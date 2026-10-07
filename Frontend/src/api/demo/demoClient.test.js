import { describe, it, expect, afterEach } from 'vitest';
import { createDemoClient } from './demoClient.js';
import { memoryStorage } from './store.js';

const clients = [];
// All clients share storage and a BroadcastChannel namespace, like tabs of one browser.
const storage = memoryStorage();
const make = (opts = {}) => {
  const c = createDemoClient({ storage, latency: [0, 1], ambient: false, ...opts });
  clients.push(c);
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (client, event) => { const out = []; client.on(event, (p) => out.push(p)); return out; };

afterEach(() => { while (clients.length) clients.pop().disconnect(); });

describe('demo client', () => {
  it('connects, lists rooms and loads history', async () => {
    const c = make();
    const statuses = collect(c, 'status');
    c.connect();
    await sleep(450);
    expect(statuses).toEqual(['connecting', 'connected']);
    expect((await c.listRooms()).length).toBeGreaterThan(3);
    const page = await c.history('general', { limit: 10 });
    expect(page.data).toHaveLength(10);
  });

  it('rejects sending before joining a room', async () => {
    const c = make();
    await expect(c.send({ message: 'x' })).rejects.toThrow(/Join a room/);
  });

  it('echoes messages, then a bot answers with a typing indicator', async () => {
    const c = make({ rand: () => 0 });
    c.connect();
    await c.join('sam', 'dev');
    const msgs = collect(c, 'message');
    const typing = collect(c, 'typing');
    await c.send({ message: 'hello team?' });
    expect(msgs[0].user).toBe('sam');
    await sleep(3600);
    expect(msgs.some((m) => m.user !== 'sam')).toBe(true);
    expect(typing.some((t) => t.typing === true)).toBe(true);
    expect(typing.some((t) => t.typing === false)).toBe(true);
  }, 10000);

  it('reports presence including bots and the user', async () => {
    const c = make();
    const presence = collect(c, 'presence');
    c.connect();
    await c.join('sam', 'music');
    const last = presence.at(-1);
    expect(last.room).toBe('music');
    expect(last.users).toEqual(expect.arrayContaining(['sam', 'felix']));
  });

  it('keeps two tabs in sync (messages, typing, presence)', async () => {
    const a = make({ rand: () => 0.99 }); // rand 0.99 keeps bots quiet
    const b = make({ rand: () => 0.99 });
    a.connect(); b.connect();
    await sleep(450);
    await a.join('amy', 'random');
    await b.join('bob', 'random');
    await sleep(50);
    const gotB = collect(b, 'message');
    const typingB = collect(b, 'typing');
    a.typing(true);
    await a.send({ message: 'hi from tab A' });
    await sleep(50);
    expect(gotB.map((m) => m.message)).toContain('hi from tab A');
    expect(typingB.some((t) => t.user === 'amy' && t.typing)).toBe(true);

    const presenceA = collect(a, 'presence');
    b.leave();
    await sleep(50);
    expect(presenceA.at(-1).users).not.toContain('bob');
  });

  it('does not deliver other rooms to a tab', async () => {
    const a = make({ rand: () => 0.99 });
    const b = make({ rand: () => 0.99 });
    a.connect(); b.connect();
    await a.join('amy', 'dev');
    await b.join('bob', 'design');
    const gotB = collect(b, 'message');
    const activityB = collect(b, 'activity');
    await a.send({ message: 'dev only' });
    await sleep(50);
    expect(gotB).toEqual([]);
    expect(activityB.some((x) => x.room === 'dev')).toBe(true);
  });

  it('supports reactions, edits, deletes and reset', async () => {
    const c = make({ rand: () => 0.99 });
    c.connect();
    await c.join('sam', 'general');
    const updates = collect(c, 'message_updated');
    const m = await c.send({ message: 'edit me' });
    await c.react(m._id, '👍');
    await c.edit(m._id, 'edited');
    await c.remove(m._id);
    expect(updates.map((u) => [u.reactions.length, u.message, u.deleted])).toEqual([[1, 'edit me', undefined], [1, 'edited', undefined], [0, '', true]]);
    await expect(c.edit(m._id, 'again')).rejects.toThrow();
    let resets = 0;
    c.on('reset', () => { resets += 1; });
    await c.reset();
    expect(resets).toBe(1);
    expect((await c.history('general', { limit: 100 })).data.some((x) => x._id === m._id)).toBe(false);
  });
});
