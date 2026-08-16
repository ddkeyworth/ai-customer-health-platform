"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const ALLOWED_DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const ALLOWED_LANGUAGES = ["en-GB", "en-US"];

export async function updateWorkspace(formData: FormData) {
  const workspace = await getCurrentWorkspace();

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;

  const primaryRaw = String(formData.get("brandPrimaryColor") ?? "").trim();
  const accentRaw = String(formData.get("brandAccentColor") ?? "").trim();
  const brandPrimaryColor = HEX_COLOR.test(primaryRaw) ? primaryRaw : null;
  const brandAccentColor = HEX_COLOR.test(accentRaw) ? accentRaw : null;

  const currencyRaw = String(formData.get("currency") ?? "").trim().toUpperCase();
  const currency = CURRENCY_CODE.test(currencyRaw) ? currencyRaw : workspace.currency;

  const dateFormatRaw = String(formData.get("dateFormat") ?? "").trim();
  const dateFormat = ALLOWED_DATE_FORMATS.includes(dateFormatRaw) ? dateFormatRaw : workspace.dateFormat;

  const languageRaw = String(formData.get("language") ?? "").trim();
  const language = ALLOWED_LANGUAGES.includes(languageRaw) ? languageRaw : workspace.language;

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { name, brandPrimaryColor, brandAccentColor, currency, dateFormat, language },
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addCompetitor(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  const existing = await prisma.competitorConfig.count({ where: { workspaceId: workspace.id } });
  if (existing >= 20) return;

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;

  const riskWeightRaw = Number(formData.get("riskWeight"));
  const riskWeight = Number.isFinite(riskWeightRaw) ? Math.min(5, Math.max(1, Math.round(riskWeightRaw))) : 3;

  await prisma.competitorConfig.create({
    data: { workspaceId: workspace.id, name, riskWeight },
  });
  revalidatePath("/settings");
}

export async function deleteCompetitor(id: string) {
  const workspace = await getCurrentWorkspace();
  await prisma.competitorConfig.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}
