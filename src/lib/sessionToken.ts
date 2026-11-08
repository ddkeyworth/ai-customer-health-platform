// The session cookie holds a 256-bit random token from the operating
// system's secure random source. Only its SHA-256 hash is stored as the
// session row's id, so a database leak or backup does not hand out working
// logins, and the token cannot be guessed or predicted from other sessions
// (a database cuid is built from a timestamp and counter, so it is neither).
import { createHash, randomBytes } from "node:crypto";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
