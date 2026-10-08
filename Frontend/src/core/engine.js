import { createEmitter } from './emitter.js';
import { createClock } from './clock.js';
import { createRateLimiter } from './ratelimit.js';
import { applyOp, createState, getChannel, reactionsOf, receiptsFor, sortedMessages, threadsOf, isPinned } from './state.js';
import { accessFor, collectHistory, toWire } from './history.js';
import { signHello, signOp, verifyHello, verifyOp } from './crypto.js';
import { dmKey, dmMembers, grpKey, isDm, isGroup, isUid, newId, validateOp, cleanName } from './ops.js';
import { DEFAULT_CHANNELS, IDLE_AFTER_MS, LIMITS, OP, PRESENCE, RATES } from './constants.js';
import { mentions, plainPreview } from './sanitize.js';

const TYPING_TTL = 5500;
const TYPING_SEND_GAP = 2500;
const PRESENCE_EVERY = 25000;
const SYNC_OVERLAP = 15 * 60 * 1000;
const RECEIPT_PEER_LIMIT = 12;
const LOAD_ON_START = 3000;

const noop = () => {};
export const memoryPrefs = () => {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => { m.set(k, v); } };
};

// The chat engine: all domain logic, independent of how bytes travel (transport) or how pixels are drawn (React).
export function createEngine({
  transport, store, identity, profile, ws, wsInfo = {}, prefs = memoryPrefs(), platform = {}, now = () => Date.now(),
}) {
  const bus = createEmitter();
  const clock = createClock(now);
  const ledger = createState();
  const me = { uid: identity.uid, name: profile.name, color: profile.color, status: profile.status || '', presence: PRESENCE.ONLINE };
  const people = new Map(); // uid -> connected person
  const directory = new Map(); // uid -> { name, color, status, seen } (everyone ever seen, persisted)
  const peerMap = new Map(); // transport peer id -> { uid, greeted }
  const seen = new Set(); // op ids already ingested
  const typingUntil = new Map(); // `${uid}|${c}` -> expiry
  const anchors = new Map(); // channel -> my read marker when the channel was opened (for the "new messages" divider)
  const exhausted = new Set(); // channels with no older history anywhere
  const openDms = new Set();
  const limiters = { op: createRateLimiter(RATES.op, now), eph: createRateLimiter(RATES.eph, now), blob: createRateLimiter(RATES.blob, now), hist: createRateLimiter(RATES.hist, now) };
  const sendLimiter = createRateLimiter({ capacity: 10, refillPerSec: 1 }, now);
  const viewCache = new Map();
  const timers = new Set();

  let active = null;
  let visible = true;
  let atBottom = true;
  let lastActivity = now();
  let started = false;
  let version = 0;
  let snapCache = null;
  let announce = { n: 0, text: '' };
  let status = { state: 'connecting', transport: transport.kind, quality: null, rtt: null, detail: '', relays: null, strategy: '' };
  let maxLc = 0;
  let joinError = null;
  let persistQueue = [];
  let persistScheduled = false;
  let notifyScheduled = false;
  let sendChain = Promise.resolve();
  let lastTypingSent = 0;
  let typingActive = '';
  const settings = {
    sound: prefs.get('sound', true),
    notifications: prefs.get('notifications', false),
    family: prefs.get('family', false),
    practice: false,
  };
  const blocked = new Set(prefs.get('blocked', []));
  const muted = new Set(prefs.get('muted', []));
  const hidden = new Set(prefs.get('hidden', []));

  const every = (ms, fn) => { const t = setInterval(fn, ms); timers.add(t); return t; };
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  // ---------- change notification ----------
  function touch() {
    version++;
    snapCache = null;
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => { notifyScheduled = false; bus.emit('change', version); });
  }

  // ---------- names ----------
  const nameOf = (uid) => (uid === me.uid ? me.name : directory.get(uid)?.name || people.get(uid)?.name || `user-${String(uid).slice(0, 4)}`);
  const colorOf = (uid) => (uid === me.uid ? me.color : directory.get(uid)?.color ?? parseInt(String(uid).slice(0, 4), 16) % 360);
  let dirDirty = false;
  let nameVer = 0;
  function remember(uid, patch) {
    const cur = directory.get(uid) || {};
    const next = { ...cur, ...patch, seen: Math.max(cur.seen || 0, patch.seen || 0) };
    if (!cur.name || cur.name !== next.name || cur.color !== next.color || cur.status !== next.status) dirDirty = true;
    directory.set(uid, next);
    if (dirDirty) nameVer++;
    if (dirDirty && !remember.scheduled) {
      remember.scheduled = true;
      later(800, () => { remember.scheduled = false; dirDirty = false; store.setKv(`dir:${ws}`, Object.fromEntries([...directory].slice(-300))).catch(noop); });
    }
  }

  // ---------- persistence ----------
  function persist(op) {
    persistQueue.push(op);
    if (persistScheduled) return;
    persistScheduled = true;
    queueMicrotask(async () => {
      persistScheduled = false;
      const batch = persistQueue;
      persistQueue = [];
      try { await store.putOps(ws, batch.map(toWire)); } catch { /* storage full or unavailable: keep chatting in memory */ }
    });
  }

  // ---------- audience ----------
  function audience(c) {
    if (isDm(c)) return dmMembers(c);
    if (isGroup(c)) return ledger.groups.get(c.slice(4))?.members;
    return undefined; // everyone in the workspace
  }
  const isMember = (c) => {
    if (isDm(c)) return dmMembers(c).includes(me.uid);
    if (isGroup(c)) { const g = ledger.groups.get(c.slice(4)); return Boolean(g) && g.members.includes(me.uid) && !g.del; }
    return true;
  };

  // ---------- applying ops ----------
  const myRead = (c) => ledger.channels.get(c)?.reads.get(me.uid) || 0;

  function afterApply(op, res, { live, fromSelf }) {
    maxLc = Math.max(maxLc, op.lc);
    if (op.t === OP.MSG) {
      const d = op.d;
      if (op.a !== me.uid) remember(op.a, { name: d.n || undefined, color: d.col ?? undefined, seen: op.ts });
      if (res.created && live && !fromSelf) onIncomingMessage(res.message);
    }
    if (isDm(op.c) && op.t === OP.MSG) { openDms.add(op.c); }
  }

  function onIncomingMessage(msg) {
    if (blocked.has(msg.a) || hidden.has(msg.id)) return;
    const ch = ledger.channels.get(msg.c);
    const mine = mentions(msg.text, me.name);
    const direct = isDm(msg.c) || isGroup(msg.c);
    const isActive = active === msg.c && visible && atBottom;
    if (isActive) {
      // The reader is looking at the newest messages, so these are not "new" for the divider.
      let before = 0;
      for (const m of ch.msgs.values()) if (m.a !== me.uid && m.id !== msg.id && m.lc > before) before = m.lc;
      if ((anchors.get(msg.c) ?? 0) >= before) anchors.set(msg.c, msg.lc);
      announce = { n: announce.n + 1, text: `${nameOf(msg.a)}: ${plainPreview(msg.text || (msg.att ? msg.att.name : 'sticker'), 140)}` };
      scheduleRead(msg.c);
    } else {
      scheduleDelivered(msg.c);
    }
    const quiet = muted.has(msg.a);
    if (!quiet && !isActive && (mine || direct || !visible)) {
      if (settings.sound && (mine || direct)) platform.beep?.();
      if (settings.notifications && !visible && (mine || direct)) {
        platform.notify?.(`${nameOf(msg.a)}${direct ? '' : ` in #${msg.c}`}`, plainPreview(msg.text || (msg.att ? msg.att.name : 'sticker'), 120), msg.c);
      }
    } else if (!quiet && isActive && settings.sound && mine) {
      platform.beep?.();
    }
    if (ch) viewCache.delete(msg.c);
  }

  function ingestVerified(op, { live = true, fromSelf = false, save = true } = {}) {
    if (seen.has(op.id)) return false;
    seen.add(op.id);
    clock.observe(op.lc);
    const res = applyOp(ledger, op);
    if (save) persist(op);
    viewCache.delete(op.c);
    if (res.changed || op.t === OP.CHANNEL || op.t === OP.GROUP) afterApply(op, res, { live, fromSelf });
    if (op.t === OP.GROUP && res.changed) {
      const g = ledger.groups.get(op.d.id);
      if (g && g.members.includes(me.uid)) openDms.add(grpKey(g.id));
    }
    touch();
    return res.changed;
  }

  // Full inbound path for an op from the network: structure, membership, block list, signature.
  async function receiveOp(op, ctx = {}, { live = true, rate = true } = {}) {
    if (!started) return false;
    const key = ctx.peerId || ctx.uid || 'unknown';
    if (rate && !limiters.op.take(key)) { stats.rateLimited++; return false; }
    if (!op || typeof op !== 'object' || seen.has(op.id)) return false;
    if (validateOp(op, { now: now() })) { stats.invalid++; return false; }
    if (op.w !== ws) return false;
    if (blocked.has(op.a)) return false;
    if (isDm(op.c) && !dmMembers(op.c).includes(me.uid)) return false;
    if (isGroup(op.c) && op.t !== OP.GROUP) {
      const g = ledger.groups.get(op.c.slice(4));
      if (g && (!g.members.includes(op.a) || !g.members.includes(me.uid))) return false;
    }
    if (transport.signed) {
      if (!(await verifyOp(op))) { stats.badSignature++; return false; }
    } else if (ctx.uid && ctx.uid !== op.a) {
      return false;
    }
    if (op.t === OP.GROUP && !op.d.members.includes(op.a)) return false;
    return ingestVerified(op, { live, fromSelf: op.a === me.uid });
  }

  async function receiveBatch(ops, ctx, opts) {
    let n = 0;
    const list = Array.isArray(ops) ? ops.slice(0, LIMITS.syncBatch * 2) : [];
    for (let i = 0; i < list.length; i += 25) {
      const results = await Promise.all(list.slice(i, i + 25).map((op) => receiveOp(op, ctx, { live: false, rate: false, ...opts })));
      n += results.filter(Boolean).length;
    }
    return n;
  }

  const stats = { rateLimited: 0, invalid: 0, badSignature: 0 };

  // ---------- sending ----------
  function buildOp(c, t, d) {
    return { id: newId(16), w: ws, c, t, a: me.uid, lc: clock.tick(), ts: now(), d };
  }

  function emit(c, t, d, { save = true } = {}) {
    const op = buildOp(c, t, d);
    seen.add(op.id);
    const res = applyOp(ledger, op);
    viewCache.delete(c);
    maxLc = Math.max(maxLc, op.lc);
    if (res.changed || t === OP.CHANNEL || t === OP.GROUP) afterApply(op, res, { live: false, fromSelf: true });
    touch();
    const toUids = audience(c);
    sendChain = sendChain.then(async () => {
      if (transport.signed) await signOp(identity, op);
      if (save) persist(op);
      transport.sendOp(toWire(op), toUids ? { toUids } : {});
    }).catch(noop);
    return op;
  }

  // ---------- read / delivered markers ----------
  let readTimer = null;
  const readPending = new Set();
  function latestFromOthers(c) {
    const ch = ledger.channels.get(c);
    if (!ch) return 0;
    let top = 0;
    for (const m of ch.msgs.values()) if (m.a !== me.uid && m.lc > top) top = m.lc;
    return top;
  }
  function scheduleRead(c) {
    readPending.add(c);
    if (readTimer) return;
    readTimer = later(250, () => {
      readTimer = null;
      for (const ch of readPending) markReadNow(ch);
      readPending.clear();
    });
  }
  function markReadNow(c) {
    if (!visible || !atBottom || active !== c || !isMember(c)) return;
    const ch = ledger.channels.get(c);
    if (!ch) return;
    let upto = 0;
    for (const m of ch.msgs.values()) if (m.lc > upto) upto = m.lc;
    if (upto > myRead(c)) emit(c, OP.READ, { upto });
  }
  const deliveredPending = new Set();
  let dlvTimer = null;
  function scheduleDelivered(c) {
    if (peerMap.size > RECEIPT_PEER_LIMIT || !isMember(c)) return;
    deliveredPending.add(c);
    if (dlvTimer) return;
    dlvTimer = later(500, () => {
      dlvTimer = null;
      for (const ch of deliveredPending) {
        const upto = latestFromOthers(ch);
        const cur = ledger.channels.get(ch)?.dlv.get(me.uid) || 0;
        if (upto > cur && upto > myRead(ch)) emit(ch, OP.DELIVERED, { upto });
      }
      deliveredPending.clear();
    });
  }

  // ---------- peers and presence ----------
  const peerCount = () => peerMap.size;
  const connectedPeople = () => [...people.values()];

  function bindPeer(peerId, uid, profileData) {
    const rec = peerMap.get(peerId) || { uid: null, greeted: false };
    rec.uid = uid;
    peerMap.set(peerId, rec);
    if (uid === me.uid) return;
    if (blocked.has(uid)) return;
    const p = people.get(uid) || { uid, peers: new Set(), joinedAt: now() };
    p.peers.add(peerId);
    if (profileData) {
      p.name = profileData.name || p.name || nameOf(uid);
      p.color = profileData.color ?? p.color ?? colorOf(uid);
      p.status = profileData.status ?? p.status ?? '';
      p.presence = profileData.presence || p.presence || PRESENCE.ONLINE;
      remember(uid, { name: p.name, color: p.color, status: p.status, seen: now() });
    }
    people.set(uid, p);
  }

  async function sendHello(peerId) {
    const profileData = { name: me.name, color: me.color, status: me.status, presence: me.presence };
    const hello = transport.signed ? await signHello(identity, transport.selfId, profileData) : { uid: me.uid, pid: transport.selfId, ts: now(), profile: profileData };
    transport.sendEph('hi', hello, peerId ? { peerId } : {});
  }

  async function onHello(h, ctx) {
    if (!h || typeof h !== 'object' || !isUid(h.uid) || typeof h.profile !== 'object' || !h.profile) return;
    if (transport.signed) {
      if (h.pid !== ctx.peerId || Math.abs(now() - h.ts) > 10 * 60 * 1000 || !(await verifyHello(h))) { stats.badSignature++; return; }
    } else if (ctx.uid !== h.uid) {
      return;
    }
    const name = cleanText(h.profile.name, LIMITS.name);
    if (!name) return;
    const prof = {
      name,
      color: Number.isInteger(h.profile.color) && h.profile.color >= 0 && h.profile.color < 360 ? h.profile.color : colorOf(h.uid),
      status: cleanText(h.profile.status, LIMITS.status),
      presence: Object.values(PRESENCE).includes(h.profile.presence) ? h.profile.presence : PRESENCE.ONLINE,
    };
    const rec = peerMap.get(ctx.peerId);
    const first = !rec || rec.uid !== h.uid;
    bindPeer(ctx.peerId, h.uid, prof);
    touch();
    if (h.uid === me.uid || blocked.has(h.uid)) return;
    const r = peerMap.get(ctx.peerId);
    if (!r.greeted) { r.greeted = true; sendHello(ctx.peerId).catch(noop); }
    if (first && !transport.centralHistory) catchUp(ctx.peerId).catch(noop);
  }

  function cleanText(v, max) {
    return typeof v === 'string' ? [...v].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join('').trim().slice(0, max) : '';
  }

  function onPeerLeave(peerId) {
    const rec = peerMap.get(peerId);
    peerMap.delete(peerId);
    limiters.op.forget(peerId); limiters.eph.forget(peerId);
    if (rec?.uid && people.has(rec.uid)) {
      const p = people.get(rec.uid);
      p.peers.delete(peerId);
      if (!p.peers.size) {
        people.delete(rec.uid);
        remember(rec.uid, { seen: now() });
        for (const k of [...typingUntil.keys()]) if (k.startsWith(`${rec.uid}|`)) typingUntil.delete(k);
      }
    }
    touch();
  }

  function sendPresence() {
    transport.sendEph('pres', { state: me.presence });
  }
  function computePresence() {
    const next = !visible ? PRESENCE.AWAY : now() - lastActivity > IDLE_AFTER_MS ? PRESENCE.IDLE : PRESENCE.ONLINE;
    if (next !== me.presence) { me.presence = next; sendPresence(); touch(); }
  }

  function onEph({ type, data }, ctx) {
    if (!started) return;
    if (!limiters.eph.take(ctx.peerId || ctx.uid || 'unknown')) { stats.rateLimited++; return; }
    if (type === 'hi') { onHello(data, ctx).catch(noop); return; }
    const uid = ctx.uid || peerMap.get(ctx.peerId)?.uid;
    if (!uid || uid === me.uid || blocked.has(uid)) return;
    if (type === 'pres' && data && Object.values(PRESENCE).includes(data.state)) {
      const p = people.get(uid);
      if (p) { p.presence = data.state; touch(); }
    } else if (type === 'ty' && data && typeof data.c === 'string') {
      if (isDm(data.c) && !(dmMembers(data.c).includes(uid) && dmMembers(data.c).includes(me.uid))) return;
      const k = `${uid}|${data.c}`;
      if (data.on) typingUntil.set(k, now() + TYPING_TTL); else typingUntil.delete(k);
      touch();
    }
  }

  // ---------- history sync ----------
  const myAccess = (uid) => accessFor(uid, ledger.groups);

  async function serveHistory(query, from) {
    if (!limiters.hist.take(from.peerId || from.uid || 'unknown')) return [];
    // The requester's signed hello may still be in flight; wait briefly so direct messages are served correctly.
    let uid = from.uid || peerMap.get(from.peerId)?.uid || null;
    for (let i = 0; !uid && i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); uid = peerMap.get(from.peerId)?.uid || null; }
    if (uid && blocked.has(uid)) return [];
    return collectHistory(store, ws, query, myAccess(uid));
  }

  async function catchUp(peerId) {
    const after = Math.max(0, maxLc - SYNC_OVERLAP);
    const ops = await transport.requestHistory({ after: maxLc ? after : 0, limit: LIMITS.syncBatch }, peerId ? { peerId } : {});
    const n = await receiveBatch(ops, { peerId }, {});
    if (n) touch();
    return n;
  }

  async function loadFromStore(query) {
    const rows = await store.getOps(ws, query);
    return receiveLocal(rows);
  }
  async function receiveLocal(rows) {
    let n = 0;
    for (const op of rows) {
      if (seen.has(op.id) || validateOp(op, { now: now() }) || op.w !== ws) continue;
      if (ingestVerified(op, { live: false, save: false, fromSelf: op.a === me.uid })) n++;
    }
    return n;
  }

  // ---------- public API ----------
  const api = {
    kind: transport.kind,
    autoLoadMedia: Boolean(transport.autoLoadMedia),
    ws,
    me,
    settings,
    stats,
    get started() { return started; },
    subscribe(fn) { return bus.on('change', fn); },
    on: bus.on,

    async start() {
      if (started) return;
      started = true;
      const dir = await store.getKv(`dir:${ws}`).catch(() => null);
      if (dir && typeof dir === 'object') for (const [uid, v] of Object.entries(dir)) if (isUid(uid) && v && typeof v.name === 'string') directory.set(uid, { name: v.name.slice(0, LIMITS.name), color: v.color, status: v.status || '', seen: v.seen || 0 });
      const dms = await store.getKv(`dms:${ws}`).catch(() => null);
      if (Array.isArray(dms)) for (const c of dms) if (isDm(c) && dmMembers(c).includes(me.uid)) openDms.add(c);
      const stored = await store.getOps(ws, { limit: LOAD_ON_START }).catch(() => []);
      await receiveLocal(stored);
      for (const op of stored) if (op.t === OP.MSG && op.a !== me.uid) remember(op.a, { name: op.d.n || undefined, color: op.d.col ?? undefined, seen: op.ts });
      transport.setResolver?.((uid) => [...peerMap].filter(([, r]) => r.uid === uid).map(([id]) => id));
      transport.setHistoryProvider?.(serveHistory);
      transport.setBlobProvider?.(async (id, from) => {
        if (!limiters.blob.take(from.peerId || 'unknown')) return null;
        const uid = peerMap.get(from.peerId)?.uid;
        if (uid && blocked.has(uid)) return null;
        return store.getBlob(id);
      });
      transport.on('status', (s) => { status = { ...status, ...s }; if (s.state === 'online') sendHello().catch(noop); touch(); });
      transport.on('peer-join', ({ peerId, uid, profile: pf }) => {
        peerMap.set(peerId, peerMap.get(peerId) || { uid: null, greeted: false });
        if (uid && pf) bindPeer(peerId, uid, pf);
        sendHello(peerId).catch(noop);
        touch();
      });
      transport.on('peer-leave', ({ peerId }) => onPeerLeave(peerId));
      transport.on('joined', () => { joinError = null; catchUp().catch(noop); });
      transport.on('join-error', (e) => { joinError = e; touch(); });
      transport.on('reject', ({ error }) => bus.emit('notice', { kind: 'error', text: error }));
      transport.on('op', (op, ctx) => { receiveOp(op, ctx || {}).catch(noop); });
      transport.on('eph', (e, ctx) => onEph(e, ctx || {}));
      every(1000, () => {
        const t = now();
        let changed = false;
        for (const [k, until] of typingUntil) if (until < t) { typingUntil.delete(k); changed = true; }
        computePresence();
        if (changed) touch();
      });
      every(PRESENCE_EVERY, sendPresence);
      await transport.join({ ws, password: wsInfo.password, uid: me.uid, profile: { name: me.name, color: me.color } });
      touch();
    },

    stop() {
      started = false;
      for (const t of timers) { clearInterval(t); clearTimeout(t); }
      timers.clear();
      try { transport.leave(); } catch { /* already left */ }
    },

    getSnapshot() {
      if (!snapCache) snapCache = buildSnapshot();
      return snapCache;
    },

    // --- view state ---
    setActive(c) {
      if (active !== c) { active = c; atBottom = true; anchors.set(c, myRead(c)); }
      if (isDm(c)) openDms.add(c);
      scheduleRead(c);
      touch();
    },
    // Scrolled away from the newest messages: new ones stay unread until the reader comes back down.
    setAtBottom(v) {
      if (atBottom === v) return;
      atBottom = v;
      if (v && active) scheduleRead(active);
    },
    setVisible(v) {
      if (visible === v) return;
      visible = v;
      if (v) { lastActivity = now(); if (active) scheduleRead(active); }
      computePresence();
      touch();
    },
    activity() {
      lastActivity = now();
      if (me.presence === PRESENCE.IDLE) computePresence();
    },
    markRead(c) { scheduleRead(c); },
    anchorFor: (c) => anchors.get(c) ?? myRead(c),

    // --- profile ---
    setProfile(patch) {
      if (patch.name != null) me.name = cleanText(patch.name, LIMITS.name) || me.name;
      if (patch.color != null) me.color = patch.color;
      if (patch.status != null) me.status = cleanText(patch.status, LIMITS.status);
      sendHello().catch(noop);
      touch();
    },

    // --- messages ---
    sendMessage(c, { text = '', reply = null, att = null, stk = null } = {}) {
      if (!isMember(c)) return { error: 'You are not in this conversation.' };
      const body = String(text).replace(/\r\n/g, '\n').trim();
      if (!body && !att && !stk) return { error: 'Write a message first.' };
      if (body.length > LIMITS.text) return { error: `Messages can have at most ${LIMITS.text} characters.` };
      if (!sendLimiter.take('me')) return { error: 'You are sending messages too fast. Wait a moment.' };
      const d = { text: body, n: me.name, col: me.color };
      if (reply && ledger.channels.get(c)?.msgs.has(reply)) d.reply = reply;
      if (att) d.att = att;
      if (stk) d.stk = stk;
      const op = emit(c, OP.MSG, d);
      if (c === active) anchors.set(c, op.lc);
      bus.emit('sent', op);
      viewCache.delete(c);
      scheduleRead(c);
      api.setTyping(c, false);
      return { op };
    },
    edit(id, c, text) {
      const msg = ledger.channels.get(c)?.msgs.get(id);
      const body = String(text).trim();
      if (!msg || msg.a !== me.uid || msg.del) return { error: 'You can only edit your own messages.' };
      if (!body || body.length > LIMITS.text) return { error: `Messages need 1-${LIMITS.text} characters.` };
      if (body === msg.text) return { op: null };
      return { op: emit(c, OP.EDIT, { x: id, text: body }) };
    },
    remove(id, c) {
      const msg = ledger.channels.get(c)?.msgs.get(id);
      if (!msg || msg.a !== me.uid || msg.del) return { error: 'You can only delete your own messages.' };
      return { op: emit(c, OP.DEL, { x: id }) };
    },
    react(id, c, emoji) {
      const msg = ledger.channels.get(c)?.msgs.get(id);
      if (!msg || msg.del) return { error: 'Message not found.' };
      const cur = msg.rx.get(emoji)?.get(me.uid);
      const on = !(cur && cur.on);
      if (on && !msg.rx.has(emoji) && reactionsOf(msg).length >= LIMITS.reactionKinds) return { error: 'Too many different reactions on this message.' };
      return { op: emit(c, OP.REACT, { x: id, e: emoji, on }) };
    },
    pin(id, c, on = true) {
      const msg = ledger.channels.get(c)?.msgs.get(id);
      if (!msg || msg.del) return { error: 'Message not found.' };
      return { op: emit(c, OP.PIN, { x: id, on }) };
    },
    setTyping(c, on) {
      if (!started || !c) return;
      const t = now();
      if (on) {
        if (typingActive === c && t - lastTypingSent < TYPING_SEND_GAP) return;
        typingActive = c; lastTypingSent = t;
      } else {
        if (!typingActive) return;
        typingActive = '';
      }
      const toUids = audience(c);
      transport.sendEph('ty', { c, on }, toUids ? { toUids } : {});
    },

    // --- channels, DMs and groups ---
    createChannel(name, topic = '') {
      const clean = cleanName(name);
      if (!clean) return { error: 'Use letters, numbers and dashes.' };
      if (DEFAULT_CHANNELS.includes(clean) || (ledger.chanDefs.get(clean) && !ledger.chanDefs.get(clean).del)) return { error: `#${clean} already exists.` };
      if (listChannels().filter((c) => c.type === 'channel').length >= 30) return { error: 'This room already has 30 channels.' };
      emit(clean, OP.CHANNEL, { name: clean, topic: cleanText(topic, 80) });
      return { key: clean };
    },
    openDm(uid) {
      if (!isUid(uid) || uid === me.uid) return { error: 'Pick someone else.' };
      const key = dmKey(me.uid, uid);
      openDms.add(key);
      store.setKv(`dms:${ws}`, [...openDms].filter(isDm)).catch(noop);
      touch();
      return { key };
    },
    createGroup(name, uids) {
      const members = [...new Set([me.uid, ...uids.filter(isUid)])];
      const title = cleanText(name, LIMITS.groupName);
      if (!title) return { error: 'Give the group a name.' };
      if (members.length < 3) return { error: 'Pick at least two other people.' };
      if (members.length > LIMITS.groupMembers) return { error: `Groups can have up to ${LIMITS.groupMembers} people.` };
      const id = newId(10);
      emit(grpKey(id), OP.GROUP, { id, name: title, members });
      return { key: grpKey(id) };
    },
    leaveGroup(c) {
      const g = ledger.groups.get(c.slice(4));
      if (!g || g.by !== me.uid) return { error: 'Only the person who created the group can remove it.' };
      emit(c, OP.GROUP, { id: g.id, name: g.name, members: g.members, del: true });
      return {};
    },

    // --- local safety controls ---
    block(uid, on = true) {
      if (uid === me.uid) return;
      if (on) { blocked.add(uid); people.delete(uid); } else blocked.delete(uid);
      prefs.set('blocked', [...blocked]);
      viewCache.clear();
      touch();
    },
    mute(uid, on = true) {
      if (on) muted.add(uid); else muted.delete(uid);
      prefs.set('muted', [...muted]);
      touch();
    },
    hideMessage(id, on = true) {
      if (on) hidden.add(id); else hidden.delete(id);
      prefs.set('hidden', [...hidden].slice(-500));
      viewCache.clear();
      touch();
    },
    reportMessage(id, c, reason = '') {
      api.hideMessage(id, true);
      return transport.report ? transport.report({ id, c, reason }) : Promise.resolve(false);
    },
    isBlocked: (uid) => blocked.has(uid),
    isMuted: (uid) => muted.has(uid),
    setSetting(key, value) {
      settings[key] = value;
      if (['sound', 'notifications', 'family'].includes(key)) prefs.set(key, value);
      viewCache.clear();
      touch();
    },

    // --- reading ---
    view(c) {
      const hit = viewCache.get(c);
      const ch = ledger.channels.get(c);
      const sk = `${hidden.size}|${blocked.size}|${muted.size}|${nameVer}|${me.name}|${peerMap.size}`;
      if (hit && hit.rev === (ch?.rev ?? -1) && hit.settingsKey === sk) return hit.list;
      const list = buildView(c);
      viewCache.set(c, { rev: ch?.rev ?? -1, settingsKey: sk, list });
      return list;
    },
    message(c, id) { return buildView(c).find((m) => m.id === id) || null; },
    pins(c) { return api.view(c).filter((m) => m.pinned); },
    thread(c, rootId) {
      const ch = ledger.channels.get(c);
      if (!ch) return [];
      const { roots } = threadsOf(ch);
      const ids = new Set([rootId, ...(roots.get(rootId) || [])]);
      return api.view(c).filter((m) => ids.has(m.id));
    },
    async loadOlder(c, pageSize = LIMITS.historyPage) {
      const ch = getChannel(ledger, c);
      const msgs = sortedMessages(ch);
      const oldest = msgs.length ? msgs[0].lc : Infinity;
      let got = await loadFromStore({ c, before: oldest, limit: pageSize * 2 });
      if (!got) {
        const ops = await transport.requestHistory({ c, before: oldest, limit: pageSize }).catch(() => []);
        got = await receiveBatch(ops, {}, {});
      }
      if (!got) exhausted.add(c);
      touch();
      return { loaded: got, done: !got };
    },
    hasMore: (c) => !exhausted.has(c),
    async search(q, { c = null, limit = 100 } = {}) {
      const needle = String(q).trim().toLowerCase();
      if (needle.length < 2) return [];
      await loadFromStore({ limit: 20000 }).catch(noop);
      const out = [];
      for (const [key, ch] of ledger.channels) {
        if (c && key !== c) continue;
        if (!isMember(key)) continue;
        for (const m of ch.msgs.values()) {
          if (m.del || blocked.has(m.a) || hidden.has(m.id)) continue;
          const hay = `${m.text} ${m.att?.name || ''}`.toLowerCase();
          if (hay.includes(needle)) out.push({ ...viewMessage(ch, m), c: key });
        }
      }
      return out.sort((a, b) => b.lc - a.lc).slice(0, limit);
    },

    // --- attachments ---
    async addAttachment(blob, meta) {
      const id = newId(20);
      const att = { id, kind: meta.kind, name: String(meta.name || 'file').slice(0, 120), mime: meta.mime || blob.type || 'application/octet-stream', size: blob.size };
      if (!/^[\w.+-]+\/[\w.+-]+$/.test(att.mime)) att.mime = 'application/octet-stream';
      for (const k of ['dur', 'wave', 'w', 'h']) if (meta[k] != null) att[k] = meta[k];
      if (blob.size > LIMITS.fileBytes) throw new Error(`Files can be at most ${Math.round(LIMITS.fileBytes / 1048576)} MB.`);
      await store.putBlob(id, blob);
      const extra = await transport.publishBlob(att, blob);
      return { ...att, ...extra };
    },
    async getAttachment(att, authorUid) {
      const local = await store.getBlob(att.id);
      if (local) return local;
      const preferred = [...peerMap].filter(([, r]) => r.uid === authorUid).map(([id]) => id);
      const blob = await transport.fetchBlob(att, { peerIds: preferred });
      if (!(blob instanceof Blob) || blob.size > att.size + 16 || blob.size === 0 || blob.size > LIMITS.fileBytes) throw new Error('The file did not arrive intact.');
      await store.putBlob(att.id, blob);
      return blob;
    },
    async clearHistory() { await store.clearWorkspace(ws); },
    hasLocalAttachment: async (att) => Boolean(await store.getBlob(att.id)),

    // for the practice bot and tests: local-only events that are never stored or sent
    injectLocal(op) { return ingestVerified(op, { live: true, save: false }); },
    injectPresence(uid, prof, on = true) {
      const peerId = `practice:${uid}`;
      if (on) { peerMap.set(peerId, { uid, greeted: true }); bindPeer(peerId, uid, prof); } else onPeerLeave(peerId);
      touch();
    },
    injectTyping(uid, c, on) {
      const k = `${uid}|${c}`;
      if (on) typingUntil.set(k, now() + TYPING_TTL); else typingUntil.delete(k);
      touch();
    },
    setPractice(on) { settings.practice = on; touch(); },
    clock,
    ledger,
    peerCount,
    destroy() { api.stop(); bus.emit('change', -1); },
  };

  // ---------- views ----------
  function viewMessage(ch, m) {
    const rec = receiptsFor(ch, m);
    const reactions = reactionsOf(m).map((r) => ({ emoji: r.emoji, users: r.users, count: r.users.length, mine: r.users.includes(me.uid) }));
    const parent = m.reply ? ch.msgs.get(m.reply) : null;
    const { roots, rootOf } = threadsOf(ch);
    const rootId = rootOf(m);
    const mine = m.a === me.uid;
    return {
      id: m.id, c: m.c, a: m.a, lc: m.lc, ts: m.ts, name: nameOf(m.a), color: colorOf(m.a), mine,
      text: m.del ? '' : m.text, deleted: m.del, edited: m.editedAt > 0 && !m.del, editedAt: m.editedAt,
      att: m.att, stk: m.stk,
      reply: m.reply ? { id: m.reply, name: parent ? nameOf(parent.a) : '', text: parent ? (parent.del ? 'Message deleted' : plainPreview(parent.text || parent.att?.name || 'Sticker', 80)) : 'Earlier message', missing: !parent } : null,
      reactions,
      pinned: isPinned(m),
      mentionsMe: !mine && !m.del && mentions(m.text, me.name),
      root: rootId,
      threadCount: m.reply ? 0 : (roots.get(m.id)?.length || 0),
      receipt: mine && !m.del ? { delivered: rec.delivered, seen: rec.seen, seenBy: rec.seenBy.map(nameOf), peers: Math.max(peerCount(), 0) } : null,
      muted: muted.has(m.a),
      filtered: settings.family,
    };
  }

  function buildView(c) {
    const ch = ledger.channels.get(c);
    if (!ch) return [];
    return sortedMessages(ch).filter((m) => !blocked.has(m.a) && !hidden.has(m.id)).map((m) => viewMessage(ch, m));
  }

  function listChannels() {
    const out = [];
    const defs = new Map();
    for (const n of DEFAULT_CHANNELS) defs.set(n, { name: n, topic: '' });
    for (const [n, d] of ledger.chanDefs) { if (d.del) defs.delete(n); else defs.set(n, d); }
    const summary = (c) => {
      const ch = ledger.channels.get(c);
      if (!ch) return { unread: 0, mentions: 0, lastTs: 0, preview: '', lastLc: 0 };
      const read = myRead(c);
      const sk = `${ch.rev}|${read}|${blocked.size}|${muted.size}|${hidden.size}|${me.name}|${nameVer}`;
      if (ch.sumKey === sk) return ch.sum;
      let unread = 0; let ment = 0; let last = null;
      for (const m of ch.msgs.values()) {
        if (!last || m.lc > last.lc) last = m;
        if (m.a === me.uid || m.del || m.lc <= read || blocked.has(m.a) || hidden.has(m.id)) continue;
        if (muted.has(m.a)) continue;
        unread++;
        if (mentions(m.text, me.name)) ment++;
      }
      ch.sumKey = sk;
      ch.sum = { unread, mentions: ment, lastTs: last ? last.ts : 0, lastLc: last ? last.lc : 0, preview: last ? (last.del ? 'Message deleted' : `${last.a === me.uid ? 'You' : nameOf(last.a)}: ${plainPreview(last.text || last.att?.name || 'Sticker', 50)}`) : '' };
      return ch.sum;
    };
    for (const [name, d] of defs) out.push({ key: name, type: 'channel', name, title: `#${name}`, topic: d.topic, ...summary(name) });
    for (const g of ledger.groups.values()) {
      if (g.del || !g.members.includes(me.uid)) continue;
      out.push({ key: grpKey(g.id), type: 'group', name: g.name, title: g.name, members: g.members, ...summary(grpKey(g.id)) });
    }
    const dmKeys = new Set(openDms);
    for (const k of ledger.channels.keys()) if (isDm(k) && dmMembers(k).includes(me.uid)) dmKeys.add(k);
    for (const k of dmKeys) {
      const other = dmMembers(k).find((u) => u !== me.uid);
      if (!other || blocked.has(other)) continue;
      out.push({ key: k, type: 'dm', name: nameOf(other), title: nameOf(other), uid: other, color: colorOf(other), online: people.has(other), ...summary(k) });
    }
    return out;
  }

  function buildSnapshot() {
    const t = now();
    const typing = {};
    for (const [k, until] of typingUntil) {
      if (until < t) continue;
      const [uid, c] = k.split('|');
      (typing[c] ||= []).push(nameOf(uid));
    }
    const list = connectedPeople().map((p) => ({
      uid: p.uid, name: p.name || nameOf(p.uid), color: p.color ?? colorOf(p.uid), status: p.status || '', presence: p.presence || PRESENCE.ONLINE,
      online: true, blocked: false, muted: muted.has(p.uid),
    }));
    const offline = [...directory]
      .filter(([uid]) => uid !== me.uid && !people.has(uid))
      .sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0))
      .slice(0, 30)
      .map(([uid, v]) => ({ uid, name: v.name, color: v.color ?? colorOf(uid), status: v.status || '', presence: 'offline', online: false, blocked: blocked.has(uid), muted: muted.has(uid) }));
    const channels = listChannels();
    const unreadTotal = channels.reduce((n, c) => n + c.unread, 0);
    return {
      version,
      ws: { name: ws, private: Boolean(wsInfo.private), password: Boolean(wsInfo.password) },
      me: { ...me },
      status: { ...status, peers: peerMap.size },
      channels,
      unreadTotal,
      mentionTotal: channels.reduce((n, c) => n + c.mentions, 0),
      active,
      people: [...list, ...offline],
      typing,
      settings: { ...settings },
      blocked: [...blocked],
      announce,
      joinError,
      stats: { ...stats },
    };
  }

  return api;
}
