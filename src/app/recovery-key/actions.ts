"use server";

import { redirect } from "next/navigation";
import { clearRecoveryKeyCookie } from "@/lib/recoveryKeyCookie";

// The person confirms they have saved the key. The cookie that carried it is
// deleted here, so it cannot be shown again. After a reset they are not signed
// in (every session was ended), so they go to the login page.
export async function acknowledgeRecoveryKey(formData: FormData) {
  await clearRecoveryKeyCookie();
  redirect(String(formData.get("from") ?? "") === "reset" ? "/login?reset=1" : "/");
}
