import { useCallback, useEffect, useReducer, useRef } from 'react';
import { LIMITS } from '../lib/limits.js';
import { KEYS, readJson, writeJson } from '../lib/storage.js';
import { playBeep } from '../lib/sound.js';

const initial = {
  status: 'connecting',
  phase: 'loading', // loading | ready | error
  error: '',
  messages: [],
  hasMore: false,
  nextBefore: null,
  loadingOlder: false,
  online: [],
  typing: [],
  rooms: [],
  roomsPhase: 'loading', // loading | ready | error
  unread: {},
};

const upsertRoom = (rooms, room) => (rooms.some((r) => r.name === room.name) ? rooms : [...rooms, room]);

function reducer(s, a) {
  switch (a.type) {
    case 'status': return { ...s, status: a.status };
    case 'loading': return { ...s, phase: 'loading', error: '', messages: [], hasMore: false, nextBefore: null, online: [], typing: [] };
    case 'loaded': return { ...s, phase: 'ready', error: '', messages: a.data, hasMore: a.hasMore, nextBefore: a.nextBefore };
    case 'failed': return { ...s, phase: 'error', error: a.error };
    case 'older_start': return { ...s, loadingOlder: true };
    case 'older_done': {
      const seen = new Set(s.messages.map((m) => m._id));
      return { ...s, loadingOlder: false, messages: [...a.data.filter((m) => !seen.has(m._id)), ...s.messages], hasMore: a.hasMore, nextBefore: a.nextBefore };
    }
    case 'older_failed': return { ...s, loadingOlder: false };
    case 'message': return s.messages.some((m) => m._id === a.message._id) ? s : { ...s, messages: [...s.messages, a.message] };
    case 'updated': return { ...s, messages: s.messages.map((m) => (m._id === a.message._id ? a.message : m)) };
    case 'presence': return { ...s, online: a.users };
    case 'typing': {
      const without = s.typing.filter((u) => u !== a.user);
      return { ...s, typing: a.typing ? [...without, a.user] : without };
    }
    case 'rooms': return { ...s, rooms: a.rooms, roomsPhase: 'ready' };
    case 'rooms_failed': return { ...s, roomsPhase: 'error' };
    case 'room_added': return { ...s, rooms: upsertRoom(s.rooms, a.room) };
    case 'unread': return { ...s, unread: a.unread };
    case 'unread_inc': return { ...s, unread: { ...s.unread, [a.room]: (s.unread[a.room] || 0) + 1 } };
    case 'unread_clear': return s.unread[a.room] ? { ...s, unread: { ...s.unread, [a.room]: 0 } } : s;
    default: return s;
  }
}

const errMsg = (e) => (e instanceof Error ? e.message : 'Something went wrong.');

/**
 * Connects the UI to a client (real or demo) for one user and the currently open room.
 */
