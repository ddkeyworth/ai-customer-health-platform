// Runs Adoption's agentic layer for every account below the workspace's
// configured underused-breadth threshold - see computeHealthScores.ts for
// the equivalent Health pattern this mirrors.
import { prisma } from "@/lib/prisma";
import { computeAdoptionNudge } from "./agenticLayer";
import { upsertProposedAgentAction } from "@/lib/agentActions";

async function selectCandidates(workspaceId: string, onlyIds?: string[]) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const threshold = workspace.adoptionUnderusedThresholdPct;

  const liveProducts = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "live", customer: { workspaceId }, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
    include: {
      customer: { include: { interactions: true } },
      product: { include: { capabilities: true } },
    },
  });
  const usage = await prisma.usageSnapshot.findMany({ where: { customer: { workspaceId } } });

  // Built once, so the work grows with the number of usage rows rather than
  // with customers times rows.
  const capsByCustomer = new Map<string, Set<string>>();
  for (const u of usage) {
    if (!capsByCustomer.has(u.customerId)) capsByCustomer.set(u.customerId, new Set());
    capsByCustomer.get(u.customerId)!.add(u.capabilityId);
  }

  const candidates = liveProducts
    .map((cp) => {
      const entitled = cp.product.capabilities;
      const entitledIds = new Set(entitled.map((c) => c.id));
      const usedIds = new Set([...(capsByCustomer.get(cp.customerId) ?? [])].filter((id) => entitledIds.has(id)));
      const breadthPct = entitled.length > 0 ? Math.round((usedIds.size / entitled.length) * 100) : 0;
      return { cp, entitled, usedIds, breadthPct };
    })
    .filter((c) => c.breadthPct < threshold);
  return { candidates, threshold };
}

// The ids this capability would review (see src/lib/capabilityBatches.ts).
export async function listAdoptionWorkIds(workspaceId: string): Promise<string[]> {
  return (await selectCandidates(workspaceId)).candidates.map((c) => c.cp.id);
}

export async function computeAdoptionActionsForWorkspace(workspaceId: string, apiKey: string, onlyIds?: string[]): Promise<void> {
  const { candidates, threshold } = await selectCandidates(workspaceId, onlyIds);

  console.log(`Adoption agentic layer: ${candidates.length} account(s) below ${threshold}% breadth.`);

  for (const c of candidates) {
    const entitledNames = c.entitled.map((cap) => cap.name);
    const usedNames = c.entitled.filter((cap) => c.usedIds.has(cap.id)).map((cap) => cap.name);

    const result = await computeAdoptionNudge(
      c.cp.customer.name,
      c.breadthPct,
      entitledNames,
      usedNames,
      c.cp.customer.interactions,
      apiKey
    );

    await upsertProposedAgentAction({
      workspaceId,
      customerId: c.cp.customerId,
      subjectId: c.cp.id,
      area: "adoption",
      actionType: "usage_nudge",
      headline: `${c.breadthPct}% breadth - ${result.nudgeType.replace("_", " ")}`,
      reasoning: result.reasoning,
      suggestedNextStep: result.underusedCapabilities.length > 0 ? `Nudge on: ${result.underusedCapabilities.join(", ")}` : null,
      impactArr: c.cp.consumptionArr,
      confidenceLevel: result.confidenceLevel,
      metadata: { breadthPct: c.breadthPct, underusedCapabilities: result.underusedCapabilities, nudgeType: result.nudgeType },
    });
    console.log(`  ${c.cp.customer.name}: ${result.nudgeType} recorded.`);
  }
}
