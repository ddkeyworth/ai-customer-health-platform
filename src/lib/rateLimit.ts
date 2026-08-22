// Rate limiter for the write-heavy Server Actions, backed by this app's own
// Postgres (the same free-tier Neon instance everything else already uses),
// not a separate paid Redis service - no new account, no new env vars, and
// it works identically in local dev and on Vercel since DATABASE_URL is
// already configured in both.
//
// A single INSERT ... ON CONFLICT statement does the whole fixed-window
// check atomically: create the row on first use, or - within the same
// statement - either increment the count (window still open) or reset it
// to 1 (window has expired), all in one round-trip so concurrent requests
// for the same key can't race each other into an inconsistent count.
import { prisma } from "@/lib/prisma";

export async function withinRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limit_buckets (key, count, "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets."resetAt" < ${now} THEN 1 ELSE rate_limit_buckets.count + 1 END,
      "resetAt" = CASE WHEN rate_limit_buckets."resetAt" < ${now} THEN ${resetAt} ELSE rate_limit_buckets."resetAt" END
    RETURNING count
  `;

  return rows[0].count <= limit;
}
