// Per-visit changes on the shared demo. Visitors to the public demo can click
// Accept, Dismiss and Snooze, but those clicks must never change the demo for
// anyone else. So on the locked demo the click is saved against the visitor's
// own session (the list of recommendations they have hidden) and the shared
// recommendation row is left exactly as it was. When the session ends (logout
// or expiry) the saved list goes with it, so the demo is back to normal for
// that visitor and nothing was ever wiped.
//
// Pure database functions, no cookies, so they can be tested without a request.
import { prisma } from "@/lib/prisma";

export const MAX_HIDDEN_PER_VISIT = 500;

export async function hiddenIdsForSession(sessionId: string): Promise<string[]> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { demoHiddenActionIds: true } });
  return session?.demoHiddenActionIds ?? [];
}

// Hide one recommendation for this visit only. Refuses an action that is not a
// proposed recommendation in this workspace, a session that does not exist, and
// a visit that has already hidden the maximum.
export async function hideActionForVisit(sessionId: string, workspaceId: string, actionId: string): Promise<boolean> {
  const action = await prisma.agentAction.findFirst({
    where: { id: actionId, workspaceId, status: "proposed" },
    select: { id: true },
  });
  if (!action) return false;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { demoHiddenActionIds: true } });
  if (!session) return false;
  if (session.demoHiddenActionIds.includes(actionId)) return true;
  if (session.demoHiddenActionIds.length >= MAX_HIDDEN_PER_VISIT) return false;
  await prisma.session.update({ where: { id: sessionId }, data: { demoHiddenActionIds: { push: actionId } } });
  return true;
}

// A where-clause fragment for the pages' recommendation queries.
export function visibleToVisit(hiddenIds: string[]) {
  return hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {};
}
