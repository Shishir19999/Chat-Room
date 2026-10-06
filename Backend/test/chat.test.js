// Runs against a throwaway database (chatroom_test_<pid>) that is dropped afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.CORS_ORIGIN = 'http://localhost:5173,http://192.168.1.20:5173';
const BASE = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';

const { default: mongoose } = await import('mongoose');
const { default: request } = await import('supertest');
const { io: connectClient } = await import('socket.io-client');
const { createChatServer } = await import('../app.js');
const { default: ChatMessage } = await import('../models/ChatMessage.js');

const { app, server, io } = createChatServer();
let url;
const clients = [];

before(async () => {
  await mongoose.connect(`${BASE}/chatroom_test_${process.pid}`);
  await mongoose.connection.dropDatabase();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const c of clients) c.disconnect();
  io.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const client = () => {
  const c = connectClient(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return new Promise((res, rej) => { c.on('connect', () => res(c)); c.on('connect_error', rej); });
};
const once = (c, ev, pred = () => true) => new Promise((res) => {
  const h = (p) => { if (pred(p)) { c.off(ev, h); res(p); } };
  c.on(ev, h);
});

test('socket.io: join, presence, message broadcast + persistence, typing, isolation', async () => {
  const a = await client();
  const b = await client();
  const other = await client();
  const gotOther = [];
  other.on('message', (m) => gotOther.push(m));

  a.emit('join', { user: 'alice', room: 'Dev Room!' }); // sanitised to "devroom"
  const joined = await once(a, 'joined');
  assert.equal(joined.room, 'devroom');
  b.emit('join', { user: 'bob', room: 'devroom' });
  const pres = await once(a, 'presence', (p) => p.users.length === 2);
  assert.deepEqual(pres.users.sort(), ['alice', 'bob']);
  other.emit('join', { user: 'zed', room: 'elsewhere' });
  await once(other, 'joined');

  const typing = once(b, 'typing', (p) => p.typing);
  a.emit('typing', true);
  assert.equal((await typing).user, 'alice');

  const recv = once(b, 'message');
  const ack = await new Promise((r) => a.emit('message', { message: '  hello bob  ' }, r));
  assert.equal(ack.ok, true);
  const msg = await recv;
  assert.equal(msg.user, 'alice');
  assert.equal(msg.message, 'hello bob');
  assert.equal(msg.room, 'devroom');
  assert.equal(await ChatMessage.countDocuments({ room: 'devroom' }), 1);
  assert.equal(gotOther.length, 0, 'other rooms do not receive it');

  const bad = await new Promise((r) => a.emit('message', { message: '   ' }, r));
  assert.equal(bad.ok, false);
  const cl = await client();
  const noRoom = await new Promise((r) => cl.emit('message', { message: 'x' }, r));
  assert.equal(noRoom.ok, false);

  b.disconnect();
  const after = await once(a, 'presence', (p) => p.users.length === 1);
  assert.deepEqual(after.users, ['alice']);
});

test('REST: post validates and broadcasts', async () => {
  assert.equal((await request(app).post('/messages').send({ user: '', message: 'x' })).status, 400);
  const c = await client();
  c.emit('join', { user: 'listener', room: 'restroom' });
  await once(c, 'joined');
  const recv = once(c, 'message');
  const r = await request(app).post('/messages').send({ user: 'bot', message: 'hi', room: 'restroom' });
  assert.equal(r.status, 201);
  assert.equal((await recv).message, 'hi');
});

test('cursor pagination: GET /messages?room&before&limit', async () => {
  const base = Date.now() - 3600_000;
  await ChatMessage.insertMany(Array.from({ length: 120 }, (_, i) => ({
    user: 'u', message: `m${i}`, room: 'paged',
    createdAt: new Date(base + i * 1000), updatedAt: new Date(base + i * 1000),
  })), { timestamps: false });

  let r = await request(app).get('/messages?room=paged&limit=50');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 50);
  assert.equal(r.body.hasMore, true);
  assert.equal(r.body.data[0].message, 'm70');
  assert.equal(r.body.data[49].message, 'm119', 'oldest -> newest order');
  assert.equal(r.body.nextBefore, r.body.data[0]._id);

  r = await request(app).get(`/messages?room=paged&limit=50&before=${r.body.nextBefore}`);
  assert.equal(r.body.data.length, 50);
  assert.equal(r.body.data[0].message, 'm20');
  assert.equal(r.body.data[49].message, 'm69');
  assert.equal(r.body.hasMore, true);

  r = await request(app).get(`/messages?room=paged&limit=50&before=${r.body.nextBefore}`);
  assert.equal(r.body.data.length, 20);
  assert.equal(r.body.data[0].message, 'm0');
  assert.equal(r.body.hasMore, false);
  assert.equal(r.body.nextBefore, null);

  // ISO cursor, limit clamping and bad cursors
  r = await request(app).get(`/messages?room=paged&limit=5&before=${encodeURIComponent(new Date(base + 10_000).toISOString())}`);
  assert.deepEqual(r.body.data.map((m) => m.message), ['m5', 'm6', 'm7', 'm8', 'm9']);
  r = await request(app).get('/messages?room=paged&limit=100000');
  assert.equal(r.body.data.length, 100);
  assert.equal((await request(app).get('/messages?room=paged&before=nonsense')).status, 400);
  assert.equal((await request(app).get(`/messages?room=paged&before=${new mongoose.Types.ObjectId()}`)).status, 400);
  r = await request(app).get('/messages?room=emptyroom');
  assert.deepEqual([r.body.data, r.body.hasMore], [[], false]);
});

test('legacy messages without a room belong to #general', async () => {
  await ChatMessage.collection.insertOne({ user: 'old', message: 'legacy', createdAt: new Date(), updatedAt: new Date() });
  const r = await request(app).get('/messages');
  assert.ok(r.body.data.some((m) => m.message === 'legacy'));
});

test('CORS accepts configured LAN origin and rejects others', async () => {
  let r = await request(app).get('/messages').set('Origin', 'http://192.168.1.20:5173');
  assert.equal(r.headers['access-control-allow-origin'], 'http://192.168.1.20:5173');
  r = await request(app).get('/messages').set('Origin', 'http://evil.example');
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});
