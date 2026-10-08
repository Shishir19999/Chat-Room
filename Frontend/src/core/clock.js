// Hybrid logical clock: monotonic, close to wall time, and it never goes backwards when peers' clocks differ.
const MAX_AHEAD_MS = 60 * 1000;

export function createClock(now = () => Date.now()) {
  let last = 0;
  return {
    // Value for a new local event.
    tick() {
      last = Math.max(last + 1, now());
      return last;
    },
    // Fold in a value seen on a remote event (capped so a bad clock cannot drag ours far ahead).
    observe(remote) {
      if (Number.isFinite(remote)) last = Math.max(last, Math.min(remote, now() + MAX_AHEAD_MS));
      return last;
    },
    get value() { return last; },
  };
}

// Total order used for message lists: logical time, then wall time, then id.
export function compareOps(a, b) {
  return (a.lc - b.lc) || (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
