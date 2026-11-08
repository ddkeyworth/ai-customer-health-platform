"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";
import { assignRecoveryKey } from "@/lib/passwordReset";
import { setRecoveryKeyCookie } from "@/lib/recoveryKeyCookie";
import { isSelfHosted, signupMode } from "@/lib/deployment";
import { encryptionKeyUsable } from "@/lib/secretReady";

// Signup is closed by default on the owner's hosted site (no workspace is ever
// created there unless ALLOW_SIGNUP=true), and on a self-hosted copy it is open
// only for the first account. See signupMode() in src/lib/deployment.ts. When it
// is explicitly opened on a hosted site, these caps still apply as a backstop:
// the database is free-tier, so it limits how many workspaces can exist and how
// many one visitor can create. A self-hosted copy has neither cap.
const HOSTED_MAX_WORKSPACES = 200;
const HOSTED_SIGNUPS_PER_IP_PER_DAY = 3;

class SignupClosedError extends Error {}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const workspaceName = String(formData.get("workspaceName") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Enforced here on the server, not just by hiding the form.
  const mode = signupMode();
  if (mode === "closed") redirect("/signup?error=signup_closed");
  if (mode === "first_account_only" && (await prisma.user.count()) > 0) redirect("/signup?error=signup_closed");
  if (!name || !workspaceName || !email || !password) redirect("/signup?error=missing");
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) redirect("/signup?error=invalid_email");
  // bcrypt only uses the first 72 bytes, and hashing a huge password costs real
  // CPU, so very long passwords are refused rather than silently truncated.
  if (password.length < 8 || password.length > 128) redirect("/signup?error=weak_password");
  // The new person's recovery key travels in an encrypted cookie. If the
  // encryption key is missing or unusable that step fails AFTER the account
  // exists and the key would never be shown, so check it now, before creating
  // anything.
  if (!encryptionKeyUsable()) redirect("/signup?error=server_misconfigured");

  if (!(await withinRateLimit(`signup:${email}`, 5, 60 * 60_000))) {
    redirect("/signup?error=rate_limited");
  }
  if (!isSelfHosted()) {
    if (!(await withinRateLimit(`signup-ip:${await clientIp()}`, HOSTED_SIGNUPS_PER_IP_PER_DAY, 24 * 60 * 60_000))) {
      redirect("/signup?error=rate_limited");
    }
    if ((await prisma.workspace.count()) >= HOSTED_MAX_WORKSPACES) redirect("/signup?error=site_full");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect("/signup?error=email_taken");

  const passwordHash = await hashPassword(password);

  // A real new tenant, not a new user in the shared demo workspace - this
  // is the whole point of the signup flow: two people signing up get two
  // genuinely isolated workspaces, exercising the workspaceId scoping
  // built earlier rather than leaving it untestable.
  //
  // The findUnique check above isn't atomic with this create - two
  // concurrent signups for the same email could both pass it. Wrapped in a
  // transaction (so a failed user create doesn't leave an orphaned empty
  // workspace behind) and the email's unique-constraint violation (P2002)
  // is caught explicitly, so a genuine race still fails gracefully with the
  // same "email taken" message rather than a raw 500 error.
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      if (mode === "first_account_only") {
        // Two first sign-ups at the same moment must not both succeed.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('signup-first-account'))`;
        if ((await tx.user.count()) > 0) throw new SignupClosedError();
      }
      const workspace = await tx.workspace.create({ data: { name: workspaceName } });
      return tx.user.create({
        data: {
          workspaceId: workspace.id,
          name,
          email,
          passwordHash,
          role: "head_vp_cs",
          isAdmin: true,
        },
      });
    });
  } catch (err) {
    if (err instanceof SignupClosedError) redirect("/signup?error=signup_closed");
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      redirect("/signup?error=email_taken");
    }
    throw err;
  }

  await createSessionCookie(user.id);
  // The new account's recovery key is shown once, on the next page.
  await setRecoveryKeyCookie(await assignRecoveryKey(user.id));
  redirect("/recovery-key");
}
