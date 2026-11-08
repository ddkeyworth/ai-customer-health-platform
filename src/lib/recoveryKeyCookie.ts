import "server-only";
import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "@/lib/workspaceSecret";

// A new recovery key is handed to the one-time /recovery-key page in a
// short-lived cookie: httpOnly (scripts cannot read it) and encrypted with the
// app's secret key, so the key is not sitting readable in the browser's cookie
// store. It lasts at most five minutes and is deleted when the person confirms
// they have saved it.
export const RECOVERY_COOKIE = "bearing_recovery_key";
const FIVE_MINUTES = 5 * 60;

export async function setRecoveryKeyCookie(key: string): Promise<void> {
  (await cookies()).set(RECOVERY_COOKIE, encryptSecret(key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_MINUTES,
  });
}

export async function readRecoveryKeyCookie(): Promise<string | null> {
  const value = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null; // tampered with or from an older secret key: treat as absent
  }
}

export async function clearRecoveryKeyCookie(): Promise<void> {
  (await cookies()).delete(RECOVERY_COOKIE);
}
