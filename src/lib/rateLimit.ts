// Small in-memory limiter for the write-heavy Server Actions. Deliberately
// simple: per-process, resets on restart, not shared across instances - fine
// for this single-instance demo, not production-grade. Real deployment would
// need a shared store (e.g. Redis) once this runs on more than one instance -
// see README.md Stage 2 gates.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function withinRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
