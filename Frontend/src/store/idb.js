import { registerKey } from '../core/ops.js';
import { createMemoryStore } from './memory.js';

// IndexedDB store: ops (per workspace, indexed by logical time), attachment blobs and a small key-value area.
const DB_NAME = 'chatroom-p2p';
const DB_VERSION = 1;

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

function open(factory, name) {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ops = db.createObjectStore('ops', { keyPath: ['w', 'id'] });
      ops.createIndex('byLc', ['w', 'lc']);
      ops.createIndex('byKey', ['w', 'k']);
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

// Falls back to the memory store when IndexedDB is unavailable (private mode, blocked storage).
export async function createIdbStore({ factory = globalThis.indexedDB, name = DB_NAME } = {}) {
  if (!factory) return createMemoryStore();
  let db;
  try {
    db = await open(factory, name);
  } catch {
    return createMemoryStore();
  }

  return {
    kind: 'indexeddb',
    async putOps(ws, list) {
      if (!list.length) return;
      const tx = db.transaction('ops', 'readwrite');
      const store = tx.objectStore('ops');
      const byKey = store.index('byKey');
      for (const op of list) {
        const k = registerKey(op);
        if (k) {
          const prev = await wrap(byKey.get([ws, k]));
          if (prev && (prev.lc > op.lc || (prev.lc === op.lc && prev.id >= op.id))) continue;
          if (prev) store.delete([ws, prev.id]);
        }
        store.put({ ...op, w: ws, ...(k ? { k } : {}) });
      }
      await done(tx);
    },
    async getOps(ws, { c, before = Infinity, after = 0, limit = 1000, filter } = {}) {
      const tx = db.transaction('ops', 'readonly');
      const upper = Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER;
      const range = IDBKeyRange.bound([ws, after], [ws, upper], true, true);
      const out = [];
      await new Promise((resolve, reject) => {
        const req = tx.objectStore('ops').index('byLc').openCursor(range, 'prev');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur || out.length >= limit) { resolve(); return; }
          const op = cur.value;
          if ((!c || op.c === c) && (!filter || filter(op))) {
            const { k: _k, ...rest } = op; // eslint-disable-line no-unused-vars
            out.push(rest);
          }
          cur.continue();
        };
      });
      return out.reverse();
    },
    async hasOp(ws, id) {
      return Boolean(await wrap(db.transaction('ops').objectStore('ops').getKey([ws, id])));
    },
    async clearWorkspace(ws) {
      const tx = db.transaction('ops', 'readwrite');
      tx.objectStore('ops').index('byLc').openKeyCursor(IDBKeyRange.bound([ws, 0], [ws, Number.MAX_SAFE_INTEGER])).onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { tx.objectStore('ops').delete(cur.primaryKey); cur.continue(); }
      };
      await done(tx);
    },
    async putBlob(id, blob) {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ id, blob, at: Date.now() });
      await done(tx);
    },
    async getBlob(id) {
      const row = await wrap(db.transaction('blobs').objectStore('blobs').get(id));
      return row ? row.blob : null;
    },
    async getKv(key) {
      const row = await wrap(db.transaction('kv').objectStore('kv').get(key));
      return row ? row.value : null;
    },
    async setKv(key, value) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value });
      await done(tx);
    },
  };
}
