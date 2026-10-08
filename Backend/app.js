import http from 'http';
import { randomBytes } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import Op from './models/Op.js';
import Workspace from './models/Workspace.js';
import User from './models/User.js';
import Report from './models/Report.js';
import { C2S, S2C, EPH_TYPES, EPH_MAX_BYTES, ERROR } from './events.js';
import { LIMITS, OP, RATES, DEFAULT_CHANNELS } from './shared/constants.js';
import { cleanWorkspace, dmMembers, isDm, isGroup, isUid, registerKey, validateOp } from './shared/ops.js';
import { createRateLimiter } from './lib/ratelimit.js';
import { hashPassword, safeEqualHex, sha256, verifyPassword } from './lib/password.js';
import { fetchHistory } from './lib/history.js';
import { createUploadsRouter } from './lib/uploads.js';

const MAX_CHANNELS = 40;
const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

// CORS_ORIGIN: comma-separated list of allowed origins (REST + Socket.IO), e.g.
// http://localhost:5173,http://192.168.1.20:5173. Use * to allow any origin.
export function corsOptionsFromEnv() {
    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
        .split(',').map((o) => o.trim()).filter(Boolean);
    return { origin: allowedOrigins.includes('*') ? true : allowedOrigins };
}

const newer = (a, b) => a.lc > b.lc || (a.lc === b.lc && a.id > b.id);

