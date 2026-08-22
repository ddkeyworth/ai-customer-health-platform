// Assert-based regression check for the real withinRateLimit() from
// src/lib/rateLimit.ts - the actual Postgres-backed implementation, not a
// fallback or a copy, since it's backed by the same database everywhere
// (local dev and production alike). Cleans up the rows it creates
// afterward so it doesn't leave test keys sitting in the real table.
import { PrismaClient } from "@prisma/client";
import { withinRateLimit } from "../src/lib/rateLimit";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const testKeyPrefix = `test-rate-limit-${Date.now()}`;
  const key = `${testKeyPrefix}-main`;

  try {
    for (let i = 1; i <= 3; i++) {
      assert(await withinRateLimit(key, 3, 60_000), `Call ${i} of 3 within the limit is allowed`);
    }
    assert(!(await withinRateLimit(key, 3, 60_000)), "The 4th call, over the limit, is correctly blocked");
    assert(!(await withinRateLimit(key, 3, 60_000)), "A further call while still blocked stays blocked, not reset by the check itself");

    const otherKey = `${testKeyPrefix}-other`;
    assert(await withinRateLimit(otherKey, 3, 60_000), "A different key has its own independent count, unaffected by the first key being exhausted");

    const shortWindowKey = `${testKeyPrefix}-short-window`;
    assert(await withinRateLimit(shortWindowKey, 1, 50), "First call against a 1-request, 50ms window is allowed");
    assert(!(await withinRateLimit(shortWindowKey, 1, 50)), "A second immediate call against that same short window is blocked");
    await sleep(75);
    assert(await withinRateLimit(shortWindowKey, 1, 50), "After the window elapses, the same key is allowed again - it doesn't stay blocked forever");

    const concurrentKey = `${testKeyPrefix}-concurrent`;
    const results = await Promise.all(Array.from({ length: 5 }, () => withinRateLimit(concurrentKey, 3, 60_000)));
    const allowedCount = results.filter(Boolean).length;
    assert(
      allowedCount === 3,
      `Exactly 3 of 5 truly concurrent calls against a limit of 3 are allowed (got ${allowedCount}) - the atomic upsert prevents a race from over-counting`
    );

    console.log("\nAll rate-limit checks passed.");
  } finally {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: testKeyPrefix } } });
  }
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
