// Computes and stores a HealthScoreSnapshot for every Customer in a
// workspace. Deliberately NOT run live on every page load - see
// src/lib/health/agenticLayer.ts. Lives here (not in prisma/) so it can be
// imported by both the CLI script (prisma/compute-health-scores.ts) and
// src/lib/capabilityRuns.ts (Run Now / the daily cron) without the CLI
// script's own top-level main() executing as a side effect of the import.
//
// Requires the workspace's own Anthropic key (see Settings) - no fallback to
// a shared platform key. A workspace with nothing configured is skipped, not
// silently charged against someone else's key.
import { prisma } from "@/lib/prisma";
import { computeBaseline } from "./baseline";
import { computeAgenticLayer } from "./agenticLayer";
import { decryptSecret } from "@/lib/workspaceSecret";
import { baselineConfidence, baselineNarrative } from "./baselineNarrative";
import { listCustomFields } from "@/lib/customFields/store";

function tierLabelFor(score: number): string {
  if (score >= 85) return "Thriving";
  if (score >= 60) return "Stable";
  if (score >= 40) return "Watch";
  return "Critical";
}

// The ids this capability would score (see src/lib/capabilityBatches.ts).
export async function listHealthWorkIds(workspaceId: string): Promise<string[]> {
  const customers = await prisma.customer.findMany({ where: { workspaceId }, select: { id: true } });
  return customers.map((c) => c.id);
}

// onlyIds limits the run to those customers; used for resumable batches and
// for re-scoring a few accounts without paying for all of them.
export async function computeHealthScoresForWorkspace(workspaceId: string, onlyIds?: string[]): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  // With no key there is no AI layer, but the deterministic baseline is free
  // and complete, so Health still runs: baseline only, no adjustment.
  const apiKey = workspace.anthropicApiKeyEncrypted ? decryptSecret(workspace.anthropicApiKeyEncrypted) : null;

  const customers = await prisma.customer.findMany({
    where: { workspaceId, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
  });
  console.log(`Computing Health scores for "${workspace.name}" (${customers.length} customers)...`);

  // Loaded once per run; each customer's shareable values are built from it.
  const customFieldDefs = await listCustomFields(workspaceId);

  for (const customer of customers) {
    const { baselineScore, drivers } = await computeBaseline(customer.id);
    const agentic = apiKey
      ? await computeAgenticLayer(customer.id, baselineScore, drivers, apiKey, customFieldDefs)
      : {
          adjustmentDelta: 0,
          adjustmentReason: null,
          narrative: baselineNarrative(drivers, baselineScore),
          confidenceLevel: baselineConfidence(drivers),
        };
    const compositeScore = Math.max(0, Math.min(100, baselineScore + agentic.adjustmentDelta));

    await prisma.healthScoreSnapshot.create({
      data: {
        customerId: customer.id,
        baselineScore,
        adjustmentDelta: agentic.adjustmentDelta,
        adjustmentReason: agentic.adjustmentReason,
        compositeScore,
        tierLabel: tierLabelFor(compositeScore),
        confidenceLevel: agentic.confidenceLevel,
        driverValues: drivers as unknown as object,
        narrative: agentic.narrative,
      },
    });

    console.log(`  ${customer.name}: baseline ${baselineScore}, adjustment ${agentic.adjustmentDelta}, composite ${compositeScore}`);
  }
}
