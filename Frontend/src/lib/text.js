// Pure text helpers: rich-text tokenizing, search highlighting, dates, avatar colors.

const TOKEN_RE = /(https?:\/\/[^\s<>"]+)|((?<![\w.])@[A-Za-z0-9_.-]{2,30})/g;
const TRAILING = /[.,;:!?)\]'"-]+$/;

// Splits text into { type: 'text' | 'link' | 'mention', value } parts. Only http(s) links are linked.
export function tokenize(text) {
  const out = [];
  const src = String(text ?? '');
  let last = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    let value = m[0];
    const trail = value.match(TRAILING);
    if (trail) value = value.slice(0, value.length - trail[0].length);
    if (!value || (m[2] && value.length < 3)) continue;
    if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index) });
    out.push({ type: m[1] ? 'link' : 'mention', value });
    last = m.index + value.length;
  }
  if (last < src.length) out.push({ type: 'text', value: src.slice(last) });
  return out;
}

export function mentionsUser(text, user) {
  if (!user) return false;
  return tokenize(text).some((t) => t.type === 'mention' && t.value.slice(1).toLowerCase() === user.toLowerCase());
}

// Splits text into [{ value, match }] so the UI can wrap matches in <mark>.
export function splitHighlight(text, query) {
  const src = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return [{ value: src, match: false }];
  const lower = src.toLowerCase();
  const needle = q.toLowerCase();
  const out = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ value: src.slice(i, at), match: false });
    out.push({ value: src.slice(at, at + needle.length), match: true });
    i = at + needle.length;
  }
  if (i < src.length) out.push({ value: src.slice(i), match: false });
  return out.length ? out : [{ value: src, match: false }];
}

export const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

export function relativeShort(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Dark enough for white text (AA) on every hue.
export const avatarColor = (name) => `hsl(${hashString(String(name).toLowerCase()) % 360} 55% 36%)`;
export const initials = (name) => String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';

// Groups messages: marks date separators and whether a message continues the previous author's run.
export function decorateMessages(messages, groupMs = 5 * 60 * 1000) {
  let prev = null;
  return messages.map((m) => {
    const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
    const grouped = Boolean(prev) && !newDay && prev.user === m.user && !m.replyTo
      && new Date(m.createdAt) - new Date(prev.createdAt) < groupMs;
    prev = m;
    return { message: m, newDay, grouped };
  });
}
