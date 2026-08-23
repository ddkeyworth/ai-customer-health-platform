import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/sessionCookie";

// Next.js 16 renamed "middleware" to "proxy" and made the Node.js runtime the
// default here (previously Edge-only) - which means this can now do the real,
// authoritative session check itself (query the Session table, verify
// expiry) rather than only a cheap cookie-presence check with the database
// validation deferred to each page's own getCurrentWorkspace() call. Both
// checks still exist: this one rejects an invalid/expired/forged session
// before a protected page even starts rendering; getCurrentWorkspace() is
// kept as defense-in-depth for any request path that reaches a page without
// going through this proxy (e.g. a future API route added without updating
// the matcher below).
const PUBLIC_PATHS = ["/login", "/signup", "/marketing"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await prisma.session.findUnique({ where: { id: token } });
  if (!session || session.expiresAt < new Date()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// /api/* is excluded here - it's machine-callable, not browser-page traffic,
// and each route owns its own auth strategy (e.g. run-capabilities checks
// CRON_SECRET, since Vercel's cron invocation carries no session cookie at
// all to check). This was the exact gap flagged in the comment above before
// an API route actually existed to expose it.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
