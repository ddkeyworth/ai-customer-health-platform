// Assert-based regression check for encrypting a workspace's own bring-your-own
// Anthropic key at rest - same rigor as test-auth.ts, warranted here because
// this stores a genuine, spendable third-party API credential, not demo data.
import { encryptSecret, decryptSecret } from "../src/lib/workspaceSecret";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const plaintext = "sk-ant-api03-this-is-a-fake-test-key-not-a-real-credential";
const encrypted = encryptSecret(plaintext);

assert(encrypted !== plaintext, "Encrypted form does not contain the plaintext key");
assert(!encrypted.includes(plaintext), "Encrypted form does not embed the plaintext as a substring");
assert(decryptSecret(encrypted) === plaintext, "Decrypting the stored value recovers the exact original key");

const secondEncryption = encryptSecret(plaintext);
assert(secondEncryption !== encrypted, "Encrypting the same key twice produces different ciphertext (random IV per call)");
assert(decryptSecret(secondEncryption) === plaintext, "The second encryption still decrypts correctly");

try {
  decryptSecret(encrypted.slice(0, -4) + "abcd");
  throw new Error("FAILED: tampering with the ciphertext should have thrown, not silently returned a value");
} catch (e) {
  if (e instanceof Error && e.message.startsWith("FAILED:")) throw e;
  console.log("OK: tampering with stored ciphertext is detected and rejected (GCM auth tag)");
}

console.log("\nAll workspace-secret checks passed.");
