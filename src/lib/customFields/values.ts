// Reading and showing the values stored on a customer in Customer.customFields
// (a JSON object keyed by custom field id). Pure: no database. Used by the
// customer page, the export, the segment filter and the AI context builder.
import type { CustomFieldType } from "@/lib/import/customFields";

// The shape every helper needs from a definition. The database rows in
// store.ts (CustomFieldDef) satisfy it.
export interface CustomFieldLike {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  shareWithAi: boolean;
}

export type StoredValue = string | number;

// Only plain text and finite numbers are ever read back; anything else in the
// JSON (nested objects, booleans, nulls, NaN) is ignored.
export function storedValues(stored: unknown): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// How a value reads on screen and in the AI context: numbers with thousands
// separators, dates as "31 Mar 2026", text as it is.
export function displayValue(type: CustomFieldType, value: StoredValue): string {
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 6 }) : String(value);
  }
  if (type === "date" && typeof value === "string" && ISO_DATE.test(value)) {
    const d = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
  }
  return String(value);
}

// The canonical form written to the export: numbers as numbers, everything else
// as the stored text (dates are already YYYY-MM-DD).
export function exportValue(type: CustomFieldType, value: StoredValue | undefined): StoredValue | null {
  if (value === undefined) return null;
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return String(value);
}

// The values a customer has, in definition order, ready to show as a list.
export function customerCustomValues(
  defs: CustomFieldLike[],
  stored: unknown
): { id: string; label: string; type: CustomFieldType; value: StoredValue; shown: string }[] {
  const values = storedValues(stored);
  const out: { id: string; label: string; type: CustomFieldType; value: StoredValue; shown: string }[] = [];
  for (const d of defs) {
    const v = values[d.id];
    if (v === undefined) continue;
    out.push({ id: d.id, label: d.label, type: d.type, value: v, shown: displayValue(d.type, v) });
  }
  return out;
}
