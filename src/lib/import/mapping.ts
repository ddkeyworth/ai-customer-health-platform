// Flexible import, phase 1: the pure logic that lets an uploaded file use its
// own column names. For every column in the file it suggests one of three
// things: map it to a field Bearing already has, keep it as a new custom field
// (customers file only), or ignore it. The person confirms or changes each
// choice, then applyMapping() rewrites the file into the canonical layout the
// existing validators already read, so none of the import rules change.
//
// No database, no network: every function here is testable on its own.
import { createHash } from "node:crypto";
import {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  coerceCustomValue,
  type CustomFieldType,
} from "./customFields";
import { parseDate, type ImportKind } from "./validate";

// The same nine kinds the importer reads.
export type MappingKind = ImportKind;

// ---------- the catalogue of columns Bearing already understands ----------

export interface KnownColumn {
  name: string; // the canonical column name the validators read
  label: string; // what to call it to a person
  required: boolean;
  aliases: string[]; // names people really use for it
}

const CUSTOMER_REF_ALIASES = ["customer name", "customer ref", "customer id", "account", "account name", "account id", "company", "company name", "client", "client name", "customer reference"];
const CUSTOMER_COLUMN: KnownColumn = { name: "customer", label: "Customer", required: true, aliases: CUSTOMER_REF_ALIASES.concat(["ref", "customer"]) };