// Builds the HTTP + Socket.IO server (not listening, not connected to MongoDB).
export function createChatServer() {
    const app = express();
    const corsOptions = corsOptionsFromEnv();
    app.disable('x-powered-by');
    app.use(cors(corsOptions));
    app.use(express.json({ limit: '64kb' }));
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

    const server = http.createServer(app);
    const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 256 * 1024 });
    const uploadTokens = new Map(); // token -> { uid, ws, socketId }
    const joinLimiter = createRateLimiter({ capacity: 60, refillPerSec: 2 });
    const failLimiter = createRateLimiter({ capacity: 8, refillPerSec: 0.1 }); // wrong passwords / identities per address
    const sweeper = setInterval(() => { joinLimiter.sweep(); failLimiter.sweep(); }, 5 * 60 * 1000);
    sweeper.unref();
    server.on('close', () => clearInterval(sweeper));

    // ---------- REST ----------
    app.get('/health', (req, res) => res.json({ ok: true }));

    // Public rooms with their activity, for the landing screen. Private rooms are never listed.
    app.get('/rooms', async (req, res) => {
        try {
            const rows = await Workspace.find({ isPrivate: false }).sort({ lastAt: -1 }).limit(30).lean();
            const out = [];
            for (const w of rows) {
                const online = new Set((await io.in(w.name).fetchSockets()).map((s) => s.data.uid)).size;
                out.push({ name: w.name, online, lastAt: w.lastAt });
            }
            res.json({ data: out });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.use(createUploadsRouter({ tokens: uploadTokens }));

    // ---------- helpers ----------
    const userRoom = (ws, uid) => `${ws}|u|${uid}`;

    async function groupOf(ws, c) {
        return Op.findOne({ w: ws, k: `g:${c.slice(4)}` }).lean();
    }

    // Returns an error string or '' when the op may be stored; also returns the audience for delivery.
    async function authorize(ws, uid, op) {
        if (op.a !== uid) return { error: 'Author mismatch' };
        if (op.w !== ws) return { error: 'Wrong room' };
        if (isGroup(op.c)) {
            const def = await groupOf(ws, op.c);
            if (op.t === OP.GROUP) {
                if (def && def.a !== uid) return { error: 'Only the creator can change a group' };
                if (!op.d.members.includes(uid)) return { error: 'Creator must be a member' };
                return { members: [...new Set([...(def?.d.members || []), ...op.d.members])] };
            }
            if (!def || def.d.del || !def.d.members.includes(uid)) return { error: 'Not a member of this group' };
            return { members: def.d.members };
        }
        if (op.t === OP.GROUP) return { error: 'Groups live in group channels' };
        if (isDm(op.c)) return { members: dmMembers(op.c) };
        if (op.t === OP.CHANNEL) {
            const exists = await Op.exists({ w: ws, k: `ch:${op.d.name}` });
            if (!exists && !DEFAULT_CHANNELS.includes(op.d.name) && (await Op.countDocuments({ w: ws, t: OP.CHANNEL })) >= MAX_CHANNELS) return { error: 'Too many channels' };
        }
        if ([OP.EDIT, OP.DEL, OP.REACT, OP.PIN].includes(op.t)) {
            const target = await Op.findOne({ w: ws, id: op.d.x, t: OP.MSG }).select('a c').lean();
            if (!target || target.c !== op.c) return { error: 'Unknown message' };
            if ((op.t === OP.EDIT || op.t === OP.DEL) && target.a !== uid) return { error: 'You can only change your own messages' };
        }
        return { members: null };
    }

    async function storeOp(ws, op) {
        const k = registerKey(op);
        const doc = { w: ws, id: op.id, c: op.c, t: op.t, a: op.a, lc: op.lc, ts: op.ts, d: op.d, ...(k ? { k } : {}) };
        if (k) {
            const prev = await Op.findOne({ w: ws, k }).lean();
            if (prev && !newer(op, prev)) return { stale: true };
            if (prev) await Op.deleteOne({ _id: prev._id });
        }
        try {
            await Op.create(doc);
        } catch (e) {
            if (e.code === 11000) return { duplicate: true };
            throw e;
        }
        return {};
    }

    async function joinWorkspace(socket, p) {
        const ws = cleanWorkspace(p.ws);
        const uid = p.uid;
        const name = clean(p.profile?.name, LIMITS.name);
        if (!ws || !isUid(uid) || !name || typeof p.secret !== 'string' || p.secret.length < 16 || p.secret.length > 128) return { ok: false, code: ERROR.BAD_REQUEST, error: 'Invalid join request.' };

        const secretHash = sha256(p.secret);
        const user = await User.findOne({ uid });
        if (!user) {
            try { await User.create({ uid, secretHash, name }); } catch (e) { if (e.code !== 11000) throw e; return { ok: false, code: ERROR.IDENTITY, error: 'This identity belongs to someone else.' }; }
        } else if (!safeEqualHex(user.secretHash, secretHash)) {
            return { ok: false, code: ERROR.IDENTITY, error: 'This identity belongs to someone else.' };
        } else {
            user.name = name; user.lastAt = new Date();
            await user.save();
        }

        let room = await Workspace.findOne({ name: ws });
        let isNew = false;
        const password = typeof p.password === 'string' ? p.password.slice(0, LIMITS.password) : '';
        if (!room) {
            const secret = password ? await hashPassword(password) : {};
            try {
                room = await Workspace.create({ name: ws, isPrivate: Boolean(password), createdBy: uid, ...secret });
                isNew = true;
            } catch (e) {
                if (e.code !== 11000) throw e;
                room = await Workspace.findOne({ name: ws });
            }
        }
        if (room.isPrivate && !(await verifyPassword(password, room))) return { ok: false, code: ERROR.WRONG_PASSWORD, error: 'Wrong room password.' };

        if (socket.data.ws && socket.data.ws !== ws) leaveWorkspace(socket);
        socket.data.uid = uid;
        socket.data.ws = ws;
        socket.data.profile = { name, color: Number.isInteger(p.profile?.color) ? p.profile.color : 0, status: clean(p.profile?.status, LIMITS.status), presence: 'online' };
        socket.join(ws);
        socket.join(userRoom(ws, uid));
        const token = randomBytes(24).toString('hex');
        uploadTokens.set(token, { uid, ws, socketId: socket.id });
        socket.data.uploadToken = token;

        const others = (await io.in(ws).fetchSockets()).filter((s) => s.id !== socket.id);
        socket.to(ws).emit(S2C.PEER_JOIN, { peerId: socket.id, uid, profile: socket.data.profile });
        return {
            ok: true, selfId: socket.id, uploadToken: token, isNew, private: room.isPrivate,
            peers: others.map((s) => ({ peerId: s.id, uid: s.data.uid, profile: s.data.profile })),
        };
    }

    function leaveWorkspace(socket) {
        const { ws, uid, uploadToken } = socket.data;
        if (!ws) return;
        if (uploadToken) uploadTokens.delete(uploadToken);
        socket.to(ws).emit(S2C.PEER_LEAVE, { peerId: socket.id, uid });
        socket.leave(ws);
        socket.leave(userRoom(ws, uid));
        socket.data.ws = null;
    }

    // ---------- Socket.IO ----------
    io.on('connection', (socket) => {
        const limits = { op: createRateLimiter(RATES.op), eph: createRateLimiter(RATES.eph), hist: createRateLimiter(RATES.hist) };
        const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
        const requireJoined = (ack) => {
            if (socket.data.ws) return true;
            reply(ack, { ok: false, code: ERROR.NOT_JOINED, error: 'Join a room first.' });
            return false;
        };

        socket.on(C2S.JOIN, async (payload, ack) => {
            try {
                const key = socket.handshake.address || socket.id;
                if (!joinLimiter.take(key) || !failLimiter.has(key)) return reply(ack, { ok: false, code: ERROR.RATE, error: 'Too many attempts. Wait a moment.' });
                if (!payload || typeof payload !== 'object') return reply(ack, { ok: false, code: ERROR.BAD_REQUEST, error: 'Invalid join request.' });
                const result = await joinWorkspace(socket, payload);
                if (!result.ok && (result.code === ERROR.WRONG_PASSWORD || result.code === ERROR.IDENTITY)) failLimiter.take(key);
                return reply(ack, result);
            } catch (error) {
                console.error(error.message);
                return reply(ack, { ok: false, error: 'Could not join the room.' });
            }
        });

        socket.on(C2S.PING, (ack) => reply(ack, { ok: true }));
        socket.on(C2S.LEAVE, () => leaveWorkspace(socket));

        socket.on(C2S.OP, async (op, ack) => {
            try {
                if (!requireJoined(ack)) return;
                if (!limits.op.take('op')) return reply(ack, { ok: false, code: ERROR.RATE, error: 'You are sending too fast.' });
                const { ws, uid } = socket.data;
                const problem = validateOp(op);
                if (problem) return reply(ack, { ok: false, error: `Invalid message (${problem}).` });
                const auth = await authorize(ws, uid, op);
                if (auth.error) return reply(ack, { ok: false, code: ERROR.FORBIDDEN, error: auth.error });
                const stored = await storeOp(ws, op);
                if (stored.duplicate || stored.stale) return reply(ack, { ok: true, duplicate: Boolean(stored.duplicate) });
                Workspace.updateOne({ name: ws }, { lastAt: new Date() }).catch(() => {});
                const wire = { id: op.id, w: ws, c: op.c, t: op.t, a: op.a, lc: op.lc, ts: op.ts, d: op.d };
                if (auth.members) {
                    let target = socket;
                    for (const m of auth.members) target = target.to(userRoom(ws, m));
                    target.emit(S2C.OP, wire, { uid });
                } else {
                    socket.to(ws).emit(S2C.OP, wire, { uid });
                }
                return reply(ack, { ok: true });
            } catch (error) {
                console.error(error.message);
                return reply(ack, { ok: false, error: 'Could not save the message.' });
            }
        });

        socket.on(C2S.EPH, (req) => {
            const { ws, uid } = socket.data;
            if (!ws || !req || typeof req !== 'object' || !EPH_TYPES.includes(req.type)) return;
            if (!limits.eph.take('eph')) return;
            let size = 0;
            try { size = JSON.stringify(req.data ?? null).length; } catch { return; }
            if (size > EPH_MAX_BYTES) return;
            const out = { type: req.type, data: req.data };
            const ctx = { peerId: socket.id, uid };
            if (typeof req.peerId === 'string') io.to(req.peerId).emit(S2C.EPH, out, ctx);
            else if (Array.isArray(req.toUids) && req.toUids.length <= LIMITS.groupMembers) {
                let target = socket;
                for (const m of req.toUids.filter(isUid)) target = target.to(userRoom(ws, m));
                target.emit(S2C.EPH, out, ctx);
            } else socket.to(ws).emit(S2C.EPH, out, ctx);
            if (req.type === 'hi' && req.data?.profile) {
                const prof = req.data.profile;
                socket.data.profile = { ...socket.data.profile, name: clean(prof.name, LIMITS.name) || socket.data.profile.name, color: Number.isInteger(prof.color) ? prof.color : socket.data.profile.color, status: clean(prof.status, LIMITS.status), presence: socket.data.profile.presence };
            }
            if (req.type === 'pres' && typeof req.data?.state === 'string') socket.data.profile = { ...socket.data.profile, presence: req.data.state };
        });

        socket.on(C2S.HISTORY, async (query, ack) => {
            try {
                if (!requireJoined(ack)) return;
                if (!limits.hist.take('hist')) return reply(ack, { ok: false, code: ERROR.RATE, ops: [] });
                return reply(ack, { ok: true, ops: await fetchHistory(socket.data.ws, socket.data.uid, query) });
            } catch (error) {
                console.error(error.message);
                return reply(ack, { ok: false, ops: [] });
            }
        });

        socket.on(C2S.REPORT, async (payload, ack) => {
            try {
                if (!requireJoined(ack)) return;
                if (!payload || typeof payload.id !== 'string' || typeof payload.c !== 'string') return reply(ack, { ok: false });
                await Report.create({ w: socket.data.ws, c: payload.c.slice(0, 60), messageId: payload.id.slice(0, 40), by: socket.data.uid, reason: clean(payload.reason, 200) });
                return reply(ack, { ok: true });
            } catch (error) {
                console.error(error.message);
                return reply(ack, { ok: false });
            }
        });

        socket.on('disconnect', () => leaveWorkspace(socket));
    });

    return { app, server, io };
}
