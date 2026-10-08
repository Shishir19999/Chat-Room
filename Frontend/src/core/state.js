import { OP } from './constants.js';
import { compareOps } from './clock.js';

// Pure, idempotent and order-independent reducer for one workspace. Applying the same ops in any order,
// any number of times, yields the same state (messages, edits, tombstones, reactions, pins, receipts).

const MAX_ORPHANS = 500;

export function createState() {
  return {
    channels: new Map(), // key -> channel record
    chanDefs: new Map(), // public channel name -> { name, topic, lc, del }
    groups: new Map(), // group id -> { id, name, members, lc, del, by }
    orphans: new Map(), // target message id -> ops waiting for that message
    orphanCount: 0,
  };
}

export function getChannel(state, key) {
  let ch = state.channels.get(key);
  if (!ch) {
    ch = { key, msgs: new Map(), reads: new Map(), dlv: new Map(), rev: 0, sorted: null, sortedRev: -1, threadsRev: -1, threads: null };
    state.channels.set(key, ch);
  }
  return ch;
}

const newer = (lc, id, curLc, curId) => lc > curLc || (lc === curLc && id > curId);

function makeMessage(op) {
  const d = op.d;
  return {
    id: op.id, c: op.c, a: op.a, lc: op.lc, ts: op.ts,
    text: d.text, reply: d.reply || null, att: d.att || null, stk: d.stk || null,
    n: d.n || '', col: d.col ?? null,
    editLc: 0, editId: '', editedAt: 0,
    del: false, delAt: 0,
    rx: new Map(), // emoji -> Map(uid -> { lc, id, on })
    pin: { lc: 0, id: '', on: false },
    pinBy: '',
  };
}

function applyToMessage(msg, op) {
  const d = op.d;
  switch (op.t) {
    case OP.EDIT:
      if (op.a !== msg.a || msg.del) return false;
      if (!newer(op.lc, op.id, msg.editLc, msg.editId)) return false;
      msg.text = d.text; msg.editLc = op.lc; msg.editId = op.id; msg.editedAt = op.ts;
      return true;
    case OP.DEL:
      if (op.a !== msg.a || msg.del) return false;
      msg.del = true; msg.delAt = op.ts; msg.text = ''; msg.att = null; msg.stk = null; msg.rx = new Map();
      msg.pin = { lc: msg.pin.lc, id: msg.pin.id, on: false };
      return true;
    case OP.REACT: {
      if (msg.del) return false;
      let users = msg.rx.get(d.e);
      if (!users) { users = new Map(); msg.rx.set(d.e, users); }
      const cur = users.get(op.a);
      if (cur && !newer(op.lc, op.id, cur.lc, cur.id)) return false;
      users.set(op.a, { lc: op.lc, id: op.id, on: d.on });
      return true;
    }
    case OP.PIN:
      if (msg.del || !newer(op.lc, op.id, msg.pin.lc, msg.pin.id)) return false;
      msg.pin = { lc: op.lc, id: op.id, on: d.on };
      msg.pinBy = op.a;
      return true;
    default:
      return false;
  }
}

function stash(state, op) {
  if (state.orphanCount >= MAX_ORPHANS) return;
  const list = state.orphans.get(op.d.x) || [];
  if (list.some((o) => o.id === op.id)) return;
  list.push(op);
  state.orphans.set(op.d.x, list);
  state.orphanCount++;
}

// Returns { changed, channel, message?, created? }. Unknown ids and duplicates are ignored.
export function applyOp(state, op) {
  const result = { changed: false, channel: op.c, message: null, created: false };
  switch (op.t) {
    case OP.MSG: {
      const ch = getChannel(state, op.c);
      if (ch.msgs.has(op.id)) return result;
      const msg = makeMessage(op);
      ch.msgs.set(op.id, msg);
      const waiting = state.orphans.get(op.id);
      if (waiting) {
        state.orphans.delete(op.id);
        state.orphanCount -= waiting.length;
        for (const o of waiting) if (o.c === msg.c) applyToMessage(msg, o);
      }
      ch.rev++;
      return { ...result, changed: true, message: msg, created: true };
    }
    case OP.EDIT: case OP.DEL: case OP.REACT: case OP.PIN: {
      const ch = getChannel(state, op.c);
      const msg = ch.msgs.get(op.d.x);
      if (!msg) { stash(state, op); return result; }
      if (!applyToMessage(msg, op)) return result;
      ch.rev++;
      return { ...result, changed: true, message: msg };
    }
    case OP.READ: case OP.DELIVERED: {
      const ch = getChannel(state, op.c);
      const map = op.t === OP.READ ? ch.reads : ch.dlv;
      if ((map.get(op.a) || 0) >= op.d.upto) return result;
      map.set(op.a, op.d.upto);
      ch.rev++;
      return { ...result, changed: true };
    }
    case OP.CHANNEL: {
      const cur = state.chanDefs.get(op.d.name);
      if (cur && !newer(op.lc, op.id, cur.lc, cur.opId)) return result;
      state.chanDefs.set(op.d.name, { name: op.d.name, topic: op.d.topic || '', del: Boolean(op.d.del), lc: op.lc, opId: op.id });
      return { ...result, changed: true };
    }
    case OP.GROUP: {
      const cur = state.groups.get(op.d.id);
      if (cur && !newer(op.lc, op.id, cur.lc, cur.opId)) return result;
      // Only the creator (first definition) may change a group.
      if (cur && cur.by !== op.a) return result;
      state.groups.set(op.d.id, { id: op.d.id, name: op.d.name, members: [...new Set(op.d.members)], del: Boolean(op.d.del), lc: op.lc, opId: op.id, by: cur?.by || op.a });
      return { ...result, changed: true };
    }
    default:
      return result;
  }
}

// ---------- derived views ----------
export function sortedMessages(ch) {
  if (ch.sortedRev !== ch.rev || !ch.sorted) {
    ch.sorted = [...ch.msgs.values()].sort(compareOps);
    ch.sortedRev = ch.rev;
  }
  return ch.sorted;
}

export function reactionsOf(msg) {
  const out = [];
  for (const [emoji, users] of msg.rx) {
    const list = [];
    for (const [uid, v] of users) if (v.on) list.push(uid);
    if (list.length) out.push({ emoji, users: list });
  }
  return out;
}

// Delivery state of a message for its author: how many other people have received / read it.
export function receiptsFor(ch, msg) {
  let delivered = 0;
  const seenBy = [];
  for (const [uid, upto] of ch.reads) if (uid !== msg.a && upto >= msg.lc) seenBy.push(uid);
  for (const [uid, upto] of ch.dlv) if (uid !== msg.a && upto >= msg.lc && !seenBy.includes(uid)) delivered++;
  return { delivered: delivered + seenBy.length, seen: seenBy.length, seenBy };
}

// Thread index: root message id -> ordered reply ids (follows reply chains up to 30 hops).
export function threadsOf(ch) {
  if (ch.threadsRev === ch.rev && ch.threads) return ch.threads;
  const roots = new Map();
  const rootOf = (m) => {
    let cur = m;
    for (let i = 0; i < 30 && cur.reply; i++) {
      const parent = ch.msgs.get(cur.reply);
      if (!parent) break;
      cur = parent;
    }
    return cur.id;
  };
  for (const m of sortedMessages(ch)) {
    if (!m.reply) continue;
    const root = rootOf(m);
    if (root === m.id) continue;
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(m.id);
  }
  ch.threads = { roots, rootOf };
  ch.threadsRev = ch.rev;
  return ch.threads;
}

export const isPinned = (msg) => msg.pin.on && !msg.del;
