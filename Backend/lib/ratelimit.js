// Token bucket (same idea as the frontend limiter); used per socket and per client address.
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
        // True when `cost` tokens are available (without taking them).
        has(key, cost = 1) {
            const b = buckets.get(key);
            if (!b) return true;
            return Math.min(capacity, b.tokens + ((now() - b.at) / 1000) * refillPerSec) >= cost;
        },
        forget(key) { buckets.delete(key); },
        sweep(maxAgeMs = 10 * 60 * 1000) {
            const t = now();
            for (const [k, b] of buckets) if (t - b.at > maxAgeMs) buckets.delete(k);
        },
    };
}
