import type { NextConfig } from "next";

// Security headers that are the same for every request, sent on every response.
// The Content-Security-Policy is NOT here: it needs a fresh nonce per request, so
// src/proxy.ts sets it (see src/lib/csp.ts). These cover the rest: the site being
// framed by another site (clickjacking), content-type sniffing, how much of the
// address is sent to other sites, browser features the app never uses, and
// forcing HTTPS on later visits. HSTS is ignored by browsers over plain http, so
// it does not affect local development; "preload" is deliberately left out, as it
// is a long-lived commitment that suits the domain owner to choose.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
