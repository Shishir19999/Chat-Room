import Op from '../models/Op.js';
import { LIMITS, OP } from '../shared/constants.js';

const FOLLOW_UPS = [OP.EDIT, OP.DEL, OP.REACT, OP.PIN];
const escapeRegex = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Channels a user may read in a workspace: public channels, their DMs and the groups they belong to.
export async function accessFilter(ws, uid) {
    const groups = await Op.find({ w: ws, t: OP.GROUP, 'd.members': uid, 'd.del': { $ne: true } }).select('d.id').lean();
    const groupKeys = groups.map((g) => `grp:${g.d.id}`);
    return {
        $or: [
            { c: { $not: /^(dm|grp):/ } },
            { c: { $regex: `^dm:(${escapeRegex(uid)}:|[a-f0-9]{16}:${escapeRegex(uid)}$)` } },
            ...(groupKeys.length ? [{ c: { $in: groupKeys } }] : []),
        ],
    };
}

const toWire = (o) => ({ id: o.id, w: o.w, c: o.c, t: o.t, a: o.a, lc: o.lc, ts: o.ts, d: o.d });

// Same contract as the browser-side collectHistory: the newest `limit` matching ops, oldest first,
// plus (for backwards paging) later edits, reactions, pins and deletions of the returned messages.
export async function fetchHistory(ws, uid, rawQuery) {
    const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
    const limit = Math.max(1, Math.min(LIMITS.syncBatch, Number.isFinite(q.limit) ? q.limit : 100));
    const cond = { w: ws, ...(await accessFilter(ws, uid)) };
    if (typeof q.c === 'string') cond.c = q.c;
    const range = {};
    if (Number.isFinite(q.before)) range.$lt = q.before;
    if (Number.isFinite(q.after)) range.$gt = q.after;
    if (Object.keys(range).length) cond.lc = range;
    const rows = (await Op.find(cond).sort({ lc: -1, id: -1 }).limit(limit).lean()).reverse();
    if (Number.isFinite(q.before) && rows.length) {
        const ids = rows.filter((o) => o.t === OP.MSG).map((o) => o.id);
        if (ids.length) {
            const have = new Set(rows.map((o) => o.id));
            const extra = await Op.find({ ...cond, lc: { $gt: rows[0].lc }, t: { $in: FOLLOW_UPS }, 'd.x': { $in: ids } }).limit(3000).lean();
            rows.push(...extra.filter((o) => !have.has(o.id)));
        }
    }
    return rows.map(toWire);
}
