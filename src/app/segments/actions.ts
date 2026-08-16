"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function createSegment(formData: FormData) {
  const workspace = await prisma.workspace.findFirstOrThrow();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

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
  await prisma.segment.delete({ where: { id } });
  revalidatePath("/segments");
}
