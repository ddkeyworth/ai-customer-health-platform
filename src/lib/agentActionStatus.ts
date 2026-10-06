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
