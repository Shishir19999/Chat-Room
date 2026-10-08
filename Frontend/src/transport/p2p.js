import { createEmitter } from '../core/emitter.js';
import { APP_ID, LIMITS } from '../core/constants.js';
import { createLocalBus } from './local.js';

// Serverless transport: browsers find each other through public relays (Nostr, then BitTorrent trackers, then MQTT
// brokers if nobody was found) and then talk directly over encrypted WebRTC data channels. No account, no keys.
export const STRATEGIES = [
  { name: 'nostr', label: 'Nostr', load: () => import('trystero') },
  { name: 'torrent', label: 'BitTorrent', load: () => import('@trystero-p2p/torrent') },
  { name: 'mqtt', label: 'MQTT', load: () => import('@trystero-p2p/mqtt') },
];

const MB = 1024 * 1024;
// Public Nostr relays that accepted a WebSocket connection when last checked (dead ones only add console noise).
const NOSTR_RELAYS = ['relay.aarpia.com', 'nostr.stakey.net', 'relay.bullishbounty.com', 'relay.degmods.com', 'relay.agentry.com', 'relay.kaleidoswap.com', 'relay.bitmacro.cloud', 'relay.nostrmap.net', 'relay.grigic.org', 'relay.nostr.blockhenge.com', 'relay.routstr.com'].map((h) => `wss://${h}`);
// Size caps for what a peer may send us, per action (a stranger must not be able to push huge payloads).
const CAPS = { op: 64 * 1024, eph: 16 * 1024, hist: { request: 4 * 1024, response: 3 * MB }, blob: { request: 1024, response: LIMITS.fileBytes + 4096 } };

