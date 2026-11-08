import "server-only";
import { headers } from "next/headers";
import { parseClientAddress, parseTrustedProxyHops } from "@/lib/clientAddress";

// The visitor's address, for the sign-up, login and password-reset limits. The
// rules for which header to trust (and why) are in src/lib/clientAddress.ts.
// Set TRUSTED_PROXY_HOPS if you run your own proxy in front of the app.
export async function clientIp(): Promise<string> {
  const h = await headers();
  return parseClientAddress({
    onVercel: !!process.env.VERCEL,
    vercelForwardedFor: h.get("x-vercel-forwarded-for"),
    forwardedFor: h.get("x-forwarded-for"),
    realIp: h.get("x-real-ip"),
    trustedProxyHops: parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  });
}
