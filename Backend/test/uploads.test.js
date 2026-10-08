import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE, makeConnector } from './helpers.js';

process.env.CORS_ORIGIN = 'http://localhost:5173';
const { default: mongoose } = await import('mongoose');
const { default: request } = await import('supertest');
const { createChatServer } = await import('../app.js');

const { app, server, io } = createChatServer();
let url;
const clients = [];
const connect = makeConnector(() => url, clients);

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

before(async () => {
    await mongoose.connect(`${BASE}/chatroom_test_up_${process.pid}`);
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    for (const c of clients) c.disconnect();
    io.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('uploads need a session token', async () => {
    const r = await request(app).post('/uploads').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(r.status, 401);
    const bad = await request(app).post('/uploads').set('Authorization', 'Bearer nope').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(bad.status, 401);
});

test('stores and serves images with safe headers', async () => {
    const a = await connect({ ws: 'files' });
    const r = await request(app).post('/uploads').set('Authorization', `Bearer ${a.reply.uploadToken}`).field('name', 'dot.png').attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' });
    assert.equal(r.status, 201);
    assert.match(r.body.url, /^\/uploads\/[a-f0-9]{20}$/);
    const g = await request(app).get(r.body.url);
    assert.equal(g.status, 200);
    assert.equal(g.headers['content-type'], 'image/png');
    assert.equal(g.headers['x-content-type-options'], 'nosniff');
    assert.match(g.headers['content-security-policy'], /sandbox/);
    assert.deepEqual(Buffer.from(g.body), PNG);
    assert.equal((await request(app).get('/uploads/zzzz')).status, 404);
    assert.equal((await request(app).get(`/uploads/${'0'.repeat(20)}`)).status, 404);
});

test('rejects wrong types, disguised files and oversize uploads', async () => {
    const a = await connect({ ws: 'files2' });
    const auth = `Bearer ${a.reply.uploadToken}`;
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const disguised = await request(app).post('/uploads').set('Authorization', auth).attach('file', html, { filename: 'x.png', contentType: 'image/png' });
    assert.equal(disguised.status, 415);
    const exe = await request(app).post('/uploads').set('Authorization', auth).attach('file', Buffer.from('MZ\x90\x00'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
    assert.equal(exe.status, 415);
    const htmlType = await request(app).post('/uploads').set('Authorization', auth).attach('file', html, { filename: 'x.html', contentType: 'text/html' });
    assert.equal(htmlType.status, 415);
    const big = await request(app).post('/uploads').set('Authorization', auth).attach('file', Buffer.alloc(5 * 1024 * 1024 + 10, 97), { filename: 'big.txt', contentType: 'text/plain' });
    assert.equal(big.status, 413);
    const text = await request(app).post('/uploads').set('Authorization', auth).attach('file', Buffer.from('plain notes'), { filename: 'n.txt', contentType: 'text/plain' });
    assert.equal(text.status, 201);
    const got = await request(app).get(text.body.url);
    assert.match(got.headers['content-disposition'], /^attachment/);
    assert.equal(got.headers['content-type'], 'application/octet-stream');
});

test('token stops working after the socket leaves', async () => {
    const a = await connect({ ws: 'files3' });
    const token = a.reply.uploadToken;
    a.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const r = await request(app).post('/uploads').set('Authorization', `Bearer ${token}`).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(r.status, 401);
});

test('shared protocol modules stay identical to the frontend copies', () => {
    const pairs = [
        ['../shared/ops.js', '../../Frontend/src/core/ops.js'],
        ['../shared/constants.js', '../../Frontend/src/core/constants.js'],
        ['../events.js', '../../Frontend/src/transport/socketEvents.js'],
    ];
    for (const [mine, theirs] of pairs) {
        const other = fileURLToPath(new URL(theirs, import.meta.url));
        if (!existsSync(other)) continue; // backend deployed on its own (Docker)
        assert.equal(readFileSync(fileURLToPath(new URL(mine, import.meta.url)), 'utf8'), readFileSync(other, 'utf8'), `${mine} drifted from ${theirs}`);
    }
});
