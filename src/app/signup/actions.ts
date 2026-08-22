"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSessionCookie } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const workspaceName = String(formData.get("workspaceName") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !workspaceName || !email || !password) redirect("/signup?error=missing");
  if (!EMAIL_PATTERN.test(email)) redirect("/signup?error=invalid_email");
  if (password.length < 8) redirect("/signup?error=weak_password");

  if (!withinRateLimit(`signup:${email}`, 5, 60 * 60_000)) {
    redirect("/signup?error=rate_limited");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect("/signup?error=email_taken");

  const passwordHash = await hashPassword(password);

  // A real new tenant, not a new user in the shared demo workspace - this
  // is the whole point of the signup flow: two people signing up get two
  // genuinely isolated workspaces, exercising the workspaceId scoping
  // built earlier rather than leaving it untestable.
  const workspace = await prisma.workspace.create({
    data: { name: workspaceName },
  });
  const user = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      name,
      email,
      passwordHash,
      role: "head_vp_cs",
      isAdmin: true,
    },
  });

  await createSessionCookie(user.id);
  redirect("/");
}