export const KNOWN_COLUMNS: Record<MappingKind, KnownColumn[]> = {
  customers: [
    { name: "name", label: "Customer name", required: true, aliases: ["customer name", "customer", "account", "account name", "company", "company name", "client", "client name", "organisation", "organization", "org name"] },
    { name: "ref", label: "Customer reference", required: false, aliases: ["customer ref", "customer id", "account id", "id", "reference", "customer number", "crm id", "account number"] },
    { name: "country", label: "Country", required: false, aliases: ["nation", "country name"] },
    { name: "industry", label: "Industry", required: false, aliases: ["sector", "vertical", "industry sector"] },
    { name: "region", label: "Region", required: false, aliases: ["territory", "sales region", "area", "geo", "geography"] },
    { name: "city", label: "City", required: false, aliases: ["town", "hq city", "head office city"] },
    { name: "sub_industry", label: "Sub-industry", required: false, aliases: ["sub industry", "subsector", "sub sector", "industry segment", "sub vertical"] },
    { name: "tier", label: "Tier", required: false, aliases: ["customer tier", "account tier", "size band", "customer size"] },
    { name: "product", label: "Product", required: false, aliases: ["product name", "product line", "solution"] },
    { name: "lifecycle_status", label: "Lifecycle status", required: false, aliases: ["lifecycle", "status", "stage", "lifecycle stage", "account status", "customer status"] },
    { name: "contractual_arr", label: "Contract value (ARR)", required: false, aliases: ["arr", "acv", "annual contract value", "contract value", "annual recurring revenue", "contracted arr", "contract arr", "annual value", "subscription value", "contracted revenue"] },
    { name: "consumption_arr", label: "Consumption revenue", required: false, aliases: ["usage arr", "consumption", "variable revenue", "overage", "usage revenue", "consumption revenue", "consumption value"] },
    { name: "renewal_date", label: "Renewal date", required: false, aliases: ["renewal", "contract end", "contract end date", "renews on", "renewal on", "term end", "end date", "expiry", "expiry date", "contract expiry", "next renewal"] },
    { name: "expected_go_live_date", label: "Expected go-live date", required: false, aliases: ["expected go live", "go live target", "target go live", "planned go live", "expected launch", "target launch date", "go live due", "expected live date"] },
    { name: "go_live_date", label: "Go-live date", required: false, aliases: ["go live", "went live", "actual go live", "launch date", "live date", "live since", "go live actual"] },
    { name: "payment_status", label: "Payment status", required: false, aliases: ["payment", "billing status", "payment state", "invoice status"] },
    { name: "days_past_due", label: "Days past due", required: false, aliases: ["days overdue", "overdue days", "days late", "dpd", "days past due date"] },
    { name: "renewal_type", label: "Renewal type", required: false, aliases: ["renewal mode", "contract renewal type"] },
    { name: "interrupted_reason", label: "Interruption reason", required: false, aliases: ["interruption reason", "reason interrupted", "non renewal reason", "reason for interruption"] },
    { name: "nps", label: "NPS score", required: false, aliases: ["nps score", "net promoter score", "nps rating", "net promoter"] },
    { name: "nps_date", label: "NPS date", required: false, aliases: ["nps survey date", "survey date", "nps recorded", "date of nps", "nps measured", "nps taken"] },
    { name: "champion_name", label: "Champion", required: false, aliases: ["champion", "main contact", "key contact", "sponsor", "exec sponsor", "executive sponsor", "primary contact", "champion name"] },
    { name: "champion_last_engaged", label: "Champion last engaged", required: false, aliases: ["champion last contacted", "last contact", "last engaged", "last contacted", "last touch", "last contact date", "sponsor last contacted", "champion last contact"] },
  ],
  tickets: [
    CUSTOMER_COLUMN,
    { name: "date", label: "Date", required: true, aliases: ["created", "created at", "created date", "opened", "opened at", "date opened", "raised", "raised on", "timestamp", "ticket date", "logged", "logged on"] },
    { name: "type", label: "Type", required: false, aliases: ["channel", "ticket type", "kind", "interaction type", "source"] },
    { name: "severity", label: "Severity", required: false, aliases: ["priority", "urgency", "ticket priority", "impact"] },
    { name: "text", label: "Text", required: true, aliases: ["ticket text", "description", "summary", "body", "message", "details", "ticket description", "issue", "content", "comment"] },
  ],
  usage: [
    CUSTOMER_COLUMN,
    { name: "product", label: "Product", required: false, aliases: ["product name", "product line", "solution"] },
    { name: "capability", label: "Capability", required: true, aliases: ["feature", "metric", "product area", "module", "feature name", "metric name", "capability name", "usage metric"] },
    { name: "metric_type", label: "Metric type", required: false, aliases: ["metric kind", "kind", "measure type", "adoption or consumption"] },
    { name: "date", label: "Date", required: true, aliases: ["period", "month", "reading date", "measured at", "as of", "usage date", "recorded", "recorded on"] },
    { name: "value", label: "Value", required: true, aliases: ["amount", "count", "usage", "reading", "quantity", "units", "volume", "usage value"] },
  ],
  outcomes: [
    CUSTOMER_COLUMN,
    { name: "date", label: "Date", required: true, aliases: ["outcome date", "closed", "closed on", "effective date", "decision date", "event date"] },
    { name: "type", label: "Outcome", required: true, aliases: ["outcome", "outcome type", "result", "event", "event type"] },
    { name: "notes", label: "Notes", required: false, aliases: ["note", "comment", "comments", "reason", "details", "description"] },
  ],
  stakeholders: [
    CUSTOMER_COLUMN,
    { name: "name", label: "Person's name", required: true, aliases: ["contact", "contact name", "person", "stakeholder", "stakeholder name", "full name", "contact person"] },
    { name: "role", label: "Role", required: false, aliases: ["title", "job title", "position", "function", "job role"] },
    { name: "is_champion", label: "Is a champion", required: false, aliases: ["champion", "is champion", "champion flag", "main champion", "sponsor"] },
    { name: "last_engaged_date", label: "Last engaged", required: false, aliases: ["last engaged", "last contacted", "last contact", "last contact date", "last touch", "last engagement", "last engaged at"] },
  ],
  goals: [
    CUSTOMER_COLUMN,
    { name: "name", label: "Goal", required: true, aliases: ["goal", "goal name", "objective", "outcome", "desired outcome", "kpi", "kpi name", "target name"] },
    { name: "target_value", label: "Target", required: true, aliases: ["target", "goal value", "target amount", "goal target", "kpi target", "objective target"] },
    { name: "actual_value", label: "Actual so far", required: false, aliases: ["actual", "current", "current value", "progress", "achieved", "actual amount", "to date"] },
    { name: "unit", label: "Unit", required: false, aliases: ["units", "uom", "measure", "unit of measure", "metric unit"] },
  ],
  training: [
    CUSTOMER_COLUMN,
    { name: "course", label: "Course", required: true, aliases: ["course name", "training", "training course", "session", "session name", "class", "programme", "program", "module"] },
    { name: "attendees", label: "Attendees", required: false, aliases: ["attendee count", "number of attendees", "people", "participants", "headcount", "attendance", "completions"] },
    { name: "date", label: "Date", required: true, aliases: ["completed", "completed on", "completion date", "session date", "training date", "held on", "occurred", "occurred on"] },
  ],
  events: [
    CUSTOMER_COLUMN,
    { name: "event", label: "Event", required: true, aliases: ["event name", "webinar", "session", "conference", "meeting"] },
    { name: "date", label: "Date", required: true, aliases: ["event date", "attended", "attended on", "held on", "occurred", "occurred on"] },
  ],
  surveys: [
    CUSTOMER_COLUMN,
    { name: "type", label: "Survey type", required: true, aliases: ["survey type", "survey", "score type", "metric", "kind"] },
    { name: "score", label: "Score", required: true, aliases: ["rating", "survey score", "result", "response", "answer", "value"] },
    { name: "date", label: "Date", required: true, aliases: ["survey date", "responded", "responded on", "response date", "submitted", "submitted on", "taken"] },
  ],
};

