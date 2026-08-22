"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";

// A precomputed bcrypt hash of an arbitrary string, never a real password -
// used only so a login attempt against a nonexistent email still pays the
// same bcrypt cost as one against a real account. Without this, "!user ||
// !(await verifyPassword(...))" short-circuits and skips the bcrypt call
// entirely when the email doesn't exist, making that path measurably
// faster - a timing side-channel that lets an attacker enumerate valid
// emails by response time even though the error message itself is generic.
const DUMMY_HASH = "$2b$12$AOQeUyzbD0ZZuGLRteFrTeRe9vvh/5a1lZv86g.m0QclZogsNW66K";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  // Rate-limited by the submitted email, not IP (none reliably available in
  // this dev setup) - bounds brute-force guessing against any one account.
  if (!(await withinRateLimit(`login:${email}`, 10, 15 * 60_000))) {
    redirect("/login?error=rate_limited");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  // Deliberately the same error for "no such user" and "wrong password" -
  // distinguishing them lets an attacker enumerate valid emails.
  if (!user || !passwordValid) {
    redirect("/login?error=invalid");
  }

  await createSessionCookie(user.id);
  redirect("/");
}
