import { createEngine } from '../core/engine.js';
import { createPractice } from '../core/practice.js';
import { canSign, generateIdentity, identityFromKeys } from '../core/crypto.js';
import { createIdbStore } from '../store/idb.js';
import { newId } from '../core/ops.js';
import { KEYS, prefs, readJson, writeJson } from '../lib/storage.js';
import { playBeep } from '../lib/sound.js';

// Build-time switch: the static GitHub Pages build (VITE_DEMO=true) uses the serverless peer-to-peer transport,
// the default build talks to the Express + Socket.IO + MongoDB backend.
export const MODE = import.meta.env.VITE_DEMO === 'true' ? 'p2p' : 'socket';
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

let storePromise = null;
export const getStore = () => (storePromise ||= createIdbStore());

let identityPromise = null;
// A stable identity per browser: an ECDSA key pair kept in IndexedDB; the user id is its fingerprint.
export function getIdentity() {
  identityPromise ||= (async () => {
    if (!canSign()) {
      // Insecure context (plain http on a LAN address): no WebCrypto, so no signatures. Server mode still works.
      let uid = readJson(KEYS.uid, '');
      if (!/^[a-f0-9]{16}$/.test(uid)) { uid = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join(''); writeJson(KEYS.uid, uid); }
      return { uid, pk: '', privateKey: null, publicKey: null };
    }
    const store = await getStore();
    const saved = await store.getKv('identity').catch(() => null);
    let identity;
    if (saved?.privateKey && saved?.publicKey) {
      try { identity = await identityFromKeys(saved.privateKey, saved.publicKey); } catch { identity = null; }
    }
    if (!identity) {
      identity = await generateIdentity();
      await store.setKv('identity', { privateKey: identity.privateKey, publicKey: identity.publicKey }).catch(() => {});
    }
    writeJson(KEYS.uid, identity.uid);
    return identity;
  })();
  return identityPromise;
}

function getSecret() {
  let secret = readJson(KEYS.secret, '');
  if (typeof secret !== 'string' || secret.length < 16) { secret = newId(32); writeJson(KEYS.secret, secret); }
  return secret;
}

export const platform = {
  beep: playBeep,
  notify(title, body, tag) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body, tag, silent: true });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* notifications unavailable */ }
  },
};

// `isCancelled` lets React StrictMode / fast navigation abandon a session before it touches the network.
export async function createSession({ ws, password, profile, mode = MODE, isCancelled = () => false }) {
  const [store, identity] = await Promise.all([getStore(), getIdentity()]);
  let transport;
  if (mode === 'p2p') {
    const { createP2pTransport } = await import('../transport/p2p.js');
    transport = createP2pTransport();
  } else {
    const { createSocketTransport } = await import('../transport/socket.js');
    transport = createSocketTransport({ url: API_URL, secret: getSecret() });
  }
  if (isCancelled()) return null;
  const engine = createEngine({ transport, store, identity, profile, ws, wsInfo: { password, private: Boolean(password) }, prefs, platform });
  const practice = createPractice(engine);
  if (isCancelled()) return null;
  await engine.start();
  if (isCancelled()) { engine.stop(); return null; }
  return { engine, transport, practice, identity, mode };
}
