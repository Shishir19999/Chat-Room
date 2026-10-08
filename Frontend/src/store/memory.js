import { registerKey } from '../core/ops.js';

// In-memory store with the same interface as the IndexedDB store (tests, private mode, SSR-less fallbacks).
// getOps(ws, { c, before, after, limit, filter }) returns the newest `limit` matching ops, oldest first.
export function createMemoryStore() {
  const ops = new Map(); // `${w}\n${id}` -> op
  const keys = new Map(); // `${w}\n${k}` -> op id
  const blobs = new Map();
  const kv = new Map();
  const meta = {};

  return {
    kind: 'memory',
    async putOps(ws, list) {
      for (const op of list) {
        const k = registerKey(op);
        if (k) {
          const slot = `${ws}\n${k}`;
          const prevId = keys.get(slot);
          const prev = prevId && ops.get(`${ws}\n${prevId}`);
          if (prev && (prev.lc > op.lc || (prev.lc === op.lc && prev.id >= op.id))) continue;
          if (prev) ops.delete(`${ws}\n${prevId}`);
          keys.set(slot, op.id);
        }
        ops.set(`${ws}\n${op.id}`, { ...op });
      }
    },
    async getOps(ws, { c, before = Infinity, after = 0, limit = 1000, filter } = {}) {
      const rows = [];
      for (const [slot, op] of ops) {
        if (!slot.startsWith(`${ws}\n`)) continue;
        if (c && op.c !== c) continue;
        if (op.lc >= before || op.lc <= after) continue;
        if (filter && !filter(op)) continue;
        rows.push(op);
      }
      rows.sort((a, b) => (a.lc - b.lc) || (a.id < b.id ? -1 : 1));
      return rows.slice(Math.max(0, rows.length - limit)).map((o) => ({ ...o }));
    },
    async hasOp(ws, id) { return ops.has(`${ws}\n${id}`); },
    async clearWorkspace(ws) {
      for (const slot of [...ops.keys()]) if (slot.startsWith(`${ws}\n`)) ops.delete(slot);
      for (const slot of [...keys.keys()]) if (slot.startsWith(`${ws}\n`)) keys.delete(slot);
    },
    async putBlob(id, blob) { blobs.set(id, blob); },
    async getBlob(id) { return blobs.get(id) || null; },
    async getKv(key) { return kv.has(key) ? kv.get(key) : null; },
    async setKv(key, value) { kv.set(key, value); },
    meta,
  };
}
