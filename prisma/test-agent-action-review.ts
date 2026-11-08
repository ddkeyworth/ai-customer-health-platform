// Assert-based regression check for Accept/Dismiss/Snooze on AI recommendations
// (src/lib/agentActionStatus.ts) - confirms a review actually changes
// status/reviewedBy/reviewedAt, that an already-reviewed row can't be
// reviewed again, and the actual IDOR guard: reviewing another workspace's
// AgentAction by guessing its id updates nothing. Creates two real,
// throwaway workspaces; deletes everything it created.
import { PrismaClient } from "@prisma/client";
import { setAgentActionStatus, snoozeAgentAction, notSnoozed, SNOOZE_DAYS } from "../src/lib/agentActionStatus";

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

  const snoozable = await prisma.agentAction.create({
    data: {
      workspaceId: workspaceA.id,
      customerId: customer.id,
      area: "adoption",
      actionType: "usage_nudge",
      headline: "Snooze headline",
      reasoning: "Snooze reasoning",
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

    // --- Snooze ---
    const visible = (at: Date) =>
      prisma.agentAction.findMany({ where: { workspaceId: workspaceA.id, status: "proposed", ...notSnoozed(at) } });
    const t0 = new Date();

    assert((await visible(t0)).some((a) => a.id === snoozable.id), "A fresh recommendation is visible before any snooze");

    assert((await snoozeAgentAction(workspaceB.id, snoozable.id, 7)) === 0, "Snoozing another workspace's recommendation by guessing its id updates zero rows");
    assert((await snoozeAgentAction(workspaceA.id, snoozable.id, 5)) === 0, "A snooze length outside the 7/14/30 allowlist is refused");
    assert((await snoozeAgentAction(workspaceA.id, snoozable.id, -7)) === 0, "A negative snooze length is refused");
    const stillClear = await prisma.agentAction.findUniqueOrThrow({ where: { id: snoozable.id } });
    assert(stillClear.snoozeUntil === null, "Refused snoozes leave snoozeUntil untouched");

    for (const days of SNOOZE_DAYS) {
      assert((await snoozeAgentAction(workspaceA.id, snoozable.id, days, t0)) === 1, `Snoozing for ${days} days updates exactly one row`);
      const row = await prisma.agentAction.findUniqueOrThrow({ where: { id: snoozable.id } });
      const diffDays = (row.snoozeUntil!.getTime() - t0.getTime()) / 86_400_000;
      assert(Math.abs(diffDays - days) < 1e-6, `snoozeUntil is exactly ${days} days after the snooze moment`);
    }

    // Last snooze above was 30 days.
    const day = (n: number) => new Date(t0.getTime() + n * 86_400_000);
    assert(!(await visible(day(29))).some((a) => a.id === snoozable.id), "A snoozed recommendation is hidden before its date");
    assert((await visible(day(31))).some((a) => a.id === snoozable.id), "It reappears by itself once the snooze date has passed");
    const afterwards = await prisma.agentAction.findUniqueOrThrow({ where: { id: snoozable.id } });
    assert(afterwards.status === "proposed", "A snoozed recommendation stays proposed, not accepted or dismissed");

    await setAgentActionStatus(workspaceA.id, snoozable.id, "dismissed", "Priya Chandra");
    assert((await snoozeAgentAction(workspaceA.id, snoozable.id, 7)) === 0, "A dismissed recommendation cannot be snoozed");
  } finally {
    await prisma.agentAction.delete({ where: { id: snoozable.id } });
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
