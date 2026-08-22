// Assert-based regression check for the Calibration screen's classification
// logic - the real judge() from src/lib/calibration.ts, exercising every
// (outcome type, tier) combination the real screen can produce, not just
// the happy path.
import { judge } from "../src/lib/calibration";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

assert(judge("churned", null).verdict === "n/a", "No score on file is judged n/a, regardless of outcome type");
assert(judge("renewed", null).verdict === "n/a", "No score on file is judged n/a even for a positive outcome");

assert(judge("churned", "Watch").verdict === "confirmed", "A risk-band score followed by churn is confirmed");
assert(judge("churned", "Critical").verdict === "confirmed", "Critical tier followed by churn is confirmed");
assert(judge("churned", "Stable").verdict === "missed", "A healthy score followed by churn is missed - the real scoring gap");
assert(judge("churned", "Thriving").verdict === "missed", "Thriving tier followed by churn is missed");

assert(judge("renewed", "Watch").verdict === "review", "A risk-band score followed by renewal is worth reviewing, not auto-flagged as wrong");
assert(judge("renewed", "Critical").verdict === "review", "Critical tier followed by renewal is worth reviewing");
assert(judge("renewed", "Stable").verdict === "confirmed", "A healthy score followed by renewal is confirmed");
assert(judge("expanded", "Thriving").verdict === "confirmed", "Thriving tier followed by expansion is confirmed");
assert(judge("expanded", "Watch").verdict === "review", "A risk-band score followed by expansion is still worth reviewing, not auto-confirmed just because it's a good type");

console.log("\nAll calibration checks passed.");
