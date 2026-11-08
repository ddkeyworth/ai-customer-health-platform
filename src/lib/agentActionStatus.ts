// Plain, directly-testable workspace-scoped status update for AgentAction -
// extracted from src/lib/agentActionReview.ts's Server Actions so it's
// callable from a plain script (prisma/test-agent-action-review.ts) without
// a request context, the same reason src/lib/capabilityRuns.ts's
// setSchedule() isn't itself the Server Action. Scoped by workspaceId in
// the where clause, not just id - the actual IDOR guard: reviewing another
// workspace's AgentAction by guessing its id updates zero rows.
import { prisma } from "@/lib/prisma";

export async function setAgentActionStatus(
  workspaceId: string,
  id: string,
  status: "accepted" | "dismissed",
  reviewedBy: string | null
): Promise<number> {
  const result = await prisma.agentAction.updateMany({
    where: { id, workspaceId, status: "proposed" },
    data: { status, reviewedAt: new Date(), reviewedBy },
  });
  return result.count;
}

// Snooze presets, in days. A fixed allowlist, not a free number: the value
// arrives from a form field, so anything outside it is refused.
export const SNOOZE_DAYS = [7, 14, 30] as const;

// A snoozed recommendation stays "proposed" but is hidden until snoozeUntil
// passes. Spread into every query that lists proposed recommendations.
export function notSnoozed(now: Date = new Date()) {
  return { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: now } }] };
}

export async function snoozeAgentAction(
  workspaceId: string,
  id: string,
  days: number,
  now: Date = new Date()
): Promise<number> {
  if (!(SNOOZE_DAYS as readonly number[]).includes(days)) return 0;
  const result = await prisma.agentAction.updateMany({
    where: { id, workspaceId, status: "proposed" },
    data: { snoozeUntil: new Date(now.getTime() + days * 86_400_000) },
  });
  return result.count;
}
