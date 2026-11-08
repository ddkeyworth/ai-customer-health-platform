// Row-by-row checks for every CSV import (customers, support tickets, usage,
// outcome history, stakeholders, goals, training, events and surveys). Pure
// functions: they read parsed rows and return either clean, typed rows or a
// list of exactly which row of the file is wrong and why. The import is all or
// nothing, so one bad row means nothing is imported and nobody ends up with
// half a dataset.
//
// Row numbers in messages are the physical line of the file the row starts on
// (the header is row 1; blank lines count). The parser supplies them as
// `lines`; without it the first data row is row 2.
import { isSelfHosted } from "@/lib/deployment";

export const IMPORT_KINDS = [
  "customers",
  "tickets",
  "usage",
  "outcomes",
  "stakeholders",
  "goals",
  "training",
  "events",
  "surveys",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

// The largest values, which a self-hosted copy uses. The owner's hosted site
// uses activeLimits(), which is much lower for rows and capabilities because it
// runs on a free database that any visitor can sign up to.
export const LIMITS = {
  maxBytes: 1_000_000,
  maxCustomers: 500,
  maxCustomersPerWorkspace: 500,
  maxChildRows: 20_000,
  maxChildRowsPerWorkspace: 100_000,
  maxCapabilitiesPerWorkspace: 1_000,
  maxNewCapabilitiesPerFile: 200,
};

export function activeLimits() {
  if (isSelfHosted()) return { ...LIMITS };
  return {
    ...LIMITS,
    maxChildRowsPerWorkspace: 2_000,
    maxCapabilitiesPerWorkspace: 50,
    maxNewCapabilitiesPerFile: 50,
  };
}

export interface RowError {
  row: number;
  message: string;
}

export const TIERS = ["self_serve", "mid_market", "enterprise"] as const;
export const RENEWAL_TYPES = ["auto", "interrupted"] as const;
export const INTERRUPTED_REASONS = ["customer_requested", "contract_defined", "company_defined"] as const;
export const LIFECYCLES = ["onboarding", "live", "churned"] as const;
export const PAYMENT_STATUSES = ["current", "late", "failed"] as const;
export const INTERACTION_TYPES = ["ticket", "call", "email"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const METRIC_TYPES = ["adoption", "consumption"] as const;
export const OUTCOME_TYPES = ["renewed", "churned", "expanded"] as const;
export const SURVEY_TYPES = ["nps", "csat", "ces"] as const;

type Row = Record<string, string>;

// ---------- the columns each file knows ----------
// Anything else in a file is reported as ignored, so a misspelt header such as
// "Contractual ARR" is never silent. The Health columns on the customers file
// are written by the export and are known so a round trip does not warn.
export const KNOWN_COLUMNS: Record<ImportKind, string[]> = {
  customers: [
    "ref", "name", "country", "industry", "region", "city", "sub_industry", "tier", "product", "lifecycle_status",
    "contractual_arr", "consumption_arr", "renewal_date", "expected_go_live_date", "go_live_date", "payment_status",
    "days_past_due", "renewal_type", "interrupted_reason", "nps", "nps_date", "champion_name", "champion_last_engaged",
    "health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative",
  ],
  tickets: ["customer", "date", "type", "severity", "text"],
  usage: ["customer", "product", "capability", "metric_type", "date", "value"],
  outcomes: ["customer", "date", "type", "notes"],
  stakeholders: ["customer", "name", "role", "is_champion", "last_engaged_date"],
  goals: ["customer", "name", "target_value", "actual_value", "unit"],
  training: ["customer", "course", "attendees", "date"],
  events: ["customer", "event", "date"],
  surveys: ["customer", "type", "score", "date"],
};

// "Renewal Date", "renewal-date" and "renewal_date" all mean the same column.
// A header that is not known as written, but is known once spaces and hyphens
// become underscores, is renamed (unless that would clash with a column that is
// already there). Returns the renamed rows and which columns were renamed.
export function canonicaliseHeaders(
  kind: ImportKind,
  headers: string[],
  rows: Row[]
): { headers: string[]; rows: Row[]; renamed: [string, string][] } {
  const known = new Set(KNOWN_COLUMNS[kind]);
  const present = new Set(headers);
  const renames = new Map<string, string>();
  for (const h of headers) {
    if (h === "" || known.has(h)) continue;
    const candidate = h.replace(/[\s-]+/g, "_");
    if (known.has(candidate) && !present.has(candidate) && ![...renames.values()].includes(candidate)) renames.set(h, candidate);
  }
  if (renames.size === 0) return { headers, rows, renamed: [] };
  const newRows = rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[renames.get(k) ?? k] = v;
    return out;
  });
  return { headers: headers.map((h) => renames.get(h) ?? h), rows: newRows, renamed: [...renames.entries()] };
}

