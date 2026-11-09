// Remembering a confirmed column mapping, so the next file with the same set of
// columns needs no choices. One saved mapping per workspace, file type and
// column signature (see mappingSignature in mapping.ts: the same columns in any
// order or case give the same signature). A workspace keeps at most
// MAX_SAVED_PER_WORKSPACE; the least recently used go first.
//
// A saved mapping is only ever a starting point shown to the person. Importing
// re-checks whatever mapping arrives, so a stale or damaged saved row cannot
// cause harm: it is simply not used.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normaliseHeader,
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
  type ColumnMappingEntry,
  type MappingKind,
} from "./mapping";

type Db = Prisma.TransactionClient | typeof prisma;

export const MAX_SAVED_PER_WORKSPACE = 50;

// What is stored: new custom fields become references to the fields they
// created (a saved mapping never creates a field twice), and nothing about
// the AI setting is stored, since a field keeps its own setting.
export function mappingToSave(mapping: ColumnMapping, createdByHeader: Map<string, string>): ColumnMapping {
  return mapping.map((entry): ColumnMappingEntry => {
    if (entry.action !== "custom") return entry;
    const id = createdByHeader.get(normaliseHeader(entry.header));
    return id ? { header: entry.header, action: "existing_custom", fieldId: id } : { header: entry.header, action: "ignore" };
  });
}

export async function saveMapping(db: Db, workspaceId: string, kind: MappingKind, signature: string, mapping: ColumnMapping): Promise<void> {
  const json = mapping as unknown as Prisma.InputJsonValue;
  await db.importMapping.upsert({
    where: { workspaceId_kind_signature: { workspaceId, kind, signature } },
    create: { workspaceId, kind, signature, mapping: json },
    update: { mapping: json },
  });
  const all = await db.importMapping.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  if (all.length > MAX_SAVED_PER_WORKSPACE) {
    await db.importMapping.deleteMany({ where: { workspaceId, id: { in: all.slice(MAX_SAVED_PER_WORKSPACE).map((r) => r.id) } } });
  }
}

export async function loadSavedMapping(db: Db, workspaceId: string, kind: MappingKind, signature: string): Promise<ColumnMapping | null> {
  const row = await db.importMapping.findUnique({ where: { workspaceId_kind_signature: { workspaceId, kind, signature } }, select: { mapping: true } });
  if (!row) return null;
  const parsed = parseColumnMapping(row.mapping);
  return parsed.ok ? parsed.mapping : null;
}

// Makes a saved mapping safe to show. A column that pointed at a custom field
// that has since been deleted goes back to what we would suggest today. If the
// result still does not pass the same checks an import runs, none of it is used.
export function reconcileSavedMapping(
  kind: MappingKind,
  saved: ColumnMapping,
  suggested: ColumnMapping,
  existingFields: { id: string; label: string }[],
  fileHeaders: string[]
): ColumnMapping | null {
  const liveIds = new Set(existingFields.map((f) => f.id));
  const suggestedFor = new Map(suggested.map((e) => [normaliseHeader(e.header), e]));
  const entries = saved.map((e): ColumnMappingEntry => {
    if (e.action === "existing_custom" && !liveIds.has(e.fieldId)) return suggestedFor.get(normaliseHeader(e.header)) ?? { header: e.header, action: "ignore" };
    return e;
  });
  return validateMapping(kind, entries, existingFields, fileHeaders).length === 0 ? entries : null;
}
