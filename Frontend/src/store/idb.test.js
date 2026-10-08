import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createIdbStore } from './idb.js';
import { OP } from '../core/constants.js';

const A = 'aaaaaaaaaaaaaaaa';
const op = (id, lc, extra = {}) => ({ id, w: 'ws', c: 'general', t: OP.MSG, a: A, lc, ts: lc, d: { text: id }, ...extra });

describe('indexeddb store', () => {
  it('stores ops and pages them by logical time', async () => {
    const store = await createIdbStore({ name: `t-${Math.random()}` });
    expect(store.kind).toBe('indexeddb');
    await store.putOps('ws', [1, 2, 3, 4, 5].map((n) => op(`message${n}`, n * 10)));
    const newest = await store.getOps('ws', { limit: 2 });
    expect(newest.map((o) => o.id)).toEqual(['message4', 'message5']);
    const older = await store.getOps('ws', { before: 40, limit: 2 });
    expect(older.map((o) => o.id)).toEqual(['message2', 'message3']);
    const filtered = await store.getOps('ws', { filter: (o) => o.lc > 30 });
    expect(filtered).toHaveLength(2);
    expect(await store.hasOp('ws', 'message1')).toBe(true);
    expect(await store.getOps('other')).toEqual([]);
  });
  it('keeps only the newest register op per key', async () => {
    const store = await createIdbStore({ name: `t-${Math.random()}` });
    await store.putOps('ws', [op('read000001', 10, { t: OP.READ, d: { upto: 10 } })]);
    await store.putOps('ws', [op('read000002', 30, { t: OP.READ, d: { upto: 30 } })]);
    await store.putOps('ws', [op('read000003', 20, { t: OP.READ, d: { upto: 20 } })]);
    const rows = await store.getOps('ws');
    expect(rows.map((o) => o.id)).toEqual(['read000002']);
    expect(rows[0].k).toBeUndefined();
  });
  it('round-trips blobs and kv values', async () => {
    const store = await createIdbStore({ name: `t-${Math.random()}` });
    await store.putBlob('b1', new Blob(['hello']));
    expect((await store.getBlob('b1')).size).toBe(5);
    expect(await store.getBlob('nope')).toBeNull();
    await store.setKv('k', { a: 1 });
    expect(await store.getKv('k')).toEqual({ a: 1 });
  });
  it('falls back to memory when IndexedDB is missing', async () => {
    const store = await createIdbStore({ factory: null });
    expect(store.kind).toBe('memory');
  });
});