export function ignoredColumns(kind: ImportKind, headers: string[]): string[] {
  const known = new Set(KNOWN_COLUMNS[kind]);
  return headers.filter((h) => h !== "" && !known.has(h));
}

// ---------- small parsers ----------

// Names are compared and stored with spaces collapsed and accents composed, so
// "Acme  Ltd" and "Acme Ltd", or "Zürich" and "Zürich", are one customer.
export function normaliseName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}
export const nameKey = (value: string): string => normaliseName(value).toLowerCase();

function pickEnum<T extends string>(value: string, allowed: readonly T[], fallback: T | null, field: string): T | null | string {
  if (value === "") return fallback;
  const v = value.toLowerCase().replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(v) ? (v as T) : `${field} must be one of: ${allowed.join(", ")}`;
}

export function parseDate(value: string): Date | null | "bad" {
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "bad";
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return "bad";
  const year = d.getUTCFullYear();
  return year < 1990 || year > 2100 ? "bad" : d;
}

// Amounts: digits with up to 2 decimals, optionally with a leading currency sign
// and thousands commas. Commas are accepted ONLY in correct groups of three
// (1,200 and 1,200.50), because "1,50" or "48,00" is a European decimal comma
// and reading it as 150 or 4800 would silently corrupt the data.
export function parseMoney(value: string): number | "bad" {
  if (value === "") return 0;
  const cleaned = value.replace(/^[£$€]/, "");
  const ok = /^\d+(\.\d{1,2})?$/.test(cleaned) || /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(cleaned);
  if (!ok) return "bad";
  const n = Number(cleaned.replace(/,/g, ""));
  return n > 1_000_000_000 ? "bad" : n;
}
const MONEY_HELP = "a plain amount such as 48000 or 48,000 (commas only as thousands separators, no more than 2 decimals)";

function parseWholeNumber(value: string, min: number, max: number): number | null | "bad" {
  if (value === "") return null;
  if (!/^-?\d+$/.test(value)) return "bad";
  const n = Number(value);
  return n < min || n > max ? "bad" : n;
}

// A non-negative decimal (for goal values). Up to 6 decimals, bounded.
function parseDecimal(value: string): number | null | "bad" {
  if (value === "") return null;
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return "bad";
  const n = Number(value);
  return n > 1e12 ? "bad" : n;
}

function parseYesNo(value: string): boolean | "bad" {
  const v = value.trim().toLowerCase();
  if (v === "" || ["no", "n", "false", "0"].includes(v)) return false;
  if (["yes", "y", "true", "1"].includes(v)) return true;
  return "bad";
}

function missingHeaders(headers: string[], required: string[]): RowError[] {
  const missing = required.filter((h) => !headers.includes(h));
  return missing.length > 0
    ? [{ row: 1, message: `The file is missing the column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the layout.` }]
    : [];
}

const lineOf = (lines: number[] | undefined, idx: number) => lines?.[idx] ?? idx + 2;

// The shared opening checks for every file that hangs off customers.
function childStart(
  headers: string[],
  rows: Row[],
  required: string[],
  existingCount: number,
  noun: string
): RowError[] | null {
  const errors = missingHeaders(headers, required);
  if (errors.length > 0) return errors;
  if (rows.length === 0) return [{ row: 1, message: "The file has no rows." }];
  const limits = activeLimits();
  if (rows.length > limits.maxChildRows || existingCount + rows.length > limits.maxChildRowsPerWorkspace) {
    return [{ row: 1, message: `A file can hold at most ${limits.maxChildRows} rows, and a workspace ${limits.maxChildRowsPerWorkspace} ${noun} in total.` }];
  }
  return null;
}

