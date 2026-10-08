import { createEmitter } from '../core/emitter.js';

// In-process transport used by tests: mimics the peer-to-peer transport (peers only learn each other's
// user id through a signed hello) without any network. A hub connects any number of transports.
export function createMemoryHub({ latency = 0 } = {}) {
  const rooms = new Map(); // ws -> Map(peerId -> transport)
  let counter = 0;
  const later = (fn) => (latency ? setTimeout(fn, latency) : queueMicrotask(fn));

  function create({ peerId = `peer${++counter}`, signed = true } = {}) {
    const bus = createEmitter();
    let ws = null;
    let uid = null;
    let online = true;
    let resolver = () => [];
    let historyProvider = async () => [];
    let blobProvider = async () => null;
    const sent = { ops: 0, eph: 0 };

    const members = () => rooms.get(ws) || new Map();
    const others = () => [...members().values()].filter((t) => t !== self && t.isOnline());

    const self = {
      kind: 'memory',
      selfId: peerId,
      signed,
      autoLoadMedia: false,
      sent,
      on: bus.on,
      isOnline: () => online,
      _uid: () => uid,
      _deliver(event, payload, ctx) { if (online) bus.emit(event, payload, ctx); },
      async join({ ws: name, uid: myUid }) {
        ws = name; uid = myUid;
        if (!rooms.has(ws)) rooms.set(ws, new Map());
        rooms.get(ws).set(peerId, self);
        bus.emit('status', { state: 'online', detail: 'memory', strategy: 'memory', relays: { open: 1, total: 1 }, quality: 'good', rtt: 1 });
        later(() => {
          for (const t of others()) {
            bus.emit('peer-join', { peerId: t.selfId });
            t._deliver('peer-join', { peerId }, undefined);
          }
        });
      },
      leave() {
        if (!ws) return;
        const room = rooms.get(ws);
        room?.delete(peerId);
        for (const t of room ? [...room.values()] : []) t._deliver('peer-leave', { peerId });
        ws = null;
      },
      setOnline(value) {
        if (online === value) return;
        online = value;
        if (!ws) return;
        for (const t of members().values()) {
          if (t === self) continue;
          if (!value) { t._deliver('peer-leave', { peerId }); bus.emit('peer-leave', { peerId: t.selfId }); }
          else { t._deliver('peer-join', { peerId }); bus.emit('peer-join', { peerId: t.selfId }); }
        }
        bus.emit('status', { state: value ? 'online' : 'offline', detail: 'memory', relays: { open: value ? 1 : 0, total: 1 }, quality: value ? 'good' : null, rtt: 1 });
      },
      setResolver(fn) { resolver = fn; },
      setHistoryProvider(fn) { historyProvider = fn; },
      setBlobProvider(fn) { blobProvider = fn; },
      targets(toUids) {
        if (!toUids) return others();
        const ids = new Set(toUids.flatMap((u) => resolver(u)));
        return others().filter((t) => ids.has(t.selfId));
      },
      sendOp(op, { toUids } = {}) {
        if (!online) return;
        sent.ops++;
        const copy = JSON.parse(JSON.stringify(op));
        for (const t of self.targets(toUids)) later(() => t._deliver('op', copy, { peerId }));
      },
      sendEph(type, data, { toUids, peerId: only } = {}) {
        if (!online) return;
        sent.eph++;
        const copy = JSON.parse(JSON.stringify({ type, data }));
        const list = only ? others().filter((t) => t.selfId === only) : self.targets(toUids);
        for (const t of list) later(() => t._deliver('eph', copy, { peerId }));
      },
      async requestHistory(query, { peerId: only } = {}) {
        const list = only ? others().filter((t) => t.selfId === only) : others();
        const out = [];
        for (const t of list) {
          try { out.push(...await t._serveHistory(query, { peerId })); } catch { /* peer unreachable */ }
        }
        return out;
      },
      async _serveHistory(query, from) { return online ? JSON.parse(JSON.stringify(await historyProvider(query, from))) : []; },
      async publishBlob() { return {}; },
      async fetchBlob(att, { peerIds } = {}) {
        const list = peerIds?.length ? others().filter((t) => peerIds.includes(t.selfId)) : others();
        for (const t of list) {
          const blob = await t._serveBlob(att.id, { peerId });
          if (blob) return blob;
        }
        throw new Error('No peer has this file right now');
      },
      async _serveBlob(id, from) { return online ? blobProvider(id, from) : null; },
      async ping() { return 1; },
    };
    return self;
  }
  return { create, rooms };
}
