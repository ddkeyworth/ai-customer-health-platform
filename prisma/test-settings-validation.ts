// Assert-based regression check for Settings' field-validation rules -
// the real ones imported from src/lib/settingsValidation.ts, not a copy,
// so this actually breaks if someone loosens a rule in production code.
import {
  HEX_COLOR,
  CURRENCY_CODE,
  ALLOWED_DATE_FORMATS,
  ALLOWED_LANGUAGES,
  ANTHROPIC_KEY_PATTERN,
  clampRiskWeight,
} from "../src/lib/settingsValidation";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

assert(HEX_COLOR.test("#378ADD"), "A valid 6-digit hex colour is accepted");
assert(!HEX_COLOR.test("378ADD"), "A hex colour missing the # is rejected");
assert(!HEX_COLOR.test("#fff"), "A 3-digit shorthand hex colour is rejected (not the format this app stores)");
assert(!HEX_COLOR.test("#GGGGGG"), "A hex colour with non-hex characters is rejected");

assert(CURRENCY_CODE.test("GBP"), "A valid 3-letter uppercase currency code is accepted");
assert(!CURRENCY_CODE.test("gbp"), "A lowercase currency code is rejected (Server Action uppercases before testing)");
assert(!CURRENCY_CODE.test("GBPX"), "A 4-letter currency code is rejected");

assert(ALLOWED_DATE_FORMATS.includes("DD/MM/YYYY"), "DD/MM/YYYY is an allowed date format");
assert(!ALLOWED_DATE_FORMATS.includes("DD-MM-YYYY"), "An unlisted date format is correctly not allowed");

assert(ALLOWED_LANGUAGES.includes("en-GB"), "en-GB is an allowed language");
assert(!ALLOWED_LANGUAGES.includes("fr-FR"), "An unsupported language is correctly not allowed");

assert(ANTHROPIC_KEY_PATTERN.test("sk-ant-api03-abcdefghijklmnopqrst"), "A well-formed Anthropic key shape is accepted");
assert(!ANTHROPIC_KEY_PATTERN.test("sk-ant-tooshort"), "A too-short value after the prefix is rejected");
assert(!ANTHROPIC_KEY_PATTERN.test("not-an-anthropic-key-at-all-1234567890"), "A value with the wrong prefix is rejected");

assert(clampRiskWeight(3) === 3, "A risk weight already in range (1-5) passes through unchanged");
assert(clampRiskWeight(0) === 1, "A risk weight below the range clamps up to 1");
assert(clampRiskWeight(99) === 5, "A risk weight above the range clamps down to 5");
assert(clampRiskWeight(2.6) === 3, "A non-integer risk weight rounds to the nearest integer");
assert(clampRiskWeight(NaN) === 3, "A non-numeric risk weight defaults to 3, the same default the UI form shows");

console.log("\nAll settings-validation checks passed.");