// ---------- customers ----------

export interface ParsedCustomer {
  ref: string | null;
  name: string;
  country: string | null;
  industry: string | null;
  region: string | null;
  city: string | null;
  subIndustry: string | null;
  tier: (typeof TIERS)[number];
  renewalType: (typeof RENEWAL_TYPES)[number];
  interruptedReason: (typeof INTERRUPTED_REASONS)[number] | null;
  product: string;
  lifecycleStatus: (typeof LIFECYCLES)[number];
  contractualArr: number;
  consumptionArr: number;
  renewalDate: Date | null;
  expectedGoLiveDate: Date | null;
  goLiveDate: Date | null;
  paymentStatus: (typeof PAYMENT_STATUSES)[number];
  daysPastDue: number;
  nps: number | null;
  npsDate: Date | null;
  championName: string | null;
  championLastEngaged: Date | null;
}

// Fields that belong to the customer rather than to one product. The first row
// for a customer defines them; a later row (another product for the same
// customer) may leave them blank or repeat them exactly, and is refused if it
// says something different.
const CUSTOMER_LEVEL = [
  "country", "industry", "region", "city", "sub_industry", "tier", "renewal_type", "interrupted_reason",
  "nps", "nps_date", "champion_name", "champion_last_engaged",
] as const;

export function validateCustomerRows(
  headers: string[],
  rows: Row[],
  existing: { refs: Set<string>; names: Set<string>; count: number },
  lines?: number[]
): { rows: ParsedCustomer[]; errors: RowError[] } {
  const limits = activeLimits();
  const errors: RowError[] = missingHeaders(headers, ["name"]);
  if (errors.length > 0) return { rows: [], errors };
  if (rows.length === 0) return { rows: [], errors: [{ row: 1, message: "The file has no customer rows." }] };
  if (rows.length > limits.maxCustomers) {
    return { rows: [], errors: [{ row: 1, message: `A file can hold at most ${limits.maxCustomers} customers (this one has ${rows.length}).` }] };
  }
  if (existing.count + rows.length > limits.maxCustomersPerWorkspace) {
    return { rows: [], errors: [{ row: 1, message: `A workspace can hold at most ${limits.maxCustomersPerWorkspace} customers. This one has ${existing.count}.` }] };
  }

  const out: ParsedCustomer[] = [];
  const seenRefs = new Set<string>();
  // A customer with several products takes one row per product: repeat the
  // name with a different product. The first row defines the customer; these
  // remember each name's ref, products and customer-level values.
  const firstRefOf = new Map<string, string | null>();
  const productsOf = new Map<string, Set<string>>();
  const firstValuesOf = new Map<string, Record<string, string>>();

  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const before = errors.length;
    const blank = (k: string) => (r[k] ?? "") === "";

    const name = normaliseName(r["name"] ?? "");
    const key = name.toLowerCase();
    const product = blank("product") ? "Core product" : normaliseName(r["product"]);
    const isRepeat = productsOf.has(key);
    if (name === "" || name.length > 120) fail("name is required and must be 120 characters or fewer.");
    else if (existing.names.has(key)) fail(`the customer "${name}" already exists in this workspace.`);
    else if (isRepeat) {
      const products = productsOf.get(key)!;
      if (products.has(product.toLowerCase())) fail(`"${name}" is listed twice for the product "${product}". To give a customer a second product, repeat the name on a new row with a different product.`);
      else products.add(product.toLowerCase());
    } else {
      productsOf.set(key, new Set([product.toLowerCase()]));
    }

    let ref: string | null = blank("ref") ? null : r["ref"];
    if (isRepeat) {
      const firstRef = firstRefOf.get(key) ?? null;
      if (ref !== null && ref.toLowerCase() !== (firstRef ?? "").toLowerCase()) fail(`the second row for "${name}" must leave ref blank or repeat the same ref.`);
      ref = firstRef;
    } else if (ref !== null) {
      if (!/^[A-Za-z0-9-]{1,20}$/.test(ref)) fail("ref may only contain letters, numbers and hyphens, up to 20 characters.");
      else if (seenRefs.has(ref.toLowerCase()) || existing.refs.has(ref.toLowerCase())) fail(`the ref "${ref}" appears more than once or already exists.`);
      else seenRefs.add(ref.toLowerCase());
    }
    if (ref !== null && errors.length > before) ref = null;
    if (!isRepeat) firstRefOf.set(key, ref);

    const tier = pickEnum(r["tier"] ?? "", TIERS, "mid_market", "tier");
    const renewalType = pickEnum(r["renewal_type"] ?? "", RENEWAL_TYPES, "auto", "renewal_type");
    const reason = pickEnum(r["interrupted_reason"] ?? "", INTERRUPTED_REASONS, null, "interrupted_reason");
    const lifecycle = pickEnum(r["lifecycle_status"] ?? "", LIFECYCLES, "live", "lifecycle_status");
    const payment = pickEnum(r["payment_status"] ?? "", PAYMENT_STATUSES, "current", "payment_status");
    for (const v of [tier, renewalType, reason, lifecycle, payment]) {
      if (typeof v === "string" && !(TIERS as readonly string[]).concat(RENEWAL_TYPES, INTERRUPTED_REASONS, LIFECYCLES, PAYMENT_STATUSES).includes(v)) fail(v);
    }

    const contractual = parseMoney(r["contractual_arr"] ?? "");
    const consumption = parseMoney(r["consumption_arr"] ?? "");
    if (contractual === "bad") fail(`contractual_arr must be ${MONEY_HELP}.`);
    if (consumption === "bad") fail(`consumption_arr must be ${MONEY_HELP}.`);

    const renewalDate = parseDate(r["renewal_date"] ?? "");
    const expectedGoLive = parseDate(r["expected_go_live_date"] ?? "");
    const goLive = parseDate(r["go_live_date"] ?? "");
    const champDate = parseDate(r["champion_last_engaged"] ?? "");
    const npsDate = parseDate(r["nps_date"] ?? "");
    for (const [label, v] of [["renewal_date", renewalDate], ["expected_go_live_date", expectedGoLive], ["go_live_date", goLive], ["champion_last_engaged", champDate], ["nps_date", npsDate]] as const) {
      if (v === "bad") fail(`${label} must be a real date written as YYYY-MM-DD, for example 2026-03-31.`);
    }

    const daysPastDue = parseWholeNumber(r["days_past_due"] ?? "", 0, 3650);
    if (daysPastDue === "bad") fail("days_past_due must be a whole number from 0 to 3650.");
    const nps = parseWholeNumber(r["nps"] ?? "", 0, 10);
    if (nps === "bad") fail("nps must be a whole number from 0 to 10.");
    if (nps === null && !blank("nps_date")) fail("nps_date needs an nps score on the same row.");

    if (product.length > 80) fail("product must be 80 characters or fewer.");
    const championName = blank("champion_name") ? null : normaliseName(r["champion_name"]);
    if (championName !== null && championName.length > 120) fail("champion_name must be 120 characters or fewer.");
    const text = (k: string) => (blank(k) ? null : normaliseName(r[k]));
    for (const f of ["country", "industry", "region", "city", "sub_industry"] as const) if ((text(f) ?? "").length > 80) fail(`${f} must be 80 characters or fewer.`);

    // Customer-level values on a repeat row must not contradict the first row.
    const iso = (d: Date | null | "bad") => (d instanceof Date ? d.toISOString().slice(0, 10) : "");
    const effective: Record<string, string> = {
      country: (text("country") ?? "").toLowerCase(),
      industry: (text("industry") ?? "").toLowerCase(),
      region: (text("region") ?? "").toLowerCase(),
      city: (text("city") ?? "").toLowerCase(),
      sub_industry: (text("sub_industry") ?? "").toLowerCase(),
      tier: String(tier),
      renewal_type: String(renewalType),
      interrupted_reason: renewalType === "interrupted" ? String(reason ?? "customer_requested") : "",
      nps: typeof nps === "number" ? String(nps) : "",
      nps_date: iso(npsDate),
      champion_name: (championName ?? "").toLowerCase(),
      champion_last_engaged: iso(champDate),
    };
    if (isRepeat) {
      const first = firstValuesOf.get(key);
      if (first) {
        for (const f of CUSTOMER_LEVEL) {
          if (blank(f)) continue;
          // What this row claims. An interrupted reason is only meaningful on an
          // interrupted renewal, so a stated reason is compared as written: it
          // may not contradict the first row, and it may not be added to a
          // renewal the first row says is automatic.
          const claim = f === "interrupted_reason" ? String(reason) : effective[f];
          if (claim !== first[f]) {
            fail(`the second row for "${name}" gives a different ${f} (${r[f]}) from its first row. Customer-level values belong on the first row: leave ${f} blank here or repeat it exactly.`);
          }
        }
      }
    } else {
      firstValuesOf.set(key, effective);
    }

    if (errors.length > before) return;
    out.push({
      ref,
      name,
      country: text("country"),
      industry: text("industry"),
      region: text("region"),
      city: text("city"),
      subIndustry: text("sub_industry"),
      tier: tier as ParsedCustomer["tier"],
      renewalType: renewalType as ParsedCustomer["renewalType"],
      interruptedReason: renewalType === "interrupted" ? ((reason as ParsedCustomer["interruptedReason"]) ?? "customer_requested") : null,
      product,
      lifecycleStatus: lifecycle as ParsedCustomer["lifecycleStatus"],
      contractualArr: contractual as number,
      consumptionArr: consumption as number,
      renewalDate: renewalDate as Date | null,
      expectedGoLiveDate: expectedGoLive as Date | null,
      goLiveDate: goLive as Date | null,
      paymentStatus: payment as ParsedCustomer["paymentStatus"],
      daysPastDue: payment === "current" ? 0 : ((daysPastDue as number | null) ?? 0),
      nps: nps as number | null,
      npsDate: npsDate as Date | null,
      championName,
      championLastEngaged: champDate as Date | null,
    });
  });

  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- shared by every file that hangs off customers ----------

