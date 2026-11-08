// Content Security Policy for every page, with a fresh random nonce per request
// (see src/proxy.ts, which generates the nonce and sets the header).
//
// What the nonce does: scripts only run if they carry this request's nonce (or
// were loaded by a script that did, via 'strict-dynamic'). Code an attacker
// manages to inject into a page has no nonce, so the browser refuses to run it.
//
// Styles: style-src keeps 'unsafe-inline' on purpose. Tailwind and React write
// inline style attributes (for example the run progress bar's width), and a
// nonce cannot cover style attributes. This does not weaken script safety;
// scripts are the dangerous part, and they are locked to the nonce.
//
// Development: React needs 'unsafe-eval' in development only (for readable
// error stacks). It is never allowed in production.
//
// Pure functions with no framework imports, so they are covered by
// prisma/test-csp.ts. Uses the Web Crypto API, which exists in both the Node.js
// and Edge runtimes.

// 128 bits of randomness, base64 encoded. Must be new for every request: a
// nonce that repeats can be learned and reused by an attacker.
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildCsp({ nonce, isProduction }: { nonce: string; isProduction: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
