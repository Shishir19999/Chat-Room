import { describe, it, expect } from 'vitest';
import { generateIdentity, signOp, verifyOp, signHello, verifyHello } from './crypto.js';
import { OP } from './constants.js';

const base = (uid) => ({ id: 'abcdefgh1234', w: 'ws', c: 'general', t: OP.MSG, a: uid, lc: 1000, ts: 1000, d: { text: 'hello', n: 'Ann' } });

describe('op signatures', () => {
  it('verifies an untouched op and derives the uid from the key', async () => {
    const id = await generateIdentity();
    expect(id.uid).toMatch(/^[a-f0-9]{16}$/);
    const op = await signOp(id, base(id.uid));
    expect(await verifyOp(op)).toBe(true);
  });
  it('rejects tampered content, tampered author and swapped keys', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const op = await signOp(a, base(a.uid));
    expect(await verifyOp({ ...op, d: { text: 'evil', n: 'Ann' } })).toBe(false);
    expect(await verifyOp({ ...op, lc: 999 })).toBe(false);
    expect(await verifyOp({ ...op, a: b.uid })).toBe(false);
    expect(await verifyOp({ ...op, pk: b.pk })).toBe(false);
    expect(await verifyOp({ ...op, sig: undefined })).toBe(false);
  });
  it('is independent of key order inside data', async () => {
    const id = await generateIdentity();
    const op = await signOp(id, { ...base(id.uid), d: { n: 'Ann', text: 'hello' } });
    expect(await verifyOp({ ...op, d: { text: 'hello', n: 'Ann' } })).toBe(true);
  });
  it('binds hellos to a peer id', async () => {
    const id = await generateIdentity();
    const h = await signHello(id, 'peer-1', { name: 'Ann' });
    expect(await verifyHello(h)).toBe(true);
    expect(await verifyHello({ ...h, pid: 'peer-2' })).toBe(false);
    expect(await verifyHello({ ...h, profile: { name: 'Bob' } })).toBe(false);
  });
});
