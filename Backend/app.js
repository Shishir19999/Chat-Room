import http from 'http';
import mongoose from 'mongoose';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import ChatMessage from './models/ChatMessage.js';
import Room from './models/Room.js';

const MAX_USER_LEN = 30;
const MAX_MESSAGE_LEN = 500;
const MAX_ROOM_LEN = 30;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const DEFAULT_ROOM = 'general';
const MAX_DESC_LEN = 80;
const MAX_IMAGE_LEN = 400000; // data URL characters (about 300 KB of image)
const MAX_EMOJI_LEN = 8;
const MAX_REACTION_KINDS = 12;
const MAX_SNIPPET = 140;

// ---- helpers ----
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const cleanRoom = (value) => clean(value, MAX_ROOM_LEN).toLowerCase().replace(/[^a-z0-9_-]/g, '') || DEFAULT_ROOM;

// CORS_ORIGIN: comma-separated list of allowed origins (REST + Socket.IO), e.g.
// http://localhost:5173,http://192.168.1.20:5173. Use * to allow any origin.
export function corsOptionsFromEnv() {
    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
        .split(',').map((o) => o.trim()).filter(Boolean);
    return { origin: allowedOrigins.includes('*') ? true : allowedOrigins };
}

const escapeRegex = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isImageDataUrl = (v) => typeof v === 'string' && v.length <= MAX_IMAGE_LEN && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
const roomFilter = (room) => (room === DEFAULT_ROOM ? { $or: [{ room: DEFAULT_ROOM }, { room: { $exists: false } }] } : { room });
const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === v.toLowerCase();

async function saveMessage({ user, message, room, image, replyTo }) {
    const u = clean(user, MAX_USER_LEN);
    const m = clean(message, MAX_MESSAGE_LEN);
    const img = image && isImageDataUrl(image) ? image : undefined;
    if (!u || (!m && !img)) return null;
    const r = cleanRoom(room);
    const data = { user: u, message: m, room: r };
    if (img) data.image = img;
    if (isObjectId(replyTo)) {
        const parent = await ChatMessage.findById(replyTo);
        if (parent && cleanRoom(parent.room) === r) {
            data.replyTo = { _id: parent._id, user: parent.user, message: parent.deleted ? '' : (parent.message || (parent.image ? 'Image' : '')).slice(0, MAX_SNIPPET) };
        }
    }
    const doc = new ChatMessage(data);
    await doc.save();
    return doc;
}

// Edit, delete and react helpers: return { doc } or { error }.
async function loadInRoom(id, room) {
    if (!isObjectId(id)) return { error: 'Unknown message' };
    const doc = await ChatMessage.findById(id);
    if (!doc || cleanRoom(doc.room) !== room) return { error: 'Unknown message' };
    return { doc };
}

async function editMessage({ id, user, room, message }) {
    const { doc, error } = await loadInRoom(id, room);
    if (error) return { error };
    if (doc.user !== user) return { error: 'You can only edit your own messages' };
    if (doc.deleted) return { error: 'Message was deleted' };
    const m = clean(message, MAX_MESSAGE_LEN);
    if (!m && !doc.image) return { error: `Message must be 1-${MAX_MESSAGE_LEN} characters` };
    doc.message = m;
    doc.editedAt = new Date();
    await doc.save();
    return { doc };
}

async function deleteMessage({ id, user, room }) {
    const { doc, error } = await loadInRoom(id, room);
    if (error) return { error };
    if (doc.user !== user) return { error: 'You can only delete your own messages' };
    doc.deleted = true;
    doc.message = '';
    doc.image = undefined;
    doc.reactions = [];
    await doc.save();
    return { doc };
}

async function toggleReaction({ id, user, room, emoji }) {
    const e = clean(emoji, MAX_EMOJI_LEN);
    if (!e || /[<>&]/.test(e)) return { error: 'Invalid emoji' };
    const { doc, error } = await loadInRoom(id, room);
    if (error) return { error };
    if (doc.deleted) return { error: 'Message was deleted' };
    const entry = doc.reactions.find((r) => r.emoji === e);
    if (entry) {
        if (entry.users.includes(user)) entry.users = entry.users.filter((u) => u !== user);
        else entry.users.push(user);
        if (entry.users.length === 0) doc.reactions = doc.reactions.filter((r) => r.emoji !== e);
    } else {
        if (doc.reactions.length >= MAX_REACTION_KINDS) return { error: 'Too many different reactions' };
        doc.reactions.push({ emoji: e, users: [user] });
    }
    await doc.save();
    return { doc };
}

