// Shared limits and validation (mirrors the backend rules).
export const LIMITS = {
  user: 30,
  message: 500,
  room: 30,
  description: 80,
  image: 400000, // data URL characters
  snippet: 140,
  pageSize: 30,
  emoji: 8,
  reactionKinds: 12,
};

export const DEFAULT_ROOM = 'general';

export const cleanRoom = (v) =>
  String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, LIMITS.room) || DEFAULT_ROOM;

const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;

export function validateUsername(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Please enter a username.';
  if (v.length < 2) return 'Use at least 2 characters.';
  if (v.length > LIMITS.user) return `Use at most ${LIMITS.user} characters.`;
  if (!USERNAME_RE.test(v)) return 'Use letters, numbers, dots, dashes or underscores (no spaces).';
  return '';
}

export function validateRoomName(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'Please enter a room name.';
  if (!/^[a-z0-9_-]+$/.test(v)) return 'Use lowercase letters, numbers, dashes or underscores.';
  if (v.length < 2) return 'Use at least 2 characters.';
  if (v.length > LIMITS.room) return `Use at most ${LIMITS.room} characters.`;
  return '';
}

export function validateMessage(value, hasImage = false) {
  const v = String(value ?? '').trim();
  if (!v && !hasImage) return 'Write a message first.';
  if (v.length > LIMITS.message) return `Messages can have at most ${LIMITS.message} characters.`;
  return '';
}
