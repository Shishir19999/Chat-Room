import { io } from 'socket.io-client';
import { createEmitter } from '../core/emitter.js';
import { C2S, S2C } from './socketEvents.js';

// Full-stack transport: Socket.IO to the Express server, which stores everything in MongoDB.
// Implements the same interface as the peer-to-peer transport, so the engine and UI do not care.
export function createSocketTransport({ url, secret }) {
  const bus = createEmitter();
  const unacked = new Map(); // op id -> op, resent after a reconnect
  let socket = null;
  let joinInfo = null;
  let uploadToken = '';
  let selfId = '';
  let rtt = null;
  let pingTimer = null;
  let stopped = true;
  let joined = false;
  let lastError = '';

  const emitStatus = (state, detail = '') => {
    bus.emit('status', {
      state, detail, strategy: 'Socket.IO', relays: null, rtt,
      quality: rtt == null ? null : rtt < 150 ? 'good' : rtt < 400 ? 'fair' : 'poor',
    });
  };

  function sendOne(op) {
    unacked.set(op.id, op);
    socket.emit(C2S.OP, op, (reply) => {
      if (reply?.ok) { unacked.delete(op.id); return; }
      unacked.delete(op.id);
      bus.emit('reject', { id: op.id, error: reply?.error || 'The server did not accept this message.', code: reply?.code });
    });
  }

  function doJoin() {
    socket.emit(C2S.JOIN, { ws: joinInfo.ws, password: joinInfo.password || undefined, uid: joinInfo.uid, secret, profile: joinInfo.profile }, (reply) => {
      if (!reply?.ok) {
        joined = false;
        lastError = reply?.error || 'Could not join the room.';
        emitStatus('offline', lastError);
        bus.emit('join-error', { code: reply?.code || 'error', error: lastError });
        return;
      }
      joined = true;
      lastError = '';
      selfId = reply.selfId;
      uploadToken = reply.uploadToken;
      emitStatus('online', 'Connected to the server.');
      bus.emit('joined', { isNew: reply.isNew, private: reply.private });
      for (const p of reply.peers || []) bus.emit('peer-join', { peerId: p.peerId, uid: p.uid, profile: p.profile });
      for (const op of unacked.values()) sendOne(op);
      measure();
    });
  }

  function measure() {
    if (!socket?.connected) return;
    const t0 = performance.now();
    socket.emit(C2S.PING, () => { rtt = Math.round(performance.now() - t0); emitStatus(joined ? 'online' : 'connecting', joined ? 'Connected to the server.' : ''); });
  }

  return {
    kind: 'socket',
    signed: false,
    autoLoadMedia: true,
    centralHistory: true,
    get selfId() { return selfId || socket?.id || 'pending'; },
    on: bus.on,
    setResolver() {},
    setHistoryProvider() {},
    setBlobProvider() {},

    async join({ ws, password, uid, profile }) {
      joinInfo = { ws, password, uid, profile };
      stopped = false;
      emitStatus('connecting', 'Connecting to the server...');
      socket = io(url, { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
      socket.on('connect', doJoin);
      socket.on('disconnect', (reason) => {
        joined = false;
        if (!stopped) emitStatus('offline', reason === 'io server disconnect' ? 'The server closed the connection.' : 'Connection lost. Reconnecting...');
      });
      socket.io.on('reconnect_attempt', () => { if (!stopped) emitStatus('connecting', 'Reconnecting...'); });
      socket.on('connect_error', () => { if (!stopped) emitStatus('offline', 'Cannot reach the server. Retrying...'); });
      socket.on(S2C.PEER_JOIN, (p) => bus.emit('peer-join', { peerId: p.peerId, uid: p.uid, profile: p.profile }));
      socket.on(S2C.PEER_LEAVE, (p) => bus.emit('peer-leave', { peerId: p.peerId }));
      socket.on(S2C.OP, (op, ctx) => bus.emit('op', op, { uid: ctx?.uid }));
      socket.on(S2C.EPH, (e, ctx) => bus.emit('eph', e, { peerId: ctx?.peerId, uid: ctx?.uid }));
      pingTimer = setInterval(measure, 10000);
    },

    leave() {
      stopped = true;
      clearInterval(pingTimer);
      if (socket) { socket.emit(C2S.LEAVE); socket.disconnect(); socket = null; }
      joined = false;
    },

    sendOp(op) { if (socket) sendOne(op); },
    sendEph(type, data, { toUids, peerId } = {}) {
      if (socket?.connected && joined) socket.emit(C2S.EPH, { type, data, ...(toUids ? { toUids } : {}), ...(peerId ? { peerId } : {}) });
    },

    requestHistory(query) {
      return new Promise((resolve) => {
        if (!socket?.connected || !joined) { resolve([]); return; }
        const timer = setTimeout(() => resolve([]), 10000);
        socket.emit(C2S.HISTORY, query, (reply) => { clearTimeout(timer); resolve(reply?.ok && Array.isArray(reply.ops) ? reply.ops : []); });
      });
    },

    report(payload) {
      return new Promise((resolve) => socket.emit(C2S.REPORT, payload, (r) => resolve(Boolean(r?.ok))));
    },

    async publishBlob(att, blob) {
      if (!uploadToken) throw new Error('Not connected to the server.');
      const form = new FormData();
      form.append('name', att.name);
      form.append('mime', att.mime);
      form.append('file', blob, att.name);
      const res = await fetch(`${url}/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${uploadToken}` }, body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed.');
      return { id: body.id, url: body.url };
    },
    async fetchBlob(att) {
      const res = await fetch(`${url}${att.url}`);
      if (!res.ok) throw new Error('Download failed.');
      return res.blob();
    },
    get lastError() { return lastError; },
  };
}