// Columns the export writes that are results, not inputs: a re-import must
// never keep them as custom fields, so they are suggested as "ignore".
export const EXPORT_ONLY_COLUMNS: Partial<Record<MappingKind, string[]>> = {
  customers: ["health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative"],
};

export function knownColumns(kind: MappingKind): KnownColumn[] {
  return KNOWN_COLUMNS[kind];
}

export function requiredColumns(kind: MappingKind): string[] {
  return KNOWN_COLUMNS[kind].filter((c) => c.required).map((c) => c.name);
}

// ---------- reading headers ----------

// A header as a person would compare it: no byte-order mark or zero-width
// characters, lower case, letters and digits only, single spaces. So
// "ACV (GBP)", "acv_gbp" and "  ACV  GBP " are all the same thing.
//
// Two more rules, both for custom-field columns written by the export. The export
// puts one apostrophe in front of a heading that starts with = + - or @ (so a
// spreadsheet cannot run it as a formula); that apostrophe is not part of the
// name, so it is dropped here. And a heading made only of symbols (a field called
// "@") has no letters or digits to compare, so it is compared as written, with a
// "~" in front to keep it apart from a blank heading. The export's own result
// columns (health_score and the like) keep their underscore, so a custom field the
// person called "Health Score", written beside them, is not mistaken for one.
const RESULT_COLUMNS = new Set(Object.values(EXPORT_ONLY_COLUMNS).flat());
export function normaliseHeader(header: string): string {
  const cleaned = String(header ?? "")
    .replace(/[﻿​-‍⁠]/g, "")
    .trim()
    .toLowerCase();
  if (RESULT_COLUMNS.has(cleaned)) return cleaned;
  const unguarded = /^'+[=+\-@]/.test(cleaned) ? cleaned.slice(1) : cleaned;
  const words = unguarded.replace(/[^a-z0-9]+/g, " ").trim();
  if (words !== "") return words;
  const symbols = unguarded.replace(/\s+/g, "");
  return symbols === "" ? "" : `~${symbols}`;
}

// The export writes a custom field whose name clashes with a standard column as
// "<name> (custom)" (or "(custom 2)" if that clashes too). Returns the name without that ending, or null if there is none.
export function withoutCustomSuffix(header: string): string | null {
  const m = /^(.*\S)\s*\(custom(?:\s+\d+)?\)\s*$/i.exec(String(header ?? "").trim());
  return m ? m[1] : null;
}

// Words that say nothing about what a column is.
const IGNORABLE_TOKENS = new Set(["gbp", "usd", "eur", "currency", "the", "of", "in", "a", "an"]);

