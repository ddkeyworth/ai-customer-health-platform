// Filtering customers by custom fields, for Segments. Stored in a segment's
// criteria as `custom: [{ fieldId, op, value }]`. Everything here is pure: it
// checks a stored criteria blob strictly (a deleted field or a malformed filter
// is ignored with a plain note, never a crash) and matches a customer's stored
// values against the surviving filters. A customer with no value for a field
// never matches a filter on that field.
import { parseDate } from "@/lib/import/validate";
import type { CustomFieldType } from "@/lib/import/customFields";
import { storedValues, type CustomFieldLike } from "./values";

export type FilterOp = "equals" | "contains" | "at_least" | "at_most" | "between" | "on" | "before" | "after" | "is_one_of";

export const OPS_BY_TYPE: Record<CustomFieldType, FilterOp[]> = {
  text: ["equals", "contains"],
  number: ["equals", "at_least", "at_most", "between"],
  date: ["on", "before", "after", "between"],
  pick_list: ["is_one_of"],
};

export const OP_LABELS: Record<FilterOp, string> = {
  equals: "is",
  contains: "contains",
  at_least: "is at least",
  at_most: "is at most",
  between: "is between",
  on: "is on",
  before: "is before",
  after: "is after",
  is_one_of: "is one of",
};

export type FilterValue = string | number | string[] | { min: number; max: number } | { from: string; to: string };
export interface CustomFilter {
  fieldId: string;
  op: FilterOp;
  value: FilterValue;
}

export const MAX_CUSTOM_FILTERS = 25;
const MAX_TEXT = 100;
const MAX_NUMBER = 1_000_000_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) && Math.abs(x) <= MAX_NUMBER ? x : null;
  if (typeof x === "string" && NUMERIC.test(x.trim())) {
    const n = Number(x.trim());
    return Number.isFinite(n) && Math.abs(n) <= MAX_NUMBER ? n : null;
  }
  return null;
}

function asDate(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  if (!ISO_DATE.test(t)) return null;
  const d = parseDate(t);
  return d instanceof Date ? t : null;
}

// Checks one filter against its field. Returns the cleaned filter, or a reason
// it was ignored.
function cleanFilter(def: CustomFieldLike, raw: Record<string, unknown>): CustomFilter | string {
  const op = raw.op;
  if (typeof op !== "string" || !(OPS_BY_TYPE[def.type] as string[]).includes(op)) {
    return `"${def.label}" cannot be filtered that way (it is a ${def.type.replace("_", "-")} field)`;
  }
  const value = raw.value;
  const bad = `the value for "${def.label}" is not valid`;

  if (def.type === "text") {
    if (typeof value !== "string") return bad;
    const t = value.trim();
    if (t === "" || t.length > MAX_TEXT) return bad;
    return { fieldId: def.id, op: op as FilterOp, value: t };
  }
  if (def.type === "number") {
    if (op === "between") {
      if (!isPlainObject(value)) return bad;
      const min = asNumber(value.min);
      const max = asNumber(value.max);
      if (min === null || max === null || min > max) return bad;
      return { fieldId: def.id, op: "between", value: { min, max } };
    }
    const n = asNumber(value);
    if (n === null) return bad;
    return { fieldId: def.id, op: op as FilterOp, value: n };
  }
  if (def.type === "date") {
    if (op === "between") {
      if (!isPlainObject(value)) return bad;
      const from = asDate(value.from);
      const to = asDate(value.to);
      if (from === null || to === null || from > to) return bad;
      return { fieldId: def.id, op: "between", value: { from, to } };
    }
    const d = asDate(value);
    if (d === null) return bad;
    return { fieldId: def.id, op: op as FilterOp, value: d };
  }
  // pick_list
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return bad;
  const chosen: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") return bad;
    const match = def.options.find((o) => o.trim().toLowerCase() === v.trim().toLowerCase());
    if (match !== undefined && !chosen.includes(match)) chosen.push(match);
  }
  if (chosen.length === 0) return `none of the choices for "${def.label}" exist any more`;
  return { fieldId: def.id, op: "is_one_of", value: chosen };
}

