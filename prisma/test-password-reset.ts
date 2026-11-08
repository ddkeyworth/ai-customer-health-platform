// Assert-based checks for the email-free password reset (recovery keys): the key
// itself, a successful reset, every way a reset can fail (all of which must
// answer the same and change nothing), accounts staying separate, changing a
// password, replacing a key, and the shared demo account being untouchable.
//
// Uses two throwaway workspaces and users and deletes them in a finally block.
// The only thing it does with the real demo account is try, and fail, to change
// it: it checks nothing was written.
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { deleteWorkspaceAndData } from "../src/lib/deleteWorkspace";
import { hashSessionToken, newSessionToken } from "../src/lib/sessionToken";
import {
  RECOVERY_KEY_PATTERN,
  generateRecoveryKey,
  hashRecoveryKey,
  hashesMatch,
  normaliseRecoveryKey,
} from "../src/lib/recoveryKey";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  assignRecoveryKey,
  changePassword,
  regenerateRecoveryKey,
  resetPasswordWithRecoveryKey,
  validPassword,
} from "../src/lib/passwordReset";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const FORMATTED = /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){4}$/;
const GENERIC_FAILURE = JSON.stringify({ ok: false });

(async () => {
  delete process.env.SELF_HOSTED; // the hosted, locked-down behaviour is what is being tested

  // ---------- the key ----------
  const keys = Array.from({ length: 500 }, () => generateRecoveryKey());
  assert(keys.every((k) => FORMATTED.test(k)), "A recovery key is five groups of five characters from an alphabet with no look-alikes (no 0, O, 1 or I)");
  assert(new Set(keys).size === 500, "500 generated keys are all different");
  assert(25 * Math.log2(32) >= 120, "A key carries at least 120 bits of randomness (25 characters from 32)");
  const counts = new Map<string, number>();
  for (const k of keys) for (const ch of k.replace(/-/g, "")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const expected = (500 * 25) / 32;
  assert(counts.size === 32 && [...counts.values()].every((n) => n > expected * 0.6 && n < expected * 1.4), "Every character of the alphabet is used about equally, so the key is unbiased");

  const sample = keys[0];
  const plain = sample.replace(/-/g, "");
  assert(normaliseRecoveryKey(sample) === plain, "Normalising a displayed key gives the 25 plain characters");
  assert(normaliseRecoveryKey(sample.toLowerCase()) === plain, "Normalising ignores case");
  assert(normaliseRecoveryKey(`  ${sample.replace(/-/g, " ")}  `) === plain, "Normalising accepts spaces instead of hyphens, and surrounding spaces");
  assert(normaliseRecoveryKey(plain) === plain, "Normalising accepts a key typed with no separators");
  for (const bad of ["", "garbage", plain.slice(1), plain + "A", plain.replace(plain[0], "0"), plain.replace(plain[0], "O"), plain.replace(plain[0], "I"), plain.replace(plain[0], "1")]) {
    assert(normaliseRecoveryKey(bad) === null, `A malformed key (${JSON.stringify(bad.slice(0, 12))}...) is rejected before any lookup`);
  }
  assert(RECOVERY_KEY_PATTERN.test(plain), "The plain form matches the published pattern");

  const hash = hashRecoveryKey(plain);
  assert(/^[0-9a-f]{64}$/.test(hash) && hash !== plain && hash !== sample, "The stored value is a 64-character hash, never the key");
  assert(hashRecoveryKey(plain) === hash && hashRecoveryKey(normaliseRecoveryKey(keys[1])!) !== hash, "Hashing is repeatable for one key and different for another");
  assert(hashesMatch(hash, hash) && !hashesMatch(hash, hashRecoveryKey("OTHER")) && !hashesMatch(hash, "") && !hashesMatch("", ""), "The constant-time comparison matches equal hashes only, and never an empty one");

  assert(validPassword("x".repeat(PASSWORD_MIN)) && validPassword("x".repeat(PASSWORD_MAX)), "Passwords of 8 and 128 characters are allowed");
  assert(!validPassword("") && !validPassword("x".repeat(PASSWORD_MIN - 1)) && !validPassword("x".repeat(PASSWORD_MAX + 1)), "Empty, 7-character and 129-character passwords are refused");

  // ---------- database checks ----------
  const stamp = Date.now();
  const wsA = await prisma.workspace.create({ data: { name: `Test Reset A ${stamp} - safe to delete` } });
  const wsB = await prisma.workspace.create({ data: { name: `Test Reset B ${stamp} - safe to delete` } });
  const emailA = `reset-a-${stamp}@example.test`;
  const emailB = `reset-b-${stamp}@example.test`;
  const OLD_PW = "old-password-123";
  const mkUser = async (workspaceId: string, email: string) =>
    prisma.user.create({ data: { workspaceId, name: "T", email, passwordHash: await hashPassword(OLD_PW), role: "csm" } });
  const mkSession = async (userId: string) => {
    const s = await prisma.session.create({ data: { id: hashSessionToken(newSessionToken()), userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    return s.id;
  };
  const sessionsOf = (userId: string) => prisma.session.count({ where: { userId } });
  const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  const demoUser = await prisma.user.findUniqueOrThrow({ where: { email: "priya.chandra@meridian-ops.example" } });
  const demoBefore = { hash: demoUser.passwordHash, key: demoUser.recoveryKeyHash, at: demoUser.recoveryKeyCreatedAt };
  const demoSessionsBefore = await sessionsOf(demoUser.id);

  try {
    const a = await mkUser(wsA.id, emailA);
    const b = await mkUser(wsB.id, emailB);
    assert((await row(a.id)).recoveryKeyHash === null, "A new account has no recovery key until one is issued");

    // issuing
    const k1 = await assignRecoveryKey(a.id);
    const afterAssign = await row(a.id);
    assert(FORMATTED.test(k1), "Issuing returns a key in the displayed format");
    assert(afterAssign.recoveryKeyHash === hashRecoveryKey(normaliseRecoveryKey(k1)!), "Only the hash of the key is stored");
    assert(afterAssign.recoveryKeyHash !== k1 && !JSON.stringify(afterAssign).includes(k1.replace(/-/g, "")), "The key itself appears nowhere in the stored account row");
    assert(afterAssign.recoveryKeyCreatedAt !== null, "The date the key was issued is recorded");
    const k1b = await assignRecoveryKey(a.id);
    assert(k1b !== k1 && (await row(a.id)).recoveryKeyHash !== afterAssign.recoveryKeyHash, "Issuing again replaces the key");
    assert((await resetPasswordWithRecoveryKey(emailA, k1, "brand-new-pass-1")).ok === false, "The replaced key no longer works");
    const K = await assignRecoveryKey(a.id); // the key used for the rest of the tests

    // failures: generic and harmless
    await mkSession(a.id);
    await mkSession(a.id);
    const aBefore = await row(a.id);
    const failures: [string, () => ReturnType<typeof resetPasswordWithRecoveryKey>][] = [
      ["a wrong key", () => resetPasswordWithRecoveryKey(emailA, generateRecoveryKey(), "brand-new-pass-1")],
      ["a key with one character changed", () => resetPasswordWithRecoveryKey(emailA, K.slice(0, -1) + (K.endsWith("A") ? "B" : "A"), "brand-new-pass-1")],
      ["an unknown email", () => resetPasswordWithRecoveryKey(`nobody-${stamp}@example.test`, K, "brand-new-pass-1")],
      ["someone else's email with this key", () => resetPasswordWithRecoveryKey(emailB, K, "brand-new-pass-1")],
      ["an account that has no key", () => resetPasswordWithRecoveryKey(emailB, generateRecoveryKey(), "brand-new-pass-1")],
      ["an empty key", () => resetPasswordWithRecoveryKey(emailA, "", "brand-new-pass-1")],
      ["garbage instead of a key", () => resetPasswordWithRecoveryKey(emailA, "not a key at all", "brand-new-pass-1")],
      ["an empty new password", () => resetPasswordWithRecoveryKey(emailA, K, "")],
      ["a 7-character new password", () => resetPasswordWithRecoveryKey(emailA, K, "x".repeat(7))],
      ["a 129-character new password", () => resetPasswordWithRecoveryKey(emailA, K, "x".repeat(129))],
    ];
    for (const [label, attempt] of failures) {
      const started = Date.now();
      const result = await attempt();
      const took = Date.now() - started;
      assert(JSON.stringify(result) === GENERIC_FAILURE, `Reset with ${label} gives only the generic failure, with no reason`);
      if (!/password/.test(label)) assert(took >= 50, `...and it still did the slow password work (${took} ms), so it cannot be told apart from a real attempt by timing`);
    }
    const aAfterFailures = await row(a.id);
    assert(aAfterFailures.passwordHash === aBefore.passwordHash && aAfterFailures.recoveryKeyHash === aBefore.recoveryKeyHash, "None of those failures changed the password or the key");
    assert((await sessionsOf(a.id)) === 2, "None of those failures signed anyone out");
    assert((await row(b.id)).recoveryKeyHash === null, "Failed attempts never gave an account without a key one");
    assert(await verifyPassword(OLD_PW, aAfterFailures.passwordHash), "The old password still works after all the failed attempts");

    // success
    await mkSession(b.id);
    await mkSession(b.id);
    const bBefore = await row(b.id);
    const messy = ` ${K.toLowerCase().replace(/-/g, " ")} `;
    const ok1 = await resetPasswordWithRecoveryKey(emailA.toUpperCase(), messy, "first-new-password-1");
    assert(ok1.ok === true, "A reset works with the key typed in lower case with spaces, and the email in capitals");
    if (!ok1.ok) throw new Error("unreachable");
    const afterReset = await row(a.id);
    assert(FORMATTED.test(ok1.recoveryKey) && ok1.recoveryKey !== K, "A successful reset issues a brand-new recovery key");
    assert(afterReset.recoveryKeyHash === hashRecoveryKey(normaliseRecoveryKey(ok1.recoveryKey)!), "Only the hash of the new key is stored");
    assert(await verifyPassword("first-new-password-1", afterReset.passwordHash), "The new password works");
    assert(!(await verifyPassword(OLD_PW, afterReset.passwordHash)), "The old password no longer works");
    assert((await sessionsOf(a.id)) === 0, "Every session for the account was ended, so anyone holding the old password is signed out");
    assert(JSON.stringify(await resetPasswordWithRecoveryKey(emailA, K, "second-new-password-1")) === GENERIC_FAILURE, "The used key is dead: using it again fails");
    assert(await verifyPassword("first-new-password-1", (await row(a.id)).passwordHash), "...and that failed reuse changed nothing");

    // accounts stay separate
    const bAfter = await row(b.id);
    assert(bAfter.passwordHash === bBefore.passwordHash && bAfter.recoveryKeyHash === bBefore.recoveryKeyHash, "Resetting one account never changes another account's password or key");
    assert((await sessionsOf(b.id)) === 2, "...or signs the other account out");

    // the new key works once, and two at the same moment cannot both win
    const K2 = ok1.recoveryKey;
    const [r1, r2] = await Promise.all([
      resetPasswordWithRecoveryKey(emailA, K2, "race-password-one-1"),
      resetPasswordWithRecoveryKey(emailA, K2, "race-password-two-1"),
    ]);
    assert([r1, r2].filter((r) => r.ok).length === 1, "Two resets using the same key at the same moment: exactly one succeeds");
    const winner = r1.ok ? r1 : r2;
    if (!winner.ok) throw new Error("unreachable");
    const finalHash = (await row(a.id)).passwordHash;
    assert((await verifyPassword("race-password-one-1", finalHash)) !== (await verifyPassword("race-password-two-1", finalHash)), "...and the account ends up with exactly one of the two passwords");

    // changing the password while signed in
    const keyBefore = (await row(a.id)).recoveryKeyHash;
    const keep = await mkSession(a.id);
    const other1 = await mkSession(a.id);
    const other2 = await mkSession(a.id);
    const currentPw = (await verifyPassword("race-password-one-1", finalHash)) ? "race-password-one-1" : "race-password-two-1";
    let c = await changePassword(a.id, "not-the-current-password", "changed-password-1", keep);
    assert(c.ok === false && c.reason === "current", "Changing the password with the wrong current password is refused");
    c = await changePassword(a.id, currentPw, "short", keep);
    assert(c.ok === false && c.reason === "weak", "A 5-character new password is refused");
    c = await changePassword(a.id, currentPw, "x".repeat(129), keep);
    assert(c.ok === false && c.reason === "weak", "A 129-character new password is refused");
    c = await changePassword("no-such-user", currentPw, "changed-password-1", keep);
    assert(c.ok === false && c.reason === "invalid", "An unknown account is refused");
    assert((await row(a.id)).passwordHash === finalHash && (await sessionsOf(a.id)) === 3, "Those refusals changed nothing and signed nobody out");
    c = await changePassword(a.id, currentPw, "changed-password-1", keep);
    const changed = await row(a.id);
    assert(c.ok === true && (await verifyPassword("changed-password-1", changed.passwordHash)) && !(await verifyPassword(currentPw, changed.passwordHash)), "Changing the password with the right current one works, and the old one stops working");
    const remaining = (await prisma.session.findMany({ where: { userId: a.id }, select: { id: true } })).map((s) => s.id);
    assert(remaining.length === 1 && remaining[0] === keep && !remaining.includes(other1) && !remaining.includes(other2), "The session in use stays signed in and every other session is ended");
    assert(changed.recoveryKeyHash === keyBefore, "Changing the password does not touch the recovery key");

    // regenerating the key
    const keyHeld = await assignRecoveryKey(a.id);
    let g = await regenerateRecoveryKey(a.id, "wrong-password-here");
    assert(g.ok === false && g.reason === "current" && (await row(a.id)).recoveryKeyHash === hashRecoveryKey(normaliseRecoveryKey(keyHeld)!), "Making a new key with the wrong password is refused and keeps the old key");
    g = await regenerateRecoveryKey("no-such-user", "x");
    assert(g.ok === false && g.reason === "invalid", "Making a key for an unknown account is refused");
    g = await regenerateRecoveryKey(a.id, "changed-password-1");
    assert(g.ok === true && g.recoveryKey !== keyHeld && FORMATTED.test(g.recoveryKey), "Making a new key with the right password gives a different key");
    if (!g.ok) throw new Error("unreachable");
    assert(JSON.stringify(await resetPasswordWithRecoveryKey(emailA, keyHeld, "after-regenerate-1")) === GENERIC_FAILURE, "The replaced key stops working");
    const viaNew = await resetPasswordWithRecoveryKey(emailA, g.recoveryKey, "after-regenerate-1");
    assert(viaNew.ok === true, "The new key works");

    // an older account with no key can make its first one
    assert((await row(b.id)).recoveryKeyHash === null, "The other test account still has no key");
    const first = await regenerateRecoveryKey(b.id, OLD_PW);
    assert(first.ok === true && (await row(b.id)).recoveryKeyHash !== null, "An existing account with no key can make its first one with its password");

    // the shared demo account cannot be changed
    const dChange = await changePassword(demoUser.id, "demo-password-123", "somebody-elses-new-pw-1", null);
    const dKey = await regenerateRecoveryKey(demoUser.id, "demo-password-123");
    const dReset = await resetPasswordWithRecoveryKey(demoUser.email, generateRecoveryKey(), "somebody-elses-new-pw-1");
    const demoAfter = await row(demoUser.id);
    assert(dChange.ok === false && dChange.reason === "locked", "Changing the shared demo account's password is refused as locked, even with its correct password");
    assert(dKey.ok === false && dKey.reason === "locked", "Making a recovery key for the shared demo account is refused as locked");
    assert(JSON.stringify(dReset) === GENERIC_FAILURE, "A reset of the shared demo account fails the same generic way");
    assert(demoAfter.passwordHash === demoBefore.hash && demoAfter.recoveryKeyHash === demoBefore.key && String(demoAfter.recoveryKeyCreatedAt) === String(demoBefore.at), "Nothing about the demo account changed: same password hash, same (empty) key");
    assert(await verifyPassword("demo-password-123", demoAfter.passwordHash), "The public demo password still works");
    assert((await sessionsOf(demoUser.id)) >= demoSessionsBefore, "No demo sessions were ended");
  } finally {
    for (const id of [wsA.id, wsB.id]) await deleteWorkspaceAndData(id).catch((e) => console.error("cleanup", e));
  }

  console.log("\nAll password-reset checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
