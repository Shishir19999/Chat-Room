// In-browser stand-in for the Express + Socket.IO + Mongo backend (same interface as realClient).
// Data is persisted in localStorage; other tabs of the same browser are kept in sync with BroadcastChannel;
// bots reply, react and show typing indicators so the room feels alive.
import { createEmitter } from '../emitter.js';
import { createStore } from './store.js';
import { planBotResponse, planAmbient } from './bots.js';
import { botsForRoom } from './seed.js';
import { cleanRoom, LIMITS } from '../../lib/limits.js';

const CHANNEL = 'chatroom-demo';
const HEARTBEAT_MS = 3000;
const PEER_TTL_MS = 8000;
const AMBIENT_MS = 35000;
const LEASE_KEY = 'chatroom-demo:ambient-lease';
const uid = () => Math.random().toString(36).slice(2, 10);

export function createDemoClient({
  storage = globalThis.localStorage,
  createChannel = (name) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)),
  latency = [60, 220],
  rand = Math.random,
  now = Date.now,
  ambient = true,
} = {}) {
  const bus = createEmitter();
  const store = createStore({ storage, now });
  const tabId = uid();
  let channel = null;
  const peers = new Map(); // tabId -> { user, room, seen }
  const timers = new Set();

  let me = null; // { user, room }
  let connected = false;
  let heartbeat = null;
  let ambientTimer = null;
  let lastPresence = '';

  const wait = (ms) => new Promise((resolve) => { const t = setTimeout(() => { timers.delete(t); resolve(); }, ms); timers.add(t); });
  const delay = () => wait(latency[0] + rand() * (latency[1] - latency[0]));
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const post = (msg) => { try { channel?.postMessage({ ...msg, from: tabId }); } catch { /* channel closed */ } };

  // Deliver an event locally (only if it belongs to the room we are in) and to the other tabs.
  const inMyRoom = (p) => me && p.room === me.room;
  const publish = (event, payload) => {
    if (event === 'activity' || event === 'rooms_changed' || inMyRoom(payload)) bus.emit(event, payload);
    post({ t: 'event', event, payload });
  };

  const presenceFor = (room) => {
    const users = new Set(botsForRoom(room));
    for (const p of peers.values()) if (p.room === room && p.user) users.add(p.user);
    if (me && me.room === room) users.add(me.user);
    return [...users];
  };
  const emitPresence = (force = false) => {
    if (!me) return;
    const users = presenceFor(me.room);
    const key = `${me.room}|${users.join(',')}`;
    if (!force && key === lastPresence) return;
    lastPresence = key;
    bus.emit('presence', { room: me.room, users });
  };
  const prune = () => {
    const t = now();
    let changed = false;
    for (const [id, p] of peers) if (t - p.seen > PEER_TTL_MS) { peers.delete(id); changed = true; }
    if (changed) emitPresence();
  };
  const hello = () => { if (me) post({ t: 'hello', user: me.user, room: me.room }); };

  const openChannel = () => {
    channel = createChannel(CHANNEL);
    if (!channel) return;
    channel.onmessage = ({ data }) => {
      if (!data || data.from === tabId) return;
      if (data.t === 'hello') {
        peers.set(data.from, { user: data.user, room: data.room, seen: now() });
        emitPresence();
      } else if (data.t === 'bye') {
        peers.delete(data.from);
        emitPresence();
      } else if (data.t === 'event') {
        store.sync();
        const { event, payload } = data;
        if (event === 'activity' || event === 'rooms_changed' || inMyRoom(payload)) bus.emit(event, payload);
      } else if (data.t === 'reset') {
        store.sync();
        bus.emit('reset', {});
      }
    };
  };

  const startAmbient = () => {
    if (!ambient || ambientTimer) return;
    ambientTimer = setInterval(() => {
      if (!connected) return;
      const lease = Number(storage.getItem(LEASE_KEY) || 0);
      if (now() - lease < AMBIENT_MS - 2000) return; // another tab handles it
      storage.setItem(LEASE_KEY, String(now()));
      const rooms = store.listRooms().map((r) => r.name);
      const { room, bot, text } = planAmbient({ rooms, rand });
      try {
        const doc = store.addMessage({ user: bot, message: text, room });
        publish('message', doc);
        publish('activity', { room, _id: doc._id, user: bot });
      } catch { /* storage full: skip */ }
    }, AMBIENT_MS);
  };

  const scheduleBots = ({ doc, room, user, text }) => {
    const plan = planBotResponse({ text, user, room, rand });
    for (const r of plan.replies) {
      later(() => publish('typing', { room, user: r.bot, typing: true }), r.delayMs);
      later(() => {
        publish('typing', { room, user: r.bot, typing: false });
        try {
          const reply = store.addMessage({ user: r.bot, message: r.text, room });
          publish('message', reply);
          publish('activity', { room, _id: reply._id, user: r.bot });
        } catch { /* storage full: skip */ }
      }, r.delayMs + r.typingMs);
    }
    if (plan.reaction) {
      later(() => {
        try { publish('message_updated', store.toggleReaction({ id: doc._id, user: plan.reaction.bot, room, emoji: plan.reaction.emoji })); } catch { /* message gone */ }
      }, plan.reaction.delayMs);
    }
  };

  const requireRoom = () => { if (!me) throw new Error('Join a room first'); return me; };

  return {
    mode: 'demo',
    defaultUnreadWindowMs: 3 * 3600 * 1000,
    on: bus.on,
    tabId,

    connect() {
      if (connected) return;
      openChannel();
      bus.emit('status', 'connecting');
      later(() => {
        connected = true;
        bus.emit('status', 'connected');
        heartbeat = setInterval(() => { hello(); prune(); }, HEARTBEAT_MS);
        startAmbient();
        hello();
      }, 350);
    },

    disconnect() {
      post({ t: 'bye' });
      clearInterval(heartbeat);
      clearInterval(ambientTimer);
      ambientTimer = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      connected = false;
      me = null;
      channel?.close();
      channel = null;
    },

    async listRooms() { await delay(); return store.listRooms(); },

    async createRoom(input) {
      await delay();
      const room = store.createRoom(input);
      publish('rooms_changed', room);
      return room;
    },

    async unread(user, since) { await delay(); return store.unread({ user, since }); },

    async history(room, opts = {}) { await delay(); return store.history(room, opts); },

    async join(user, room) {
      await delay();
      me = { user, room: cleanRoom(room) };
      peers.delete(tabId);
      lastPresence = '';
      hello();
      emitPresence(true);
    },

    leave() {
      me = null;
      post({ t: 'bye' });
    },

    async send({ message, image, replyTo }) {
      const { user, room } = requireRoom();
      await delay();
      const doc = store.addMessage({ user, message, room, image, replyTo });
      publish('message', doc);
      publish('activity', { room, _id: doc._id, user });
      scheduleBots({ doc, room, user, text: doc.message });
      return doc;
    },

    async edit(id, message) {
      const { user, room } = requireRoom();
      await delay();
      publish('message_updated', store.editMessage({ id, user, room, message }));
    },

    async remove(id) {
      const { user, room } = requireRoom();
      await delay();
      publish('message_updated', store.deleteMessage({ id, user, room }));
    },

    async react(id, emoji) {
      const { user, room } = requireRoom();
      await delay();
      publish('message_updated', store.toggleReaction({ id, user, room, emoji }));
    },

    typing(on) {
      if (!me) return;
      post({ t: 'event', event: 'typing', payload: { room: me.room, user: me.user, typing: Boolean(on) } });
    },

    async reset() {
      await delay();
      store.reset();
      post({ t: 'reset' });
      bus.emit('reset', {});
    },

    limits: LIMITS,
  };
}
