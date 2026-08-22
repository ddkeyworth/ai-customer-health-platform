"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSessionCookie } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  // Rate-limited by the submitted email, not IP (none reliably available in
  // this dev setup) - bounds brute-force guessing against any one account.
  if (!withinRateLimit(`login:${email}`, 10, 15 * 60_000)) {
    redirect("/login?error=rate_limited");
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Deliberately the same error for "no such user" and "wrong password" -
  // distinguishing them lets an attacker enumerate valid emails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    redirect("/login?error=invalid");
  }

  await createSessionCookie(user.id);
  redirect("/");
}
