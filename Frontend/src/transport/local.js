import { createEmitter } from '../core/emitter.js';
import { newId } from '../core/ops.js';

// Same-browser fallback: tabs of one browser talk through BroadcastChannel. Used only when the peer-to-peer
// transport is offline or has found nobody yet, so a lone visitor can still use several tabs.
export function createLocalBus(ws) {
  const bus = createEmitter();
  const selfId = `tab:${newId(8)}`;
  const peers = new Set();
  const pending = new Map(); // request id -> resolve
  let channel = null;
  let historyProvider = async () => [];

  const post = (msg) => { try { channel?.postMessage({ ...msg, from: selfId }); } catch { /* channel closed */ } };

  function onMessage({ data }) {
    if (!data || typeof data !== 'object' || data.from === selfId || typeof data.from !== 'string') return;
    if (data.to && data.to !== selfId) return;
    const from = data.from;
    switch (data.k) {
      case 'hi':
        if (!peers.has(from)) { peers.add(from); bus.emit('peer-join', { peerId: from }); post({ k: 'hi2', to: from }); }
        break;
      case 'hi2':
        if (!peers.has(from)) { peers.add(from); bus.emit('peer-join', { peerId: from }); }
        break;
      case 'bye':
        if (peers.delete(from)) bus.emit('peer-leave', { peerId: from });
        break;
      case 'op':
        bus.emit('op', data.op, { peerId: from });
        break;
      case 'eph':
        bus.emit('eph', { type: data.type, data: data.data }, { peerId: from });
        break;
      case 'hreq':
        Promise.resolve(historyProvider(data.query, { peerId: from })).then((ops) => post({ k: 'hres', to: from, id: data.id, ops })).catch(() => post({ k: 'hres', to: from, id: data.id, ops: [] }));
        break;
      case 'hres':
        pending.get(data.id)?.(Array.isArray(data.ops) ? data.ops : []);
        break;
      default:
    }
  }

  return {
    selfId,
    peers,
    on: bus.on,
    setHistoryProvider(fn) { historyProvider = fn; },
    open() {
      if (channel || typeof BroadcastChannel === 'undefined') return;
      channel = new BroadcastChannel(`chatroom:${ws}`);
      channel.onmessage = onMessage;
      post({ k: 'hi' });
    },
    close() {
      if (!channel) return;
      post({ k: 'bye' });
      for (const id of [...peers]) { peers.delete(id); bus.emit('peer-leave', { peerId: id }); }
      channel.close();
      channel = null;
    },
    get isOpen() { return Boolean(channel); },
    sendOp(op, to) { post({ k: 'op', op, ...(to ? { to } : {}) }); },
    sendEph(type, data, to) { post({ k: 'eph', type, data, ...(to ? { to } : {}) }); },
    request(query, to, timeoutMs = 2500) {
      return new Promise((resolve) => {
        const id = newId(8);
        const timer = setTimeout(() => { pending.delete(id); resolve([]); }, timeoutMs);
        pending.set(id, (ops) => { clearTimeout(timer); pending.delete(id); resolve(ops); });
        post({ k: 'hreq', id, to, query });
      });
    },
  };
}
