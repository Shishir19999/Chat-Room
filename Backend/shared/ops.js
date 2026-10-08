import { LIMITS, OP } from './constants.js';

// ---------- ids ----------
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newId(len = 16) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// ---------- channel keys ----------
// Public channel: "general". Direct message: "dm:<uidA>:<uidB>" (sorted). Group chat: "grp:<id>".
const UID_RE = /^[a-f0-9]{16}$/;
export const isUid = (v) => typeof v === 'string' && UID_RE.test(v);
export const dmKey = (a, b) => `dm:${[a, b].sort().join(':')}`;
export const grpKey = (id) => `grp:${id}`;
export const isDm = (c) => typeof c === 'string' && c.startsWith('dm:');
export const isGroup = (c) => typeof c === 'string' && c.startsWith('grp:');
export const isPublicChannel = (c) => !isDm(c) && !isGroup(c);
export const dmMembers = (c) => c.slice(3).split(':');
export const CHANNEL_RE = /^(?:[a-z0-9][a-z0-9-]{0,23}|dm:[a-f0-9]{16}:[a-f0-9]{16}|grp:[a-z0-9]{8,16})$/;

export function cleanName(value, max = LIMITS.channel) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}
export const cleanWorkspace = (value) => cleanName(value, LIMITS.workspace);

// ---------- op validation ----------
const isStr = (v, max, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const isId = (v) => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);
const validEmoji = (v) => isStr(v, 16, 1) && !/[<>&"'`]/.test(v);
const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

function validateAttachment(att) {
  if (att == null) return true;
  if (typeof att !== 'object') return false;
  if (!['image', 'file', 'voice'].includes(att.kind)) return false;
  if (!isStr(att.id, 80, 1) || !isStr(att.name, 120, 1)) return false;
  if (!isStr(att.mime, 100, 3) || !/^[\w.+-]+\/[\w.+-]+$/.test(att.mime)) return false;
  if (!Number.isInteger(att.size) || att.size < 0 || att.size > LIMITS.fileBytes) return false;
  if (att.dur != null && !(typeof att.dur === 'number' && att.dur >= 0 && att.dur <= LIMITS.voiceSeconds + 5)) return false;
  if (att.wave != null && !(Array.isArray(att.wave) && att.wave.length <= LIMITS.wave && att.wave.every((n) => typeof n === 'number' && n >= 0 && n <= 1))) return false;
  if (att.w != null && !(Number.isInteger(att.w) && att.w > 0 && att.w < 20000)) return false;
  if (att.h != null && !(Number.isInteger(att.h) && att.h > 0 && att.h < 20000)) return false;
  if (att.url != null && !(isStr(att.url, 300) && /^\/uploads\/[\w-]+$/.test(att.url))) return false;
  return true;
}

const DATA_VALIDATORS = {
  [OP.MSG]: (d) => isStr(d.text, LIMITS.text)
    && (d.reply == null || isId(d.reply))
    && (d.stk == null || isStr(d.stk, 16, 1))
    && validateAttachment(d.att)
    && (d.text.trim().length > 0 || Boolean(d.att) || Boolean(d.stk))
    && (d.n == null || isStr(d.n, LIMITS.name, 1))
    && (d.col == null || (Number.isInteger(d.col) && d.col >= 0 && d.col < 360)),
  [OP.EDIT]: (d) => isId(d.x) && isStr(d.text, LIMITS.text, 1),
  [OP.DEL]: (d) => isId(d.x),
  [OP.REACT]: (d) => isId(d.x) && validEmoji(d.e) && typeof d.on === 'boolean',
  [OP.PIN]: (d) => isId(d.x) && typeof d.on === 'boolean',
  [OP.READ]: (d) => Number.isFinite(d.upto),
  [OP.DELIVERED]: (d) => Number.isFinite(d.upto),
  [OP.CHANNEL]: (d) => typeof d.name === 'string' && /^[a-z0-9][a-z0-9-]{0,23}$/.test(d.name) && isStr(d.topic ?? '', 80) && (d.del == null || typeof d.del === 'boolean'),
  [OP.GROUP]: (d) => typeof d.id === 'string' && /^[a-z0-9]{8,16}$/.test(d.id) && isStr(d.name, LIMITS.groupName, 1)
    && Array.isArray(d.members) && d.members.length >= 2 && d.members.length <= LIMITS.groupMembers && d.members.every(isUid)
    && (d.del == null || typeof d.del === 'boolean'),
};

// Returns an error string, or '' when the op is well formed. Pure and cheap: safe to run on every inbound op.
export function validateOp(op, { now = Date.now() } = {}) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return 'not an object';
  if (!isId(op.id)) return 'bad id';
  if (!isStr(op.w, LIMITS.workspace, 1)) return 'bad workspace';
  if (typeof op.c !== 'string' || !CHANNEL_RE.test(op.c)) return 'bad channel';
  if (!Object.values(OP).includes(op.t)) return 'bad type';
  if (!isUid(op.a)) return 'bad author';
  if (!Number.isFinite(op.lc) || op.lc <= 0 || op.lc > now + MAX_SKEW_MS) return 'bad clock';
  if (!Number.isFinite(op.ts) || op.ts <= 0 || op.ts > now + MAX_SKEW_MS) return 'bad time';
  if (!op.d || typeof op.d !== 'object' || Array.isArray(op.d)) return 'bad data';
  if (!DATA_VALIDATORS[op.t](op.d)) return 'bad data';
  if (isDm(op.c) && !dmMembers(op.c).includes(op.a)) return 'not a member';
  let size;
  try { size = JSON.stringify(op).length; } catch { return 'unserializable'; }
  if (size > LIMITS.opBytes) return 'too large';
  return '';
}

// Register ops keep only the newest value per key (read markers, channel and group definitions).
export function registerKey(op) {
  switch (op.t) {
    case OP.READ: return `rd:${op.a}:${op.c}`;
    case OP.DELIVERED: return `dv:${op.a}:${op.c}`;
    case OP.CHANNEL: return `ch:${op.d.name}`;
    case OP.GROUP: return `g:${op.d.id}`;
    default: return null;
  }
}
