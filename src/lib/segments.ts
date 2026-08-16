// Applies a Segment's saved criteria to the customer list. Criteria is a
// small flat object of optional keys - only the ones present are applied.
// This build only uses this within the Segments screen itself; re-scoping
// every other screen to the active segment is a bigger change, not made
// yet - see README.md.

import { prisma } from "@/lib/prisma";

export interface SegmentCriteria {
  industry?: string;
  region?: string;
  tier?: string;
  renewalType?: string;
  healthBand?: string;
}

export async function customersMatchingCriteria(workspaceId: string, criteria: SegmentCriteria) {
  const customers = await prisma.customer.findMany({
    where: {
      workspaceId,
      ...(criteria.industry ? { industry: criteria.industry } : {}),
      ...(criteria.region ? { region: criteria.region } : {}),
      ...(criteria.tier ? { tier: criteria.tier } : {}),
      ...(criteria.renewalType ? { renewalType: criteria.renewalType } : {}),
    },
    include: {
      healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
    },
  });

  if (!criteria.healthBand) return customers;
  return customers.filter((c) => c.healthSnapshots[0]?.tierLabel === criteria.healthBand);
}
