// Renewal's churn-likelihood baseline - see docs/playbook-proposals.md #5
// decision 4. Previously a single flat lookup table (Critical 60%, Watch
// 30%, Stable 10%, Thriving 2%), applied uniformly regardless of what
// actually happened to any real account. This replaces that, per Health
// band, with the real observed churn rate from Calibration's own
// OutcomeEvent history - falling back to the illustrative table per band
// where there isn't yet enough recorded history to trust a real rate.
//
// Same honesty limitation already stated on /calibration: this build
// stores one current Health snapshot per customer, not a real historical
// series, so "the tier a churned account is in" means the tier on file now
// (or at last snapshot before it was marked churned), not necessarily the
// tier it actually held at the moment it churned. Treat this as a real but
// approximate signal, not a true point-in-time backtest.
import { prisma } from "@/lib/prisma";

export const MIN_SAMPLE_SIZE = 10;

export const ILLUSTRATIVE_CHURN_LIKELIHOOD: Record<string, number> = {
  Critical: 0.6,
  Watch: 0.3,
  Stable: 0.1,
  Thriving: 0.02,
};

export interface ChurnRateForTier {
  rate: number;
  source: "outcome_history" | "illustrative_fallback";
  sampleSize: number;
}

export async function computeBaselineChurnRates(workspaceId: string): Promise<Record<string, ChurnRateForTier>> {
  const events = await prisma.outcomeEvent.findMany({
    where: { customer: { workspaceId } },
    include: { customer: { include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } } },
  });

  const byTier = new Map<string, { total: number; churned: number }>();
  for (const e of events) {
    const tier = e.customer.healthSnapshots[0]?.tierLabel;
    if (!tier) continue;
    const cur = byTier.get(tier) ?? { total: 0, churned: 0 };
    cur.total++;
    if (e.type === "churned") cur.churned++;
    byTier.set(tier, cur);
  }

  const result: Record<string, ChurnRateForTier> = {};
  for (const tier of Object.keys(ILLUSTRATIVE_CHURN_LIKELIHOOD)) {
    const observed = byTier.get(tier);
    if (observed && observed.total >= MIN_SAMPLE_SIZE) {
      result[tier] = { rate: observed.churned / observed.total, source: "outcome_history", sampleSize: observed.total };
    } else {
      result[tier] = { rate: ILLUSTRATIVE_CHURN_LIKELIHOOD[tier], source: "illustrative_fallback", sampleSize: observed?.total ?? 0 };
    }
  }
  return result;
}