export function useChat({ client, user, room, soundOn }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const roomRef = useRef(room);
  const soundRef = useRef(soundOn);
  const typingTimers = useRef(new Map());
  const lastTyping = useRef(0);
  const joinToken = useRef(0);

  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  const markRead = useCallback((r) => {
    const map = readJson(KEYS.lastRead(user), {});
    map[r] = new Date().toISOString();
    writeJson(KEYS.lastRead(user), map);
    dispatch({ type: 'unread_clear', room: r });
  }, [user]);

  const loadRooms = useCallback(async () => {
    try {
      const rooms = await client.listRooms();
      dispatch({ type: 'rooms', rooms });
      const stored = readJson(KEYS.lastRead(user), {});
      const fallback = new Date(Date.now() - client.defaultUnreadWindowMs).toISOString();
      const since = {};
      for (const r of rooms) since[r.name] = r.name === roomRef.current ? new Date().toISOString() : (stored[r.name] || fallback);
      const unread = await client.unread(user, since);
      unread[roomRef.current] = 0;
      dispatch({ type: 'unread', unread });
    } catch (e) {
      console.warn('Could not load rooms:', errMsg(e));
      dispatch({ type: 'rooms_failed' });
    }
  }, [client, user]);

  const loadHistory = useCallback(async (r, { silent = false } = {}) => {
    const token = ++joinToken.current;
    if (!silent) dispatch({ type: 'loading' });
    try {
      await client.join(user, r);
      const page = await client.history(r, { limit: LIMITS.pageSize });
      if (token !== joinToken.current) return;
      dispatch({ type: 'loaded', data: Array.isArray(page.data) ? page.data : [], hasMore: Boolean(page.hasMore), nextBefore: page.nextBefore || null });
      markRead(r);
    } catch (e) {
      if (token === joinToken.current) dispatch({ type: 'failed', error: errMsg(e) });
    }
  }, [client, user, markRead]);

  // Event wiring + connection lifetime.
  useEffect(() => {
    const timers = typingTimers.current;
    const offs = [
      client.on('status', (status) => dispatch({ type: 'status', status })),
      client.on('message', (message) => {
        if (message.room && message.room !== roomRef.current) return;
        dispatch({ type: 'message', message });
        if (message.user !== user) markRead(roomRef.current);
      }),
      client.on('message_updated', (message) => dispatch({ type: 'updated', message })),
      client.on('presence', (p) => { if (p.room === roomRef.current) dispatch({ type: 'presence', users: p.users }); }),
      client.on('typing', ({ room: r, user: who, typing }) => {
        if (who === user || r !== roomRef.current) return;
        clearTimeout(timers.get(who));
        dispatch({ type: 'typing', user: who, typing });
        if (typing) timers.set(who, setTimeout(() => dispatch({ type: 'typing', user: who, typing: false }), 5000));
      }),
      client.on('activity', ({ room: r, user: who }) => {
        if (who === user) return;
        if (soundRef.current) playBeep();
        if (r !== roomRef.current) dispatch({ type: 'unread_inc', room: r });
        loadRoomsLater();
      }),
      client.on('rooms_changed', (r) => dispatch({ type: 'room_added', room: r })),
      client.on('reconnected', () => loadHistory(roomRef.current, { silent: true })),
      client.on('reset', () => { loadRooms(); loadHistory(roomRef.current); }),
    ];
    let roomsTimer = null;
    function loadRoomsLater() {
      clearTimeout(roomsTimer);
      roomsTimer = setTimeout(async () => {
        try { dispatch({ type: 'rooms', rooms: await client.listRooms() }); } catch { /* keep the old list */ }
      }, 600);
    }
    client.connect();
    return () => {
      offs.forEach((off) => off());
      clearTimeout(roomsTimer);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      client.disconnect();
    };
  }, [client, user, markRead, loadRooms, loadHistory]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  useEffect(() => { loadHistory(room); }, [room, loadHistory]);

  const loadOlder = useCallback(async () => {
    if (!state.nextBefore || state.loadingOlder) return;
    dispatch({ type: 'older_start' });
    try {
      const page = await client.history(room, { before: state.nextBefore, limit: LIMITS.pageSize });
      dispatch({ type: 'older_done', data: page.data || [], hasMore: Boolean(page.hasMore), nextBefore: page.nextBefore || null });
    } catch (e) {
      dispatch({ type: 'older_failed' });
      throw e;
    }
  }, [client, room, state.nextBefore, state.loadingOlder]);

  const setTyping = useCallback((on) => {
    const now = Date.now();
    if (on && now - lastTyping.current < 1500) return;
    lastTyping.current = on ? now : 0;
    client.typing(on);
  }, [client]);

  return {
    ...state,
    retry: () => loadHistory(room),
    retryRooms: loadRooms,
    loadOlder,
    setTyping,
    send: (payload) => client.send(payload),
    edit: (id, text) => client.edit(id, text),
    remove: (id) => client.remove(id),
    react: (id, emoji) => client.react(id, emoji),
    createRoom: async (input) => {
      const created = await client.createRoom({ ...input, user });
      dispatch({ type: 'room_added', room: created });
      return created;
    },
    search: (q, opts = {}) => client.history(room, { ...opts, q, limit: LIMITS.pageSize }),
  };
}
