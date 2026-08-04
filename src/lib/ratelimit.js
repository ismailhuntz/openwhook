// Simple in-memory fixed-window rate limiter. No external dependencies.
// Each limiter instance keeps its own bucket map; expired buckets are
// swept periodically so memory stays bounded even under many distinct keys.

export function createRateLimiter({ windowMs, max, message, keyFn }) {
  const buckets = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : (req.ip || req.socket.remoteAddress || 'unknown');

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: message || 'Too many requests' });
      return;
    }
    next();
  };
}
