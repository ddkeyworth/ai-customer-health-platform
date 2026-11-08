// Assert-based regression check for Health's Layer 2 guards
// (applyAdjustmentGuards in src/lib/health/agenticLayer.ts). Pure logic, no
// database or API. These exist because an unguarded Layer 2 lowered 89 of
// 120 scores (63 by exactly -8), mostly on signals the baseline had already
// scored, and a later prompt-only fix swung to +5 for most accounts after
// citing one routine "asked about seats" ticket.
import { applyAdjustmentGuards, bandCeiling } from "../src/lib/health/agenticLayer";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const EVIDENCE = "Escalated: repeated sync failures between billing and freight tracking, third time this month.";

assert(bandCeiling(90) === 100 && bandCeiling(85) === 100, "A Thriving baseline (85+) can go up to 100");
assert(bandCeiling(84) === 84 && bandCeiling(60) === 84, "A Stable baseline (60-84) tops out at 84");
assert(bandCeiling(59) === 59 && bandCeiling(40) === 59, "A Watch baseline (40-59) tops out at 59");
assert(bandCeiling(39) === 39 && bandCeiling(10) === 39, "A Critical baseline (under 40) tops out at 39");

assert(applyAdjustmentGuards(-8, undefined, 70) === 0, "A downward adjustment with no evidence named is set to 0");
assert(applyAdjustmentGuards(-8, "", 70) === 0, "A downward adjustment with an empty evidence field is set to 0");
assert(applyAdjustmentGuards(-8, "usage fell", 70) === 0, "Evidence too short to be a real quote does not count");
assert(applyAdjustmentGuards(-8, EVIDENCE, 70) === -8, "A downward adjustment backed by quoted evidence is kept");
assert(applyAdjustmentGuards(-30, EVIDENCE, 70) === -15, "An adjustment beyond the -15 bound is clamped to -15");
assert(applyAdjustmentGuards(0, undefined, 70) === 0, "No adjustment needs no evidence");

assert(applyAdjustmentGuards(5, undefined, 70) === 0, "An upward adjustment with no evidence is set to 0");
assert(applyAdjustmentGuards(5, EVIDENCE, 70) === 5, "An upward adjustment within the band is kept");
assert(applyAdjustmentGuards(5, EVIDENCE, 82) === 2, "An upward adjustment from 82 is capped at 84, the top of Stable (+2, not +5)");
assert(applyAdjustmentGuards(5, EVIDENCE, 84) === 0, "An account already at the top of its band cannot be nudged up");
assert(applyAdjustmentGuards(5, EVIDENCE, 58) === 1, "A Watch account at 58 cannot be lifted out of Watch (+1, not +5)");
assert(applyAdjustmentGuards(5, EVIDENCE, 40) === 5, "A baseline of exactly 40 is already Watch, so +5 stays within Watch");
assert(applyAdjustmentGuards(15, EVIDENCE, 90) === 10, "Even a Thriving account is capped at 100");

assert(applyAdjustmentGuards(-8, EVIDENCE, 85) === -8, "A downward move may cross a band boundary: a specific risk signal is what a baseline can miss");

console.log("\nAll Health Layer 2 guard checks passed.");
