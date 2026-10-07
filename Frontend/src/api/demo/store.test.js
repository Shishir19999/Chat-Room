import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, memoryStorage, STORAGE_KEY } from './store.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let clock;
let storage;
let store;
beforeEach(() => {
  clock = Date.parse('2026-01-10T12:00:00Z');
  storage = memoryStorage();
  store = createStore({ storage, now: () => (clock += 1000) });
});

describe('seed and persistence', () => {
  it('seeds rooms and persists to storage', () => {
    const rooms = store.listRooms();
    expect(rooms[0].name).toBe('general');
    expect(rooms.map((r) => r.name)).toEqual(expect.arrayContaining(['dev', 'design', 'random', 'music']));
    expect(rooms.every((r) => r.count > 0)).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('shares state between stores on the same storage and re-seeds on reset', () => {
    const other = createStore({ storage, now: () => clock });
    store.addMessage({ user: 'zed', message: 'shared', room: 'dev' });
    expect(other.history('dev').data.at(-1).message).toBe('shared');
    other.reset();
    expect(store.history('dev').data.some((m) => m.message === 'shared')).toBe(false);
  });

  it('recovers from corrupted storage', () => {
    storage.setItem(STORAGE_KEY, '{not json');
    expect(createStore({ storage }).listRooms().length).toBeGreaterThan(0);
  });
});

describe('pagination', () => {
  it('pages oldest-first with a cursor and ends with hasMore=false', () => {
    const total = store.history('general', { limit: 100 }).data.length;
    let page = store.history('general', { limit: 30 });
    expect(page.data).toHaveLength(30);
    expect(page.hasMore).toBe(true);
    const seen = [...page.data];
    while (page.hasMore) {
      page = store.history('general', { limit: 30, before: page.nextBefore });
      seen.unshift(...page.data);
    }
    expect(page.nextBefore).toBeNull();
    expect(seen).toHaveLength(total);
    expect(new Set(seen.map((m) => m._id)).size).toBe(total);
    const sorted = [...seen].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(seen.map((m) => m._id)).toEqual(sorted.map((m) => m._id));
  });

  it('rejects unknown cursors', () => {
    expect(() => store.history('general', { before: 'nope' })).toThrow(/cursor/);
  });
});

describe('messages', () => {
  it('validates, trims and supports replies and images', () => {
    expect(() => store.addMessage({ user: 'a', message: '   ', room: 'dev' })).toThrow();
    expect(() => store.addMessage({ user: '', message: 'x', room: 'dev' })).toThrow();
    const first = store.addMessage({ user: 'amy', message: '  hello  ', room: 'Dev!' });
    expect(first.message).toBe('hello');
    expect(first.room).toBe('dev');
    const reply = store.addMessage({ user: 'bob', message: 're', room: 'dev', replyTo: first._id, image: PIXEL });
    expect(reply.replyTo).toMatchObject({ _id: first._id, user: 'amy', message: 'hello' });
    expect(reply.image).toBe(PIXEL);
    expect(store.addMessage({ user: 'bob', message: '', room: 'dev', image: PIXEL }).image).toBe(PIXEL);
    expect(() => store.addMessage({ user: 'bob', message: '', room: 'dev', image: 'data:text/html;base64,AAAA' })).toThrow();
    expect(() => store.addMessage({ user: 'bob', message: '', room: 'dev', image: `data:image/png;base64,${'A'.repeat(400001)}` })).toThrow();
  });

  it('ignores reply targets from another room', () => {
    const a = store.addMessage({ user: 'amy', message: 'x', room: 'dev' });
    expect(store.addMessage({ user: 'bob', message: 'y', room: 'music', replyTo: a._id }).replyTo).toBeUndefined();
  });

  it('only the author can edit or delete; delete is a soft delete', () => {
    const m = store.addMessage({ user: 'amy', message: 'draft', room: 'dev' });
    expect(() => store.editMessage({ id: m._id, user: 'bob', room: 'dev', message: 'x' })).toThrow(/own/);
    const edited = store.editMessage({ id: m._id, user: 'amy', room: 'dev', message: ' final ' });
    expect(edited.message).toBe('final');
    expect(edited.editedAt).toBeTruthy();
    expect(() => store.editMessage({ id: m._id, user: 'amy', room: 'dev', message: '  ' })).toThrow();
    expect(() => store.deleteMessage({ id: m._id, user: 'bob', room: 'dev' })).toThrow(/own/);
    const gone = store.deleteMessage({ id: m._id, user: 'amy', room: 'dev' });
    expect(gone).toMatchObject({ deleted: true, message: '', reactions: [] });
    expect(() => store.toggleReaction({ id: m._id, user: 'bob', room: 'dev', emoji: '👍' })).toThrow();
    expect(() => store.editMessage({ id: m._id, user: 'amy', room: 'dev', message: 'back' })).toThrow();
    expect(() => store.deleteMessage({ id: m._id, user: 'amy', room: 'music' })).toThrow(/Unknown/);
  });

  it('toggles reactions per user and removes empty ones', () => {
    const m = store.addMessage({ user: 'amy', message: 'x', room: 'dev' });
    let r = store.toggleReaction({ id: m._id, user: 'bob', room: 'dev', emoji: '🎉' });
    expect(r.reactions).toEqual([{ emoji: '🎉', users: ['bob'] }]);
    r = store.toggleReaction({ id: m._id, user: 'amy', room: 'dev', emoji: '🎉' });
    expect(r.reactions[0].users).toEqual(['bob', 'amy']);
    store.toggleReaction({ id: m._id, user: 'amy', room: 'dev', emoji: '🎉' });
    r = store.toggleReaction({ id: m._id, user: 'bob', room: 'dev', emoji: '🎉' });
    expect(r.reactions).toEqual([]);
    expect(() => store.toggleReaction({ id: m._id, user: 'bob', room: 'dev', emoji: '<b>' })).toThrow();
  });
});

describe('rooms, search and unread', () => {
  it('creates rooms and rejects duplicates and bad names', () => {
    const r = store.createRoom({ name: 'Book Club!', description: 'Read together', user: 'amy' });
    expect(r.name).toBe('bookclub');
    expect(() => store.createRoom({ name: 'bookclub' })).toThrow(/exists/);
    expect(() => store.createRoom({ name: 'general' })).toThrow(/exists/);
    expect(() => store.createRoom({ name: '!' })).toThrow();
    expect(store.listRooms().some((x) => x.name === 'bookclub' && x.description === 'Read together')).toBe(true);
  });

  it('searches case-insensitively, skipping deleted messages', () => {
    const a = store.addMessage({ user: 'amy', message: 'Zebra crossing ahead', room: 'random' });
    store.addMessage({ user: 'amy', message: 'another zebra', room: 'random' });
    expect(store.history('random', { q: 'ZEBRA' }).data).toHaveLength(2);
    store.deleteMessage({ id: a._id, user: 'amy', room: 'random' });
    expect(store.history('random', { q: 'zebra' }).data).toHaveLength(1);
    expect(store.history('random', { q: 'qqqq' }).data).toEqual([]);
  });

  it('counts unread messages from others after a timestamp', () => {
    const since = new Date(clock).toISOString();
    store.addMessage({ user: 'bob', message: '1', room: 'dev' });
    store.addMessage({ user: 'bob', message: '2', room: 'dev' });
    store.addMessage({ user: 'amy', message: 'mine', room: 'dev' });
    expect(store.unread({ user: 'amy', since: { dev: since, music: since, bad: 'nope' } })).toEqual({ dev: 2, music: 0 });
  });

  it('keeps storage bounded when the quota is exceeded', () => {
    let limit = 120000;
    const tiny = {
      getItem: (k) => storage.getItem(k),
      removeItem: (k) => storage.removeItem(k),
      setItem: (k, v) => { if (v.length > limit) throw new Error('QuotaExceededError'); storage.setItem(k, v); },
    };
    const s = createStore({ storage: tiny, now: () => (clock += 1000) });
    limit = 10_000_000;
    s.reset();
    limit = JSON.stringify({ x: 1 }).length + storage.getItem(STORAGE_KEY).length - 3000;
    const doc = s.addMessage({ user: 'amy', message: 'still works', room: 'dev' });
    expect(doc.message).toBe('still works');
  });
});
