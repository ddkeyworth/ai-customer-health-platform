// Runs Onboarding's agentic layer for every overdue account in a workspace
// and stores the result as an AgentAction - see computeHealthScores.ts for
// the equivalent Health pattern this mirrors. Only overdue accounts are
// considered; on-pace accounts never reach the model at all.
import { prisma } from "@/lib/prisma";
import { computeDaysOverdue } from "./pace";
import { computeOnboardingRecovery } from "./agenticLayer";
import { upsertProposedAgentAction } from "@/lib/agentActions";
import { listCustomFields } from "@/lib/customFields/store";
import { buildCustomFieldContext } from "@/lib/customFields/context";

async function selectOverdue(workspaceId: string, now: Date, onlyIds?: string[]) {
  const rows = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "onboarding", customer: { workspaceId }, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
    include: { customer: { include: { interactions: true } } },
  });
  return rows.filter((r) => r.expectedGoLiveDate && computeDaysOverdue(r.expectedGoLiveDate, now)! > 0);
}

// The ids this capability would review (see src/lib/capabilityBatches.ts).
export async function listOnboardingWorkIds(workspaceId: string): Promise<string[]> {
  return (await selectOverdue(workspaceId, new Date())).map((r) => r.id);
}

export async function computeOnboardingActionsForWorkspace(workspaceId: string, apiKey: string, onlyIds?: string[]): Promise<void> {
  const now = new Date();
  const overdue = await selectOverdue(workspaceId, now, onlyIds);
  console.log(`Onboarding agentic layer: ${overdue.length} overdue account(s) to review.`);

  // Loaded once per run; each customer's shareable values are built from it.
  const customFieldDefs = await listCustomFields(workspaceId);

  for (const r of overdue) {
    const daysOverdue = computeDaysOverdue(r.expectedGoLiveDate, now)!;
    const result = await computeOnboardingRecovery(
      r.customer.name,
      daysOverdue,
      r.expectedGoLiveDate!,
      r.customer.interactions,
      apiKey,
      buildCustomFieldContext(customFieldDefs, r.customer.customFields)
    );

    if (!result.hasEnoughEvidence) {
      console.log(`  ${r.customer.name}: declined - not enough evidence beyond "it's late".`);
      continue;
    }

    await upsertProposedAgentAction({
      workspaceId,
      customerId: r.customerId,
      subjectId: r.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: `${daysOverdue} days overdue - ${result.stalledReason?.replace("_", " ") ?? "unclear reason"}`,
      reasoning: result.reasoning,
      suggestedNextStep: result.recoveryStep,
      impactArr: r.contractualArr,
      confidenceLevel: result.confidenceLevel,
      metadata: { stalledReason: result.stalledReason, daysOverdue },
    });
    console.log(`  ${r.customer.name}: recovery plan recorded (${result.stalledReason}).`);
  }
}
