// Pure-ish data layer of the demo backend. Same rules as the Express/Mongo backend.
// State lives in a storage adapter (localStorage in the browser, an in-memory map in tests).
import { LIMITS, DEFAULT_ROOM, cleanRoom } from '../../lib/limits.js';
import { buildSeed, makeId } from './seed.js';

export const STORAGE_KEY = 'chatroom-demo:v1';
const MAX_STORED_MESSAGES = 600;

export const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isImageDataUrl = (v) => typeof v === 'string' && v.length <= LIMITS.image && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
const fail = (message) => { throw new Error(message); };

export function createStore({ storage = memoryStorage(), now = Date.now } = {}) {
  let state = null;
  let lastRaw = null;

  const persist = () => {
    // Keep storage bounded: drop the oldest messages if the quota is hit.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        lastRaw = JSON.stringify(state);
        storage.setItem(STORAGE_KEY, lastRaw);
        return;
      } catch {
        const drop = Math.max(10, Math.floor(state.messages.length * 0.15));
        if (state.messages.length <= drop) break;
        state.messages.splice(0, drop);
      }
    }
    fail('Browser storage is full. Reset the demo data and try again.');
  };

  const fresh = () => {
    state = buildSeed(now());
    persist();
  };

  // Re-reads storage when another tab changed it.
  const sync = () => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw && raw === lastRaw && state) return state;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.messages) && Array.isArray(parsed.rooms)) {
          state = parsed;
          lastRaw = raw;
          return state;
        }
      } catch { /* corrupted: fall through and re-seed */ }
    }
    fresh();
    return state;
  };

  const nextId = () => {
    sync();
    state.seq += 1;
    return makeId(now(), state.seq);
  };

  const inRoom = (room) => (m) => cleanRoom(m.room) === room;
  const find = (id, room) => {
    const m = sync().messages.find((x) => x._id === id);
    if (!m || cleanRoom(m.room) !== room) fail('Unknown message');
    return m;
  };
  const touch = (m) => { m.updatedAt = new Date(now()).toISOString(); };

  return {
    sync,
    reset() { fresh(); },

    listRooms() {
      const s = sync();
      const stats = new Map();
      for (const m of s.messages) {
        const r = cleanRoom(m.room);
        const cur = stats.get(r) || { count: 0, lastAt: null };
        cur.count += 1;
        if (!cur.lastAt || m.createdAt > cur.lastAt) cur.lastAt = m.createdAt;
        stats.set(r, cur);
      }
      const list = s.rooms.map((r) => ({ name: r.name, description: r.description || '', count: 0, lastAt: null, ...(stats.get(r.name) || {}) }));
      for (const [name, st] of stats) if (!list.some((r) => r.name === name)) list.push({ name, description: '', ...st });
      return list.sort((a, b) => (a.name === DEFAULT_ROOM ? -1 : b.name === DEFAULT_ROOM ? 1 : a.name.localeCompare(b.name)));
    },

    createRoom({ name, description, user }) {
      const raw = clean(name, LIMITS.room).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (raw.length < 2) fail('Room name needs 2-30 letters, numbers, - or _');
      const s = sync();
      if (raw === DEFAULT_ROOM || s.rooms.some((r) => r.name === raw) || s.messages.some(inRoom(raw))) fail(`Room #${raw} already exists`);
      const room = { name: raw, description: clean(description, LIMITS.description), createdBy: clean(user, LIMITS.user) };
      s.rooms.push(room);
      persist();
      return { name: room.name, description: room.description, count: 0, lastAt: null };
    },

    unread({ user, since = {} }) {
      const s = sync();
      const out = {};
      for (const [name, iso] of Object.entries(since).slice(0, 100)) {
        const t = new Date(iso).getTime();
        if (Number.isNaN(t)) continue;
        const room = cleanRoom(name);
        out[room] = s.messages.filter((m) => cleanRoom(m.room) === room && !m.deleted && m.user !== user && new Date(m.createdAt).getTime() > t).length;
      }
      return out;
    },

    // { data: oldest..newest, hasMore, nextBefore } like GET /messages
    history(room, { before, limit = LIMITS.pageSize, q } = {}) {
      const r = cleanRoom(room);
      const n = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || LIMITS.pageSize));
      let rows = sync().messages.filter(inRoom(r));
      const needle = clean(q, 100).toLowerCase();
      if (needle) rows = rows.filter((m) => !m.deleted && m.message.toLowerCase().includes(needle));
      if (before) {
        const idx = rows.findIndex((m) => m._id === before);
        if (idx === -1) fail('Unknown "before" cursor');
        rows = rows.slice(0, idx);
      }
      const hasMore = rows.length > n;
      const page = rows.slice(-n);
      return { data: structuredClone(page), hasMore, nextBefore: hasMore && page.length ? page[0]._id : null };
    },

    addMessage({ user, message, room, image, replyTo }) {
      const u = clean(user, LIMITS.user);
      const m = clean(message, LIMITS.message);
      const img = isImageDataUrl(image) ? image : undefined;
      if (!u || (!m && !img)) fail(`Message must be 1-${LIMITS.message} characters`);
      const r = cleanRoom(room);
      const s = sync();
      const ts = new Date(now()).toISOString();
      const doc = { _id: nextId(), user: u, message: m, room: r, reactions: [], createdAt: ts, updatedAt: ts };
      if (img) doc.image = img;
      if (replyTo) {
        const parent = s.messages.find((x) => x._id === replyTo);
        if (parent && cleanRoom(parent.room) === r) {
          doc.replyTo = { _id: parent._id, user: parent.user, message: parent.deleted ? '' : (parent.message || (parent.image ? 'Image' : '')).slice(0, LIMITS.snippet) };
        }
      }
      s.messages.push(doc);
      if (s.messages.length > MAX_STORED_MESSAGES) s.messages.splice(0, s.messages.length - MAX_STORED_MESSAGES);
      persist();
      return structuredClone(doc);
    },

    editMessage({ id, user, room, message }) {
      const m = find(id, cleanRoom(room));
      if (m.user !== user) fail('You can only edit your own messages');
      if (m.deleted) fail('Message was deleted');
      const text = clean(message, LIMITS.message);
      if (!text && !m.image) fail(`Message must be 1-${LIMITS.message} characters`);
      m.message = text;
      m.editedAt = new Date(now()).toISOString();
      touch(m);
      persist();
      return structuredClone(m);
    },

    deleteMessage({ id, user, room }) {
      const m = find(id, cleanRoom(room));
      if (m.user !== user) fail('You can only delete your own messages');
      m.deleted = true;
      m.message = '';
      delete m.image;
      m.reactions = [];
      touch(m);
      persist();
      return structuredClone(m);
    },

    toggleReaction({ id, user, room, emoji }) {
      const e = clean(emoji, LIMITS.emoji);
      if (!e || /[<>&]/.test(e)) fail('Invalid emoji');
      const m = find(id, cleanRoom(room));
      if (m.deleted) fail('Message was deleted');
      const entry = m.reactions.find((r) => r.emoji === e);
      if (entry) {
        entry.users = entry.users.includes(user) ? entry.users.filter((x) => x !== user) : [...entry.users, user];
        if (entry.users.length === 0) m.reactions = m.reactions.filter((r) => r.emoji !== e);
      } else {
        if (m.reactions.length >= LIMITS.reactionKinds) fail('Too many different reactions');
        m.reactions.push({ emoji: e, users: [user] });
      }
      touch(m);
      persist();
      return structuredClone(m);
    },
  };
}
