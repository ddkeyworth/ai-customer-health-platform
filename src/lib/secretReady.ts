// Is SECRET_ENCRYPTION_KEY present and usable? Checked before signup creates
// an account, because the recovery key handed to a new person is carried in an
// encrypted cookie. Without a working key that step throws after the account
// already exists, and the person never sees their recovery key. No
// "server-only" guard: plain Node crypto, importable from tests.
import { decryptSecret, encryptSecret } from "@/lib/workspaceSecret";

export function encryptionKeyUsable(): boolean {
  try {
    return decryptSecret(encryptSecret("probe")) === "probe";
  } catch {
    return false;
  }
}
