// Shared limits and identifiers for the chat domain (used by both transports).
export const APP_ID = 'chat-room-p2p-v1';
export const LOBBY = 'lobby';
export const DEFAULT_CHANNEL = 'general';
export const DEFAULT_CHANNELS = ['general', 'random'];

export const LIMITS = {
  name: 24,
  status: 60,
  text: 4000,
  channel: 24,
  workspace: 30,
  password: 64,
  opBytes: 32 * 1024, // serialized op, attachments excluded (they travel separately)
  fileBytes: 5 * 1024 * 1024,
  voiceSeconds: 120,
  reactionKinds: 12,
  groupMembers: 8,
  groupName: 30,
  historyPage: 50,
  syncBatch: 400,
  wave: 48,
};

// Per-sender rate limits (token buckets).
export const RATES = {
  op: { capacity: 12, refillPerSec: 1.5 },
  eph: { capacity: 30, refillPerSec: 6 },
  blob: { capacity: 4, refillPerSec: 0.2 },
  hist: { capacity: 4, refillPerSec: 0.3 },
};

export const OP = {
  MSG: 'm',
  EDIT: 'e',
  DEL: 'd',
  REACT: 'r',
  PIN: 'p',
  READ: 'rd',
  DELIVERED: 'dv',
  CHANNEL: 'ch',
  GROUP: 'g',
};

export const PRESENCE = { ONLINE: 'online', IDLE: 'idle', AWAY: 'away' };
export const IDLE_AFTER_MS = 2 * 60 * 1000;

export const PUBLIC_NOTICE = 'Public rooms are visible to anyone on the internet; do not share personal information.';
export const DEMO_BANNER = 'Live preview - runs in your browser; chat is peer-to-peer. Messages stay on this device.';

export const COLORS = [210, 340, 25, 150, 270, 190, 50, 310, 120, 0];
