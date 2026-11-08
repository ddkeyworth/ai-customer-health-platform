// Assert-based check of the Content Security Policy builder and the places that
// use it. Pure: no database, no network, no browser. It cannot prove a page
// renders under the policy (that needs a browser: see the verification
// checklist), but it does lock in what the policy says and that nothing quietly
// goes back to a weaker one.
import fs from "node:fs";
import path from "node:path";
import { buildCsp, generateNonce } from "../src/lib/csp";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const directive = (policy: string, name: string) => policy.split("; ").find((d) => d === name || d.startsWith(`${name} `)) ?? "";

// ---------- the nonce ----------
const nonces = Array.from({ length: 500 }, () => generateNonce());
assert(new Set(nonces).size === 500, "500 generated nonces are all different (a nonce must never repeat between requests)");
assert(nonces.every((n) => /^[A-Za-z0-9+/]{22}==$/.test(n)), "A nonce is 16 random bytes (128 bits) in base64, which is valid inside a policy");
assert(nonces.every((n) => !/[\s;,'"]/.test(n)), "A nonce contains no space, semicolon, comma or quote that could break out of the header");

// ---------- the policy ----------
const nonce = generateNonce();
const prod = buildCsp({ nonce, isProduction: true });
const dev = buildCsp({ nonce, isProduction: false });

for (const name of ["default-src", "script-src", "style-src", "img-src", "font-src", "connect-src", "frame-ancestors", "base-uri", "form-action", "object-src"]) {
  assert(directive(prod, name) !== "", `The production policy sets ${name}`);
}
assert(directive(prod, "default-src") === "default-src 'self'", "Everything not listed defaults to this site only");
assert(directive(prod, "frame-ancestors") === "frame-ancestors 'none'", "No other site may show this one in a frame (clickjacking)");
assert(directive(prod, "object-src") === "object-src 'none'", "Plugins are blocked");
assert(directive(prod, "base-uri") === "base-uri 'self'", "The page's base address cannot be changed by injected markup");
assert(directive(prod, "form-action") === "form-action 'self'", "Forms can only post back to this site");
assert(directive(prod, "connect-src") === "connect-src 'self'", "The page can only make requests to this site");

const scriptSrc = directive(prod, "script-src");
assert(scriptSrc === `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, "Scripts need this request's nonce, and scripts they load are trusted ('strict-dynamic')");
assert(!/unsafe-inline/.test(scriptSrc), "script-src does NOT allow unsafe-inline, so injected inline code cannot run");
assert(!/unsafe-eval/.test(prod), "unsafe-eval is never allowed in production");
assert(/script-src[^;]*'unsafe-eval'/.test(dev), "unsafe-eval is allowed in development only (React needs it for readable error stacks)");
assert(!/unsafe-inline/.test(dev.split("; ").filter((d) => d.startsWith("script-src")).join()), "Development does not allow unsafe-inline scripts either");
assert(directive(prod, "style-src") === "style-src 'self' 'unsafe-inline'", "Styles allow inline (Tailwind and React write inline style attributes, which a nonce cannot cover)");
assert(prod.split(nonce).length === 2, "The nonce appears exactly once, in script-src only");
assert(!/https?:\/\/|\*/.test(prod), "No other site and no wildcard is allowed anywhere");
assert(!/upgrade-insecure-requests/.test(prod), "upgrade-insecure-requests is not set, so a production build still works over http://localhost for testing");
assert(buildCsp({ nonce: "a", isProduction: true }) !== buildCsp({ nonce: "b", isProduction: true }), "Different requests get different policies");
assert(!/[\r\n]/.test(prod) && !/[\r\n]/.test(dev), "The policy is a single header line");

// ---------- the places that use it (source checks) ----------
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const config = read("next.config.ts");
assert(!/Content-Security-Policy/i.test(config.replace(/\/\/.*$/gm, "")), "next.config.ts no longer sets a fixed Content-Security-Policy (a fixed one cannot carry a per-request nonce)");
assert(/Strict-Transport-Security/.test(config) && /max-age=63072000/.test(config) && /includeSubDomains/.test(config), "HSTS is set for two years including subdomains");
assert(!/preload/.test(config.replace(/\/\/.*$/gm, "")), "HSTS does not ask for the long-lived preload commitment");
for (const header of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
  assert(config.includes(header), `next.config.ts still sets ${header}`);
}
assert(/poweredByHeader:\s*false/.test(config), "The server still does not advertise what it runs on");

const proxy = read("src/proxy.ts");
const code = proxy.replace(/\/\/.*$/gm, "");
assert(/generateNonce\(\)/.test(code) && /buildCsp\(/.test(code), "The proxy creates a fresh nonce and builds the policy for each request");
assert(/requestHeaders\.set\("x-nonce"/.test(code) && /requestHeaders\.set\("Content-Security-Policy"/.test(code), "The policy and nonce are set on the request so Next.js can put the nonce on its own scripts");
assert(/NextResponse\.next\(\{ request: \{ headers: requestHeaders \} \}\)/.test(code), "Pages are rendered with those request headers");
assert(!/return NextResponse\./.test(code), "Every return goes through next() or redirect(), so no response can skip the policy (public pages and redirects included)");
assert(/response\.headers\.set\("Content-Security-Policy", csp\)/.test(code), "The policy is set on every response so the browser enforces it");
assert((code.match(/response\.headers\.set\("Content-Security-Policy", csp\)/g) ?? []).length === 2, "Both the next() and the redirect() responses carry it");

const marketing = read("src/app/marketing/page.tsx");
assert(/export const dynamic = "force-dynamic"/.test(marketing), "The marketing page is rendered per request, so it always gets a nonce");

console.log("\nAll Content Security Policy checks passed.");
