// Assert-based regression check for the free-trial gate (src/lib/trialGate.ts)
// that every capability's AI layer - Health included - now runs behind. Pure
// function, no database needed: trial status is computed from createdAt at
// read time, not a stored column.
import { getTrialStatus, TRIAL_DAYS } from "../src/lib/trialGate";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const now = new Date("2026-09-20T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const freshWorkspace = { isDemoSeed: false, subscriptionActive: false, createdAt: daysAgo(1) };
const freshStatus = getTrialStatus(freshWorkspace, now);
assert(freshStatus.active, "A workspace created yesterday is still within its trial");
assert(!freshStatus.exempt, "A real (non-demo) workspace is not exempt");
assert(freshStatus.daysRemaining === TRIAL_DAYS - 1, "Days remaining counts down from TRIAL_DAYS");

const expiredWorkspace = { isDemoSeed: false, subscriptionActive: false, createdAt: daysAgo(TRIAL_DAYS + 1) };
const expiredStatus = getTrialStatus(expiredWorkspace, now);
assert(!expiredStatus.active, "A workspace past TRIAL_DAYS with no subscription has no AI access");
assert(expiredStatus.daysRemaining === 0, "Days remaining floors at 0 once the trial has ended, not negative");

const boundaryWorkspace = { isDemoSeed: false, subscriptionActive: false, createdAt: daysAgo(TRIAL_DAYS) };
assert(!getTrialStatus(boundaryWorkspace, now).active, "A workspace exactly TRIAL_DAYS old has its trial ended, not still active");

const subscribedWorkspace = { isDemoSeed: false, subscriptionActive: true, createdAt: daysAgo(TRIAL_DAYS + 100) };
const subscribedStatus = getTrialStatus(subscribedWorkspace, now);
assert(subscribedStatus.active, "A subscribed workspace has AI access regardless of trial age");
assert(subscribedStatus.subscribed, "subscribed reflects the workspace's real subscriptionActive flag");

const demoWorkspace = { isDemoSeed: true, subscriptionActive: false, createdAt: daysAgo(1000) };
const demoStatus = getTrialStatus(demoWorkspace, now);
assert(demoStatus.active, "The demo seed workspace always has AI access, however old it is");
assert(demoStatus.exempt, "The demo seed workspace is flagged exempt, not just incidentally active");

console.log("\nAll trial-gate checks passed.");