// Matches a row's "customer" cell to a customer already in the workspace, by
// ref (CUS-0001) or by exact name, ignoring case, extra spaces and accent form.
// The lookup's keys are built the same way (see importData.ts).
export function resolveCustomer(value: string, lookup: Map<string, string>): string | null {
  return lookup.get(nameKey(value)) ?? null;
}

const unknownCustomer = (value: string | undefined) =>
  `customer "${value ?? ""}" is not in this workspace. Use a customer's ref or exact name from the customers file.`;
const DATE_HELP = "must be written as YYYY-MM-DD.";

// ---------- support tickets ----------

export interface ParsedInteraction {
  customerId: string;
  type: (typeof INTERACTION_TYPES)[number];
  // Left blank in the file means "not recorded" (null), not "low".
  severity: (typeof SEVERITIES)[number] | null;
  occurredAt: Date;
  text: string;
}

export function validateInteractionRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedInteraction[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "date", "text"], existingCount, "tickets");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedInteraction[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    const type = pickEnum(r["type"] ?? "", INTERACTION_TYPES, "ticket", "type");
    const severity = pickEnum(r["severity"] ?? "", SEVERITIES, null, "severity");
    for (const v of [type, severity]) if (typeof v === "string" && v.includes("must be one of")) errors.push({ row: rowNo, message: v });
    const text = r["text"] ?? "";
    if (text === "" || text.length > 2000) errors.push({ row: rowNo, message: "text is required and must be 2000 characters or fewer." });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, type: type as ParsedInteraction["type"], severity: severity as ParsedInteraction["severity"], occurredAt: date as Date, text });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- usage ----------

