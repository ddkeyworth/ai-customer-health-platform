// Rate limiter for the write-heavy Server Actions. Uses a real shared store
// (Upstash Redis, via Vercel's Storage marketplace integration) when
// UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are configured - counts
// are then shared across every serverless function instance, not reset
// per cold start. Falls back to the original per-process in-memory Map
// when those aren't set (e.g. local `npm run dev`), so running the app
// locally never requires its own Redis instance.
//
// The in-memory fallback was originally sized for a small, known key set
// (createSegment:<workspaceId>, one entry per workspace). login/signup key
// it by attacker-supplied email addresses instead - an unbounded
// cardinality the original design didn't anticipate, since nothing ever
// removes an expired entry from the map on its own. Mitigated with an
// opportunistic sweep (checked on every call, cheap when the map is small)
// rather than a scheduled job this simple in-memory store has no way to run.
import { Redis } from "@upstash/redis";

const buckets = new Map<string, { count: number; resetAt: number }>();
const SWEEP_INTERVAL = 500; // calls, not ms - avoids a full scan on every single call
let callsSinceSweep = 0;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export async function withinRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  return redis ? withinRateLimitRedis(redis, key, limit, windowMs) : withinRateLimitMemory(key, limit, windowMs);
}

// Fixed-window counter: INCR is atomic even across concurrent serverless
// instances, and EXPIRE is only set on the first increment of a window so
// a burst of concurrent requests can't each reset the window's expiry.
async function withinRateLimitRedis(redis: Redis, key: string, limit: number, windowMs: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, Math.ceil(windowMs / 1000));
  }
  return count <= limit;
}

function withinRateLimitMemory(key: string, limit: number, windowMs: number): boolean {
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