function tokensOf(normalised: string): string[] {
  return normalised.split(" ").filter((t) => t !== "" && !IGNORABLE_TOKENS.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

const MIN_MAP_CONFIDENCE = 0.7;

// How well a file header matches one known column, 0 to 1, and why.
function scoreAgainst(headerNorm: string, col: KnownColumn): { score: number; how: string } {
  const headerTokens = tokensOf(headerNorm);
  const canonical = col.name.replace(/_/g, " ");
  const candidates = [{ text: canonical, canonical: true }, ...col.aliases.map((a) => ({ text: normaliseHeader(a), canonical: false }))];
  let best = { score: 0, how: "" };
  const offer = (score: number, how: string) => {
    if (score > best.score) best = { score, how };
  };

  for (const c of candidates) {
    if (headerNorm === c.text) offer(c.canonical ? 1 : 0.95, c.canonical ? "Same name as the Bearing field" : "A common name for this field");
    const cTokens = tokensOf(c.text);
    if (headerTokens.length > 0 && cTokens.length > 0) {
      const same = headerTokens.length === cTokens.length && headerTokens.every((t) => cTokens.includes(t));
      if (same) offer(0.9, "Same words, ignoring currency and filler words");
      // The header contains every word of a multi-word alias ("Contract End Date" holds "contract end").
      if (cTokens.length >= 2 && cTokens.every((t) => headerTokens.includes(t))) offer(0.8, "Contains the words of a common name for this field");
    }
    // Close spelling ("Renewl Date", "Renewal Dt").
    const shorter = Math.min(headerNorm.length, c.text.length);
    if (shorter >= 5) {
      const sim = 1 - levenshtein(headerNorm, c.text) / Math.max(headerNorm.length, c.text.length);
      if (sim >= 0.8) offer(Math.min(0.88, sim), "Very close spelling to a Bearing field");
    }
  }
  return best;
}

// ---------- the mapping a person confirms ----------

export type ColumnMappingEntry =
  | { header: string; action: "map"; target: string }
  | { header: string; action: "custom"; label: string; type: CustomFieldType; options?: string[]; shareWithAi: boolean }
  | { header: string; action: "existing_custom"; fieldId: string }
  | { header: string; action: "ignore" };
export type ColumnMapping = ColumnMappingEntry[];

export interface ColumnSuggestion {
  header: string;
  index: number;
  action: "map" | "custom" | "existing_custom" | "ignore";
  fieldId?: string; // when action is "existing_custom"
  fieldLabel?: string;
  target?: string; // when action is "map"
  targetLabel?: string;
  label?: string; // when action is "custom"
  type?: CustomFieldType;
  options?: string[];
  confidence: number; // 0 to 1
  reason: string;
  samples: string[]; // up to 3 distinct example values
}

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function suggestLabel(header: string): string {
  const words = String(header ?? "")
    .replace(/[﻿​-‍⁠]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = words === words.toLowerCase() ? titleCase(words) : words;
  return label.slice(0, CUSTOM_FIELD_LIMITS.maxLabel);
}

// Works out a custom field's type from the values in its column. Only an exact
// YYYY-MM-DD counts as a date, so 03/04/2026 (which could be 3 April or 4 March)
// stays text rather than being guessed.
export function inferCustomType(values: string[]): { type: CustomFieldType; options?: string[] } {
  const filled = values.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v !== "");
  if (filled.length === 0) return { type: "text" };

  const isDate = (v: string) => {
    const d = parseDate(v);
    return d !== "bad" && d !== null;
  };
  if (filled.every(isDate)) return { type: "date" };

  // Whole numbers with a leading zero ("00123", "01632 960001") are identifiers, not quantities.
  const looksLikeId = (v: string) => /^0\d+$/.test(v);
  if (filled.every((v) => coerceCustomValue("number", v).ok && !looksLikeId(v))) return { type: "number" };

  const counts = new Map<string, { first: string; n: number }>();
  for (const v of filled) {
    const key = v.toLowerCase();
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { first: v, n: 1 });
  }
  const distinct = [...counts.values()];
  const short = distinct.every((d) => d.first.length <= 40);
  if (filled.length >= 4 && distinct.length >= 2 && distinct.length <= 8 && distinct.length <= filled.length / 2 && short) {
    const options = distinct.sort((a, b) => b.n - a.n || a.first.localeCompare(b.first)).map((d) => d.first);
    return { type: "pick_list", options };
  }
  return { type: "text" };
}

function sampleValues(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t !== "" && !out.includes(t.slice(0, 60))) out.push(t.slice(0, 60));
    if (out.length === 3) break;
  }
  return out;
}

