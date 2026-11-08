"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";
import { isSpendLocked } from "@/lib/demoGuard";
import { changePassword, regenerateRecoveryKey } from "@/lib/passwordReset";
import { setRecoveryKeyCookie } from "@/lib/recoveryKeyCookie";
import { SESSION_COOKIE } from "@/lib/sessionCookie";
import { hashSessionToken } from "@/lib/sessionToken";

async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

// Change the password. Needs the current one. The session in use stays signed
// in; every other session for the account is ended.
export async function changeMyPassword(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (isSpendLocked(user.workspace)) redirect("/settings?security=locked");
  if (!(await withinRateLimit(`change-password:${user.id}`, 10, 60 * 60_000))) redirect("/settings?security=rate_limited");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!current || !next) redirect("/settings?security=missing");
  if (next !== confirm) redirect("/settings?security=mismatch");

  const result = await changePassword(user.id, current, next, await currentSessionId());
  redirect(`/settings?security=${result.ok ? "password_changed" : result.reason}`);
}

// Make a new recovery key (the first one for an older account, or a
// replacement). Needs the current password. The old key stops working. The new
// one is shown once, on /recovery-key.
export async function regenerateMyRecoveryKey(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (isSpendLocked(user.workspace)) redirect("/settings?security=locked");
  if (!(await withinRateLimit(`recovery-key:${user.id}`, 10, 60 * 60_000))) redirect("/settings?security=rate_limited");

  const current = String(formData.get("current") ?? "");
  if (!current) redirect("/settings?security=missing");

  const result = await regenerateRecoveryKey(user.id, current);
  if (!result.ok) redirect(`/settings?security=${result.reason}`);
  await setRecoveryKeyCookie(result.recoveryKey);
  redirect("/recovery-key");
}
