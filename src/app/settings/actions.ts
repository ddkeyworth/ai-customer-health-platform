"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { withinRateLimit } from "@/lib/rateLimit";
import { EXPORT_FIELD_KEYS } from "@/lib/exportFields";
import { encryptSecret } from "@/lib/workspaceSecret";
import {
  HEX_COLOR,
  CURRENCY_CODE,
  ALLOWED_DATE_FORMATS,
  ALLOWED_LANGUAGES,
  ANTHROPIC_KEY_PATTERN,
  clampRiskWeight,
} from "@/lib/settingsValidation";

export async function updateWorkspace(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  if (!withinRateLimit(`updateWorkspace:${workspace.id}`, 10, 60_000)) return;

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
  if (!withinRateLimit(`addCompetitor:${workspace.id}`, 20, 60_000)) return;

  const existing = await prisma.competitorConfig.count({ where: { workspaceId: workspace.id } });
  if (existing >= 20) return;

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;

  const riskWeight = clampRiskWeight(Number(formData.get("riskWeight")));

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

export async function updateAnthropicApiKey(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  if (!withinRateLimit(`updateAnthropicApiKey:${workspace.id}`, 5, 60_000)) return;

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!ANTHROPIC_KEY_PATTERN.test(apiKey)) return;

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      anthropicApiKeyEncrypted: encryptSecret(apiKey),
      anthropicApiKeyLast4: apiKey.slice(-4),
    },
  });
  revalidatePath("/settings");
}

export async function clearAnthropicApiKey() {
  const workspace = await getCurrentWorkspace();
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { anthropicApiKeyEncrypted: null, anthropicApiKeyLast4: null },
  });
  revalidatePath("/settings");
}

export async function updateExportAllowlist(formData: FormData) {
  const workspace = await getCurrentWorkspace();
  if (!withinRateLimit(`updateExportAllowlist:${workspace.id}`, 10, 60_000)) return;

  const selected = formData.getAll("field").map(String).filter((key) => EXPORT_FIELD_KEYS.includes(key as (typeof EXPORT_FIELD_KEYS)[number]));

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { exportAllowlist: selected },
  });
  revalidatePath("/settings");
}