// Suggests what to do with every column of an uploaded file. A known column is
// never suggested for two file columns: the stronger match wins and the other
// becomes a custom field (customers file) or is ignored (the other files).
export function suggestMapping(
  kind: MappingKind,
  headers: string[],
  sampleRows: Record<string, string>[],
  existingFields: { id: string; label: string }[] = []
): ColumnSuggestion[] {
  const known = KNOWN_COLUMNS[kind];
  // A column headed exactly like one of the workspace's own custom fields is that
  // field. The export writes custom fields as columns headed by their label, so
  // this is what makes export-then-import round trip. Only the customers file has them.
  const existingByLabel = new Map<string, { id: string; label: string }>();
  if (kind === "customers") for (const f of existingFields) if (!existingByLabel.has(normaliseHeader(f.label))) existingByLabel.set(normaliseHeader(f.label), f);
  // A heading written exactly as one of Bearing's own column names (region, tier,
  // health_score) stays that column even if a custom field has the same name: the
  // export writes such a field as "<name> (custom)". Any other heading that equals a
  // custom field's name, in any case or punctuation, is that field.
  const canonicalNames = new Set([...known.map((c) => c.name), ...(EXPORT_ONLY_COLUMNS[kind] ?? [])]);
  const fieldFor = (header: string): { id: string; label: string } | undefined => {
    const n = normaliseHeader(header);
    if (n === "") return undefined;
    const whole = existingByLabel.get(n);
    if (whole && !canonicalNames.has(header.trim().toLowerCase())) return whole;
    const bare = withoutCustomSuffix(header);
    return bare === null ? undefined : existingByLabel.get(normaliseHeader(bare));
  };
  const exportOnly = new Set((EXPORT_ONLY_COLUMNS[kind] ?? []).map(normaliseHeader));
  // The file reader lower-cases headings, so look a cell up by the heading as
  // given first, then by its trimmed lower-case form.
  const cell = (row: Record<string, string>, header: string) => row[header] ?? row[header.trim().toLowerCase()] ?? "";
  const columnValues = headers.map((h) => sampleRows.slice(0, 1000).map((r) => cell(r, h)));

  const normalised = headers.map(normaliseHeader);
  const firstIndexOf = new Map<string, number>();
  normalised.forEach((n, i) => {
    if (n !== "" && !firstIndexOf.has(n)) firstIndexOf.set(n, i);
  });

  // every plausible (column, known column) pair
  const pairs: { index: number; col: KnownColumn; score: number; how: string }[] = [];
  headers.forEach((_, index) => {
    const n = normalised[index];
    if (n === "" || firstIndexOf.get(n) !== index) return;
    if (fieldFor(headers[index]) || exportOnly.has(n)) return;
    for (const col of known) {
      const s = scoreAgainst(n, col);
      if (s.score >= MIN_MAP_CONFIDENCE) pairs.push({ index, col, score: s.score, how: s.how });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  const takenColumns = new Set<number>();
  const takenTargets = new Set<string>();
  const chosen = new Map<number, { col: KnownColumn; score: number; how: string }>();
  for (const p of pairs) {
    if (takenColumns.has(p.index) || takenTargets.has(p.col.name)) continue;
    takenColumns.add(p.index);
    takenTargets.add(p.col.name);
    chosen.set(p.index, { col: p.col, score: p.score, how: p.how });
  }

  return headers.map((header, index): ColumnSuggestion => {
    const samples = sampleValues(columnValues[index]);
    const n = normalised[index];
    if (n === "") {
      return { header, index, action: "ignore", confidence: 1, reason: "This column has no heading", samples };
    }
    if (firstIndexOf.get(n) !== index) {
      return { header, index, action: "ignore", confidence: 1, reason: "Another column has the same heading", samples };
    }
    const existingField = fieldFor(header);
    if (existingField) {
      return { header, index, action: "existing_custom", fieldId: existingField.id, fieldLabel: existingField.label, confidence: 1, reason: "Same name as one of your custom fields", samples };
    }
    if (exportOnly.has(n)) {
      return { header, index, action: "ignore", confidence: 1, reason: "A result written by the export, not something to import", samples };
    }
    const hit = chosen.get(index);
    if (hit) {
      return { header, index, action: "map", target: hit.col.name, targetLabel: hit.col.label, confidence: Math.round(hit.score * 100) / 100, reason: hit.how, samples };
    }
    const values = columnValues[index];
    if (values.every((v) => (typeof v === "string" ? v.trim() : "") === "")) {
      return { header, index, action: "ignore", confidence: 0.9, reason: "Every value in this column is empty", samples };
    }
    if (kind !== "customers") {
      return { header, index, action: "ignore", confidence: 0.6, reason: "Bearing does not use this column in this file", samples };
    }
    const inferred = inferCustomType(values);
    return {
      header,
      index,
      action: "custom",
      label: suggestLabel(header),
      type: inferred.type,
      options: inferred.options,
      confidence: 0.6,
      reason: "Bearing has no built-in field for this, so it can be kept as a custom field",
      samples,
    };
  });
}

// The default mapping to show a person: just the suggestions, accepted.
export function suggestionsToMapping(suggestions: ColumnSuggestion[]): ColumnMapping {
  return suggestions.map((s): ColumnMappingEntry => {
    if (s.action === "map" && s.target) return { header: s.header, action: "map", target: s.target };
    if (s.action === "existing_custom" && s.fieldId) return { header: s.header, action: "existing_custom", fieldId: s.fieldId };
    if (s.action === "custom" && s.label && s.type) {
      return { header: s.header, action: "custom", label: s.label, type: s.type, ...(s.options ? { options: s.options } : {}), shareWithAi: false };
    }
    return { header: s.header, action: "ignore" };
  });
}

// ---------- checking a mapping before using it ----------

export interface ExistingCustomField {
  label: string;
  id?: string; // needed to check a column that is mapped to an existing field
}

function labelKey(label: string): string {
  return normaliseHeader(label);
}

// Returns every reason the mapping cannot be used, in plain English. Empty
// means it is fine. fileHeaders, when given, also requires a choice for every
// column in the file.
export function validateMapping(
  kind: MappingKind,
  mapping: ColumnMapping,
  existingCustomFields: ExistingCustomField[] = [],
  fileHeaders?: string[]
): string[] {
  const errors: string[] = [];
  const known = KNOWN_COLUMNS[kind];
  const knownByName = new Map(known.map((c) => [c.name, c]));
  const reservedLabels = new Set(known.flatMap((c) => [normaliseHeader(c.name), normaliseHeader(c.label)]));
  const show = (h: string) => `"${h.slice(0, 60)}"`;

  const seenHeaders = new Set<string>();
  const targetOwner = new Map<string, string>();
  const newLabels = new Map<string, string>();
  const existingLabels = new Set(existingCustomFields.map((f) => labelKey(f.label)));
  const existingIds = new Set(existingCustomFields.flatMap((f) => (f.id ? [f.id] : [])));
  const fieldOwner = new Map<string, string>();
  let customCount = 0;

  for (const entry of mapping) {
    const hk = normaliseHeader(entry.header);
    if (seenHeaders.has(hk)) errors.push(`The column ${show(entry.header)} appears more than once in your choices.`);
    seenHeaders.add(hk);

    if (entry.action === "map") {
      const col = knownByName.get(entry.target);
      if (!col) {
        errors.push(`${show(entry.header)} cannot be mapped to "${String(entry.target).slice(0, 40)}": this file type has no such field.`);
        continue;
      }
      const owner = targetOwner.get(col.name);
      if (owner !== undefined) {
        errors.push(`${show(owner)} and ${show(entry.header)} are both set to "${col.label}". Choose one of them.`);
      } else {
        targetOwner.set(col.name, entry.header);
      }
    } else if (entry.action === "custom") {
      if (kind !== "customers") {
        errors.push(`${show(entry.header)}: custom fields can only be added from the customers file. Map or ignore this column.`);
        continue;
      }
      customCount += 1;
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      if (label === "") {
        errors.push(`${show(entry.header)}: the custom field needs a name.`);
      } else {
        if (label.length > CUSTOM_FIELD_LIMITS.maxLabel) errors.push(`${show(entry.header)}: the custom field name must be ${CUSTOM_FIELD_LIMITS.maxLabel} characters or fewer.`);
        const key = labelKey(label);
        if (key === "" || !/[a-z0-9]/.test(key)) errors.push(`${show(entry.header)}: the custom field name needs letters or numbers.`);
        else if (reservedLabels.has(key)) errors.push(`${show(entry.header)}: "${label}" is already a built-in Bearing field. Map the column to it instead, or choose another name.`);
        else if (existingLabels.has(key)) errors.push(`${show(entry.header)}: you already have a custom field called "${label}".`);
        else if (newLabels.has(key)) errors.push(`${show(newLabels.get(key) as string)} and ${show(entry.header)} would both create a custom field called "${label}".`);
        else newLabels.set(key, entry.header);
      }
      if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(entry.type)) {
        errors.push(`${show(entry.header)}: the field type must be one of text, number, date or pick-list.`);
      } else if (entry.type === "pick_list") {
        const options = Array.isArray(entry.options) ? entry.options : [];
        const cleaned = options.map((o) => (typeof o === "string" ? o.trim() : ""));
        if (cleaned.length === 0) errors.push(`${show(entry.header)}: a pick-list needs at least one choice.`);
        else if (cleaned.length > CUSTOM_FIELD_LIMITS.maxOptions) errors.push(`${show(entry.header)}: a pick-list can have at most ${CUSTOM_FIELD_LIMITS.maxOptions} choices (this has ${cleaned.length}).`);
        else if (cleaned.some((o) => o === "" || o.length > CUSTOM_FIELD_LIMITS.maxOptionLength)) errors.push(`${show(entry.header)}: each choice must be 1 to ${CUSTOM_FIELD_LIMITS.maxOptionLength} characters.`);
        else if (new Set(cleaned.map((o) => o.toLowerCase())).size !== cleaned.length) errors.push(`${show(entry.header)}: the pick-list choices must all be different.`);
      } else if (entry.options !== undefined && entry.options.length > 0) {
        errors.push(`${show(entry.header)}: only a pick-list has choices.`);
      }
    } else if (entry.action === "existing_custom") {
      if (kind !== "customers") {
        errors.push(`${show(entry.header)}: custom fields only exist on the customers file. Map or ignore this column.`);
        continue;
      }
      if (typeof entry.fieldId !== "string" || !existingIds.has(entry.fieldId)) {
        errors.push(`${show(entry.header)}: the custom field you chose no longer exists. Choose again.`);
        continue;
      }
      const owner = fieldOwner.get(entry.fieldId);
      if (owner !== undefined) errors.push(`${show(owner)} and ${show(entry.header)} are both set to the same custom field. Choose one of them.`);
      else fieldOwner.set(entry.fieldId, entry.header);
    } else if (entry.action !== "ignore") {
      errors.push(`${show((entry as { header: string }).header)}: unknown choice.`);
    }
  }

  for (const name of requiredColumns(kind)) {
    if (!targetOwner.has(name)) {
      const col = knownByName.get(name);
      errors.push(`Choose which column holds "${col?.label ?? name}". The ${kind} file needs it.`);
    }
  }

  if (existingCustomFields.length + customCount > CUSTOM_FIELD_LIMITS.maxFields) {
    errors.push(`A workspace can have at most ${CUSTOM_FIELD_LIMITS.maxFields} custom fields. You have ${existingCustomFields.length} and are adding ${customCount}.`);
  }

  if (fileHeaders) {
    for (const h of fileHeaders) {
      if (normaliseHeader(h) !== "" && !seenHeaders.has(normaliseHeader(h))) errors.push(`The column ${show(h)} has no choice. Map it, keep it as a custom field, or ignore it.`);
    }
  }
  return errors;
}

// ---------- applying a mapping ----------

// A stable key for a custom field, made from its name: lower case letters,
// digits and underscores. Collisions get a number added.
export function customFieldKey(label: string, taken: Set<string> = new Set()): string {
  let base = normaliseHeader(label).replace(/[^a-z0-9 ]/g, "").trim().replace(/ /g, "_").slice(0, 40);
  if (base === "") base = "field";
  let key = base;
  let n = 2;
  while (taken.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  return key;
}

export interface AppliedCustomField {
  key: string;
  header: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  shareWithAi: boolean;
}

export interface AppliedExistingField {
  fieldId: string;
  header: string;
}

export interface AppliedMapping {
  existingFields: AppliedExistingField[];
  existingFieldValues: Record<string, string>[]; // one per row, same order: existing field id -> raw cell
  headers: string[]; // canonical column names, in file order
  rows: Record<string, string>[]; // same rows, renamed, ready for the existing validators
  customFields: AppliedCustomField[];
  customFieldValues: Record<string, string>[]; // one per row, same order: custom field key -> raw cell
}

// Rewrites a parsed file into the layout the existing validators read. Row
// order is unchanged, so row numbers in later error messages still match the
// person's spreadsheet. Ignored columns are dropped. Raw custom values are
// kept as text here and checked with coerceCustomValue when they are saved.
export function applyMapping(
  parsed: { headers: string[]; rows: Record<string, string>[] },
  mapping: ColumnMapping
): AppliedMapping {
  const fileHeaderFor = new Map<string, string>();
  for (const h of parsed.headers) {
    const n = normaliseHeader(h);
    if (n !== "" && !fileHeaderFor.has(n)) fileHeaderFor.set(n, h);
  }

  const maps: { from: string; to: string }[] = [];
  const existingFields: AppliedExistingField[] = [];
  const customFields: AppliedCustomField[] = [];
  const takenKeys = new Set<string>();
  for (const entry of mapping) {
    const from = fileHeaderFor.get(normaliseHeader(entry.header));
    if (from === undefined) continue;
    if (entry.action === "map") {
      maps.push({ from, to: entry.target });
    } else if (entry.action === "existing_custom") {
      existingFields.push({ fieldId: entry.fieldId, header: from });
    } else if (entry.action === "custom") {
      const key = customFieldKey(entry.label, takenKeys);
      takenKeys.add(key);
      customFields.push({
        key,
        header: from,
        label: entry.label.trim(),
        type: entry.type,
        ...(entry.options ? { options: entry.options.map((o) => o.trim()) } : {}),
        shareWithAi: entry.shareWithAi === true,
      });
    }
  }

  const headersInFileOrder = parsed.headers.filter((h) => maps.some((m) => m.from === h)).map((h) => maps.find((m) => m.from === h)!.to);
  const rows = parsed.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const m of maps) out[m.to] = row[m.from] ?? "";
    return out;
  });
  const customFieldValues = parsed.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const f of customFields) out[f.key] = row[f.header] ?? "";
    return out;
  });
  const existingFieldValues = parsed.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const f of existingFields) out[f.fieldId] = row[f.header] ?? "";
    return out;
  });
  return { existingFields, existingFieldValues, headers: headersInFileOrder, rows, customFields, customFieldValues };
}

