// Assert-based regression check for the shared AgentAction upsert helper
// (src/lib/agentActions.ts) that every agentic layer beyond Health uses. A
// scheduled capability re-runs against the same still-open condition
// (daily/weekly) - this confirms that refreshes an existing "proposed" row
// in place rather than piling up duplicates, and that a reviewed
// (accepted/dismissed) row is left alone so a genuinely new one can be
// raised instead. Creates a real, throwaway workspace/customer; deletes
// everything it created.
import { PrismaClient } from "@prisma/client";
import { upsertProposedAgentAction } from "../src/lib/agentActions";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  const workspace = await prisma.workspace.create({ data: { name: "Test Agent Actions Workspace - safe to delete" } });
  const customer = await prisma.customer.create({
    data: { workspaceId: workspace.id, name: "Test Agent Actions Customer", tier: "enterprise" },
  });

  try {
    await upsertProposedAgentAction({
      workspaceId: workspace.id,
      customerId: customer.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: "First run headline",
      reasoning: "First run reasoning",
      confidenceLevel: "early_read",
    });

    const afterFirstRun = await prisma.agentAction.findMany({ where: { workspaceId: workspace.id } });
    assert(afterFirstRun.length === 1, "A single AgentAction is created on the first run");
    assert(afterFirstRun[0].status === "proposed", "A newly created AgentAction starts out proposed");

    await upsertProposedAgentAction({
      workspaceId: workspace.id,
      customerId: customer.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: "Second run headline",
      reasoning: "Second run reasoning",
      confidenceLevel: "established",
    });

    const afterSecondRun = await prisma.agentAction.findMany({ where: { workspaceId: workspace.id } });
    assert(afterSecondRun.length === 1, "A second run against the same still-open condition refreshes in place rather than creating a duplicate");
    assert(afterSecondRun[0].id === afterFirstRun[0].id, "The refreshed row keeps the same id, not a new one");
    assert(afterSecondRun[0].headline === "Second run headline", "The refreshed row's content actually updates");

    await prisma.agentAction.update({ where: { id: afterSecondRun[0].id }, data: { status: "dismissed" } });

    await upsertProposedAgentAction({
      workspaceId: workspace.id,
      customerId: customer.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: "Third run headline",
      reasoning: "Third run reasoning",
      confidenceLevel: "early_read",
    });

    const afterThirdRun = await prisma.agentAction.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } });
    assert(afterThirdRun.length === 2, "A run after the prior one was dismissed raises a genuinely new row rather than reviving the dismissed one");
    assert(afterThirdRun[0].status === "dismissed", "The originally dismissed row is left untouched, not silently reopened");
    assert(afterThirdRun[1].status === "proposed" && afterThirdRun[1].headline === "Third run headline", "The new row is proposed with the latest content");

    // A real bug caught by actually running this end to end (not by the
    // tests above alone): a customer with two live Products/Opportunities
    // needs two independent actions of the same area/actionType, not one
    // that silently overwrites the other - the same customer-vs-product
    // mistake already found once in Briefing (see TESTING.md).
    await upsertProposedAgentAction({
      workspaceId: workspace.id,
      customerId: customer.id,
      subjectId: "product-a",
      area: "renewal",
      actionType: "save_play",
      headline: "Product A save play",
      reasoning: "reasoning A",
      confidenceLevel: "early_read",
    });
    await upsertProposedAgentAction({
      workspaceId: workspace.id,
      customerId: customer.id,
      subjectId: "product-b",
      area: "renewal",
      actionType: "save_play",
      headline: "Product B save play",
      reasoning: "reasoning B",
      confidenceLevel: "early_read",
    });

    const renewalActions = await prisma.agentAction.findMany({ where: { workspaceId: workspace.id, area: "renewal" }, orderBy: { subjectId: "asc" } });
    assert(renewalActions.length === 2, "Two different subjectIds under the same customer/area/actionType create two independent rows, not one overwriting the other");
    assert(renewalActions[0].headline === "Product A save play" && renewalActions[1].headline === "Product B save play", "Each row keeps its own distinct content");
  } finally {
    await prisma.agentAction.deleteMany({ where: { workspaceId: workspace.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }

  console.log("\nAll agent-action checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