export interface ParsedUsage {
  customerId: string;
  // The product the capability belongs to; blank means the customer's first product.
  product: string | null;
  capability: string;
  metricType: (typeof METRIC_TYPES)[number];
  // True when the file said which kind of metric this is (rather than the default).
  metricExplicit: boolean;
  occurredAt: Date;
  value: number;
}

export function validateUsageRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedUsage[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "capability", "date", "value"], existingCount, "usage readings");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedUsage[] = [];
  // The same capability must not be given two different metric types in one file.
  const metricOf = new Map<string, string>();
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const capability = normaliseName(r["capability"] ?? "");
    if (capability === "" || capability.length > 80) errors.push({ row: rowNo, message: "capability is required (the feature or metric name) and must be 80 characters or fewer." });
    const product = (r["product"] ?? "") === "" ? null : normaliseName(r["product"]);
    if (product !== null && product.length > 80) errors.push({ row: rowNo, message: "product must be 80 characters or fewer." });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    const metric = pickEnum(r["metric_type"] ?? "", METRIC_TYPES, "adoption", "metric_type");
    if (typeof metric === "string" && metric.includes("must be one of")) errors.push({ row: rowNo, message: metric });
    const explicit = (r["metric_type"] ?? "") !== "";
    const value = r["value"] ?? "";
    if (!/^\d+(\.\d+)?$/.test(value) || Number(value) > 1e12) errors.push({ row: rowNo, message: "value must be a plain number, zero or more." });
    if (explicit && (METRIC_TYPES as readonly string[]).includes(metric as string) && customerId) {
      const k = `${(product ?? "").toLowerCase()}|${capability.toLowerCase()}`;
      const seen = metricOf.get(k);
      if (seen && seen !== metric) errors.push({ row: rowNo, message: `the capability "${capability}" is given two different metric types in this file (${seen} and ${metric}).` });
      else metricOf.set(k, metric as string);
    }
    if (errors.length > before) return;
    out.push({
      customerId: customerId!,
      product,
      capability,
      metricType: metric as ParsedUsage["metricType"],
      metricExplicit: explicit,
      occurredAt: date as Date,
      value: Number(value),
    });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- outcome history (renewed, churned, expanded) ----------
