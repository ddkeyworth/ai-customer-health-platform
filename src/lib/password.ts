// Split out from auth.ts (no `server-only` guard here) so this can be
// imported from prisma/seed.ts too, which runs as a plain Node script
// outside Next.js's own bundling context.
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
