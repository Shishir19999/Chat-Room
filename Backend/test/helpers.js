import { randomBytes } from 'node:crypto';
import { io as connectClient } from 'socket.io-client';
import { C2S, S2C } from '../events.js';

export const BASE = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';
export const hex = (n) => randomBytes(n).toString('hex');
let counter = 0;

export function makeConnector(getUrl, clients) {
    // Opens a socket and joins a room; resolves to a small client wrapper.
    return async function connect({ ws = 'lobby', name = `user${++counter}`, uid = hex(8), secret = hex(16), password, join = true } = {}) {
        const socket = connectClient(getUrl(), { transports: ['websocket'], forceNew: true });
        clients.push(socket);
        await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
        const log = { ops: [], eph: [], joins: [], leaves: [] };
        socket.on(S2C.OP, (op, ctx) => log.ops.push({ op, ctx }));
        socket.on(S2C.EPH, (e, ctx) => log.eph.push({ e, ctx }));
        socket.on(S2C.PEER_JOIN, (p) => log.joins.push(p));
        socket.on(S2C.PEER_LEAVE, (p) => log.leaves.push(p));
        const client = {
            socket, uid, secret, name, log,
            call: (ev, payload) => new Promise((r) => socket.emit(ev, payload, r)),
            join: (extra = {}) => client.call(C2S.JOIN, { ws, uid, secret, password, profile: { name, color: 100 }, ...extra }),
            op: (op) => client.call(C2S.OP, op),
            history: (query) => client.call(C2S.HISTORY, query),
        };
        if (join) client.reply = await client.join();
        return client;
    };
}

let lc = Date.now();
export function makeOp(c, ws = 'lobby') {
    return (a, t, d, extra = {}) => ({ id: hex(8), w: ws, c, t, a, lc: ++lc, ts: Date.now(), d, ...extra });
}

export const until = async (fn, timeout = 2000) => {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error('until timed out');
        await new Promise((r) => setTimeout(r, 10));
    }
};
export const quiet = (ms = 120) => new Promise((r) => setTimeout(r, ms));
