import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/sessionCookie";
import { hashSessionToken } from "@/lib/sessionToken";
import { isSpendLocked } from "@/lib/demoGuard";
import { hiddenIdsForSession, hideActionForVisit } from "@/lib/demoVisit";

// The id of the current visitor's session row (the hash of their cookie).
async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

// The recommendations this visitor has hidden. Empty for any workspace other
// than the locked shared demo, where clicks change the real row instead.
export async function getHiddenActionIds(workspace: { isDemoSeed: boolean }): Promise<string[]> {
  if (!isSpendLocked(workspace)) return [];
  const id = await currentSessionId();
  return id ? hiddenIdsForSession(id) : [];
}

export async function hideCurrentVisitAction(workspaceId: string, actionId: string): Promise<boolean> {
  const id = await currentSessionId();
  return id ? hideActionForVisit(id, workspaceId, actionId) : false;
}
