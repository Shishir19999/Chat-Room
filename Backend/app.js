import http from 'http';
import mongoose from 'mongoose';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import ChatMessage from './models/ChatMessage.js';

const MAX_USER_LEN = 30;
const MAX_MESSAGE_LEN = 500;
const MAX_ROOM_LEN = 30;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const DEFAULT_ROOM = 'general';

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

async function saveMessage({ user, message, room }) {
    const u = clean(user, MAX_USER_LEN);
    const m = clean(message, MAX_MESSAGE_LEN);
    if (!u || !m) return null;
    const doc = new ChatMessage({ user: u, message: m, room: cleanRoom(room) });
    await doc.save();
    return doc;
}

// Builds the HTTP + Socket.IO server (not listening, not connected to MongoDB).
export function createChatServer() {
    const app = express();
    const corsOptions = corsOptionsFromEnv();
    app.use(cors(corsOptions));
    app.use(express.json());
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
            const filter = room === DEFAULT_ROOM
                ? { $or: [{ room: DEFAULT_ROOM }, { room: { $exists: false } }] }
                : { room };

            const before = typeof req.query.before === 'string' ? req.query.before.trim() : '';
            const conds = [filter];
            if (before) {
                if (mongoose.Types.ObjectId.isValid(before) && String(new mongoose.Types.ObjectId(before)) === before.toLowerCase()) {
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
            res.status(201).json(doc);
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
                const doc = await saveMessage({ user, message: payload.message, room });
                if (!doc) {
                    if (typeof ack === 'function') ack({ ok: false, error: `Message must be 1-${MAX_MESSAGE_LEN} characters` });
                    return;
                }
                io.to(room).emit('message', doc);
                if (typeof ack === 'function') ack({ ok: true });
            } catch (error) {
                console.error(error.message);
                if (typeof ack === 'function') ack({ ok: false, error: 'Could not save message' });
            }
        });

        socket.on('typing', (typing) => {
            const { room, user } = socket.data;
            if (!room) return;
            socket.to(room).emit('typing', { room, user, typing: Boolean(typing) });
        });

        socket.on('disconnect', () => leaveRoom(socket));
    });

    return { app, server, io };
}
