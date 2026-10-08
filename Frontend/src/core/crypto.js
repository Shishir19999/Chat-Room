// Op signing: every author owns an ECDSA P-256 key pair; the user id is a fingerprint of the public key.
// This lets peers relay history for each other without being able to forge or alter anyone's messages.
const subtle = () => globalThis.crypto?.subtle;
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export const canSign = () => Boolean(subtle());

export function toB64u(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  const b = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export async function uidFromPublic(raw) {
  const digest = await subtle().digest('SHA-256', raw);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateIdentity() {
  const pair = await subtle().generateKey(ALGO, false, ['sign', 'verify']);
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { uid: await uidFromPublic(raw), pk: toB64u(raw), privateKey: pair.privateKey, publicKey: pair.publicKey };
}

// Rebuilds an identity from a stored private/public CryptoKey pair.
export async function identityFromKeys(privateKey, publicKey) {
  const raw = new Uint8Array(await subtle().exportKey('raw', publicKey));
  return { uid: await uidFromPublic(raw), pk: toB64u(raw), privateKey, publicKey };
}

export function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]));
  }
  return value;
}
const opString = (op) => JSON.stringify([op.id, op.w, op.c, op.t, op.a, op.lc, op.ts, canon(op.d)]);
const textBytes = (s) => new TextEncoder().encode(s);

async function sign(identity, text) {
  return toB64u(await subtle().sign(SIGN, identity.privateKey, textBytes(text)));
}

const keyCache = new Map(); // pk -> { uid, key }
async function publicKeyFor(pk) {
  let hit = keyCache.get(pk);
  if (hit) return hit;
  const raw = fromB64u(pk);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('bad key');
  const key = await subtle().importKey('raw', raw, ALGO, false, ['verify']);
  hit = { uid: await uidFromPublic(raw), key };
  if (keyCache.size > 2000) keyCache.clear();
  keyCache.set(pk, hit);
  return hit;
}

async function verify(pk, sig, text, uid) {
  try {
    const { uid: expected, key } = await publicKeyFor(pk);
    if (expected !== uid) return false;
    return await subtle().verify(SIGN, key, fromB64u(sig), textBytes(text));
  } catch {
    return false;
  }
}

export async function signOp(identity, op) {
  op.pk = identity.pk;
  op.sig = await sign(identity, opString(op));
  return op;
}
export const verifyOp = (op) => (typeof op.pk === 'string' && typeof op.sig === 'string' ? verify(op.pk, op.sig, opString(op), op.a) : Promise.resolve(false));

// Signed "hello": binds a user id to one transport peer id (so it cannot be replayed from another peer).
const helloString = (h) => JSON.stringify([h.uid, h.pid, h.ts, canon(h.profile)]);
export async function signHello(identity, pid, profile) {
  const hello = { uid: identity.uid, pid, ts: Date.now(), profile, pk: identity.pk };
  hello.sig = await sign(identity, helloString(hello));
  return hello;
}
export const verifyHello = (h) => (h && typeof h.pk === 'string' && typeof h.sig === 'string' ? verify(h.pk, h.sig, helloString(h), h.uid) : Promise.resolve(false));
