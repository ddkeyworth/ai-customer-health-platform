// Assert-based regression check for the extracted days-overdue calculation
// (src/lib/onboarding/pace.ts) - pure logic, no database, exactly what was
// already shipped inline on the Onboarding and Briefing screens before
// being pulled out for reuse.
import { computeDaysOverdue } from "../src/lib/onboarding/pace";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const now = new Date("2026-08-23T12:00:00Z");

assert(computeDaysOverdue(null, now) === null, "No expected go-live date returns null, not zero or a crash");
assert(computeDaysOverdue(new Date("2026-08-13T12:00:00Z"), now) === 10, "A date 10 days in the past returns 10 days overdue");
assert(computeDaysOverdue(new Date("2026-08-30T12:00:00Z"), now) === -7, "A date in the future returns a negative number, not clamped to zero");
assert(computeDaysOverdue(now, now) === 0, "The expected date being today returns exactly zero");

console.log("\nAll onboarding-pace checks passed.");
