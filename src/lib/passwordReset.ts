// Password reset without email. Plain database logic with no cookies or
// requests, so every rule here can be tested directly.
//
//  - resetPasswordWithRecoveryKey: for someone who forgot their password. Needs
//    their email and their recovery key. Answers only "worked" or "did not",
//    never why, and spends the same time either way, so it cannot be used to
//    find out which emails have accounts or which have a key.
//  - changePassword: for a signed-in person, needs their current password.
//  - regenerateRecoveryKey: for a signed-in person, needs their current password.
//  - assignRecoveryKey: used at signup, when the person has just chosen their
//    password.
//
// The shared demo account on the owner's hosted site is locked out of all of it
// (see demoGuard.ts): a visitor must never be able to change the public demo
// password or recovery key. Every function checks that itself, before writing.
//
// A recovery key is only ever returned once, in the result of the call that
// created it. Only its hash is stored.
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isSpendLocked } from "@/lib/demoGuard";
import { generateRecoveryKey, hashRecoveryKey, hashesMatch, normaliseRecoveryKey } from "@/lib/recoveryKey";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function validPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}

function newKeyWithHash(): { key: string; hash: string } {
  const key = generateRecoveryKey();
  return { key, hash: hashRecoveryKey(normaliseRecoveryKey(key)!) };
}

export type ResetResult = { ok: true; recoveryKey: string } | { ok: false };

// Never says which part was wrong. On success: the new password is set, EVERY
// session for that account is deleted (so anyone who had the old password is
// logged out), and a new recovery key is issued and returned. The old key stops
// working at once. If two requests use the same key at the same moment, only
// one of them can win.
export async function resetPasswordWithRecoveryKey(email: string, rawKey: string, newPassword: string): Promise<ResetResult> {
  if (!validPassword(newPassword)) return { ok: false };

  // The slow part (bcrypt) always happens, whether or not the account exists,
  // so a failure takes as long as a success.
  const newHash = await hashPassword(newPassword);

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { workspace: { select: { isDemoSeed: true } } },
  });
  const normalised = normaliseRecoveryKey(rawKey);
  const candidate = hashRecoveryKey(normalised ?? "INVALID");
  const stored = user?.recoveryKeyHash ?? hashRecoveryKey("NO-KEY-ISSUED");
  const keyMatches = hashesMatch(candidate, stored);
  if (!user || !user.recoveryKeyHash || !normalised || !keyMatches) return { ok: false };
  if (isSpendLocked(user.workspace)) return { ok: false };

  const fresh = newKeyWithHash();
  const swapped = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      // Only if the key is still the one just checked: a second use of the same
      // key, or a reset that finished first, leaves nothing to update.
      where: { id: user.id, recoveryKeyHash: user.recoveryKeyHash },
      data: { passwordHash: newHash, recoveryKeyHash: fresh.hash, recoveryKeyCreatedAt: new Date() },
    });
    if (updated.count !== 1) return false;
    await tx.session.deleteMany({ where: { userId: user.id } });
    return true;
  });
  return swapped ? { ok: true, recoveryKey: fresh.key } : { ok: false };
}

export type ChangeResult = { ok: true } | { ok: false; reason: "locked" | "current" | "weak" | "invalid" };

// For a signed-in person. keepSessionId is the session they are using right now:
// it stays signed in, and every OTHER session for the account is deleted (a
// changed password should log out other devices). The recovery key is not touched.
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string | null
): Promise<ChangeResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { workspace: { select: { isDemoSeed: true } } } });
  if (!user) return { ok: false, reason: "invalid" };
  if (isSpendLocked(user.workspace)) return { ok: false, reason: "locked" };
  if (!validPassword(newPassword)) return { ok: false, reason: "weak" };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return { ok: false, reason: "current" };

  const newHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    prisma.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } }),
  ]);
  return { ok: true };
}

export type KeyResult = { ok: true; recoveryKey: string } | { ok: false; reason: "locked" | "current" | "invalid" };

// For a signed-in person: makes a new recovery key and kills the old one. Needs
// the current password, so someone at an unlocked screen cannot take it over.
export async function regenerateRecoveryKey(userId: string, currentPassword: string): Promise<KeyResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { workspace: { select: { isDemoSeed: true } } } });
  if (!user) return { ok: false, reason: "invalid" };
  if (isSpendLocked(user.workspace)) return { ok: false, reason: "locked" };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return { ok: false, reason: "current" };
  return { ok: true, recoveryKey: await assignRecoveryKey(userId) };
}

// Issues a key with no password check. Only for flows that have already proved
// who the person is: signup, and the reset above.
export async function assignRecoveryKey(userId: string): Promise<string> {
  const fresh = newKeyWithHash();
  await prisma.user.update({ where: { id: userId }, data: { recoveryKeyHash: fresh.hash, recoveryKeyCreatedAt: new Date() } });
  return fresh.key;
}
