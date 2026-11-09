// Storage for a workspace's custom fields (see src/lib/import/customFields.ts for
// the types and the value checks). A definition lives in the CustomField table;
// each customer's values live in Customer.customFields, keyed by the definition's
// id. Customer-level only. Everything here is scoped to the workspace id passed
// in, and the definitions are capped per workspace.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPES, type CustomFieldType } from "@/lib/import/customFields";

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  shareWithAi: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;

function toDef(row: { id: string; label: string; type: string; options: unknown; shareWithAi: boolean }): CustomFieldDef {
  return {
    id: row.id,
    label: row.label,
    type: row.type as CustomFieldType,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    shareWithAi: row.shareWithAi,
  };
}

export async function listCustomFields(workspaceId: string, db: Db = prisma): Promise<CustomFieldDef[]> {
  const rows = await db.customField.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return rows.map(toDef);
}

// A plain-English problem with a proposed label, or null if it is fine. Labels
// are compared case-insensitively and with spaces collapsed.
export function labelProblem(label: string, existingLabels: string[]): string | null {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean === "") return "A custom field needs a name.";
  if (clean.length > CUSTOM_FIELD_LIMITS.maxLabel) return `A custom field name must be ${CUSTOM_FIELD_LIMITS.maxLabel} characters or fewer.`;
  if (existingLabels.some((l) => l.replace(/\s+/g, " ").trim().toLowerCase() === clean.toLowerCase())) {
    return `There is already a custom field called "${clean}".`;
  }
  return null;
}

export class CustomFieldError extends Error {}

// Creates one definition. Throws CustomFieldError (a plain message) if the label
// is bad or the workspace already has the maximum, so a caller inside a
// transaction rolls everything back. Pass the transaction client as `db`.
export async function createCustomField(
  workspaceId: string,
  input: { label: string; type: CustomFieldType; options?: string[]; shareWithAi?: boolean },
  db: Db = prisma
): Promise<CustomFieldDef> {
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(input.type)) throw new CustomFieldError("Unknown field type.");
  const existing = await listCustomFields(workspaceId, db);
  if (existing.length >= CUSTOM_FIELD_LIMITS.maxFields) {
    throw new CustomFieldError(`A workspace can have at most ${CUSTOM_FIELD_LIMITS.maxFields} custom fields.`);
  }
  const problem = labelProblem(input.label, existing.map((f) => f.label));
  if (problem) throw new CustomFieldError(problem);
  const options = (input.options ?? []).map((o) => o.trim()).filter((o) => o !== "");
  if (input.type === "pick_list" && (options.length < 1 || options.length > CUSTOM_FIELD_LIMITS.maxOptions)) {
    throw new CustomFieldError(`A pick-list needs between 1 and ${CUSTOM_FIELD_LIMITS.maxOptions} choices.`);
  }
  const row = await db.customField.create({
    data: {
      workspaceId,
      label: input.label.replace(/\s+/g, " ").trim(),
      type: input.type,
      options: input.type === "pick_list" ? options : undefined,
      shareWithAi: input.shareWithAi ?? true,
    },
  });
  return toDef(row);
}

// Rename a field or change whether the AI may read it. The type and the choices
// are fixed once values exist.
export async function updateCustomField(
  workspaceId: string,
  id: string,
  changes: { label?: string; shareWithAi?: boolean }
): Promise<CustomFieldDef | null> {
  const existing = await listCustomFields(workspaceId);
  const current = existing.find((f) => f.id === id);
  if (!current) return null;
  const data: { label?: string; shareWithAi?: boolean } = {};
  if (changes.label !== undefined) {
    const problem = labelProblem(changes.label, existing.filter((f) => f.id !== id).map((f) => f.label));
    if (problem) throw new CustomFieldError(problem);
    data.label = changes.label.replace(/\s+/g, " ").trim();
  }
  if (changes.shareWithAi !== undefined) data.shareWithAi = changes.shareWithAi;
  const row = await prisma.customField.update({ where: { id }, data });
  return toDef(row);
}

// Deletes the definition and removes its values from every customer in the workspace.
export async function deleteCustomField(workspaceId: string, id: string): Promise<boolean> {
  const existing = await prisma.customField.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) return false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE customers SET "customFields" = "customFields" - ${id} WHERE "workspaceId" = ${workspaceId}`;
    await tx.customField.delete({ where: { id } });
  });
  return true;
}

// The values stored on a customer, as readable label/value pairs in the order
// the fields were created. Values for deleted fields are ignored.
export function readableCustomValues(
  defs: CustomFieldDef[],
  stored: unknown,
  options: { forAiOnly?: boolean } = {}
): { id: string; label: string; type: CustomFieldType; value: string | number }[] {
  const values = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: { id: string; label: string; type: CustomFieldType; value: string | number }[] = [];
  for (const d of defs) {
    if (options.forAiOnly && !d.shareWithAi) continue;
    const v = values[d.id];
    if (typeof v === "string" || typeof v === "number") out.push({ id: d.id, label: d.label, type: d.type, value: v });
  }
  return out;
}
