// The recovery key: an email-free way to get back into an account. It is shown
// to the person once, they keep it somewhere safe, and only a hash of it is
// stored, so nobody who sees the database (or a backup) can use it.
//
// 25 characters from a 32-character alphabet that leaves out the look-alikes
// (no 0, O, 1, I) is 125 bits of randomness, written in five groups of five so
// it is easy to read out or type: ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2.
//
// A high-entropy random key does not need a slow password hash, so SHA-256 is
// enough. Because the key cannot be guessed, an attacker who somehow had the
// hash still could not work backwards to it.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 characters, 5 bits each
const KEY_LENGTH = 25;
const GROUP = 5;

export const RECOVERY_KEY_PATTERN = /^[A-HJ-NP-Z2-9]{25}$/;

// 32 divides 256 exactly, so taking each random byte modulo 32 is uniform.
function randomKeyCharacters(): string {
  const bytes = randomBytes(KEY_LENGTH);
  let out = "";
  for (let i = 0; i < KEY_LENGTH; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

export function formatRecoveryKey(characters: string): string {
  const groups: string[] = [];
  for (let i = 0; i < characters.length; i += GROUP) groups.push(characters.slice(i, i + GROUP));
  return groups.join("-");
}

// A new key in its displayed form, for example ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2.
export function generateRecoveryKey(): string {
  return formatRecoveryKey(randomKeyCharacters());
}

// Turns whatever a person typed (any case, spaces or hyphens or neither) into the
// 25 plain characters, or null if it cannot be a recovery key.
export function normaliseRecoveryKey(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  return RECOVERY_KEY_PATTERN.test(cleaned) ? cleaned : null;
}

export function hashRecoveryKey(normalised: string): string {
  return createHash("sha256").update(normalised).digest("hex");
}

// Compares two hex hashes in constant time, so how long the comparison takes
// says nothing about how many leading characters matched.
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