// ---------- remembering a mapping for the next upload ----------

// A stable fingerprint of a file's set of columns. The same columns in any
// order and any case give the same signature; a different set gives a
// different one. Used as the key under which a confirmed mapping is saved.
export function mappingSignature(headers: string[]): string {
  const unique = [...new Set(headers.map(normaliseHeader).filter((h) => h !== ""))].sort();
  return createHash("sha256").update(unique.join("\n")).digest("hex");
}

// ---------- reading a mapping that arrived from the browser ----------

const MAX_MAPPING_BYTES = 200_000;
const MAX_ENTRIES = 200;
const MAX_STRING = 500;
const MAX_OPTIONS_PARSE = 200;

export type ParseMappingResult = { ok: true; mapping: ColumnMapping } | { ok: false; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// Checks the shape of untrusted input (JSON text or an already-parsed value).
// Rejects anything malformed, oversized, or with keys it does not know, so
// nothing unexpected (including prototype-pollution keys) gets past here.
export function parseColumnMapping(input: unknown): ParseMappingResult {
  let value: unknown = input;
  if (typeof input === "string") {
    if (input.length > MAX_MAPPING_BYTES) return { ok: false, error: "The mapping is too large." };
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: "The mapping is not valid JSON." };
    }
  }
  if (!Array.isArray(value)) return { ok: false, error: "The mapping must be a list of column choices." };
  if (value.length > MAX_ENTRIES) return { ok: false, error: `A mapping can cover at most ${MAX_ENTRIES} columns.` };

  const out: ColumnMapping = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    const at = `Choice ${i + 1}`;
    if (!isPlainObject(raw)) return { ok: false, error: `${at} is not an object.` };
    const keys = Object.keys(raw);
    const header = raw.header;
    if (typeof header !== "string" || header.length > MAX_STRING) return { ok: false, error: `${at} has no valid column heading.` };
    const hk = normaliseHeader(header);
    if (hk !== "" && seen.has(hk)) return { ok: false, error: `${at}: the column "${header.slice(0, 40)}" appears twice.` };
    seen.add(hk);

    const allowOnly = (allowed: string[]) => keys.every((k) => allowed.includes(k));
    if (raw.action === "ignore") {
      if (!allowOnly(["header", "action"])) return { ok: false, error: `${at} has unexpected fields.` };
      out.push({ header, action: "ignore" });
    } else if (raw.action === "map") {
      if (!allowOnly(["header", "action", "target"])) return { ok: false, error: `${at} has unexpected fields.` };
      if (typeof raw.target !== "string" || raw.target === "" || raw.target.length > MAX_STRING) return { ok: false, error: `${at} has no valid target.` };
      out.push({ header, action: "map", target: raw.target });
    } else if (raw.action === "existing_custom") {
      if (!allowOnly(["header", "action", "fieldId"])) return { ok: false, error: `${at} has unexpected fields.` };
      if (typeof raw.fieldId !== "string" || raw.fieldId === "" || raw.fieldId.length > 100) return { ok: false, error: `${at} has no valid custom field.` };
      out.push({ header, action: "existing_custom", fieldId: raw.fieldId });
    } else if (raw.action === "custom") {
      if (!allowOnly(["header", "action", "label", "type", "options", "shareWithAi"])) return { ok: false, error: `${at} has unexpected fields.` };
      if (typeof raw.label !== "string" || raw.label.length > MAX_STRING) return { ok: false, error: `${at} has no valid field name.` };
      if (typeof raw.type !== "string" || !(CUSTOM_FIELD_TYPES as readonly string[]).includes(raw.type)) return { ok: false, error: `${at} has an unknown field type.` };
      if (typeof raw.shareWithAi !== "boolean") return { ok: false, error: `${at} must say whether the AI may read this field.` };
      let options: string[] | undefined;
      if (raw.options !== undefined) {
        if (raw.type !== "pick_list") return { ok: false, error: `${at}: only a pick-list has choices.` };
        if (!Array.isArray(raw.options) || raw.options.length > MAX_OPTIONS_PARSE || !raw.options.every((o) => typeof o === "string" && o.length <= MAX_STRING)) {
          return { ok: false, error: `${at} has invalid choices.` };
        }
        options = raw.options as string[];
      }
      out.push({ header, action: "custom", label: raw.label, type: raw.type as CustomFieldType, ...(options ? { options } : {}), shareWithAi: raw.shareWithAi });
    } else {
      return { ok: false, error: `${at} has an unknown choice.` };
    }
  }
  return { ok: true, mapping: out };
}
