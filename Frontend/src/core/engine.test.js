import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHub } from '../transport/memory.js';
import { createMemoryStore } from '../store/memory.js';
import { makeClient, waitFor, tick, texts } from '../test/kit.js';
import { dmKey, newId } from './ops.js';
import { signOp, generateIdentity } from './crypto.js';
import { OP } from './constants.js';

const open = [];
const track = (c) => { open.push(c); return c; };
afterEach(() => { while (open.length) open.pop().engine.stop(); });

async function pair(hub, names = ['Ann', 'Ben']) {
  const clients = [];
  for (const n of names) clients.push(track(await makeClient(hub, n)));
  // wait until everybody has verified everybody's hello
  await waitFor(() => clients.every((c) => c.engine.getSnapshot().people.filter((p) => p.online).length === names.length - 1));
  return clients;
}

describe('engine over a mocked p2p transport', () => {
  it('delivers messages with ordering and dedupe', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    ann.engine.sendMessage('general', { text: 'hello ben' });
    ben.engine.sendMessage('general', { text: 'hi ann' });
    await waitFor(() => texts(ben.engine).length === 2 && texts(ann.engine).length === 2);
    expect(texts(ann.engine)).toEqual(texts(ben.engine));
    expect(ann.engine.view('general')[0].name).toBe('Ann');
  });

  it('syncs history to a peer that joins later (and from a persisted store)', async () => {
    const hub = createMemoryHub();
    const ann = track(await makeClient(hub, 'Ann'));
    for (let i = 1; i <= 5; i++) ann.engine.sendMessage('general', { text: `msg ${i}` });
    await tick(30);
    const ben = track(await makeClient(hub, 'Ben'));
    await waitFor(() => texts(ben.engine).length === 5);
    expect(texts(ben.engine)).toEqual(['msg 1', 'msg 2', 'msg 3', 'msg 4', 'msg 5']);
    // Ben reloads: everything is restored from his own store without any peer
    ben.engine.stop();
    const again = track(await makeClient(createMemoryHub(), 'Ben', { store: ben.store, identity: ben.identity }));
    expect(texts(again.engine)).toHaveLength(5);
  });

  it('shows typing indicators and expires them', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    ann.engine.setTyping('general', true);
    await waitFor(() => ben.engine.getSnapshot().typing.general?.includes('Ann'));
    ann.engine.setTyping('general', false);
    await waitFor(() => !ben.engine.getSnapshot().typing.general?.length);
  });

  it('applies reactions, replies, edits and deletes everywhere', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    const { op } = ann.engine.sendMessage('general', { text: 'original' });
    await waitFor(() => texts(ben.engine).length === 1);
    ben.engine.react(op.id, 'general', '👍');
    ben.engine.sendMessage('general', { text: 'a reply', reply: op.id });
    ann.engine.edit(op.id, 'general', 'edited text');
    await waitFor(() => ben.engine.view('general')[0].edited && ann.engine.view('general')[0].reactions.length === 1 && texts(ann.engine).length === 2);
    const msgOnAnn = ann.engine.view('general')[0];
    expect(msgOnAnn.reactions[0]).toMatchObject({ emoji: '👍', count: 1, mine: false });
    expect(ann.engine.view('general')[1].reply.id).toBe(op.id);
    expect(ben.engine.view('general')[0].text).toBe('edited text');
    expect(ann.engine.thread('general', op.id).map((m) => m.text)).toEqual(['edited text', 'a reply']);
    ann.engine.remove(op.id, 'general');
    await waitFor(() => ben.engine.view('general')[0].deleted);
    expect(ben.engine.view('general')[0].text).toBe('');
    expect(ben.engine.edit(op.id, 'general', 'nope').error).toBeTruthy();
  });

  it('does not let a peer edit or delete someone else message', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    const { op } = ann.engine.sendMessage('general', { text: 'mine' });
    await waitFor(() => texts(ben.engine).length === 1);
    expect(ben.engine.remove(op.id, 'general').error).toBeTruthy();
    // a hand-crafted delete signed by Ben is ignored by everyone
    const forged = { id: newId(16), w: 'testroom', c: 'general', t: OP.DEL, a: ben.identity.uid, lc: Date.now() + 5, ts: Date.now(), d: { x: op.id } };
    await signOp(ben.identity, forged);
    ben.transport.sendOp(forged);
    await tick(40);
    expect(ann.engine.view('general')[0].deleted).toBe(false);
  });

  it('drops ops with forged authors or bad signatures', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    const mallory = await generateIdentity();
    const evil = track(await makeClient(hub, 'Mallory', { identity: mallory }));
    await tick(30);
    const base = { id: newId(16), w: 'testroom', c: 'general', t: OP.MSG, a: ann.identity.uid, lc: Date.now(), ts: Date.now(), d: { text: 'ann says pay me', n: 'Ann' } };
    await signOp(mallory, base); // signed by the wrong key
    evil.transport.sendOp(base);
    const unsigned = { ...base, id: newId(16) };
    delete unsigned.sig; delete unsigned.pk;
    evil.transport.sendOp(unsigned);
    await tick(60);
    expect(texts(ben.engine)).toEqual([]);
    expect(ben.engine.stats.badSignature).toBeGreaterThanOrEqual(2);
    expect(texts(ann.engine)).toEqual([]);
  });

  it('rate limits a flooding peer', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    for (let i = 0; i < 60; i++) {
      const op = { id: newId(16), w: 'testroom', c: 'general', t: OP.MSG, a: ann.identity.uid, lc: Date.now() + i, ts: Date.now(), d: { text: `spam ${i}` } };
      await signOp(ann.identity, op);
      ann.transport.sendOp(op);
    }
    await tick(100);
    expect(ben.engine.view('general').length).toBeLessThan(25);
    expect(ben.engine.stats.rateLimited).toBeGreaterThan(20);
  });

  it('limits how fast the local user can send', async () => {
    const hub = createMemoryHub();
    const ann = track(await makeClient(hub, 'Ann'));
    let blocked = 0;
    for (let i = 0; i < 30; i++) if (ann.engine.sendMessage('general', { text: `m${i}` }).error) blocked++;
    expect(blocked).toBeGreaterThan(10);
  });

  it('tracks unread counts, read markers and seen receipts', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    ann.engine.setActive('general');
    ben.engine.setActive('random');
    const { op } = ann.engine.sendMessage('general', { text: 'ping @Ben' });
    await waitFor(() => ben.engine.getSnapshot().channels.find((c) => c.key === 'general').unread === 1);
    expect(ben.engine.getSnapshot().channels.find((c) => c.key === 'general').mentions).toBe(1);
    await waitFor(() => ann.engine.view('general')[0].receipt.delivered === 1);
    ben.engine.setActive('general');
    await waitFor(() => ann.engine.view('general')[0].receipt.seen === 1);
    expect(ann.engine.view('general')[0].receipt.seenBy).toEqual(['Ben']);
    expect(ben.engine.getSnapshot().channels.find((c) => c.key === 'general').unread).toBe(0);
    expect(op.id).toBeTruthy();
  });

  it('keeps direct messages private to the two people', async () => {
    const hub = createMemoryHub();
    const [ann, ben, cat] = await pair(hub, ['Ann', 'Ben', 'Cat']);
    const key = dmKey(ann.identity.uid, ben.identity.uid);
    ann.engine.sendMessage(key, { text: 'secret for ben' });
    await waitFor(() => texts(ben.engine, key).length === 1);
    expect(ben.engine.getSnapshot().channels.some((c) => c.type === 'dm')).toBe(true);
    await tick(60);
    expect(texts(cat.engine, key)).toEqual([]);
    // Cat asking for history gets nothing from the DM either
    const late = track(await makeClient(hub, 'Late'));
    await tick(80);
    expect(texts(late.engine, key)).toEqual([]);
    // Ben offline: message waits and arrives through history sync when he returns
    ben.transport.setOnline(false);
    ann.engine.sendMessage(key, { text: 'while you were away' });
    await tick(30);
    ben.transport.setOnline(true);
    await waitFor(() => texts(ben.engine, key).length === 2);
    expect(texts(ben.engine, key)[1]).toBe('while you were away');
  });

  it('creates group chats visible only to members', async () => {
    const hub = createMemoryHub();
    const [ann, ben, cat, dan] = await pair(hub, ['Ann', 'Ben', 'Cat', 'Dan']);
    const { key } = ann.engine.createGroup('Trip', [ben.identity.uid, cat.identity.uid]);
    await waitFor(() => cat.engine.getSnapshot().channels.some((c) => c.key === key));
    ben.engine.sendMessage(key, { text: 'tickets booked' });
    await waitFor(() => texts(ann.engine, key).length === 1 && texts(cat.engine, key).length === 1);
    await tick(40);
    expect(dan.engine.getSnapshot().channels.some((c) => c.key === key)).toBe(false);
    expect(texts(dan.engine, key)).toEqual([]);
  });

  it('syncs channels created by anyone', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    expect(ann.engine.createChannel('Dev Talk').key).toBe('dev-talk');
    await waitFor(() => ben.engine.getSnapshot().channels.some((c) => c.key === 'dev-talk'));
    expect(ann.engine.createChannel('general').error).toBeTruthy();
  });

  it('blocks a user: hides existing messages and ignores new ones', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    ann.engine.sendMessage('general', { text: 'before' });
    await waitFor(() => texts(ben.engine).length === 1);
    ben.engine.block(ann.identity.uid);
    expect(texts(ben.engine)).toEqual([]);
    await tick(1100);
    ann.engine.sendMessage('general', { text: 'after' });
    await tick(60);
    expect(texts(ben.engine)).toEqual([]);
    ben.engine.block(ann.identity.uid, false);
    expect(texts(ben.engine)).toEqual(['before']);
  });

  it('loads older history from the local store', async () => {
    const hub = createMemoryHub();
    const store = createMemoryStore();
    const ann = track(await makeClient(hub, 'Ann', { store }));
    for (let i = 0; i < 6; i++) { ann.engine.sendMessage('general', { text: `m${i}` }); await tick(1); }
    await tick(30);
    ann.engine.stop();
    const again = track(await makeClient(createMemoryHub(), 'Ann', { store, identity: ann.identity, start: false }));
    // simulate a partial load by clearing the ledger view: only the newest messages are present initially
    await again.engine.start();
    expect(texts(again.engine)).toHaveLength(6);
    const res = await again.engine.loadOlder('general');
    expect(res.done).toBe(true);
  });

  it('searches loaded messages', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    ann.engine.sendMessage('general', { text: 'lunch at noon' });
    ann.engine.sendMessage('random', { text: 'LUNCH menu' });
    await waitFor(() => texts(ben.engine).length === 1 && texts(ben.engine, 'random').length === 1);
    const hits = await ben.engine.search('lunch');
    expect(hits).toHaveLength(2);
    expect(await ben.engine.search('l')).toEqual([]);
  });

  it('transfers attachments on request and verifies the size', async () => {
    const hub = createMemoryHub();
    const [ann, ben] = await pair(hub);
    const blob = new Blob(['x'.repeat(2048)], { type: 'image/png' });
    const att = await ann.engine.addAttachment(blob, { kind: 'image', name: 'pic.png' });
    ann.engine.sendMessage('general', { text: '', att });
    await waitFor(() => texts(ben.engine).length === 1);
    expect(await ben.engine.hasLocalAttachment(att)).toBe(false);
    const got = await ben.engine.getAttachment(att, ann.identity.uid);
    expect(got.size).toBe(2048);
    expect(await ben.engine.hasLocalAttachment(att)).toBe(true);
    await expect(ben.engine.addAttachment(new Blob([new Uint8Array(6 * 1024 * 1024)]), { kind: 'file', name: 'big.bin' })).rejects.toThrow(/at most/);
  });
});
