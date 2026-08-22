// Small in-memory limiter for the write-heavy Server Actions. Deliberately
// simple: per-process, resets on restart, not shared across instances - fine
// for this single-instance demo, not production-grade. Real deployment would
// need a shared store (e.g. Redis) once this runs on more than one instance -
// see README.md Stage 2 gates.
//
// Originally sized for a small, known key set (createSegment:<workspaceId>,
// one entry per workspace). login/signup now key this by attacker-supplied
// email addresses instead - an unbounded cardinality the original design
// didn't anticipate, since nothing ever removes an expired entry from the
// map on its own. A flood of distinct fake emails would otherwise grow
// `buckets` without limit. Mitigated with an opportunistic sweep (checked on
// every call, cheap when the map is small) rather than a scheduled job this
// simple in-memory store has no way to run.
const buckets = new Map<string, { count: number; resetAt: number }>();
const SWEEP_INTERVAL = 500; // calls, not ms - avoids a full scan on every single call
let callsSinceSweep = 0;

export function withinRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  callsSinceSweep++;
  if (callsSinceSweep >= SWEEP_INTERVAL) {
    callsSinceSweep = 0;
    for (const [k, v] of buckets) {
      if (now > v.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}