// Builds the HTTP + Socket.IO server (not listening, not connected to MongoDB).
export function createChatServer() {
    const app = express();
    const corsOptions = corsOptionsFromEnv();
    app.use(cors(corsOptions));
    app.use(express.json({ limit: '1mb' }));
    // Express 5 leaves req.body undefined when no body is sent; keep the Express 4 behavior (empty object).
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

    const server = http.createServer(app);
    const io = new Server(server, { cors: corsOptions });

    // ---- REST ----
    // Cursor pagination, newest first from the DB but returned oldest -> newest:
    //   GET /messages?room=general&limit=50            latest page
    //   GET /messages?room=general&before=<id|ISO>&limit=50   older page
    // Response: { data: [...oldest..newest], hasMore, nextBefore }  (nextBefore = id of the oldest item)
    app.get('/messages', async (req, res) => {
        try {
            const room = cleanRoom(req.query.room);
            const limit = Math.min(MAX_PAGE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE));
            const conds = [roomFilter(room)];
            const q = clean(req.query.q, 100);
            if (q) conds.push({ deleted: { $ne: true }, message: { $regex: escapeRegex(q), $options: 'i' } });

            const before = typeof req.query.before === 'string' ? req.query.before.trim() : '';
            if (before) {
                if (isObjectId(before)) {
                    const ref = await ChatMessage.findById(before).select('createdAt');
                    if (!ref) return res.status(400).json({ error: 'Unknown "before" cursor' });
                    conds.push({ $or: [{ createdAt: { $lt: ref.createdAt } }, { createdAt: ref.createdAt, _id: { $lt: ref._id } }] });
                } else {
                    const d = new Date(before);
                    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: '"before" must be a message id or an ISO date' });
                    conds.push({ createdAt: { $lt: d } });
                }
            }
            const rows = await ChatMessage.find({ $and: conds }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
            const hasMore = rows.length > limit;
            const page = rows.slice(0, limit).reverse();
            res.json({ data: page, hasMore, nextBefore: hasMore && page.length ? page[0]._id : null });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.post('/messages', async (req, res) => {
        try {
            const doc = await saveMessage(req.body || {});
            if (!doc) {
                return res.status(400).json({ error: `User (max ${MAX_USER_LEN}) and message (max ${MAX_MESSAGE_LEN}) are required` });
            }
            io.to(doc.room).emit('message', doc);
            io.emit('activity', { room: doc.room, _id: doc._id, user: doc.user });
            res.status(201).json(doc);
        } catch (error) {
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Rooms: explicitly created rooms plus every room that already has messages.
    app.get('/rooms', async (req, res) => {
        try {
            const [created, stats] = await Promise.all([
                Room.find().lean(),
                ChatMessage.aggregate([{ $group: { _id: { $ifNull: ['$room', DEFAULT_ROOM] }, count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } }]),
            ]);
            const map = new Map();
            map.set(DEFAULT_ROOM, { name: DEFAULT_ROOM, description: 'Everyone is welcome here', count: 0, lastAt: null });
            for (const r of created) map.set(r.name, { name: r.name, description: r.description || '', count: 0, lastAt: null });
            for (const st of stats) {
                const cur = map.get(st._id) || { name: st._id, description: '', count: 0, lastAt: null };
                map.set(st._id, { ...cur, count: st.count, lastAt: st.lastAt });
            }
            const order = (a, b) => (a.name === DEFAULT_ROOM ? -1 : b.name === DEFAULT_ROOM ? 1 : a.name.localeCompare(b.name));
            res.json({ data: [...map.values()].sort(order) });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.post('/rooms', async (req, res) => {
        try {
            const raw = clean(req.body.name, MAX_ROOM_LEN).toLowerCase().replace(/[^a-z0-9_-]/g, '');
            if (raw.length < 2) return res.status(400).json({ error: 'Room name needs 2-30 letters, numbers, - or _' });
            const exists = raw === DEFAULT_ROOM || await Room.exists({ name: raw }) || await ChatMessage.exists({ room: raw });
            if (exists) return res.status(409).json({ error: `Room #${raw} already exists` });
            const room = await Room.create({ name: raw, description: clean(req.body.description, MAX_DESC_LEN), createdBy: clean(req.body.user, MAX_USER_LEN) });
            const out = { name: room.name, description: room.description, count: 0, lastAt: null };
            io.emit('rooms_changed', out);
            res.status(201).json(out);
        } catch (error) {
            if (error.code === 11000) return res.status(409).json({ error: 'Room already exists' });
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Unread counts: body { user, since: { room: ISO date } } -> { data: { room: count } }
    app.post('/rooms/unread', async (req, res) => {
        try {
            const user = clean(req.body.user, MAX_USER_LEN);
            const since = req.body.since && typeof req.body.since === 'object' ? req.body.since : {};
            const out = {};
            for (const [name, iso] of Object.entries(since).slice(0, 100)) {
                const d = new Date(iso);
                if (Number.isNaN(d.getTime())) continue;
                const room = cleanRoom(name);
                out[room] = await ChatMessage.countDocuments({ $and: [roomFilter(room), { createdAt: { $gt: d }, user: { $ne: user }, deleted: { $ne: true } }] });
            }
            res.json({ data: out });
        } catch (error) {
            console.error(error.message);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // ---- Socket.IO ----
    // presence[room] = Map(socketId -> username)
    const presence = new Map();

    const onlineUsers = (room) => {
        const users = presence.get(room);
        return users ? [...new Set(users.values())] : [];
    };

    function leaveRoom(socket) {
        const { room } = socket.data;
        if (!room) return;
        socket.leave(room);
        const users = presence.get(room);
        if (users) {
            users.delete(socket.id);
            if (users.size === 0) presence.delete(room);
        }
        socket.data.room = null;
        io.to(room).emit('presence', { room, users: onlineUsers(room) });
        io.to(room).emit('typing', { room, user: socket.data.user, typing: false });
    }

    io.on('connection', (socket) => {
        socket.on('join', (payload = {}) => {
            const user = clean(payload.user, MAX_USER_LEN);
            if (!user) {
                socket.emit('error_message', 'Username is required');
                return;
            }
            leaveRoom(socket);
            const room = cleanRoom(payload.room);
            socket.data.user = user;
            socket.data.room = room;
            socket.join(room);
            if (!presence.has(room)) presence.set(room, new Map());
            presence.get(room).set(socket.id, user);
            io.to(room).emit('presence', { room, users: onlineUsers(room) });
            socket.emit('joined', { room, user });
        });

        socket.on('leave', () => leaveRoom(socket));

        socket.on('message', async (payload = {}, ack) => {
            try {
                const { user, room } = socket.data;
                if (!room) {
                    if (typeof ack === 'function') ack({ ok: false, error: 'Join a room first' });
                    return;
                }
                const doc = await saveMessage({ user, message: payload.message, room, image: payload.image, replyTo: payload.replyTo });
                if (!doc) {
                    if (typeof ack === 'function') ack({ ok: false, error: `Message must be 1-${MAX_MESSAGE_LEN} characters` });
                    return;
                }
                io.to(room).emit('message', doc);
                io.emit('activity', { room, _id: doc._id, user: doc.user });
                if (typeof ack === 'function') ack({ ok: true });
            } catch (error) {
                console.error(error.message);
                if (typeof ack === 'function') ack({ ok: false, error: 'Could not save message' });
            }
        });

        // edit / delete / react: ack { ok, error }; everyone in the room gets 'message_updated'
        const mutation = (event, fn) => socket.on(event, async (payload = {}, ack) => {
            const reply = typeof ack === 'function' ? ack : () => {};
            try {
                const { user, room } = socket.data;
                if (!room) return reply({ ok: false, error: 'Join a room first' });
                const { doc, error } = await fn({ ...payload, user, room });
                if (error) return reply({ ok: false, error });
                io.to(room).emit('message_updated', doc);
                return reply({ ok: true });
            } catch (error) {
                console.error(error.message);
                return reply({ ok: false, error: 'Could not update message' });
            }
        });
        mutation('edit', editMessage);
        mutation('delete', deleteMessage);
        mutation('react', toggleReaction);

        socket.on('typing', (typing) => {
            const { room, user } = socket.data;
            if (!room) return;
            socket.to(room).emit('typing', { room, user, typing: Boolean(typing) });
        });

        socket.on('disconnect', () => leaveRoom(socket));
    });

    return { app, server, io };
}
