"use server";

import type { Prisma } from "@prisma/client";
import { isSpendLocked } from "@/lib/demoGuard";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { withinRateLimit } from "@/lib/rateLimit";
import { listCustomFields } from "@/lib/customFields/store";
import { parseCustomFilters } from "@/lib/customFields/segmentFilter";
import { rawFiltersFromForm } from "@/lib/customFields/segmentForm";

export async function createSegment(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return;
  if (!(await withinRateLimit(`createSegment:${workspace.id}`, 20, 60_000))) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const existingCount = await prisma.segment.count({ where: { workspaceId: workspace.id } });
  if (existingCount >= 20) return;

  const criteria: Record<string, unknown> = {};
  for (const key of ["industry", "region", "tier", "renewalType", "healthBand"]) {
    const val = String(formData.get(key) ?? "").trim();
    if (val) criteria[key] = val;
  }

  // Filters on the workspace's own custom fields. Anything invalid is dropped
  // here, so only checked filters are ever saved.
  const defs = await listCustomFields(workspace.id);
  if (defs.length > 0) {
    const { filters } = parseCustomFilters(rawFiltersFromForm(defs, formData), defs);
    if (filters.length > 0) criteria.custom = filters;
  }

  await prisma.segment.create({
    data: { workspaceId: workspace.id, name, criteria: criteria as Prisma.InputJsonObject },
  });
  revalidatePath("/segments");
}

export async function deleteSegment(id: string) {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return;
  await prisma.segment.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/segments");
}
