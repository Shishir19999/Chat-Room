// Client for the real Express + Socket.IO + MongoDB backend.
import { io } from 'socket.io-client';
import { createEmitter } from './emitter.js';
import { LIMITS } from '../lib/limits.js';

export function createRealClient({ url }) {
  const bus = createEmitter();
  let socket = null;
  let joined = null; // { user, room } to restore after reconnect

  const http = async (path, options) => {
    let res;
    try {
      res = await fetch(`${url}${path}`, options);
    } catch {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  };
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const ack = (event, payload) => new Promise((resolve, reject) => {
    if (!socket?.connected) { reject(new Error('Not connected. Please wait for reconnection.')); return; }
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) reject(new Error('The server did not respond.'));
      else if (res && res.ok === false) reject(new Error(res.error || 'Request failed'));
      else resolve(res);
    });
  });

  return {
    mode: 'real',
    defaultUnreadWindowMs: 0,
    on: bus.on,
    limits: LIMITS,

    connect() {
      if (socket) return;
      bus.emit('status', 'connecting');
      socket = io(url, { reconnectionDelayMax: 5000 });
      socket.on('connect', () => {
        bus.emit('status', 'connected');
        if (joined) {
          socket.emit('join', joined);
          bus.emit('reconnected', joined);
        }
      });
      socket.on('disconnect', () => bus.emit('status', 'disconnected'));
      socket.io.on('reconnect_attempt', () => bus.emit('status', 'reconnecting'));
      socket.on('connect_error', () => bus.emit('status', 'reconnecting'));
      for (const ev of ['message', 'message_updated', 'presence', 'typing', 'activity', 'rooms_changed']) {
        socket.on(ev, (p) => bus.emit(ev, p));
      }
      socket.on('error_message', (m) => bus.emit('error_message', m));
    },

    disconnect() {
      socket?.disconnect();
      socket = null;
      joined = null;
    },

    async listRooms() { return (await http('/rooms')).data; },
    createRoom(input) { return http('/rooms', json('POST', input)); },
    async unread(user, since) { return (await http('/rooms/unread', json('POST', { user, since }))).data; },

    history(room, { before, limit = LIMITS.pageSize, q } = {}) {
      const params = new URLSearchParams({ room, limit: String(limit) });
      if (before) params.set('before', before);
      if (q) params.set('q', q);
      return http(`/messages?${params}`);
    },

    join(user, room) {
      joined = { user, room };
      return new Promise((resolve, reject) => {
        if (!socket?.connected) { resolve(); return; } // joined automatically on connect
        socket.emit('join', joined);
        const t = setTimeout(() => reject(new Error('The server did not respond.')), 8000);
        socket.once('joined', () => { clearTimeout(t); resolve(); });
      });
    },

    leave() {
      joined = null;
      socket?.emit('leave');
    },

    send({ message, image, replyTo }) { return ack('message', { message, image, replyTo }); },
    edit(id, message) { return ack('edit', { id, message }); },
    remove(id) { return ack('delete', { id }); },
    react(id, emoji) { return ack('react', { id, emoji }); },
    typing(on) { socket?.emit('typing', Boolean(on)); },
  };
}
