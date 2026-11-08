// Assert-based check of the settings that separate the owner's hosted site from
// someone's own copy: SELF_HOSTED, ALLOW_SIGNUP, ALLOW_DEMO_SEED, and whether
// the encryption key is usable. Pure logic, no database. The seed itself is
// never run from a test, because a regression there would wipe a real database.
import { randomBytes } from "node:crypto";
import { isSelfHosted, signupAllowed, signupMode } from "../src/lib/deployment";
import { encryptionKeyUsable } from "../src/lib/secretReady";
import { seedAllowed, SEED_REFUSAL } from "./seedGuard";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const saved = { ...process.env };
const reset = () => {
  delete process.env.SELF_HOSTED;
  delete process.env.ALLOW_SIGNUP;
};
const set = (selfHosted: string | undefined, allowSignup: string | undefined) => {
  reset();
  if (selfHosted !== undefined) process.env.SELF_HOSTED = selfHosted;
  if (allowSignup !== undefined) process.env.ALLOW_SIGNUP = allowSignup;
};

// ---------- SELF_HOSTED ----------
reset();
assert(isSelfHosted() === false, "With nothing set the deployment is the locked-down hosted site");
process.env.SELF_HOSTED = "true";
assert(isSelfHosted() === true, "SELF_HOSTED=true makes it a self-hosted copy");
for (const wrong of ["TRUE", "1", "yes", " true", ""]) {
  process.env.SELF_HOSTED = wrong;
  assert(isSelfHosted() === false, `SELF_HOSTED=${JSON.stringify(wrong)} is not exactly "true", so the site stays locked down`);
}

// ---------- signup, every combination ----------
// Expected results are written out by hand, not derived from the code under test.
//   hosted site (SELF_HOSTED not exactly "true"):  ALLOW_SIGNUP unset -> closed
//   self-hosted copy:                              ALLOW_SIGNUP unset -> open for the first account only
//   ALLOW_SIGNUP "true" -> open, "false" -> closed, in either mode
type Case = { selfHosted: string | undefined; allow: string | undefined; mode: string; atZero: boolean; atOne: boolean };
const cases: Case[] = [
  { selfHosted: undefined, allow: undefined, mode: "closed", atZero: false, atOne: false },
  { selfHosted: undefined, allow: "true", mode: "open", atZero: true, atOne: true },
  { selfHosted: undefined, allow: "false", mode: "closed", atZero: false, atOne: false },
  { selfHosted: "true", allow: undefined, mode: "first_account_only", atZero: true, atOne: false },
  { selfHosted: "true", allow: "true", mode: "open", atZero: true, atOne: true },
  { selfHosted: "true", allow: "false", mode: "closed", atZero: false, atOne: false },
];
for (const c of cases) {
  set(c.selfHosted, c.allow);
  const label = `SELF_HOSTED=${JSON.stringify(c.selfHosted)} ALLOW_SIGNUP=${JSON.stringify(c.allow)}`;
  assert(signupMode() === c.mode, `${label}: signup mode is ${c.mode}`);
  assert(signupAllowed(0) === c.atZero, `${label}: with no users signup is ${c.atZero ? "allowed" : "refused"}`);
  assert(signupAllowed(1) === c.atOne, `${label}: with one user signup is ${c.atOne ? "allowed" : "refused"}`);
  assert(signupAllowed(250) === c.atOne, `${label}: with many users signup is ${c.atOne ? "allowed" : "refused"}`);
}

// Mistyped values behave exactly as if the setting were not there.
for (const wrong of ["TRUE", "True", "yes", "1", "on", " true", "true ", "FALSE", "no", "0", ""]) {
  for (const selfHosted of [undefined, "true"]) {
    set(selfHosted, wrong);
    const asUnset = (() => {
      set(selfHosted, undefined);
      return { mode: signupMode(), zero: signupAllowed(0), one: signupAllowed(1) };
    })();
    set(selfHosted, wrong);
    assert(
      signupMode() === asUnset.mode && signupAllowed(0) === asUnset.zero && signupAllowed(1) === asUnset.one,
      `ALLOW_SIGNUP=${JSON.stringify(wrong)} (SELF_HOSTED=${JSON.stringify(selfHosted)}) behaves exactly as if unset: ${asUnset.mode}`
    );
  }
}
set("TRUE", "true");
assert(signupMode() === "open", "ALLOW_SIGNUP=true opens signup even when SELF_HOSTED is mistyped (the two settings are independent)");
set("yes", undefined);
assert(signupMode() === "closed" && signupAllowed(0) === false, "A mistyped SELF_HOSTED never opens signup on the hosted site");
reset();

// ---------- the demo seed ----------
assert(seedAllowed({}) === false, "The demo seed refuses to run with no setting");
assert(seedAllowed({ ALLOW_DEMO_SEED: "false" }) === false, "The demo seed refuses when the setting is false");
assert(seedAllowed({ ALLOW_DEMO_SEED: "1" }) === false, "The demo seed refuses anything other than exactly true");
assert(seedAllowed({ ALLOW_DEMO_SEED: "true" }) === true, "The demo seed runs only with ALLOW_DEMO_SEED=true");
assert(/publicly known password/.test(SEED_REFUSAL) && /sign up and import/.test(SEED_REFUSAL), "The refusal explains why and what to do instead");

// ---------- the encryption key, checked before signup creates an account ----------
const savedKey = process.env.SECRET_ENCRYPTION_KEY;
delete process.env.SECRET_ENCRYPTION_KEY;
assert(encryptionKeyUsable() === false, "With no SECRET_ENCRYPTION_KEY signup is refused before any account is created");
process.env.SECRET_ENCRYPTION_KEY = "";
assert(encryptionKeyUsable() === false, "An empty SECRET_ENCRYPTION_KEY is not usable");
process.env.SECRET_ENCRYPTION_KEY = "not-a-real-key";
assert(encryptionKeyUsable() === false, "A key that is not 32 bytes is not usable");
process.env.SECRET_ENCRYPTION_KEY = randomBytes(31).toString("base64");
assert(encryptionKeyUsable() === false, "A 31-byte key is not usable");
process.env.SECRET_ENCRYPTION_KEY = randomBytes(33).toString("base64");
assert(encryptionKeyUsable() === false, "A 33-byte key is not usable");
process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
assert(encryptionKeyUsable() === true, "A proper 32-byte key is usable");
if (savedKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
else process.env.SECRET_ENCRYPTION_KEY = savedKey;

Object.assign(process.env, saved);
console.log("\nAll deployment-mode checks passed.");
