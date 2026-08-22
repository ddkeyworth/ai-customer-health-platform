// Assert-based regression check for the rate limiter's in-memory fallback
// path - the real withinRateLimit() from src/lib/rateLimit.ts. This
// exercises the in-memory branch specifically (no UPSTASH_REDIS_REST_URL/
// TOKEN are set when this script runs directly), the same branch local
// `npm run dev` always uses. The Redis-backed branch is only reachable
// once a real Upstash store is connected in an actual deployment, so it's
// not something a local script can assert against without one.
import { withinRateLimit } from "../src/lib/rateLimit";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const key = `test-rate-limit-${Date.now()}`;

  for (let i = 1; i <= 3; i++) {
    assert(await withinRateLimit(key, 3, 60_000), `Call ${i} of 3 within the limit is allowed`);
  }
  assert(!(await withinRateLimit(key, 3, 60_000)), "The 4th call, over the limit, is correctly blocked");
  assert(!(await withinRateLimit(key, 3, 60_000)), "A further call while still blocked stays blocked, not reset by the check itself");

  const otherKey = `test-rate-limit-other-${Date.now()}`;
  assert(await withinRateLimit(otherKey, 3, 60_000), "A different key has its own independent count, unaffected by the first key being exhausted");

  const shortWindowKey = `test-rate-limit-short-window-${Date.now()}`;
  assert(await withinRateLimit(shortWindowKey, 1, 50), "First call against a 1-request, 50ms window is allowed");
  assert(!(await withinRateLimit(shortWindowKey, 1, 50)), "A second immediate call against that same short window is blocked");
  await sleep(75);
  assert(await withinRateLimit(shortWindowKey, 1, 50), "After the window elapses, the same key is allowed again - it doesn't stay blocked forever");

  console.log("\nAll rate-limit checks passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
