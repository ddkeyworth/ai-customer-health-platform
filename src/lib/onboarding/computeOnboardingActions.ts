// Runs Onboarding's agentic layer for every overdue account in a workspace
// and stores the result as an AgentAction - see computeHealthScores.ts for
// the equivalent Health pattern this mirrors. Only overdue accounts are
// considered; on-pace accounts never reach the model at all.
import { prisma } from "@/lib/prisma";
import { computeDaysOverdue } from "./pace";
import { computeOnboardingRecovery } from "./agenticLayer";
import { upsertProposedAgentAction } from "@/lib/agentActions";

export async function computeOnboardingActionsForWorkspace(workspaceId: string, apiKey: string): Promise<void> {
  const now = new Date();
  const rows = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "onboarding", customer: { workspaceId } },
    include: { customer: { include: { interactions: true } } },
  });

  const overdue = rows.filter((r) => r.expectedGoLiveDate && computeDaysOverdue(r.expectedGoLiveDate, now)! > 0);
  console.log(`Onboarding agentic layer: ${overdue.length} overdue account(s) to review.`);

  for (const r of overdue) {
    const daysOverdue = computeDaysOverdue(r.expectedGoLiveDate, now)!;
    const result = await computeOnboardingRecovery(
      r.customer.name,
      daysOverdue,
      r.expectedGoLiveDate!,
      r.customer.interactions,
      apiKey
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
