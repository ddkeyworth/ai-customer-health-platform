// Assert-based regression check for Accept/Dismiss on AI recommendations
// (src/lib/agentActionStatus.ts) - confirms a review actually changes
// status/reviewedBy/reviewedAt, that an already-reviewed row can't be
// reviewed again, and the actual IDOR guard: reviewing another workspace's
// AgentAction by guessing its id updates nothing. Creates two real,
// throwaway workspaces; deletes everything it created.
import { PrismaClient } from "@prisma/client";
import { setAgentActionStatus } from "../src/lib/agentActionStatus";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  const workspaceA = await prisma.workspace.create({ data: { name: "Test Review Workspace A - safe to delete" } });
  const workspaceB = await prisma.workspace.create({ data: { name: "Test Review Workspace B - safe to delete" } });
  const customer = await prisma.customer.create({
    data: { workspaceId: workspaceA.id, name: "Test Review Customer", tier: "enterprise" },
  });
  const action = await prisma.agentAction.create({
    data: {
      workspaceId: workspaceA.id,
      customerId: customer.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: "Test headline",
      reasoning: "Test reasoning",
      confidenceLevel: "early_read",
    },
  });

  try {
    const crossWorkspaceCount = await setAgentActionStatus(workspaceB.id, action.id, "accepted", "Someone Else");
    assert(crossWorkspaceCount === 0, "Reviewing another workspace's AgentAction by guessing its id updates zero rows, not that workspace's data");

    const unchanged = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert(unchanged.status === "proposed", "The row is untouched after the cross-workspace attempt - it wasn't silently accepted");

    const dismissCount = await setAgentActionStatus(workspaceA.id, action.id, "dismissed", "Priya Chandra");
    assert(dismissCount === 1, "Dismissing from the owning workspace updates exactly one row");

    const dismissed = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert(dismissed.status === "dismissed", "Status is set to dismissed");
    assert(dismissed.reviewedBy === "Priya Chandra", "reviewedBy records who reviewed it");
    assert(dismissed.reviewedAt !== null, "reviewedAt is set");

    const secondReviewCount = await setAgentActionStatus(workspaceA.id, action.id, "accepted", "Someone Else");
    assert(secondReviewCount === 0, "A row that's no longer proposed can't be reviewed again - the where clause only matches status: proposed");

    const stillDismissed = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert(stillDismissed.status === "dismissed" && stillDismissed.reviewedBy === "Priya Chandra", "The original dismissal is untouched, not silently overwritten");
  } finally {
    await prisma.agentAction.delete({ where: { id: action.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.workspace.delete({ where: { id: workspaceA.id } });
    await prisma.workspace.delete({ where: { id: workspaceB.id } });
  }

  console.log("\nAll agent-action-review checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