export interface ParsedCustomFilters {
  filters: CustomFilter[];
  ignored: string[];
}

// Checks the stored `custom` criteria strictly. Never throws.
export function parseCustomFilters(input: unknown, defs: CustomFieldLike[]): ParsedCustomFilters {
  const out: ParsedCustomFilters = { filters: [], ignored: [] };
  if (input === undefined || input === null) return out;
  if (!Array.isArray(input)) {
    out.ignored.push("The custom-field filters on this segment were not in the expected form, so they were ignored.");
    return out;
  }
  const byId = new Map(defs.map((d) => [d.id, d]));
  input.slice(0, MAX_CUSTOM_FILTERS).forEach((item) => {
    if (!isPlainObject(item) || Object.keys(item).some((k) => k !== "fieldId" && k !== "op" && k !== "value")) {
      out.ignored.push("A custom-field filter on this segment was malformed and was ignored.");
      return;
    }
    const def = typeof item.fieldId === "string" ? byId.get(item.fieldId) : undefined;
    if (!def) {
      out.ignored.push("A filter on a custom field that no longer exists was ignored.");
      return;
    }
    const cleaned = cleanFilter(def, item);
    if (typeof cleaned === "string") out.ignored.push(`A filter was ignored: ${cleaned}.`);
    else out.filters.push(cleaned);
  });
  if (input.length > MAX_CUSTOM_FILTERS) out.ignored.push(`Only the first ${MAX_CUSTOM_FILTERS} custom-field filters are used.`);
  return out;
}

function matchesOne(def: CustomFieldLike, f: CustomFilter, raw: string | number | undefined): boolean {
  if (raw === undefined) return false;

  if (def.type === "text") {
    const have = String(raw).trim().toLowerCase();
    const want = String(f.value).trim().toLowerCase();
    return f.op === "equals" ? have === want : f.op === "contains" ? have.includes(want) : false;
  }
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : NUMERIC.test(raw.trim()) ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(n)) return false;
    if (f.op === "between") {
      const v = f.value as { min: number; max: number };
      return n >= v.min && n <= v.max;
    }
    const v = f.value as number;
    return f.op === "equals" ? n === v : f.op === "at_least" ? n >= v : f.op === "at_most" ? n <= v : false;
  }
  if (def.type === "date") {
    if (typeof raw !== "string" || !ISO_DATE.test(raw.trim())) return false;
    const d = raw.trim();
    if (f.op === "between") {
      const v = f.value as { from: string; to: string };
      return d >= v.from && d <= v.to;
    }
    const v = f.value as string;
    return f.op === "on" ? d === v : f.op === "before" ? d < v : f.op === "after" ? d > v : false;
  }
  // pick_list
  const have = String(raw).trim().toLowerCase();
  return (f.value as string[]).some((o) => o.trim().toLowerCase() === have);
}

// True when the customer's stored values satisfy every filter (they are ANDed).
export function matchesCustomFilters(filters: CustomFilter[], defs: CustomFieldLike[], stored: unknown): boolean {
  if (filters.length === 0) return true;
  const values = storedValues(stored);
  const byId = new Map(defs.map((d) => [d.id, d]));
  return filters.every((f) => {
    const def = byId.get(f.fieldId);
    return def ? matchesOne(def, f, values[f.fieldId]) : false;
  });
}

// A short plain-English description for the segment pages.
export function describeFilter(def: CustomFieldLike, f: CustomFilter): string {
  const op = OP_LABELS[f.op];
  if (f.op === "between") {
    const v = f.value as { min: number; max: number } | { from: string; to: string };
    return "min" in v ? `${def.label} ${op} ${v.min} and ${v.max}` : `${def.label} ${op} ${v.from} and ${v.to}`;
  }
  if (f.op === "is_one_of") return `${def.label} ${op} ${(f.value as string[]).join(", ")}`;
  return `${def.label} ${op} ${String(f.value)}`;
}
