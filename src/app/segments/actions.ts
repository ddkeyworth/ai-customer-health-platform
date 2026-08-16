"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export async function createSegment(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const existingCount = await prisma.segment.count({ where: { workspaceId: workspace.id } });
  if (existingCount >= 20) return;

  const criteria: Record<string, string> = {};
  for (const key of ["industry", "region", "tier", "renewalType", "healthBand"]) {
    const val = String(formData.get(key) ?? "").trim();
    if (val) criteria[key] = val;
  }

  await prisma.segment.create({
    data: { workspaceId: workspace.id, name, criteria },
  });
  revalidatePath("/segments");
}

export async function deleteSegment(id: string) {
  const workspace = await getCurrentWorkspace();
  await prisma.segment.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/segments");
}