// This history is what the churn model and the Calibration page learn from.

export interface ParsedOutcome {
  customerId: string;
  type: (typeof OUTCOME_TYPES)[number];
  occurredAt: Date;
  notes: string | null;
}

export function validateOutcomeRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedOutcome[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "date", "type"], existingCount, "outcomes");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedOutcome[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    const type = (r["type"] ?? "").toLowerCase();
    if (!(OUTCOME_TYPES as readonly string[]).includes(type)) errors.push({ row: rowNo, message: `type must be one of: ${OUTCOME_TYPES.join(", ")}` });
    const notes = r["notes"] ?? "";
    if (notes.length > 500) errors.push({ row: rowNo, message: "notes must be 500 characters or fewer." });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, type: type as ParsedOutcome["type"], occurredAt: date as Date, notes: notes === "" ? null : notes });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- stakeholders ----------
// People at the customer. Health's champion engagement reads these. A person is
// identified by customer plus name: the importer skips anyone who already
// exists, including a champion created from the customers file.

export interface ParsedStakeholder {
  customerId: string;
  name: string;
  role: string;
  isChampion: boolean;
  lastEngagedAt: Date | null;
}

export function validateStakeholderRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedStakeholder[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "name"], existingCount, "stakeholders");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedStakeholder[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const name = normaliseName(r["name"] ?? "");
    if (name === "" || name.length > 120) errors.push({ row: rowNo, message: "name is required and must be 120 characters or fewer." });
    const role = (r["role"] ?? "") === "" ? "Contact" : normaliseName(r["role"]);
    if (role.length > 80) errors.push({ row: rowNo, message: "role must be 80 characters or fewer." });
    const champion = parseYesNo(r["is_champion"] ?? "");
    if (champion === "bad") errors.push({ row: rowNo, message: "is_champion must be yes or no." });
    const engaged = parseDate(r["last_engaged_date"] ?? "");
    if (engaged === "bad") errors.push({ row: rowNo, message: `last_engaged_date ${DATE_HELP}` });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, name, role, isChampion: champion as boolean, lastEngagedAt: engaged as Date | null });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- goals (desired outcomes) ----------
