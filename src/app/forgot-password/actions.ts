"use server";

import { redirect } from "next/navigation";
import { allowResetAttempt, isPublicDemoEmail } from "@/lib/authLimits";
import { clientIp } from "@/lib/clientIp";
import { resetPasswordWithRecoveryKey, validPassword } from "@/lib/passwordReset";
import { setRecoveryKeyCookie } from "@/lib/recoveryKeyCookie";

// Reset a forgotten password with the recovery key. Every failure that could say
// something about an account ("no such email", "wrong key", "that account has
// no key") gets the same generic answer. Attempts are limited per email and per
// visitor address, so the key cannot be guessed by trying many.
export async function resetPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const key = String(formData.get("key") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!email || !key || !password) redirect("/forgot-password?error=missing");
  if (email.length > 254 || key.length > 64) redirect("/forgot-password?error=invalid");
  if (password !== confirm) redirect("/forgot-password?error=mismatch");
  if (!validPassword(password)) redirect("/forgot-password?error=weak");

  // Address first, then email and address together, then a higher per-email
  // ceiling (see src/lib/authLimits.ts). The public demo email is limited per
  // address only; resetting its password is refused anyway.
  const ip = await clientIp();
  if (!(await allowResetAttempt({ email, ip, isPublicDemo: () => isPublicDemoEmail(email) }))) {
    redirect("/forgot-password?error=rate_limited");
  }

  const result = await resetPasswordWithRecoveryKey(email, key, password);
  if (!result.ok) redirect("/forgot-password?error=invalid");

  // The new recovery key is shown once on the next page.
  await setRecoveryKeyCookie(result.recoveryKey);
  redirect("/recovery-key?from=reset");
}
