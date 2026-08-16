"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateWorkspace(formData: FormData) {
  const workspace = await prisma.workspace.findFirstOrThrow();
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      name: String(formData.get("name") ?? workspace.name),
      brandPrimaryColor: String(formData.get("brandPrimaryColor") ?? "") || null,
      brandAccentColor: String(formData.get("brandAccentColor") ?? "") || null,
      currency: String(formData.get("currency") ?? workspace.currency),
      dateFormat: String(formData.get("dateFormat") ?? workspace.dateFormat),
      language: String(formData.get("language") ?? workspace.language),
    },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addCompetitor(formData: FormData) {
  const workspace = await prisma.workspace.findFirstOrThrow();
  const existing = await prisma.competitorConfig.count({ where: { workspaceId: workspace.id } });
  if (existing >= 20) {
    throw new Error("Maximum of 20 competitors reached.");
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.competitorConfig.create({
    data: {
      workspaceId: workspace.id,
      name,
      riskWeight: Number(formData.get("riskWeight") ?? 3),
    },
  });
  revalidatePath("/settings");
}

export async function deleteCompetitor(id: string) {
  await prisma.competitorConfig.delete({ where: { id } });
  revalidatePath("/settings");
}
