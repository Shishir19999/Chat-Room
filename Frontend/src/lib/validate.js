import { LIMITS } from '../core/constants.js';
import { cleanName } from '../core/ops.js';

// Form validation used by the landing page and dialogs. Each returns '' when valid, otherwise a friendly message.
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function validateName(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Please enter a name.';
  if (v.length < 2) return 'Use at least 2 characters.';
  if (v.length > LIMITS.name) return `Use at most ${LIMITS.name} characters.`;
  if (!NAME_RE.test(v)) return 'Use letters, numbers, dots, dashes or underscores (no spaces).';
  return '';
}

export function validateChannelName(value) {
  const clean = cleanName(value);
  if (!clean) return 'Use letters, numbers and dashes.';
  if (clean.length < 2) return 'Use at least 2 characters.';
  return '';
}

export function validateRoomName(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Pick a room name.';
  const clean = cleanName(v, LIMITS.workspace);
  if (clean.length < 2) return 'Use at least 2 letters or numbers.';
  return '';
}

export function validatePassword(value) {
  const v = String(value ?? '');
  if (!v) return '';
  if (v.length < 4) return 'Use at least 4 characters for a private room password.';
  if (v.length > LIMITS.password) return `Use at most ${LIMITS.password} characters.`;
  return '';
}
