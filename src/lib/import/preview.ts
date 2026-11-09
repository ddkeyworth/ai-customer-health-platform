// Step 1 of an import, "Check file": read the uploaded file, work out what each
// column probably is, and describe it so the browser can show a table the person
// confirms. Nothing is written. The result is plain data (it is sent to the
// browser), and it is only ever a proposal: the import re-reads the file and
// re-checks every choice on the server.
import { prisma } from "@/lib/prisma";
import { listCustomFields } from "@/lib/customFields/store";
import { parseCsv } from "./csv";
import { IMPORT_KINDS, type ImportKind } from "./validate";
import { CUSTOM_FIELD_LIMITS, type CustomFieldType } from "./customFields";
import { knownColumns, mappingSignature, normaliseHeader, suggestMapping, suggestionsToMapping, type ColumnMappingEntry } from "./mapping";
import { loadSavedMapping, reconcileSavedMapping } from "./savedMappings";

export interface PreviewColumn {
  header: string;
  index: number;
  // A column with no heading, or the same heading as an earlier column, is always
  // ignored and is not part of the choices that are sent back.
  locked: boolean;
  action: "map" | "custom" | "existing_custom" | "ignore";
  target?: string; // built-in column, when action is "map"
  fieldId?: string; // existing custom field, when action is "existing_custom"
  label?: string; // new custom field name, when action is "custom"
  type?: CustomFieldType;
  options?: string[];
  shareWithAi: boolean; // for a new custom field; always starts off
  reason: string;
  confidence: number;
  samples: string[];
}

export interface PreviewField {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  shareWithAi: boolean;
}

export type PreviewResult =
  | {
      ok: true;
      kind: ImportKind;
      rowCount: number;
      columns: PreviewColumn[];
      known: { name: string; label: string; required: boolean }[];
      existingFields: PreviewField[];
      canCreateFields: boolean;
      fieldRoom: number; // how many more custom fields the workspace can have
      savedApplied: boolean;
    }
  | { ok: false; message: string };

const bad = (message: string): PreviewResult => ({ ok: false, message });

export async function buildPreview(workspaceId: string, kind: string, text: string): Promise<PreviewResult> {
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return bad("Unknown import type.");
  const k = kind as ImportKind;
  if (text.includes("\u0000")) return bad("The file contains a null character, so it is not a plain CSV file.");

  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "The file could not be read.");
  }
  if (parsed.headers.length === 0) return bad("The file is empty.");
  // Two columns with exactly the same heading cannot be told apart when the rows
  // are read, so ask for one of them to be renamed.
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const h of parsed.headers) {
    if (h === "") continue;
    if (seen.has(h)) dupes.add(h);
    seen.add(h);
  }
  if (dupes.size > 0) return bad(`These column names appear more than once: ${[...dupes].join(", ")}. Each column needs its own name; rename or delete one of them and check the file again.`);
  if (parsed.rows.length === 0) return bad("The file has a heading row but no rows of data.");

  const existing = await listCustomFields(workspaceId);
  const suggestions = suggestMapping(k, parsed.headers, parsed.rows, existing);
  const suggested = suggestionsToMapping(suggestions);

  let chosen: ColumnMappingEntry[] = suggested;
  let savedApplied = false;
  const saved = await loadSavedMapping(prisma, workspaceId, k, mappingSignature(parsed.headers));
  if (saved) {
    const usable = reconcileSavedMapping(k, saved, suggested, existing, parsed.headers);
    if (usable) {
      chosen = usable;
      savedApplied = true;
    }
  }
  const chosenFor = new Map(chosen.map((e) => [normaliseHeader(e.header), e]));
  const firstIndex = new Map<string, number>();
  parsed.headers.forEach((h, i) => {
    const n = normaliseHeader(h);
    if (n !== "" && !firstIndex.has(n)) firstIndex.set(n, i);
  });

  const columns = suggestions.map((s): PreviewColumn => {
    const n = normaliseHeader(s.header);
    const locked = n === "" || firstIndex.get(n) !== s.index;
    const entry: ColumnMappingEntry = locked ? { header: s.header, action: "ignore" } : (chosenFor.get(n) ?? { header: s.header, action: "ignore" });
    const column: PreviewColumn = {
      header: s.header,
      index: s.index,
      locked,
      action: entry.action,
      shareWithAi: false,
      reason: savedApplied && !locked ? "Saved mapping applied" : s.reason,
      confidence: savedApplied && !locked ? 1 : s.confidence,
      samples: s.samples,
    };
    if (entry.action === "map") column.target = entry.target;
    if (entry.action === "existing_custom") column.fieldId = entry.fieldId;
    if (entry.action === "custom") {
      column.label = entry.label;
      column.type = entry.type;
      if (entry.options) column.options = entry.options;
    }
    return column;
  });

  return {
    ok: true,
    kind: k,
    rowCount: parsed.rows.length,
    columns,
    known: knownColumns(k).map((c) => ({ name: c.name, label: c.label, required: c.required })),
    existingFields: existing.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, shareWithAi: f.shareWithAi })),
    canCreateFields: k === "customers",
    fieldRoom: Math.max(0, CUSTOM_FIELD_LIMITS.maxFields - existing.length),
    savedApplied,
  };
}
