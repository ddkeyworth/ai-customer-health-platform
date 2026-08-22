// Real, hand-rolled authentication - not a stateless JWT. Sessions are
// server-side rows in the database, so a compromised or logged-out session
// can actually be revoked, not just left to expire on its own. Chosen over
// a library (Auth.js/NextAuth) because its Prisma adapter expects its own
// schema shape, which would fight this app's already-custom User model
// (workspaceId, role, isAdmin, managerId) - see README.md.
//
// Security choices, stated explicitly rather than left implicit:
//   - Passwords: bcrypt, cost factor 12.
//   - Sessions: a long random token (the row's cuid id) as an httpOnly,
//     sameSite=lax, secure-in-production cookie. httpOnly blocks JS/XSS
//     from reading it; sameSite=lax blocks cross-site POST/PUT CSRF while
//     still allowing normal top-level navigation (a plain "strict" setting
//     breaks following a link into the app from elsewhere).
//   - Fixed 7-day expiry, no silent renewal - a session that's still being
//     used will simply need a fresh login weekly, rather than staying valid
//     indefinitely through activity alone.
//   - Every dashboard route requires a valid session, checked twice:
//     proxy.ts validates it against the database (real session, not expired)
//     before a protected page even starts rendering, and every page's own
//     getCurrentWorkspace() call validates it again - defense-in-depth for
//     any request path that reaches a page without going through the proxy.

import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/sessionCookie";
import { hashPassword, verifyPassword } from "@/lib/password";

export { SESSION_COOKIE, hashPassword, verifyPassword };
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSessionCookie(userId: string): Promise<void> {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: session.expiresAt,
    path: "/",
  });
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: token },
    include: { user: { include: { workspace: true } } },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

export async function destroySessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.delete({ where: { id: token } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
}
