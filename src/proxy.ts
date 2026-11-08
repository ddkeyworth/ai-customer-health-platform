import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/sessionCookie";
import { hashSessionToken } from "@/lib/sessionToken";
import { buildCsp, generateNonce } from "@/lib/csp";

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
const PUBLIC_PATHS = ["/login", "/signup", "/marketing", "/forgot-password", "/recovery-key"];

export async function proxy(request: NextRequest) {
  // A fresh nonce for every request. The policy goes on the REQUEST headers so
  // Next.js can read the nonce and put it on its own inline scripts while it
  // renders, and on the RESPONSE so the browser enforces it. Every return below
  // goes through next() or redirect() so no response, public page or redirect,
  // is ever sent without the policy. See src/lib/csp.ts.
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isProduction: process.env.NODE_ENV === "production" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return redirect("/login");
  }

  const session = await prisma.session.findUnique({ where: { id: hashSessionToken(token) } });
  if (!session || session.expiresAt < new Date()) {
    return redirect("/login");
  }

  return next();
}

// /api/* is excluded here - it's machine-callable, not browser-page traffic,
// and each route owns its own auth strategy (e.g. run-capabilities checks
// CRON_SECRET, since Vercel's cron invocation carries no session cookie at
// all to check). This was the exact gap flagged in the comment above before
// an API route actually existed to expose it.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
