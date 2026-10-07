// Rooms, reactions, edit/delete, replies, images, search and unread counts.
// Runs against a throwaway database (chatroom_feat_<pid>) that is dropped afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';

const { default: mongoose } = await import('mongoose');
const { default: request } = await import('supertest');
const { io: connectClient } = await import('socket.io-client');
const { createChatServer } = await import('../app.js');

const { app, server, io } = createChatServer();
let url;
const clients = [];

before(async () => {
  await mongoose.connect(`${BASE}/chatroom_feat_${process.pid}`);
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

const once = (c, ev, pred = () => true) => new Promise((res) => {
  const h = (p) => { if (pred(p)) { c.off(ev, h); res(p); } };
  c.on(ev, h);
});
const client = async (user, room) => {
  const c = connectClient(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise((res, rej) => { c.on('connect', res); c.on('connect_error', rej); });
  c.emit('join', { user, room });
  await once(c, 'joined');
  return c;
};
const call = (c, ev, payload) => new Promise((r) => c.emit(ev, payload, r));
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('rooms: create, list, duplicate and validation', async () => {
  let r = await request(app).post('/rooms').send({ name: 'Book Club!', description: 'Read together', user: 'amy' });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, 'bookclub');
  assert.equal((await request(app).post('/rooms').send({ name: 'bookclub' })).status, 409);
  assert.equal((await request(app).post('/rooms').send({ name: 'general' })).status, 409);
  assert.equal((await request(app).post('/rooms').send({ name: '!' })).status, 400);
  r = await request(app).get('/rooms');
  const names = r.body.data.map((x) => x.name);
  assert.equal(names[0], 'general');
  assert.ok(names.includes('bookclub'));
  assert.equal(r.body.data.find((x) => x.name === 'bookclub').description, 'Read together');
});

test('replies, images, edit, delete and reactions over sockets', async () => {
  const a = await client('alice', 'feat');
  const b = await client('bob', 'feat');

  const first = once(b, 'message');
  await call(a, 'message', { message: 'first post' });
  const m1 = await first;

  const second = once(a, 'message', (m) => m.user === 'bob');
  const ack = await call(b, 'message', { message: 'a reply', replyTo: m1._id, image: PIXEL });
  assert.equal(ack.ok, true);
  const m2 = await second;
  assert.equal(m2.replyTo.user, 'alice');
  assert.equal(m2.replyTo.message, 'first post');
  assert.equal(m2.image, PIXEL);

  // image-only message ok, bad image rejected, oversized rejected
  assert.equal((await call(a, 'message', { message: '', image: PIXEL })).ok, true);
  assert.equal((await call(a, 'message', { message: '', image: 'data:text/html;base64,AAAA' })).ok, false);
  assert.equal((await call(a, 'message', { message: '', image: `data:image/png;base64,${'A'.repeat(400001)}` })).ok, false);

  // reactions toggle
  let upd = once(a, 'message_updated');
  assert.equal((await call(b, 'react', { id: m1._id, emoji: '👍' })).ok, true);
  let doc = await upd;
  assert.deepEqual(doc.reactions, [{ emoji: '👍', users: ['bob'] }]);
  upd = once(a, 'message_updated');
  await call(a, 'react', { id: m1._id, emoji: '👍' });
  assert.deepEqual((await upd).reactions[0].users, ['bob', 'alice']);
  upd = once(a, 'message_updated');
  await call(a, 'react', { id: m1._id, emoji: '👍' });
  await upd;
  upd = once(a, 'message_updated');
  await call(b, 'react', { id: m1._id, emoji: '👍' });
  assert.deepEqual((await upd).reactions, []);
  assert.equal((await call(b, 'react', { id: m1._id, emoji: '<b>' })).ok, false);

  // edit own only
  assert.equal((await call(b, 'edit', { id: m1._id, message: 'hacked' })).ok, false);
  upd = once(b, 'message_updated');
  assert.equal((await call(a, 'edit', { id: m1._id, message: '  first post (edited) ' })).ok, true);
  doc = await upd;
  assert.equal(doc.message, 'first post (edited)');
  assert.ok(doc.editedAt);
  assert.equal((await call(a, 'edit', { id: m1._id, message: '   ' })).ok, false);

  // delete own only, soft delete, cannot react afterwards
  assert.equal((await call(b, 'delete', { id: m1._id })).ok, false);
  upd = once(b, 'message_updated');
  assert.equal((await call(a, 'delete', { id: m1._id })).ok, true);
  doc = await upd;
  assert.equal(doc.deleted, true);
  assert.equal(doc.message, '');
  assert.equal((await call(b, 'react', { id: m1._id, emoji: '🎉' })).ok, false);
  assert.equal((await call(a, 'edit', { id: m1._id, message: 'x' })).ok, false);
  assert.equal((await call(a, 'delete', { id: 'nope' })).ok, false);

  const hist = await request(app).get('/messages?room=feat');
  assert.equal(hist.body.data.find((m) => m._id === m1._id).deleted, true);
});

test('cannot touch messages of another room', async () => {
  const a = await client('alice', 'roomone');
  const m = await new Promise((res) => { a.once('message', res); a.emit('message', { message: 'mine' }); });
  const z = await client('zed', 'roomtwo');
  assert.equal((await call(z, 'react', { id: m._id, emoji: '👍' })).ok, false);
});

test('search and unread counts, activity events', async () => {
  const a = await client('alice', 'srch');
  const watcher = await client('carl', 'elsewhere2');
  const act = once(watcher, 'activity', (p) => p.room === 'srch');
  for (const t of ['Hello World', 'hello there', 'unrelated (x)+']) await call(a, 'message', { message: t });
  assert.equal((await act).user, 'alice');

  let r = await request(app).get('/messages?room=srch&q=HELLO');
  assert.deepEqual(r.body.data.map((m) => m.message), ['Hello World', 'hello there']);
  r = await request(app).get(`/messages?room=srch&q=${encodeURIComponent('(x)+')}`);
  assert.equal(r.body.data.length, 1, 'regex characters are escaped');
  r = await request(app).get('/messages?room=srch&q=zzz');
  assert.deepEqual(r.body.data, []);

  r = await request(app).post('/rooms/unread').send({ user: 'bob', since: { srch: '2000-01-01T00:00:00Z', feat: new Date(Date.now() + 60000).toISOString(), bad: 'nope' } });
  assert.equal(r.body.data.srch, 3);
  assert.equal(r.body.data.feat, 0);
  assert.equal('bad' in r.body.data, false);
  r = await request(app).post('/rooms/unread').send({ user: 'alice', since: { srch: '2000-01-01T00:00:00Z' } });
  assert.equal(r.body.data.srch, 0, 'own messages are not unread');
});
