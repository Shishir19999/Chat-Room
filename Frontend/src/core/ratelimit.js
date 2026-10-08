// Token bucket per key (peer id or user id). `take` returns false when the sender is over its limit.
export function createRateLimiter({ capacity, refillPerSec }, now = () => Date.now()) {
  const buckets = new Map();
  return {
    take(key, cost = 1) {
      const t = now();
      let b = buckets.get(key);
      if (!b) { b = { tokens: capacity, at: t }; buckets.set(key, b); }
      b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * refillPerSec);
      b.at = t;
      if (b.tokens < cost) return false;
      b.tokens -= cost;
      return true;
    },
    forget(key) { buckets.delete(key); },
    get size() { return buckets.size; },
  };
}