// What the customer bought the product to achieve, and how far along they are.
// Health's desired-outcome driver reads these. Identified by customer plus name.

export interface ParsedGoal {
  customerId: string;
  name: string;
  targetValue: number;
  actualValue: number;
  unit: string;
}

export function validateGoalRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedGoal[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "name", "target_value"], existingCount, "goals");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedGoal[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const name = normaliseName(r["name"] ?? "");
    if (name === "" || name.length > 120) errors.push({ row: rowNo, message: "name is required (what the customer wants to achieve) and must be 120 characters or fewer." });
    const target = parseDecimal(r["target_value"] ?? "");
    if (target === null || target === "bad" || target <= 0) errors.push({ row: rowNo, message: "target_value is required and must be a number greater than zero." });
    const actual = parseDecimal(r["actual_value"] ?? "");
    if (actual === "bad") errors.push({ row: rowNo, message: "actual_value must be a number, zero or more." });
    const unit = (r["unit"] ?? "") === "" ? "units" : normaliseName(r["unit"]);
    if (unit.length > 40) errors.push({ row: rowNo, message: "unit must be 40 characters or fewer." });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, name, targetValue: target as number, actualValue: (actual as number | null) ?? 0, unit });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- training ----------

export interface ParsedTraining {
  customerId: string;
  courseName: string;
  attendeeCount: number;
  occurredAt: Date;
}

export function validateTrainingRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedTraining[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "course", "date"], existingCount, "training sessions");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedTraining[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const course = normaliseName(r["course"] ?? "");
    if (course === "" || course.length > 120) errors.push({ row: rowNo, message: "course is required and must be 120 characters or fewer." });
    const attendees = parseWholeNumber(r["attendees"] ?? "", 1, 100_000);
    if (attendees === "bad") errors.push({ row: rowNo, message: "attendees must be a whole number from 1 to 100000." });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, courseName: course, attendeeCount: (attendees as number | null) ?? 1, occurredAt: date as Date });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- events ----------

export interface ParsedEvent {
  customerId: string;
  eventName: string;
  occurredAt: Date;
}

export function validateEventRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedEvent[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "event", "date"], existingCount, "event attendances");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedEvent[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const event = normaliseName(r["event"] ?? "");
    if (event === "" || event.length > 120) errors.push({ row: rowNo, message: "event is required and must be 120 characters or fewer." });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, eventName: event, occurredAt: date as Date });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- surveys (NPS, CSAT, CES) ----------
// Scores are whole numbers from 0 to 10 for every type. Health reads NPS only;
// the others are kept for the record.

export interface ParsedSurvey {
  customerId: string;
  type: (typeof SURVEY_TYPES)[number];
  score: number;
  occurredAt: Date;
}

export function validateSurveyRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number,
  lines?: number[]
): { rows: ParsedSurvey[]; errors: RowError[] } {
  const early = childStart(headers, rows, ["customer", "type", "score", "date"], existingCount, "survey responses");
  if (early) return { rows: [], errors: early };
  const errors: RowError[] = [];
  const out: ParsedSurvey[] = [];
  rows.forEach((r, idx) => {
    const rowNo = lineOf(lines, idx);
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: unknownCustomer(r["customer"]) });
    const type = (r["type"] ?? "").toLowerCase();
    if (!(SURVEY_TYPES as readonly string[]).includes(type)) errors.push({ row: rowNo, message: `type must be one of: ${SURVEY_TYPES.join(", ")}` });
    const score = parseWholeNumber(r["score"] ?? "", 0, 10);
    if (score === null || score === "bad") errors.push({ row: rowNo, message: "score is required and must be a whole number from 0 to 10." });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: `date is required and ${DATE_HELP}` });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, type: type as ParsedSurvey["type"], score: score as number, occurredAt: date as Date });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}
