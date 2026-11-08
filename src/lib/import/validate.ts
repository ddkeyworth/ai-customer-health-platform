// Row-by-row checks for the three CSV imports (customers, support tickets,
// usage). Pure functions: they read parsed rows and return either clean,
// typed rows or a list of exactly which spreadsheet row is wrong and why.
// The import is all or nothing, so one bad row means nothing is imported and
// nobody ends up with half a dataset.
//
// Row numbers in messages are spreadsheet row numbers: the header is row 1, so
// the first data row is row 2.

export const LIMITS = {
  maxBytes: 1_000_000,
  maxCustomers: 500,
  maxCustomersPerWorkspace: 500,
  maxChildRows: 20_000,
  maxChildRowsPerWorkspace: 100_000,
};

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

type Row = Record<string, string>;

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

export function parseMoney(value: string): number | "bad" {
  if (value === "") return 0;
  const cleaned = value.replace(/^[£$€]/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return "bad";
  const n = Number(cleaned);
  return n > 1_000_000_000 ? "bad" : n;
}

function parseWholeNumber(value: string, min: number, max: number): number | null | "bad" {
  if (value === "") return null;
  if (!/^-?\d+$/.test(value)) return "bad";
  const n = Number(value);
  return n < min || n > max ? "bad" : n;
}

function missingHeaders(headers: string[], required: string[]): RowError[] {
  const missing = required.filter((h) => !headers.includes(h));
  return missing.length > 0
    ? [{ row: 1, message: `The file is missing the column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the layout.` }]
    : [];
}

// ---------- customers ----------

export interface ParsedCustomer {
  ref: string | null;
  name: string;
  country: string | null;
  industry: string | null;
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
  championName: string | null;
  championLastEngaged: Date | null;
}

export function validateCustomerRows(
  headers: string[],
  rows: Row[],
  existing: { refs: Set<string>; names: Set<string>; count: number }
): { rows: ParsedCustomer[]; errors: RowError[] } {
  const errors: RowError[] = missingHeaders(headers, ["name"]);
  if (errors.length > 0) return { rows: [], errors };
  if (rows.length === 0) return { rows: [], errors: [{ row: 1, message: "The file has no customer rows." }] };
  if (rows.length > LIMITS.maxCustomers) {
    return { rows: [], errors: [{ row: 1, message: `A file can hold at most ${LIMITS.maxCustomers} customers (this one has ${rows.length}).` }] };
  }
  if (existing.count + rows.length > LIMITS.maxCustomersPerWorkspace) {
    return { rows: [], errors: [{ row: 1, message: `A workspace can hold at most ${LIMITS.maxCustomersPerWorkspace} customers. This one has ${existing.count}.` }] };
  }

  const out: ParsedCustomer[] = [];
  const seenRefs = new Set<string>();
  // A customer with several products takes one row per product: repeat the
  // name with a different product. The first row defines the customer; these
  // remember each name's ref and the products already listed for it.
  const firstRefOf = new Map<string, string | null>();
  const productsOf = new Map<string, Set<string>>();

  rows.forEach((r, idx) => {
    const rowNo = idx + 2;
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const before = errors.length;

    const name = r["name"] ?? "";
    const nameKey = name.toLowerCase();
    const product = (r["product"] ?? "") === "" ? "Core product" : r["product"];
    const isRepeat = productsOf.has(nameKey);
    if (name === "" || name.length > 120) fail("name is required and must be 120 characters or fewer.");
    else if (existing.names.has(nameKey)) fail(`the customer "${name}" already exists in this workspace.`);
    else if (isRepeat) {
      const products = productsOf.get(nameKey)!;
      if (products.has(product.toLowerCase())) fail(`"${name}" is listed twice for the product "${product}". To give a customer a second product, repeat the name on a new row with a different product.`);
      else products.add(product.toLowerCase());
    } else {
      productsOf.set(nameKey, new Set([product.toLowerCase()]));
    }

    let ref: string | null = (r["ref"] ?? "") === "" ? null : r["ref"];
    if (isRepeat) {
      const firstRef = firstRefOf.get(nameKey) ?? null;
      if (ref !== null && ref.toLowerCase() !== (firstRef ?? "").toLowerCase()) fail(`the second row for "${name}" must leave ref blank or repeat the same ref.`);
      ref = firstRef;
    } else if (ref !== null) {
      if (!/^[A-Za-z0-9-]{1,20}$/.test(ref)) fail("ref may only contain letters, numbers and hyphens, up to 20 characters.");
      else if (seenRefs.has(ref.toLowerCase()) || existing.refs.has(ref.toLowerCase())) fail(`the ref "${ref}" appears more than once or already exists.`);
      else seenRefs.add(ref.toLowerCase());
    }
    if (ref !== null && errors.length > before) ref = null;
    if (!isRepeat) firstRefOf.set(nameKey, ref);

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
    if (contractual === "bad") fail("contractual_arr must be a plain amount such as 48000 (no more than 2 decimals).");
    if (consumption === "bad") fail("consumption_arr must be a plain amount such as 12000 (no more than 2 decimals).");

    const renewalDate = parseDate(r["renewal_date"] ?? "");
    const expectedGoLive = parseDate(r["expected_go_live_date"] ?? "");
    const goLive = parseDate(r["go_live_date"] ?? "");
    const champDate = parseDate(r["champion_last_engaged"] ?? "");
    for (const [label, v] of [["renewal_date", renewalDate], ["expected_go_live_date", expectedGoLive], ["go_live_date", goLive], ["champion_last_engaged", champDate]] as const) {
      if (v === "bad") fail(`${label} must be a real date written as YYYY-MM-DD, for example 2026-03-31.`);
    }

    const daysPastDue = parseWholeNumber(r["days_past_due"] ?? "", 0, 3650);
    if (daysPastDue === "bad") fail("days_past_due must be a whole number from 0 to 3650.");
    const nps = parseWholeNumber(r["nps"] ?? "", 0, 10);
    if (nps === "bad") fail("nps must be a whole number from 0 to 10.");

    if (product.length > 80) fail("product must be 80 characters or fewer.");
    const championName = (r["champion_name"] ?? "") === "" ? null : r["champion_name"];
    if (championName !== null && championName.length > 120) fail("champion_name must be 120 characters or fewer.");
    for (const f of ["country", "industry"] as const) if ((r[f] ?? "").length > 80) fail(`${f} must be 80 characters or fewer.`);

    if (errors.length > before) return;
    out.push({
      ref,
      name,
      country: r["country"] || null,
      industry: r["industry"] || null,
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
      championName,
      championLastEngaged: champDate as Date | null,
    });
  });

  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}

// ---------- shared by tickets and usage ----------

// Matches a row's "customer" cell to a customer already in the workspace, by
// ref (CUS-0001) or by exact name, ignoring case.
export function resolveCustomer(value: string, lookup: Map<string, string>): string | null {
  return lookup.get(value.toLowerCase()) ?? null;
}

// ---------- support tickets ----------

export interface ParsedInteraction {
  customerId: string;
  type: (typeof INTERACTION_TYPES)[number];
  severity: (typeof SEVERITIES)[number];
  occurredAt: Date;
  text: string;
}

export function validateInteractionRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number
): { rows: ParsedInteraction[]; errors: RowError[] } {
  const errors: RowError[] = missingHeaders(headers, ["customer", "date", "text"]);
  if (errors.length > 0) return { rows: [], errors };
  if (rows.length === 0) return { rows: [], errors: [{ row: 1, message: "The file has no rows." }] };
  if (rows.length > LIMITS.maxChildRows || existingCount + rows.length > LIMITS.maxChildRowsPerWorkspace) {
    return { rows: [], errors: [{ row: 1, message: `A file can hold at most ${LIMITS.maxChildRows} rows, and a workspace ${LIMITS.maxChildRowsPerWorkspace} tickets in total.` }] };
  }
  const out: ParsedInteraction[] = [];
  rows.forEach((r, idx) => {
    const rowNo = idx + 2;
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: `customer "${r["customer"] ?? ""}" is not in this workspace. Use a customer's ref or exact name from the customers file.` });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: "date is required and must be written as YYYY-MM-DD." });
    const type = pickEnum(r["type"] ?? "", INTERACTION_TYPES, "ticket", "type");
    const severity = pickEnum(r["severity"] ?? "", SEVERITIES, "low", "severity");
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
  capability: string;
  metricType: (typeof METRIC_TYPES)[number];
  occurredAt: Date;
  value: number;
}

