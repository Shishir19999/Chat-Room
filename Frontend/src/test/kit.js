import { createEngine } from '../core/engine.js';
import { generateIdentity } from '../core/crypto.js';
import { createMemoryStore } from '../store/memory.js';

// Test helpers: spin up engines connected through an in-memory hub (the peer-to-peer transport is mocked).
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 2000, step = 5 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`waitFor timed out: ${fn}`);
    await tick(step);
  }
}

export async function makeClient(hub, name, { ws = 'testroom', store = createMemoryStore(), identity, start = true, ...rest } = {}) {
  const id = identity || await generateIdentity();
  const transport = hub.create();
  const engine = createEngine({ transport, store, identity: id, profile: { name, color: 120 }, ws, ...rest });
  if (start) await engine.start();
  return { engine, transport, store, identity: id, name };
}

export const texts = (engine, c = 'general') => engine.view(c).map((m) => m.text);
