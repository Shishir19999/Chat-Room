// Pure display helpers: times, dates, avatar colours, message grouping.

export const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function dayLabel(ms, now = new Date()) {
  const d = new Date(ms);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

export function relativeShort(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

export const formatDuration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Avatar colours are dark enough for white initials (WCAG AA) at every hue.
export const avatarColor = (hue) => `hsl(${Number.isFinite(hue) ? hue : 210} 55% 34%)`;
export const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';

// Decorates an ordered message list with date separators, author grouping and the "new messages" divider.
export function decorateMessages(messages, { groupMs = 5 * 60 * 1000, unreadAfter = null, me = null } = {}) {
  let prev = null;
  let dividerPlaced = false;
  return messages.map((m) => {
    const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
    const grouped = Boolean(prev) && !newDay && prev.a === m.a && !m.reply && !prev.deleted && !m.deleted && m.ts - prev.ts < groupMs;
    let divider = false;
    if (unreadAfter != null && !dividerPlaced && m.lc > unreadAfter && m.a !== me) { divider = true; dividerPlaced = true; }
    prev = m;
    return { message: m, newDay, grouped: grouped && !divider, divider };
  });
}

export const isImageMime = (mime) => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime);
