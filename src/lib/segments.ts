// Applies a Segment's saved criteria to the customer list. Criteria is a
// small flat object of optional keys - only the ones present are applied.
// The optional `custom` key holds filters on the workspace's own custom fields
// (see src/lib/customFields/segmentFilter.ts). It comes from stored JSON, so it
// is checked strictly: a deleted field or a malformed filter is ignored, never
// a crash, and customCriteriaReport() says what was ignored.
// This build only uses this within the Segments screen itself; re-scoping
// every other screen to the active segment is a bigger change, not made
// yet - see README.md.

import { prisma } from "@/lib/prisma";
import { listCustomFields, type CustomFieldDef } from "@/lib/customFields/store";
import { matchesCustomFilters, parseCustomFilters, type CustomFilter } from "@/lib/customFields/segmentFilter";

export interface SegmentCriteria {
  industry?: string;
  region?: string;
  tier?: string;
  renewalType?: string;
  healthBand?: string;
  custom?: unknown;
}

export interface CustomCriteriaReport {
  defs: CustomFieldDef[];
  filters: CustomFilter[];
  ignored: string[];
}

// The valid custom-field filters on a segment, the workspace's field
// definitions, and a plain note for each filter that was ignored.
export async function customCriteriaReport(workspaceId: string, criteria: SegmentCriteria): Promise<CustomCriteriaReport> {
  if (criteria.custom === undefined || criteria.custom === null) return { defs: [], filters: [], ignored: [] };
  const defs = await listCustomFields(workspaceId);
  const { filters, ignored } = parseCustomFilters(criteria.custom, defs);
  return { defs, filters, ignored };
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

  let result = customers;
  if (criteria.healthBand) result = result.filter((c) => c.healthSnapshots[0]?.tierLabel === criteria.healthBand);

  const { defs, filters } = await customCriteriaReport(workspaceId, criteria);
  if (filters.length > 0) result = result.filter((c) => matchesCustomFilters(filters, defs, c.customFields));
  return result;
}
