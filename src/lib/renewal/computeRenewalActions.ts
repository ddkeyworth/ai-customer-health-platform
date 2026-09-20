// Runs Renewal's agentic layer for every at-risk renewal within the next 90
// days - see computeHealthScores.ts for the equivalent Health pattern this
// mirrors. "At risk" matches the same condition src/app/briefing/page.tsx
// already uses: interrupted renewal type, or Health Watch/Critical. A
// healthy, on-track renewal never reaches the model.
import { prisma } from "@/lib/prisma";
import { computeBaselineChurnRates } from "./churnModel";
import { computeRenewalSavePlay } from "./agenticLayer";
import { upsertProposedAgentAction } from "@/lib/agentActions";

export async function computeRenewalActionsForWorkspace(workspaceId: string, apiKey: string): Promise<void> {
  const now = new Date();
  const rows = await prisma.customerProduct.findMany({
    where: {
      lifecycleStatus: "live",
      renewalDate: { not: null },
      customer: { workspaceId },
    },
    include: {
      customer: { include: { interactions: true, healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } },
    },
  });

  // Deliberately the exact same window /renewal itself counts (renewal date
  // at most 90 days out, with no lower bound): a live account whose renewal
  // date has already passed without being marked renewed or churned is the
  // most urgent case there is, not one to skip. An earlier version added a
  // "not in the past" condition here that the page doesn't have, so the
  // riskiest seeded account (Critical, interrupted, date already passed)
  // never got a save play at all.
  const next90 = rows.filter((r) => r.renewalDate && r.renewalDate.getTime() - now.getTime() <= 90 * 86_400_000);
  const atRisk = next90.filter((r) => {
    const tier = r.customer.healthSnapshots[0]?.tierLabel;
    return r.customer.renewalType === "interrupted" || tier === "Watch" || tier === "Critical";
  });

  console.log(`Renewal agentic layer: ${atRisk.length} at-risk renewal(s) in the next 90 days.`);
  const baselineRates = await computeBaselineChurnRates(workspaceId);

  for (const r of atRisk) {
    const snap = r.customer.healthSnapshots[0] ?? null;
    const tier = snap?.tierLabel ?? "Stable";
    const baseline = baselineRates[tier] ?? baselineRates.Stable;
    const daysToRenewal = Math.round((r.renewalDate!.getTime() - now.getTime()) / 86_400_000);

    const result = await computeRenewalSavePlay(
      r.customer.name,
      r.customer.renewalType,
      daysToRenewal,
      baseline.rate,
      baseline.source,
      tier,
      snap?.narrative ?? null,
      r.customer.interactions,
      apiKey
    );

    const adjustedLikelihood = Math.max(0, Math.min(1, baseline.rate + result.likelihoodAdjustmentPct / 100));
    const totalArr = Number(r.contractualArr) + Number(r.consumptionArr);

    await upsertProposedAgentAction({
      workspaceId,
      customerId: r.customerId,
      subjectId: r.id,
      area: "renewal",
      actionType: "save_play",
      headline: `${Math.round(adjustedLikelihood * 100)}% churn risk - ${
        daysToRenewal >= 0 ? `${daysToRenewal} days to renewal` : `renewal date passed ${-daysToRenewal} days ago`
      }`,
      reasoning: result.reasoning,
      suggestedNextStep: result.savePlay,
      impactArr: totalArr * adjustedLikelihood,
      confidenceLevel: result.confidenceLevel,
      metadata: {
        riskFactors: result.riskFactors,
        baselineLikelihood: baseline.rate,
        baselineSource: baseline.source,
        baselineSampleSize: baseline.sampleSize,
        adjustedLikelihood,
      },
    });
    console.log(`  ${r.customer.name}: baseline ${Math.round(baseline.rate * 100)}% (${baseline.source}), adjusted ${Math.round(adjustedLikelihood * 100)}%.`);
  }
}
