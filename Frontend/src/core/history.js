import { LIMITS, OP } from './constants.js';
import { dmMembers, isDm, isGroup } from './ops.js';

// History sync helpers shared by the peer-to-peer responder and the tests.
// A history query is { c?, before?, after?, limit? }; answers are plain signed ops (oldest first).

const FOLLOW_UPS = new Set([OP.EDIT, OP.DEL, OP.REACT, OP.PIN]);
const MAX_RESPONSE_BYTES = 1.5 * 1024 * 1024;

// Who may read which channel: everyone reads public channels, only members read DMs and group chats.
export function accessFor(uid, groups) {
  return (op) => {
    if (isDm(op.c)) return Boolean(uid) && dmMembers(op.c).includes(uid);
    if (isGroup(op.c)) {
      const g = groups.get(op.c.slice(4));
      return Boolean(uid) && Boolean(g) && g.members.includes(uid);
    }
    return true;
  };
}

export function cleanQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  return {
    c: typeof q.c === 'string' ? q.c : undefined,
    before: num(q.before),
    after: num(q.after),
    limit: Math.max(1, Math.min(LIMITS.syncBatch, num(q.limit) || 100)),
  };
}

export async function collectHistory(store, ws, rawQuery, allow) {
  const query = cleanQuery(rawQuery);
  const rows = await store.getOps(ws, { c: query.c, before: query.before, after: query.after, limit: query.limit, filter: allow });
  if (query.before != null && rows.length) {
    // Paging backwards: also return later edits, reactions, pins and deletions of the messages in this page.
    const ids = new Set(rows.filter((o) => o.t === OP.MSG).map((o) => o.id));
    const have = new Set(rows.map((o) => o.id));
    const minLc = rows[0].lc;
    if (ids.size) {
      const extra = await store.getOps(ws, {
        c: query.c, after: minLc, limit: 3000,
        filter: (o) => FOLLOW_UPS.has(o.t) && ids.has(o.d.x) && !have.has(o.id) && allow(o),
      });
      rows.push(...extra);
    }
  }
  let bytes = 0;
  const out = [];
  for (const op of rows) {
    bytes += JSON.stringify(op).length;
    if (bytes > MAX_RESPONSE_BYTES) break;
    const { k: _k, ...wire } = op; // eslint-disable-line no-unused-vars
    out.push(wire);
  }
  return out;
}

// Strips fields that only exist locally before an op goes on the wire.
export function toWire(op) {
  const wire = { id: op.id, w: op.w, c: op.c, t: op.t, a: op.a, lc: op.lc, ts: op.ts, d: op.d };
  if (op.pk) wire.pk = op.pk;
  if (op.sig) wire.sig = op.sig;
  return wire;
}