export function validateUsageRows(
  headers: string[],
  rows: Row[],
  lookup: Map<string, string>,
  existingCount: number
): { rows: ParsedUsage[]; errors: RowError[] } {
  const errors: RowError[] = missingHeaders(headers, ["customer", "capability", "date", "value"]);
  if (errors.length > 0) return { rows: [], errors };
  if (rows.length === 0) return { rows: [], errors: [{ row: 1, message: "The file has no rows." }] };
  if (rows.length > LIMITS.maxChildRows || existingCount + rows.length > LIMITS.maxChildRowsPerWorkspace) {
    return { rows: [], errors: [{ row: 1, message: `A file can hold at most ${LIMITS.maxChildRows} rows, and a workspace ${LIMITS.maxChildRowsPerWorkspace} usage readings in total.` }] };
  }
  const out: ParsedUsage[] = [];
  rows.forEach((r, idx) => {
    const rowNo = idx + 2;
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: `customer "${r["customer"] ?? ""}" is not in this workspace. Use a customer's ref or exact name from the customers file.` });
    const capability = r["capability"] ?? "";
    if (capability === "" || capability.length > 80) errors.push({ row: rowNo, message: "capability is required (the feature or metric name) and must be 80 characters or fewer." });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: "date is required and must be written as YYYY-MM-DD." });
    const metric = pickEnum(r["metric_type"] ?? "", METRIC_TYPES, "adoption", "metric_type");
    if (typeof metric === "string" && metric.includes("must be one of")) errors.push({ row: rowNo, message: metric });
    const value = r["value"] ?? "";
    if (!/^\d+(\.\d+)?$/.test(value) || Number(value) > 1e12) errors.push({ row: rowNo, message: "value must be a plain number, zero or more." });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, capability, metricType: metric as ParsedUsage["metricType"], occurredAt: date as Date, value: Number(value) });
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
  existingCount: number
): { rows: ParsedOutcome[]; errors: RowError[] } {
  const errors: RowError[] = missingHeaders(headers, ["customer", "date", "type"]);
  if (errors.length > 0) return { rows: [], errors };
  if (rows.length === 0) return { rows: [], errors: [{ row: 1, message: "The file has no rows." }] };
  if (rows.length > LIMITS.maxChildRows || existingCount + rows.length > LIMITS.maxChildRowsPerWorkspace) {
    return { rows: [], errors: [{ row: 1, message: `A file can hold at most ${LIMITS.maxChildRows} rows, and a workspace ${LIMITS.maxChildRowsPerWorkspace} outcomes in total.` }] };
  }
  const out: ParsedOutcome[] = [];
  rows.forEach((r, idx) => {
    const rowNo = idx + 2;
    const before = errors.length;
    const customerId = resolveCustomer(r["customer"] ?? "", lookup);
    if (!customerId) errors.push({ row: rowNo, message: `customer "${r["customer"] ?? ""}" is not in this workspace. Use a customer's ref or exact name from the customers file.` });
    const date = parseDate(r["date"] ?? "");
    if (date === null || date === "bad") errors.push({ row: rowNo, message: "date is required and must be written as YYYY-MM-DD." });
    const type = (r["type"] ?? "").toLowerCase();
    if (!(OUTCOME_TYPES as readonly string[]).includes(type)) errors.push({ row: rowNo, message: `type must be one of: ${OUTCOME_TYPES.join(", ")}` });
    const notes = r["notes"] ?? "";
    if (notes.length > 500) errors.push({ row: rowNo, message: "notes must be 500 characters or fewer." });
    if (errors.length > before) return;
    out.push({ customerId: customerId!, type: type as ParsedOutcome["type"], occurredAt: date as Date, notes: notes === "" ? null : notes });
  });
  return errors.length > 0 ? { rows: [], errors } : { rows: out, errors: [] };
}
