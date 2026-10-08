// The single source of truth for the Socket.IO protocol. The frontend keeps a verbatim copy at
// Frontend/src/transport/socketEvents.js (a test fails if the two drift apart).

/** Client -> server events. */
export const C2S = Object.freeze({
  JOIN: 'join', // (JoinRequest, ack: (JoinReply) => void)
  LEAVE: 'leave', // ()
  OP: 'op', // (Op, ack: ({ ok, error?, duplicate? }) => void)
  EPH: 'eph', // (EphRequest) typing, presence and profile announcements
  HISTORY: 'history', // (HistoryQuery, ack: ({ ok, ops }) => void)
  REPORT: 'report', // ({ id, c, reason }, ack)
  PING: 'ping-rtt', // (ack) used to measure round-trip time
});

/** Server -> client events. */
export const S2C = Object.freeze({
  PEER_JOIN: 'peer-join', // ({ peerId, uid, profile })
  PEER_LEAVE: 'peer-leave', // ({ peerId, uid })
  OP: 'op', // (Op, { uid })
  EPH: 'eph', // ({ type, data }, { peerId, uid })
});

/** Ephemeral message kinds the server relays (everything else is dropped). */
export const EPH_TYPES = Object.freeze(['hi', 'pres', 'ty']);

export const EPH_MAX_BYTES = 8 * 1024;

/**
 * @typedef {{ ws: string, password?: string, uid: string, secret: string, profile: { name: string, color?: number, status?: string, presence?: string } }} JoinRequest
 * @typedef {{ ok: boolean, error?: string, code?: string, selfId?: string, peers?: { peerId: string, uid: string, profile: object }[], uploadToken?: string, isNew?: boolean, private?: boolean }} JoinReply
 * @typedef {{ type: 'hi'|'pres'|'ty', data: object, toUids?: string[], peerId?: string }} EphRequest
 * @typedef {{ c?: string, before?: number, after?: number, limit?: number }} HistoryQuery
 */

export const ERROR = Object.freeze({
  BAD_REQUEST: 'bad-request',
  WRONG_PASSWORD: 'wrong-password',
  IDENTITY: 'identity-mismatch',
  RATE: 'rate-limited',
  NOT_JOINED: 'not-joined',
  FORBIDDEN: 'forbidden',
});
