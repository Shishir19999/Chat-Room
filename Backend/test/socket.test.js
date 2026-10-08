// Runs against a throwaway database (chatroom_test_<pid>) that is dropped afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, hex, makeConnector, makeOp, until, quiet } from './helpers.js';

process.env.CORS_ORIGIN = 'http://localhost:5173';
const { default: mongoose } = await import('mongoose');
const { default: request } = await import('supertest');
const { createChatServer } = await import('../app.js');
const { C2S } = await import('../events.js');

const { app, server, io } = createChatServer();
let url;
const clients = [];
const connect = makeConnector(() => url, clients);

before(async () => {
    await mongoose.connect(`${BASE}/chatroom_test_${process.pid}`);
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // unique indexes must exist before the first op
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    for (const c of clients) c.disconnect();
    io.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('join: public room, peers list and presence events', async () => {
    const a = await connect({ ws: 'lobby', name: 'alice' });
    assert.equal(a.reply.ok, true);
    assert.equal(a.reply.peers.length, 0);
    assert.ok(a.reply.uploadToken);
    const b = await connect({ ws: 'lobby', name: 'bob' });
    assert.equal(b.reply.peers.length, 1);
    assert.equal(b.reply.peers[0].uid, a.uid);
    assert.equal(b.reply.peers[0].profile.name, 'alice');
    await until(() => a.log.joins.length === 1);
    assert.equal(a.log.joins[0].uid, b.uid);
    b.socket.disconnect();
    await until(() => a.log.leaves.length === 1);
});

test('join: validation and identity binding', async () => {
    const bad = await connect({ join: false });
    assert.equal((await bad.join({ ws: '' })).ok, false);
    assert.equal((await bad.join({ uid: 'nothex' })).ok, false);
    assert.equal((await bad.join({ secret: 'short' })).ok, false);
    assert.equal((await bad.join({ profile: { name: '' } })).ok, false);
    const owner = await connect({ ws: 'idroom' });
    assert.equal(owner.reply.ok, true);
    const thief = await connect({ ws: 'idroom', uid: owner.uid, secret: hex(16) });
    assert.equal(thief.reply.ok, false);
    assert.equal(thief.reply.code, 'identity-mismatch');
    const same = await connect({ ws: 'idroom', uid: owner.uid, secret: owner.secret });
    assert.equal(same.reply.ok, true);
});

test('private rooms need the right password', async () => {
    const owner = await connect({ ws: 'secretclub', password: 'hunter2-hunter2' });
    assert.equal(owner.reply.ok, true);
    assert.equal(owner.reply.private, true);
    const none = await connect({ ws: 'secretclub' });
    assert.equal(none.reply.code, 'wrong-password');
    const wrong = await connect({ ws: 'secretclub', password: 'nope-nope' });
    assert.equal(wrong.reply.code, 'wrong-password');
    const right = await connect({ ws: 'secretclub', password: 'hunter2-hunter2' });
    assert.equal(right.reply.ok, true);
    const rooms = (await request(app).get('/rooms')).body.data.map((r) => r.name);
    assert.ok(!rooms.includes('secretclub'));
    assert.ok(rooms.includes('lobby'));
});

test('ops are stored, relayed to others, and replayable as history', async () => {
    const a = await connect({ ws: 'chatty' });
    const b = await connect({ ws: 'chatty' });
    const mk = makeOp('general', 'chatty');
    const m1 = mk(a.uid, 'm', { text: 'hello there', n: 'alice' });
    assert.deepEqual(await a.op(m1), { ok: true });
    await until(() => b.log.ops.length === 1);
    assert.equal(b.log.ops[0].op.d.text, 'hello there');
    assert.equal(b.log.ops[0].ctx.uid, a.uid);
    assert.equal(a.log.ops.length, 0, 'sender does not get an echo');
    assert.equal((await a.op(m1)).duplicate, true);

    const edit = mk(a.uid, 'e', { x: m1.id, text: 'hello edited' });
    assert.equal((await a.op(edit)).ok, true);
    const react = mk(b.uid, 'r', { x: m1.id, e: '👍', on: true });
    assert.equal((await b.op(react)).ok, true);

    const late = await connect({ ws: 'chatty' });
    const h = await late.history({ limit: 50 });
    assert.equal(h.ok, true);
    assert.deepEqual(h.ops.map((o) => o.t), ['m', 'e', 'r']);
    const older = await late.history({ c: 'general', before: edit.lc, limit: 10 });
    assert.deepEqual(older.ops.map((o) => o.t).sort(), ['e', 'm', 'r'], 'paging back includes later edits and reactions');
});

test('rejects forged authors, foreign edits, invalid and unjoined ops', async () => {
    const a = await connect({ ws: 'authz' });
    const b = await connect({ ws: 'authz' });
    const mk = makeOp('general', 'authz');
    const m = mk(a.uid, 'm', { text: 'mine' });
    await a.op(m);
    assert.equal((await b.op(mk(a.uid, 'm', { text: 'forged' }))).code, 'forbidden');
    assert.equal((await b.op(mk(b.uid, 'e', { x: m.id, text: 'hijack' }))).code, 'forbidden');
    assert.equal((await b.op(mk(b.uid, 'd', { x: m.id }))).code, 'forbidden');
    assert.equal((await b.op(mk(b.uid, 'e', { x: 'doesnotexist1', text: 'x' }))).ok, false);
    assert.equal((await b.op({ ...mk(b.uid, 'm', { text: 'x' }), t: 'zz' })).ok, false);
    assert.equal((await b.op({ ...mk(b.uid, 'm', { text: 'x'.repeat(5000) }) })).ok, false);
    assert.equal((await b.op({ ...mk(b.uid, 'm', { text: 'x' }), w: 'otherroom' })).ok, false);
    const stranger = await connect({ join: false });
    assert.equal((await stranger.op(mk(stranger.uid, 'm', { text: 'hi' }))).code, 'not-joined');
    // the original message is untouched
    const h = await b.history({});
    assert.equal(h.ops.filter((o) => o.t !== 'm').length, 0);
});

test('direct messages and groups are private to their members', async () => {
    const a = await connect({ ws: 'privacy' });
    const b = await connect({ ws: 'privacy' });
    const c = await connect({ ws: 'privacy' });
    const key = `dm:${[a.uid, b.uid].sort().join(':')}`;
    const mk = makeOp(key, 'privacy');
    assert.equal((await a.op(mk(a.uid, 'm', { text: 'psst' }))).ok, true);
    await until(() => b.log.ops.length === 1);
    await quiet();
    assert.equal(c.log.ops.length, 0);
    assert.equal((await c.op(mk(c.uid, 'm', { text: 'let me in' }))).ok, false);
    assert.equal((await c.history({ c: key })).ops.length, 0);
    assert.equal((await b.history({ c: key })).ops.length, 1);

    const gid = 'grp' + hex(4);
    const gk = `grp:${gid}`;
    const mg = makeOp(gk, 'privacy');
    assert.equal((await a.op(mg(a.uid, 'g', { id: gid, name: 'Trip', members: [a.uid, b.uid, c.uid] }))).ok, true);
    await until(() => b.log.ops.some((o) => o.op.t === 'g') && c.log.ops.some((o) => o.op.t === 'g'));
    const outsider = await connect({ ws: 'privacy' });
    assert.equal((await outsider.op(mg(outsider.uid, 'm', { text: 'hi group' }))).code, 'forbidden');
    assert.equal((await outsider.history({ c: gk })).ops.length, 0);
    assert.equal((await b.op(mg(b.uid, 'g', { id: gid, name: 'Hijacked', members: [b.uid, a.uid] }))).code, 'forbidden');
    assert.equal((await c.op(mg(c.uid, 'm', { text: 'count me in' }))).ok, true);
    assert.equal((await c.history({ c: gk })).ops.length, 2);
});

test('register ops keep only the newest value', async () => {
    const a = await connect({ ws: 'registers' });
    const mk = makeOp('general', 'registers');
    assert.equal((await a.op(mk(a.uid, 'rd', { upto: 100 }))).ok, true);
    assert.equal((await a.op(mk(a.uid, 'rd', { upto: 300 }))).ok, true);
    const h = await a.history({});
    assert.equal(h.ops.filter((o) => o.t === 'rd').length, 1);
    assert.equal(h.ops[0].d.upto, 300);
    const ch = makeOp('dev', 'registers');
    assert.equal((await a.op(ch(a.uid, 'ch', { name: 'dev', topic: '' }))).ok, true);
});

test('ephemeral relay: typing reaches others, bad kinds and oversize are dropped', async () => {
    const a = await connect({ ws: 'ephroom' });
    const b = await connect({ ws: 'ephroom' });
    a.socket.emit(C2S.EPH, { type: 'ty', data: { c: 'general', on: true } });
    await until(() => b.log.eph.length === 1);
    assert.equal(b.log.eph[0].ctx.uid, a.uid);
    a.socket.emit(C2S.EPH, { type: 'evil', data: {} });
    a.socket.emit(C2S.EPH, { type: 'hi', data: { blob: 'x'.repeat(20000) } });
    await quiet();
    assert.equal(b.log.eph.length, 1);
    a.socket.emit(C2S.EPH, { type: 'ty', data: { c: 'general', on: false }, peerId: b.socket.id });
    await until(() => b.log.eph.length === 2);
});

test('rate limits floods of ops', async () => {
    const a = await connect({ ws: 'flood' });
    const mk = makeOp('general', 'flood');
    const results = [];
    for (let i = 0; i < 40; i++) results.push(await a.op(mk(a.uid, 'm', { text: `spam ${i}` })));
    assert.ok(results.some((r) => r.code === 'rate-limited'));
    assert.ok(results.filter((r) => r.ok).length >= 10);
});

test('reports are stored', async () => {
    const a = await connect({ ws: 'reports' });
    assert.equal((await a.call(C2S.REPORT, { id: 'abc12345', c: 'general', reason: 'rude' })).ok, true);
    assert.equal((await a.call(C2S.REPORT, { nope: 1 })).ok, false);
    const { default: Report } = await import('../models/Report.js');
    assert.equal(await Report.countDocuments({ w: 'reports' }), 1);
});
