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

function tierLabelFor(score: number): string {
  if (score >= 85) return "Thriving";
  if (score >= 60) return "Stable";
  if (score >= 40) return "Watch";
  return "Critical";
}

export async function computeHealthScoresForWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!workspace.anthropicApiKeyEncrypted) {
    console.log(`Skipping "${workspace.name}" - no Anthropic API key configured in Settings.`);
    return;
  }
  const apiKey = decryptSecret(workspace.anthropicApiKeyEncrypted);

  const customers = await prisma.customer.findMany({ where: { workspaceId } });
  console.log(`Computing Health scores for "${workspace.name}" (${customers.length} customers)...`);

  for (const customer of customers) {
    const { baselineScore, drivers } = await computeBaseline(customer.id);
    const agentic = await computeAgenticLayer(customer.id, baselineScore, drivers, apiKey);
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