export function createP2pTransport({
  strategies = STRATEGIES, stepMs = 9000, offlineAfterMs = 8000, localFallback = true, loadTimeoutMs = 12000,
} = {}) {
  const bus = createEmitter();
  const links = []; // { spec, room, actions, getRelays, selfId }
  const peerLinks = new Map(); // peer id -> Set(link)
  const rtts = new Map();
  const timers = new Set();
  let local = null;
  let ws = '';
  let password = '';
  let joinedAt = 0;
  let stopped = true;
  let nextStrategy = 0;
  let lastError = '';
  let historyProvider = async () => [];
  let blobProvider = async () => null;
  let resolver = () => [];
  let lastStatus = '';

  const every = (ms, fn) => { const t = setInterval(fn, ms); timers.add(t); return t; };
  const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  const peerCount = () => peerLinks.size + (local?.peers.size || 0);

  function relayStats() {
    let open = 0; let total = 0;
    for (const l of links) {
      try {
        const socks = Object.values(l.getRelays?.() || {});
        total += socks.length;
        open += socks.filter((s) => s && s.readyState === 1).length;
      } catch { /* relay map unavailable */ }
    }
    return { open, total };
  }

  function quality() {
    const values = [...rtts.values()].filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return { quality: null, rtt: null };
    const rtt = Math.round(values[Math.floor(values.length / 2)]);
    return { quality: rtt < 150 ? 'good' : rtt < 400 ? 'fair' : 'poor', rtt };
  }

  function emitStatus() {
    if (stopped) return;
    const relays = relayStats();
    const onlineFlag = typeof navigator === 'undefined' || navigator.onLine !== false;
    const waited = Date.now() - joinedAt;
    let state = 'online';
    let detail = '';
    let reason = '';
    if (typeof RTCPeerConnection === 'undefined') { state = 'offline'; detail = 'This browser has no WebRTC support, so peer-to-peer chat cannot connect. Tabs of this browser still work.'; reason = 'webrtc'; }
    else if (!onlineFlag) { state = 'offline'; detail = 'You are offline.'; reason = 'offline'; }
    else if (links.length && relays.open === 0 && waited > offlineAfterMs) { state = 'offline'; detail = 'Cannot reach the discovery relays.'; }
    else if (!links.length || (relays.open === 0)) { state = 'connecting'; detail = 'Contacting relays...'; }
    else if (peerCount() === 0) { detail = 'Connected to relays. Waiting for other people to join.'; }
    else detail = `${peerCount()} peer${peerCount() === 1 ? '' : 's'} connected.`;
    if (lastError && state !== 'offline' && peerCount() === 0) detail = lastError;
    const q = quality();
    const names = links.map((l) => l.spec.label).join(' + ');
    const status = { state, detail, reason, relays, strategy: names, ...q, localOnly: Boolean(local?.isOpen && !peerLinks.size && local.peers.size > 0) };
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    bus.emit('status', status);
    if (localFallback && (state === 'offline')) enableLocal();
  }

  function enableLocal() {
    if (!local || local.isOpen) return;
    local.open();
  }

  function addPeer(link, peerId) {
    let set = peerLinks.get(peerId);
    const fresh = !set;
    if (!set) { set = new Set(); peerLinks.set(peerId, set); }
    set.add(link);
    if (fresh) { lastError = ''; bus.emit('peer-join', { peerId }); }
    emitStatus();
  }
  function removePeer(link, peerId) {
    const set = peerLinks.get(peerId);
    if (!set) return;
    set.delete(link);
    if (!set.size) { peerLinks.delete(peerId); rtts.delete(peerId); bus.emit('peer-leave', { peerId }); }
    emitStatus();
  }

  async function openLink(spec) {
    let mod;
    try {
      mod = await Promise.race([spec.load(), new Promise((_, rej) => after(loadTimeoutMs, () => rej(new Error('load timeout'))))]);
    } catch {
      return null;
    }
    if (stopped) return null;
    const config = { appId: APP_ID, maxReceiveBytes: 8 * MB, ...(password ? { password } : {}), ...(spec.name === 'nostr' ? { relayConfig: { urls: NOSTR_RELAYS } } : {}) };
    const room = mod.joinRoom(config, ws, {
      onJoinError: (details) => {
        lastError = password
          ? 'A peer rejected the connection. Check that the room password is correct.'
          : `Could not connect to a peer (${details?.error || 'unknown reason'}).`;
        emitStatus();
      },
    });
    const limit = (cap) => ({ byteLength }) => byteLength <= cap;
    const link = {
      spec, room, getRelays: mod.getRelaySockets, selfId: mod.selfId,
      op: room.makeAction('op', { onReceive: limit(CAPS.op) }),
      eph: room.makeAction('eph', { onReceive: limit(CAPS.eph) }),
      hist: room.makeAction('hist', {
        kind: 'request',
        onReceive: ({ byteLength, kind }) => byteLength <= (kind === 'response' ? CAPS.hist.response : CAPS.hist.request),
      }),
      blob: room.makeAction('blob', {
        kind: 'request',
        onReceive: ({ byteLength, kind }) => byteLength <= (kind === 'response' ? CAPS.blob.response : CAPS.blob.request),
      }),
    };
    link.op.onMessage = (data, { peerId }) => bus.emit('op', data, { peerId });
    link.eph.onMessage = (data, { peerId }) => {
      if (data && typeof data === 'object') bus.emit('eph', { type: data.type, data: data.data }, { peerId });
    };
    link.hist.onRequest = async (query, { peerId }) => historyProvider(query, { peerId });
    link.blob.onRequest = async (req, { peerId }) => {
      const blob = req && typeof req.id === 'string' ? await blobProvider(req.id, { peerId }) : null;
      if (!blob) throw new Error('not available');
      return blob;
    };
    room.onPeerJoin = (peerId) => addPeer(link, peerId);
    room.onPeerLeave = (peerId) => removePeer(link, peerId);
    links.push(link);
    emitStatus();
    return link;
  }

  // Opens the next discovery strategy when the current ones found nobody (or cannot reach their relays).
  async function advance() {
    if (stopped || nextStrategy >= strategies.length) return;
    await openLink(strategies[nextStrategy++]);
  }

  function schedule() {
    after(3500, emitStatus);
    after(stepMs, function check() {
      if (stopped) return;
      if (peerCount() === 0 && nextStrategy < strategies.length) advance().then(() => { after(stepMs, check); });
      else if (nextStrategy < strategies.length && relayStats().open === 0) advance().then(() => { after(stepMs, check); });
    });
    // Relays that never opened at all: try the next strategy sooner.
    after(5000, () => { if (!stopped && relayStats().open === 0 && nextStrategy < strategies.length) advance(); });
    every(10000, async () => {
      for (const [peerId, set] of peerLinks) {
        const link = [...set][0];
        link.room.ping(peerId).then((ms) => { rtts.set(peerId, ms); }).catch(() => {});
      }
      emitStatus();
    });
    every(4000, emitStatus);
  }

  const transport = {
    kind: 'p2p',
    signed: true,
    autoLoadMedia: false,
    get selfId() { return links[0]?.selfId || local?.selfId || 'pending'; },
    on: bus.on,
    setResolver(fn) { resolver = fn; },
    setHistoryProvider(fn) { historyProvider = fn; local?.setHistoryProvider(fn); },
    setBlobProvider(fn) { blobProvider = fn; },

    async join({ ws: name, password: pw }) {
      ws = name; password = pw || ''; stopped = false; joinedAt = Date.now(); nextStrategy = 0; lastError = '';
      if (localFallback) {
        local = createLocalBus(ws);
        local.setHistoryProvider(historyProvider);
        local.on('peer-join', (e) => { bus.emit('peer-join', e); emitStatus(); });
        local.on('peer-leave', (e) => { bus.emit('peer-leave', e); emitStatus(); });
        local.on('op', (op, ctx) => bus.emit('op', op, ctx));
        local.on('eph', (e, ctx) => bus.emit('eph', e, ctx));
      }
      const onOnline = () => emitStatus();
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOnline);
        transport._cleanupNet = () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); };
      }
      emitStatus();
      await advance();
      schedule();
      // A lone visitor still gets same-browser tabs after a short wait.
      if (localFallback) after(6000, () => { if (peerCount() === 0) enableLocal(); });
    },

    leave() {
      stopped = true;
      for (const t of timers) { clearInterval(t); clearTimeout(t); }
      timers.clear();
      for (const l of links) { try { l.room.leave(); } catch { /* already gone */ } }
      links.length = 0;
      peerLinks.clear();
      local?.close();
      transport._cleanupNet?.();
    },

    reconnect() {
      const keep = { ws, password };
      transport.leave();
      return transport.join(keep);
    },

    // Broadcast to everyone, or to the peers that currently belong to the given user ids.
    sendOp(op, { toUids } = {}) {
      if (toUids) {
        for (const [link, ids] of groupByLink(toUids)) link.op.send(op, { target: ids }).catch(() => {});
        const tabs = tabTargets(toUids);
        for (const t of tabs) local.sendOp(op, t);
        return;
      }
      for (const l of links) l.op.send(op).catch(() => {});
      if (local?.isOpen) local.sendOp(op);
    },
    sendEph(type, data, { toUids, peerId } = {}) {
      const msg = { type, data };
      if (peerId) {
        if (peerId.startsWith('tab:')) { local?.sendEph(type, data, peerId); return; }
        const link = [...(peerLinks.get(peerId) || [])][0];
        link?.eph.send(msg, { target: [peerId] }).catch(() => {});
        return;
      }
      if (toUids) {
        for (const [link, ids] of groupByLink(toUids)) link.eph.send(msg, { target: ids }).catch(() => {});
        for (const t of tabTargets(toUids)) local.sendEph(type, data, t);
        return;
      }
      for (const l of links) l.eph.send(msg).catch(() => {});
      if (local?.isOpen) local.sendEph(type, data);
    },

    async requestHistory(query, { peerId } = {}) {
      const asks = [];
      const targets = peerId ? [peerId] : [...peerLinks.keys()].sort(() => Math.random() - 0.5).slice(0, 3);
      for (const id of targets) {
        if (id.startsWith('tab:')) { asks.push(local.request(query, id)); continue; }
        const link = [...(peerLinks.get(id) || [])][0];
        if (link) asks.push(link.hist.request(query, { target: id, timeoutMs: 12000 }).catch(() => []));
      }
      if (!peerId && local?.isOpen) for (const id of local.peers) asks.push(local.request(query, id));
      const results = await Promise.all(asks);
      return results.flatMap((r) => (Array.isArray(r) ? r : []));
    },

    async publishBlob() { return {}; },
    async fetchBlob(att, { peerIds = [] } = {}) {
      const order = [...new Set([...peerIds, ...peerLinks.keys()])];
      let lastErr = new Error('No peer has this file right now.');
      for (const id of order) {
        const link = [...(peerLinks.get(id) || [])][0];
        if (!link) continue;
        try {
          const data = await link.blob.request({ id: att.id }, { target: id, timeoutMs: 45000 });
          return data instanceof Blob ? data : new Blob([data], { type: att.mime });
        } catch (e) { lastErr = e; }
      }
      throw new Error(lastErr.message && /not available|rejected/i.test(lastErr.message) ? 'No peer has this file right now.' : lastErr.message || 'Download failed.');
    },
  };

  function groupByLink(uids) {
    const map = new Map();
    for (const uid of uids) {
      for (const id of resolver(uid)) {
        if (id.startsWith('tab:')) continue;
        const link = [...(peerLinks.get(id) || [])][0];
        if (!link) continue;
        if (!map.has(link)) map.set(link, []);
        map.get(link).push(id);
      }
    }
    return map;
  }
  function tabTargets(uids) {
    if (!local?.isOpen) return [];
    return uids.flatMap((u) => resolver(u)).filter((id) => id.startsWith('tab:'));
  }

  return transport;
}
