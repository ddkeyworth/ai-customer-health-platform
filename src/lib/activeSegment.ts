// Resolves the "?segment=" query param into a concrete customer-ID filter,
// shared by every area page so a saved Segment re-scopes the whole app, not
// just the Segments screen itself. Returns null customerIds when no segment
// is active - callers should skip the extra filter in that case.

import { prisma } from "@/lib/prisma";
import { customersMatchingCriteria, SegmentCriteria } from "@/lib/segments";

export interface ActiveSegment {
  id: string;
  name: string;
  customerIds: string[];
}

export async function resolveActiveSegment(
  workspaceId: string,
  segmentId: string | undefined
): Promise<ActiveSegment | null> {
  if (!segmentId) return null;

  const segment = await prisma.segment.findFirst({ where: { id: segmentId, workspaceId } });
  if (!segment) return null;

  const customers = await customersMatchingCriteria(workspaceId, segment.criteria as SegmentCriteria);
  return { id: segment.id, name: segment.name, customerIds: customers.map((c) => c.id) };
}
