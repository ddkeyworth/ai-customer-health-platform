// Encrypts a workspace's own bring-your-own Anthropic key at rest (see
// Settings). Real, working encryption (AES-256-GCM, Node's built-in crypto,
// no extra dependency) - not a placeholder, because the thing being stored
// is a genuine, spendable third-party API credential, not a demo value.
// SECRET_ENCRYPTION_KEY is a 32-byte key, base64-encoded, unrelated to any
// user's own Anthropic key - see .env.example for how to generate one.
// No "server-only" guard: pure Node crypto, no Next.js dependency, and needs
// to be importable from plain scripts (prisma/test-workspace-secret.ts) the
// same way src/lib/password.ts already is.
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error("SECRET_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

// Stored as iv:authTag:ciphertext, each base64, colon-separated - self-contained,
// no need for a separate column per component.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
