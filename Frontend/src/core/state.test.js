import { describe, it, expect } from 'vitest';
import { applyOp, createState, getChannel, reactionsOf, receiptsFor, sortedMessages, threadsOf } from './state.js';
import { createClock, compareOps } from './clock.js';
import { OP } from './constants.js';
import { validateOp, dmKey, registerKey } from './ops.js';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';
let n = 0;
const op = (t, d, o = {}) => ({ id: o.id || `op${String(++n).padStart(6, '0')}`, w: 'ws', c: o.c || 'general', t, a: o.a || A, lc: o.lc ?? 1000 + n, ts: o.ts ?? 5000 + n, d });
const msg = (text, o) => op(OP.MSG, { text }, o);

describe('lamport / hybrid clock', () => {
  it('is monotonic and never goes backwards when the wall clock does', () => {
    let wall = 1000;
    const clock = createClock(() => wall);
    const a = clock.tick();
    wall = 500;
    const b = clock.tick();
    expect(b).toBeGreaterThan(a);
  });
  it('jumps ahead of remote events but caps absurd values', () => {
    const clock = createClock(() => 1000);
    clock.observe(1050);
    expect(clock.tick()).toBeGreaterThan(1050);
    clock.observe(9e15);
    expect(clock.value).toBeLessThan(1000 + 61000);
  });
  it('orders by clock, then wall time, then id', () => {
    const list = [{ id: 'b', lc: 5, ts: 1 }, { id: 'a', lc: 5, ts: 1 }, { id: 'c', lc: 4, ts: 9 }];
    expect(list.sort(compareOps).map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('message ordering and dedupe', () => {
  it('ignores duplicates and orders independent of arrival order', () => {
    const ops = [msg('one', { lc: 10 }), msg('two', { lc: 20 }), msg('three', { lc: 30 })];
    const forward = createState();
    const shuffled = createState();
    ops.forEach((o) => applyOp(forward, o));
    [ops[2], ops[0], ops[1], ops[0], ops[2]].forEach((o) => applyOp(shuffled, o));
    const texts = (s) => sortedMessages(getChannel(s, 'general')).map((m) => m.text);
    expect(texts(forward)).toEqual(['one', 'two', 'three']);
    expect(texts(shuffled)).toEqual(texts(forward));
  });
  it('reports duplicates as unchanged', () => {
    const s = createState();
    const o = msg('hi');
    expect(applyOp(s, o).changed).toBe(true);
    expect(applyOp(s, o).changed).toBe(false);
  });
});

describe('edits and tombstones', () => {
  it('last edit wins regardless of arrival order', () => {
    const s = createState();
    const m = msg('v0', { id: 'msgaaaaaaaa', lc: 10 });
    const e1 = op(OP.EDIT, { x: m.id, text: 'v1' }, { lc: 20 });
    const e2 = op(OP.EDIT, { x: m.id, text: 'v2' }, { lc: 30 });
    [m, e2, e1].forEach((o) => applyOp(s, o));
    const got = getChannel(s, 'general').msgs.get(m.id);
    expect(got.text).toBe('v2');
    expect(got.editedAt).toBeGreaterThan(0);
  });
  it('rejects edits and deletes from other people', () => {
    const s = createState();
    const m = msg('mine', { id: 'msgbbbbbbbb' });
    applyOp(s, m);
    expect(applyOp(s, op(OP.EDIT, { x: m.id, text: 'hacked' }, { a: B })).changed).toBe(false);
    expect(applyOp(s, op(OP.DEL, { x: m.id }, { a: B })).changed).toBe(false);
    expect(getChannel(s, 'general').msgs.get(m.id).text).toBe('mine');
  });
  it('delete leaves a tombstone that wins over later edits and clears content', () => {
    const s = createState();
    const m = msg('secret', { id: 'msgcccccccc', lc: 10 });
    applyOp(s, m);
    applyOp(s, op(OP.DEL, { x: m.id }, { lc: 20 }));
    applyOp(s, op(OP.EDIT, { x: m.id, text: 'back' }, { lc: 30 }));
    const got = getChannel(s, 'general').msgs.get(m.id);
    expect(got.del).toBe(true);
    expect(got.text).toBe('');
  });
  it('applies an edit that arrives before its message', () => {
    const s = createState();
    const m = msg('first', { id: 'msgdddddddd', lc: 10 });
    applyOp(s, op(OP.EDIT, { x: m.id, text: 'second' }, { lc: 20 }));
    applyOp(s, m);
    expect(getChannel(s, 'general').msgs.get(m.id).text).toBe('second');
  });
  it('does not apply an op to a message of another channel', () => {
    const s = createState();
    const m = msg('here', { id: 'msgeeeeeeee', c: 'general' });
    applyOp(s, m);
    applyOp(s, op(OP.DEL, { x: m.id }, { c: 'random' }));
    expect(getChannel(s, 'general').msgs.get(m.id).del).toBe(false);
  });
});

describe('reactions and pins', () => {
  it('toggles per user and converges', () => {
    const s = createState();
    const m = msg('react to me', { id: 'msgffffffff', lc: 10 });
    applyOp(s, m);
    applyOp(s, op(OP.REACT, { x: m.id, e: '👍', on: true }, { a: A, lc: 20 }));
    applyOp(s, op(OP.REACT, { x: m.id, e: '👍', on: true }, { a: B, lc: 21 }));
    applyOp(s, op(OP.REACT, { x: m.id, e: '👍', on: false }, { a: A, lc: 30 }));
    applyOp(s, op(OP.REACT, { x: m.id, e: '👍', on: true }, { a: A, lc: 25 })); // stale
    const r = reactionsOf(getChannel(s, 'general').msgs.get(m.id));
    expect(r).toEqual([{ emoji: '👍', users: [B] }]);
  });
  it('keeps the newest pin state', () => {
    const s = createState();
    const m = msg('pin me', { id: 'msggggggggg', lc: 10 });
    applyOp(s, m);
    applyOp(s, op(OP.PIN, { x: m.id, on: true }, { lc: 20 }));
    applyOp(s, op(OP.PIN, { x: m.id, on: false }, { lc: 30 }));
    applyOp(s, op(OP.PIN, { x: m.id, on: true }, { lc: 25 }));
    expect(getChannel(s, 'general').msgs.get(m.id).pin.on).toBe(false);
  });
});

describe('receipts and threads', () => {
  it('counts delivered and seen from other users markers', () => {
    const s = createState();
    const m = msg('hello', { id: 'msghhhhhhhh', lc: 100 });
    applyOp(s, m);
    applyOp(s, op(OP.DELIVERED, { upto: 100 }, { a: B, lc: 110 }));
    applyOp(s, op(OP.DELIVERED, { upto: 100 }, { a: C, lc: 111 }));
    applyOp(s, op(OP.READ, { upto: 100 }, { a: C, lc: 120 }));
    const ch = getChannel(s, 'general');
    const r = receiptsFor(ch, ch.msgs.get(m.id));
    expect(r.delivered).toBe(2);
    expect(r.seen).toBe(1);
    expect(r.seenBy).toEqual([C]);
  });
  it('markers never move backwards', () => {
    const s = createState();
    applyOp(s, op(OP.READ, { upto: 500 }, { a: B }));
    applyOp(s, op(OP.READ, { upto: 100 }, { a: B }));
    expect(getChannel(s, 'general').reads.get(B)).toBe(500);
  });
  it('groups replies under their root', () => {
    const s = createState();
    const root = msg('root', { id: 'rootmessage1', lc: 10 });
    const r1 = op(OP.MSG, { text: 'r1', reply: root.id }, { id: 'replymessage1', lc: 20 });
    const r2 = op(OP.MSG, { text: 'r2', reply: 'replymessage1' }, { id: 'replymessage2', lc: 30 });
    [root, r1, r2].forEach((o) => applyOp(s, o));
    const { roots } = threadsOf(getChannel(s, 'general'));
    expect(roots.get(root.id)).toEqual(['replymessage1', 'replymessage2']);
  });
});

describe('op validation', () => {
  const good = () => msg('fine');
  it('accepts a normal op', () => expect(validateOp(good())).toBe(''));
  it('rejects malformed ops', () => {
    expect(validateOp(null)).not.toBe('');
    expect(validateOp({ ...good(), t: 'zz' })).not.toBe('');
    expect(validateOp({ ...good(), c: '../x' })).not.toBe('');
    expect(validateOp({ ...good(), a: 'short' })).not.toBe('');
    expect(validateOp({ ...good(), lc: Date.now() + 9e9 })).not.toBe('');
    expect(validateOp({ ...good(), d: { text: 'x'.repeat(4001) } })).not.toBe('');
    expect(validateOp({ ...good(), d: { text: '' } })).not.toBe('');
    expect(validateOp(op(OP.REACT, { x: 'abcdefgh', e: '<img>', on: true }))).not.toBe('');
    expect(validateOp(msg('x', { c: dmKey(B, C), a: A }))).toBe('not a member');
  });
  it('validates attachments', () => {
    const base = { text: '', att: { kind: 'image', id: 'abc', name: 'a.png', mime: 'image/png', size: 100 } };
    expect(validateOp(op(OP.MSG, base))).toBe('');
    expect(validateOp(op(OP.MSG, { ...base, att: { ...base.att, size: 6 * 1024 * 1024 } }))).not.toBe('');
    expect(validateOp(op(OP.MSG, { ...base, att: { ...base.att, mime: 'text/html; x' } }))).not.toBe('');
    expect(validateOp(op(OP.MSG, { ...base, att: { ...base.att, url: 'https://evil.example/x' } }))).not.toBe('');
  });
  it('gives register ops a key', () => {
    expect(registerKey(op(OP.READ, { upto: 1 }))).toBe(`rd:${A}:general`);
    expect(registerKey(msg('x'))).toBeNull();
  });
});
