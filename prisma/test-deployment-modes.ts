// Assert-based check of the settings that separate the owner's hosted site from
// someone's own copy: SELF_HOSTED, ALLOW_SIGNUP and ALLOW_DEMO_SEED. Pure
// logic, no database. The seed itself is never run from a test, because a
// regression there would wipe a real database.
import { isSelfHosted, signupAllowed } from "../src/lib/deployment";
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

reset();
assert(isSelfHosted() === false, "With nothing set the deployment is the locked-down hosted site");
assert(signupAllowed() === true, "With nothing set signup is open");

process.env.SELF_HOSTED = "true";
assert(isSelfHosted() === true, "SELF_HOSTED=true makes it a self-hosted copy");
for (const wrong of ["TRUE", "1", "yes", " true", ""]) {
  process.env.SELF_HOSTED = wrong;
  assert(isSelfHosted() === false, `SELF_HOSTED=${JSON.stringify(wrong)} is not exactly "true", so the site stays locked down`);
}

reset();
process.env.ALLOW_SIGNUP = "false";
assert(signupAllowed() === false, "ALLOW_SIGNUP=false closes signup");
for (const other of ["true", "no", "0", "FALSE"]) {
  process.env.ALLOW_SIGNUP = other;
  assert(signupAllowed() === true, `ALLOW_SIGNUP=${JSON.stringify(other)} is not exactly "false", so signup stays open`);
}
reset();

assert(seedAllowed({}) === false, "The demo seed refuses to run with no setting");
assert(seedAllowed({ ALLOW_DEMO_SEED: "false" }) === false, "The demo seed refuses when the setting is false");
assert(seedAllowed({ ALLOW_DEMO_SEED: "1" }) === false, "The demo seed refuses anything other than exactly true");
assert(seedAllowed({ ALLOW_DEMO_SEED: "true" }) === true, "The demo seed runs only with ALLOW_DEMO_SEED=true");
assert(/publicly known password/.test(SEED_REFUSAL) && /sign up and import/.test(SEED_REFUSAL), "The refusal explains why and what to do instead");

Object.assign(process.env, saved);
console.log("\nAll deployment-mode checks passed.");
