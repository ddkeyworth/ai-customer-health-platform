// Writes a validated CSV import into one workspace. All or nothing: every row
// is checked first, and the whole import runs in one database transaction, so
// a failure part way leaves the workspace exactly as it was. Any refusal that is
// found after something has been written (for example a usage row whose
// customer has no product) is thrown as a Refusal, which rolls the transaction
// back; nothing is ever committed and then reported as "not imported".
//
// Everything is scoped to the workspace id passed in. Imports for the same
// workspace are serialised with a database lock, so two uploads at once cannot
// both pass the "does this customer already exist" check.
//
// Re-importing the same file does not double your data: rows that already exist
// (or that appear twice in the file) are skipped and counted in the result.
//
// What the round trip does NOT carry (stated so nobody is surprised):
//  - a customer with no product link gets a "Core product" link when its row is
//    imported again;
//  - only the first champion is written on the customers file (the stakeholders
//    file carries everyone);
//  - Health snapshots, AI recommendations and opportunities are results, not
//    inputs, and are not importable.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCsv, headerProblems } from "./csv";
import { coerceCustomValue, type CustomFieldType } from "./customFields";
import { applyMapping, mappingSignature, normaliseHeader, parseColumnMapping, validateMapping, type AppliedMapping, type ColumnMapping } from "./mapping";
import { mappingToSave, saveMapping } from "./savedMappings";
import { CustomFieldError, createCustomField, listCustomFields, type CustomFieldDef } from "@/lib/customFields/store";
import {
  IMPORT_KINDS,
  LIMITS,
  activeLimits,
  canonicaliseHeaders,
  ignoredColumns,
  nameKey,
  validateCustomerRows,
  validateEventRows,
  validateGoalRows,
  validateInteractionRows,
  validateOutcomeRows,
  validateStakeholderRows,
  validateSurveyRows,
  validateTrainingRows,
  validateUsageRows,
  type ImportKind,
  type ParsedEvent,
  type ParsedGoal,
  type ParsedInteraction,
  type ParsedOutcome,
  type ParsedStakeholder,
  type ParsedSurvey,
  type ParsedTraining,
  type ParsedUsage,
  type RowError,
} from "./validate";

export type { ImportKind };
export { IMPORT_KINDS };

export interface ImportResult {
  ok: boolean;
  imported: number;
  errors: RowError[];
  message: string;
}

const NOTHING = "Nothing was imported.";
const fail = (errors: RowError[], note = "", message = `${NOTHING} Fix the rows below and upload the file again.`): ImportResult => ({
  ok: false,
  imported: 0,
  errors,
  message: message + note,
});

// Thrown inside the transaction to roll it back and report a refusal.
class Refusal extends Error {
  constructor(public result: ImportResult) {
    super("import refused");
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Why a file could not be decoded as text, or null if it is fine. A spreadsheet
// saved as plain "CSV" in Excel is usually Windows-1252, not UTF-8, and decoding
// it loosely would silently turn "Zürich" into "Z?rich".
export function decodeUpload(bytes: ArrayBuffer | Uint8Array): { ok: true; text: string } | { ok: false; message: string } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, message: `${NOTHING} This file is not UTF-8 text. In Excel choose Save As, then CSV UTF-8 (Comma delimited), and upload that file.` };
  }
  if (text.includes("\u0000")) {
    return { ok: false, message: `${NOTHING} This file contains a null character, so it is not a plain CSV file (it may be a spreadsheet or another binary file). Export it as CSV and try again.` };
  }
  return { ok: true, text };
}

// Customer lookup used by every file that hangs off customers: a row may name a
// customer by its ref (CUS-0001) or by its exact name, ignoring case, extra
// spaces and accent form. A ref wins over a name if the two ever clash.
async function customerLookup(tx: Prisma.TransactionClient, workspaceId: string): Promise<Map<string, string>> {
  const customers = await tx.customer.findMany({ where: { workspaceId }, select: { id: true, ref: true, name: true } });
  const lookup = new Map<string, string>();
  for (const c of customers) lookup.set(nameKey(c.name), c.id);
  for (const c of customers) if (c.ref) lookup.set(nameKey(c.ref), c.id);
  return lookup;
}

function nextRefGenerator(existing: Iterable<string>, taken: Set<string>): () => string {
  let max = 0;
  for (const ref of existing) {
    const m = /^CUS-(\d+)$/i.exec(ref);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return () => {
    for (;;) {
      max += 1;
      const ref = `CUS-${String(max).padStart(4, "0")}`;
      if (!taken.has(ref.toLowerCase())) {
        taken.add(ref.toLowerCase());
        return ref;
      }
    }
  };
}

type Parsed = ReturnType<typeof parseCsv>;
type Tx = Prisma.TransactionClient;

interface ChildSpec<T> {
  one: string;
  many: string;
  validate: (headers: string[], rows: Record<string, string>[], lookup: Map<string, string>, existingCount: number, lines?: number[]) => { rows: T[]; errors: RowError[] };
  // Keys of rows already in the workspace, and the key of a new row.
  existingKeys: (tx: Tx, workspaceId: string) => Promise<Set<string>>;
  count: (tx: Tx, workspaceId: string) => Promise<number>;
  keyOf: (row: T) => string;
  // Writes the new rows. It receives each row's line in the file so it can
  // report a problem against the right row, and it must do every check BEFORE
  // its first create (or throw a Refusal, which rolls everything back).
  write: (tx: Tx, workspaceId: string, rows: { row: T; line: number }[]) => Promise<void>;
}

// Imports one of the files that hang off customers: validate every row, skip
// exact duplicates, check the workspace cap on what is actually new, write.
async function importChild<T>(tx: Tx, workspaceId: string, parsed: Parsed, lookup: Map<string, string>, spec: ChildSpec<T>, note: string): Promise<ImportResult> {
  const { rows, errors } = spec.validate(parsed.headers, parsed.rows, lookup, 0, parsed.lines);
  if (errors.length > 0) return fail(errors, note);

  const seen = await spec.existingKeys(tx, workspaceId);
  const fresh: { row: T; line: number }[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    const k = spec.keyOf(row);
    if (seen.has(k)) {
      skipped++;
      return;
    }
    seen.add(k);
    fresh.push({ row, line: parsed.lines[i] ?? i + 2 });
  });

  const limit = activeLimits().maxChildRowsPerWorkspace;
  const existingCount = await spec.count(tx, workspaceId);
  if (existingCount + fresh.length > limit) {
    return fail([{ row: 1, message: `A workspace can hold at most ${limit} ${spec.many} in total. This one has ${existingCount} and the file adds ${fresh.length} new.` }], note);
  }
  if (fresh.length > 0) await spec.write(tx, workspaceId, fresh);

  const dup = skipped > 0 ? ` ${plural(skipped, "row was a duplicate", "rows were duplicates")} of data already here or repeated in the file, and skipped.` : "";
  return { ok: true, imported: fresh.length, errors: [], message: `Imported ${plural(fresh.length, spec.one, spec.many)}.${dup}${note}` };
}

const inWorkspace = (workspaceId: string) => ({ customer: { workspaceId } });

// Gives a typed spec the common type the dispatcher works with.
function spec<T>(s: ChildSpec<T>): ChildSpec<unknown> {
  return s as unknown as ChildSpec<unknown>;
}

const CHILD_SPECS: Record<Exclude<ImportKind, "customers" | "usage">, ChildSpec<unknown>> = {
  tickets: spec<ParsedInteraction>({
    one: "ticket",
    many: "tickets",
    validate: validateInteractionRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.interaction.findMany({ where: inWorkspace(ws), select: { customerId: true, occurredAt: true, type: true, text: true } })).map((r) => `${r.customerId}|${iso(r.occurredAt)}|${r.type}|${r.text}`)),
    count: (tx, ws) => tx.interaction.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${iso(r.occurredAt)}|${r.type}|${r.text}`,
    write: async (tx, _ws, rows) => {
      await tx.interaction.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, type: r.type, severity: r.severity, occurredAt: r.occurredAt, text: r.text })),
      });
    },
  }),
  outcomes: spec<ParsedOutcome>({
    one: "outcome",
    many: "outcomes",
    validate: validateOutcomeRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.outcomeEvent.findMany({ where: inWorkspace(ws), select: { customerId: true, occurredAt: true, type: true } })).map((r) => `${r.customerId}|${iso(r.occurredAt)}|${r.type}`)),
    count: (tx, ws) => tx.outcomeEvent.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${iso(r.occurredAt)}|${r.type}`,
    write: async (tx, _ws, rows) => {
      await tx.outcomeEvent.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, type: r.type, occurredAt: r.occurredAt, notes: r.notes })),
      });
    },
  }),
  stakeholders: spec<ParsedStakeholder>({
    one: "stakeholder",
    many: "stakeholders",
    validate: validateStakeholderRows,
    // A person is identified by customer plus name, so a champion already made
    // from the customers file is not added twice.
    existingKeys: async (tx, ws) =>
      new Set((await tx.stakeholder.findMany({ where: inWorkspace(ws), select: { customerId: true, name: true } })).map((r) => `${r.customerId}|${nameKey(r.name)}`)),
    count: (tx, ws) => tx.stakeholder.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${nameKey(r.name)}`,
    write: async (tx, _ws, rows) => {
      await tx.stakeholder.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, name: r.name, role: r.role, isChampion: r.isChampion, lastEngagedAt: r.lastEngagedAt })),
      });
    },
  }),
  goals: spec<ParsedGoal>({
    one: "goal",
    many: "goals",
    validate: validateGoalRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.desiredOutcome.findMany({ where: inWorkspace(ws), select: { customerId: true, name: true } })).map((r) => `${r.customerId}|${nameKey(r.name)}`)),
    count: (tx, ws) => tx.desiredOutcome.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${nameKey(r.name)}`,
    write: async (tx, _ws, rows) => {
      await tx.desiredOutcome.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, name: r.name, targetValue: r.targetValue, actualValue: r.actualValue, unit: r.unit })),
      });
    },
  }),
  training: spec<ParsedTraining>({
    one: "training session",
    many: "training sessions",
    validate: validateTrainingRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.trainingCompletion.findMany({ where: inWorkspace(ws), select: { customerId: true, courseName: true, occurredAt: true, attendeeCount: true } })).map((r) => `${r.customerId}|${nameKey(r.courseName)}|${iso(r.occurredAt)}|${r.attendeeCount}`)),
    count: (tx, ws) => tx.trainingCompletion.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${nameKey(r.courseName)}|${iso(r.occurredAt)}|${r.attendeeCount}`,
    write: async (tx, _ws, rows) => {
      await tx.trainingCompletion.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, courseName: r.courseName, attendeeCount: r.attendeeCount, occurredAt: r.occurredAt })),
      });
    },
  }),
  events: spec<ParsedEvent>({
    one: "event attendance",
    many: "event attendances",
    validate: validateEventRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.eventAttendance.findMany({ where: inWorkspace(ws), select: { customerId: true, eventName: true, occurredAt: true } })).map((r) => `${r.customerId}|${nameKey(r.eventName)}|${iso(r.occurredAt)}`)),
    count: (tx, ws) => tx.eventAttendance.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${nameKey(r.eventName)}|${iso(r.occurredAt)}`,
    write: async (tx, _ws, rows) => {
      await tx.eventAttendance.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, eventName: r.eventName, occurredAt: r.occurredAt })),
      });
    },
  }),
  surveys: spec<ParsedSurvey>({
    one: "survey response",
    many: "survey responses",
    validate: validateSurveyRows,
    existingKeys: async (tx, ws) =>
      new Set((await tx.surveyResponse.findMany({ where: inWorkspace(ws), select: { customerId: true, type: true, occurredAt: true, score: true } })).map((r) => `${r.customerId}|${r.type}|${iso(r.occurredAt)}|${r.score}`)),
    count: (tx, ws) => tx.surveyResponse.count({ where: inWorkspace(ws) }),
    keyOf: (r) => `${r.customerId}|${r.type}|${iso(r.occurredAt)}|${r.score}`,
    write: async (tx, _ws, rows) => {
      await tx.surveyResponse.createMany({
        data: rows.map(({ row: r }) => ({ customerId: r.customerId, type: r.type, score: r.score, occurredAt: r.occurredAt })),
      });
    },
  }),
};

// ---------- usage: capabilities belong to products ----------

const usageSpec: ChildSpec<ParsedUsage> = {
  one: "usage reading",
  many: "usage readings",
  validate: validateUsageRows,
  existingKeys: async (tx, ws) =>
    new Set(
      (await tx.usageSnapshot.findMany({ where: inWorkspace(ws), select: { customerId: true, occurredAt: true, value: true, capability: { select: { name: true } } } })).map(
        (r) => `${r.customerId}|${nameKey(r.capability.name)}|${iso(r.occurredAt)}|${Number(r.value)}`
      )
    ),
  count: (tx, ws) => tx.usageSnapshot.count({ where: inWorkspace(ws) }),
  keyOf: (r) => `${r.customerId}|${nameKey(r.capability)}|${iso(r.occurredAt)}|${r.value}`,
  write: async (tx, workspaceId, rows) => {
    // Every check happens before the first create, so a refusal writes nothing.
    const links = await tx.customerProduct.findMany({
      where: { customer: { workspaceId } },
      orderBy: { id: "asc" },
      select: { customerId: true, productId: true, product: { select: { name: true } } },
    });
    const productsOfCustomer = new Map<string, { id: string; name: string }[]>();
    for (const l of links) {
      const list = productsOfCustomer.get(l.customerId) ?? [];
      list.push({ id: l.productId, name: l.product.name });
      productsOfCustomer.set(l.customerId, list);
    }
    const capabilities = await tx.capability.findMany({ where: { product: { workspaceId } }, select: { id: true, productId: true, name: true, metricType: true } });
    const existing = new Map(capabilities.map((c) => [`${c.productId}|${nameKey(c.name)}`, c]));

    const problems: RowError[] = [];
    const resolved: { productId: string; row: ParsedUsage }[] = [];
    const fresh = new Map<string, { id: string; productId: string; name: string; metricType: string; explicit: boolean }>();
    for (const { row, line } of rows) {
      const products = productsOfCustomer.get(row.customerId);
      if (!products || products.length === 0) {
        problems.push({ row: line, message: "this customer has no product, so usage cannot be attached. Import the customer through the customers file." });
        continue;
      }
      let product = products[0];
      if (row.product !== null) {
        const match = products.find((p) => nameKey(p.name) === nameKey(row.product!));
        if (!match) {
          problems.push({ row: line, message: `the customer is not on a product called "${row.product}". Its products: ${products.map((p) => p.name).join(", ")}.` });
          continue;
        }
        product = match;
      }
      const key = `${product.id}|${nameKey(row.capability)}`;
      const old = existing.get(key);
      if (old) {
        if (row.metricExplicit && old.metricType !== row.metricType) {
          problems.push({ row: line, message: `metric_type "${row.metricType}" does not match the existing capability "${old.name}", which is ${old.metricType}.` });
          continue;
        }
      } else {
        const f = fresh.get(key);
        if (!f) fresh.set(key, { id: randomUUID(), productId: product.id, name: row.capability, metricType: row.metricType, explicit: row.metricExplicit });
        else if (row.metricExplicit && !f.explicit) {
          f.metricType = row.metricType;
          f.explicit = true;
        }
      }
      resolved.push({ productId: product.id, row });
    }
    if (problems.length > 0) throw new Refusal(fail(problems));

    const limits = activeLimits();
    if (fresh.size > limits.maxNewCapabilitiesPerFile || capabilities.length + fresh.size > limits.maxCapabilitiesPerWorkspace) {
      throw new Refusal(
        fail([{ row: 1, message: `This file would create ${fresh.size} new capabilities. A file may create at most ${limits.maxNewCapabilitiesPerFile}, and a workspace may have at most ${limits.maxCapabilitiesPerWorkspace} (this one has ${capabilities.length}).` }])
      );
    }

    if (fresh.size > 0) {
      await tx.capability.createMany({ data: [...fresh.values()].map((c) => ({ id: c.id, productId: c.productId, name: c.name, metricType: c.metricType })) });
    }
    await tx.usageSnapshot.createMany({
      data: resolved.map(({ productId, row }) => {
        const key = `${productId}|${nameKey(row.capability)}`;
        const capabilityId = existing.get(key)?.id ?? fresh.get(key)!.id;
        return { customerId: row.customerId, capabilityId, occurredAt: row.occurredAt, value: row.value };
      }),
    });
  },
};

// ---------- the entry point ----------

// Imports a file as it is: the columns must already be named as Bearing names them
// (a few spelling variants are read, see canonicaliseHeaders).
export async function importCsv(workspaceId: string, kind: ImportKind, text: string): Promise<ImportResult> {
  return guarded(() => runImport(workspaceId, kind, text));
}

// Imports a file with the column choices a person confirmed on the mapping
// screen. `mapping` is whatever arrived from the browser (JSON text or a parsed
// value): it is parsed strictly and every choice is checked again here against
// the real file and the workspace's real custom fields, so nothing the browser
// sent is trusted. All or nothing: one bad row means no import, no new custom
// field and no saved mapping.
export async function importCsvMapped(workspaceId: string, kind: ImportKind, text: string, mapping: unknown): Promise<ImportResult> {
  return guarded(() => runImport(workspaceId, kind, text, mapping));
}

async function guarded(run: () => Promise<ImportResult>): Promise<ImportResult> {
  try {
    return await run();
  } catch (e) {
    // Never show an error page or a database message: say what happened in plain words.
    console.error("Import failed", e);
    const timedOut = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028";
    return fail(
      [],
      "",
      timedOut
        ? `${NOTHING} The import took too long and was cancelled. Try a smaller file.`
        : `${NOTHING} Something went wrong while saving the file, so nothing was changed. Try again, and try a smaller file if it keeps happening.`
    );
  }
}

async function runImport(workspaceId: string, kind: ImportKind, text: string, mappingInput?: unknown): Promise<ImportResult> {
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return fail([], "", `${NOTHING} Unknown import type.`);
  if (text.includes("\u0000")) return fail([], "", `${NOTHING} The file contains a null character, so it is not a plain CSV file.`);

  let raw: Parsed;
  try {
    raw = parseCsv(text);
  } catch (e) {
    return fail([{ row: 1, message: e instanceof Error ? e.message : "The file could not be read." }]);
  }
  if (raw.headers.length === 0) return fail([{ row: 1, message: "The file is empty." }]);

  if (mappingInput !== undefined) return runMappedImport(workspaceId, kind, raw, mappingInput);

  const headerIssues = headerProblems(raw.headers);
  if (headerIssues.length > 0) return fail(headerIssues.map((message) => ({ row: 1, message })));

  // "Renewal Date" is read as renewal_date; anything still unknown is reported.
  const tidy = canonicaliseHeaders(kind, raw.headers, raw.rows);
  const parsed: Parsed = { headers: tidy.headers, rows: tidy.rows, lines: raw.lines };
  const ignored = ignoredColumns(kind, parsed.headers);
  const note =
    (tidy.renamed.length > 0 ? ` Read ${tidy.renamed.map(([from, to]) => `"${from}" as ${to}`).join(", ")}.` : "") +
    (ignored.length > 0 ? ` These columns were ignored: ${ignored.join(", ")}.` : "");

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + workspaceId}))`;

        if (kind === "customers") return importCustomers(tx, workspaceId, parsed, note);

        const lookup = await customerLookup(tx, workspaceId);
        if (lookup.size === 0) return fail([{ row: 1, message: "This workspace has no customers yet. Import the customers file first." }], note);
        if (kind === "usage") return importChild(tx, workspaceId, parsed, lookup, spec<ParsedUsage>(usageSpec), note);
        return importChild(tx, workspaceId, parsed, lookup, CHILD_SPECS[kind], note);
      },
      { timeout: 60_000, maxWait: 15_000 }
    );
  } catch (e) {
    if (e instanceof Refusal) return { ...e.result, message: e.result.message + note };
    throw e;
  }
}

// ---------- the mapped import ----------

// Which custom fields a customers file fills, and which it creates. `created`
// is filled in as the new fields are made, so the saved mapping can point at them.
interface CustomPlan {
  applied: AppliedMapping;
  existing: CustomFieldDef[];
  created: { header: string; field: CustomFieldDef }[];
}

function ignoredNote(headers: string[], mapping: ColumnMapping): string {
  const used = new Set(mapping.filter((e) => e.action !== "ignore").map((e) => normaliseHeader(e.header)));
  const named = headers.filter((h) => h !== "" && !used.has(normaliseHeader(h)));
  const unnamed = headers.filter((h) => h === "").length;
  const parts = [...named, ...(unnamed > 0 ? [`${plural(unnamed, "column with no heading", "columns with no heading")}`] : [])];
  return parts.length > 0 ? ` These columns were ignored: ${parts.join(", ")}.` : "";
}

async function runMappedImport(workspaceId: string, kind: ImportKind, raw: Parsed, mappingInput: unknown): Promise<ImportResult> {
  const read = parseColumnMapping(mappingInput);
  if (!read.ok) return fail([{ row: 1, message: read.error }], "", `${NOTHING} The column choices could not be read.`);
  const mapping = read.mapping;

  // Two columns with exactly the same heading cannot be told apart once the rows
  // are read. (A column with no heading is fine: it can only be ignored.)
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const h of raw.headers) {
    if (h === "") continue;
    if (seen.has(h)) dupes.add(h);
    seen.add(h);
  }
  if (dupes.size > 0) {
    return fail([{ row: 1, message: `These column names appear more than once: ${[...dupes].join(", ")}. Each column needs its own name; rename or delete one of them and upload the file again.` }]);
  }

  const note = ignoredNote(raw.headers, mapping);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + workspaceId}))`;
        return importMapped(tx, workspaceId, kind, raw, mapping, note);
      },
      { timeout: 60_000, maxWait: 15_000 }
    );
  } catch (e) {
    if (e instanceof Refusal) return { ...e.result, message: e.result.message + note };
    throw e;
  }
}

async function importMapped(tx: Tx, workspaceId: string, kind: ImportKind, raw: Parsed, mapping: ColumnMapping, note: string): Promise<ImportResult> {
  // Checked against the workspace's real custom fields, inside the lock.
  const existing = await listCustomFields(workspaceId, tx);
  const problems = validateMapping(kind, mapping, existing, raw.headers);
  if (problems.length > 0) return fail(problems.map((message) => ({ row: 1, message })), "", `${NOTHING} Fix the column choices below and import again.`);

  const applied = applyMapping(raw, mapping);
  const parsed: Parsed = { headers: applied.headers, rows: applied.rows, lines: raw.lines };
  const plan: CustomPlan = { applied, existing, created: [] };

  let result: ImportResult;
  if (kind === "customers") {
    result = await importCustomers(tx, workspaceId, parsed, note, plan);
  } else {
    const lookup = await customerLookup(tx, workspaceId);
    if (lookup.size === 0) return fail([{ row: 1, message: "This workspace has no customers yet. Import the customers file first." }], note);
    result = kind === "usage" ? await importChild(tx, workspaceId, parsed, lookup, spec<ParsedUsage>(usageSpec), note) : await importChild(tx, workspaceId, parsed, lookup, CHILD_SPECS[kind], note);
  }

  // Remember the choices for the next file with these columns, in the same
  // transaction, so a failed import saves nothing.
  if (result.ok) {
    const createdByHeader = new Map(plan.created.map((c) => [normaliseHeader(c.header), c.field.id]));
    await saveMapping(tx, workspaceId, kind, mappingSignature(raw.headers), mappingToSave(mapping, createdByHeader));
  }
  return result;
}


// ---------- customers ----------

// One custom field a customers file fills: a new one (made when the import
// succeeds) or one the workspace already has.
interface FieldSpec {
  label: string;
  type: CustomFieldType;
  options: string[];
  key: string; // the new field's key in the mapping, or the existing field's id
  isNew: boolean;
}

const MAX_REPORTED = 200;
const byRow = (a: RowError, b: RowError) => a.row - b.row;

type CustomValue = string | number | null;

// Checks every custom value against its field's type, with the row numbers of
// the person's spreadsheet. Returns the value of every field on every row.
function coerceCustomColumns(plan: CustomPlan, specs: FieldSpec[], lines: number[]): { values: CustomValue[][]; errors: RowError[] } {
  const errors: RowError[] = [];
  const values: CustomValue[][] = [];
  const total = plan.applied.customFieldValues.length;
  for (let i = 0; i < total; i++) {
    const row: CustomValue[] = [];
    for (const f of specs) {
      const rawCell = f.isNew ? plan.applied.customFieldValues[i][f.key] : plan.applied.existingFieldValues[i][f.key];
      const r = coerceCustomValue(f.type, rawCell ?? "", f.options);
      if (r.ok) row.push(r.value);
      else {
        row.push(null);
        errors.push({ row: lines[i] ?? i + 2, message: `${f.label}: ${r.error}` });
      }
    }
    values.push(row);
  }
  return { values, errors };
}

async function importCustomers(tx: Tx, workspaceId: string, parsed: Parsed, note: string, plan?: CustomPlan): Promise<ImportResult> {
  const existing = await tx.customer.findMany({ where: { workspaceId }, select: { ref: true, name: true } });
  const refs = new Set(existing.flatMap((c) => (c.ref ? [c.ref.toLowerCase()] : [])));
  const names = new Set(existing.map((c) => nameKey(c.name)));
  const { rows, errors } = validateCustomerRows(parsed.headers, parsed.rows, { refs, names, count: existing.length }, parsed.lines);

  // Custom fields filled by this file, checked before anything is written. Bad
  // values are reported together with the other row problems.
  const specs: FieldSpec[] = plan
    ? [
        ...plan.applied.customFields.map((f): FieldSpec => ({ label: f.label, type: f.type, options: f.options ?? [], key: f.key, isNew: true })),
        ...plan.applied.existingFields.flatMap((f): FieldSpec[] => {
          const def = plan.existing.find((d) => d.id === f.fieldId);
          return def ? [{ label: def.label, type: def.type, options: def.options, key: def.id, isNew: false }] : [];
        }),
      ]
    : [];
  const coerced = plan && specs.length > 0 ? coerceCustomColumns(plan, specs, parsed.lines) : { values: [] as CustomValue[][], errors: [] as RowError[] };
  const all = [...errors, ...coerced.errors].sort(byRow);
  if (all.length > 0) {
    const shown = all.slice(0, MAX_REPORTED);
    if (all.length > MAX_REPORTED) shown.push({ row: shown[shown.length - 1].row, message: `${all.length - MAX_REPORTED} more problems not shown. Fix these first and check the file again.` });
    return fail(shown, note);
  }

  // One value per customer and field. The first row that has a value sets it; a
  // later row for the same customer may repeat it or leave it blank, but not
  // contradict it (customer-level fields are the same on every row).
  const valuesOf = new Map<string, { values: CustomValue[]; lines: number[] }>();
  if (specs.length > 0) {
    const contradictions: RowError[] = [];
    rows.forEach((r, i) => {
      const key = nameKey(r.name);
      const line = parsed.lines[i] ?? i + 2;
      let held = valuesOf.get(key);
      if (!held) {
        held = { values: specs.map(() => null), lines: specs.map(() => line) };
        valuesOf.set(key, held);
      }
      specs.forEach((f, s) => {
        const v = coerced.values[i][s];
        if (v === null) return;
        if (held!.values[s] === null) {
          held!.values[s] = v;
          held!.lines[s] = line;
        } else if (held!.values[s] !== v) {
          contradictions.push({ row: line, message: `${f.label}: "${v}" here, but "${held!.values[s]}" on row ${held!.lines[s]} for the same customer. A customer's custom fields must match on every row.` });
        }
      });
    });
    if (contradictions.length > 0) return fail(contradictions.slice(0, MAX_REPORTED), note);
  }

  // Everything is checked. Make the new custom fields (inside this transaction, so
  // any later failure removes them again), then note which id each value goes to.
  const fieldIds: string[] = [];
  if (plan) {
    for (const f of specs) {
      if (!f.isNew) {
        fieldIds.push(f.key);
        continue;
      }
      const wanted = plan.applied.customFields.find((c) => c.key === f.key)!;
      try {
        const made = await createCustomField(workspaceId, { label: wanted.label, type: wanted.type, options: wanted.options, shareWithAi: wanted.shareWithAi }, tx);
        plan.created.push({ header: wanted.header, field: made });
        fieldIds.push(made.id);
      } catch (e) {
        if (e instanceof CustomFieldError) throw new Refusal(fail([{ row: 1, message: e.message }]));
        throw e;
      }
    }
  }

  const newRef = nextRefGenerator(
    existing.flatMap((c) => (c.ref ? [c.ref] : [])),
    new Set([...refs, ...rows.flatMap((r) => (r.ref ? [r.ref.toLowerCase()] : []))])
  );

  const products = await tx.product.findMany({ where: { workspaceId } });
  const productIds = new Map(products.map((p) => [nameKey(p.name), p.id]));
  const newProducts: Prisma.ProductCreateManyInput[] = [];
  for (const r of rows) {
    if (!productIds.has(nameKey(r.product))) {
      const id = randomUUID();
      productIds.set(nameKey(r.product), id);
      newProducts.push({ id, workspaceId, name: r.product });
    }
  }
  if (newProducts.length > 0) await tx.product.createMany({ data: newProducts });

  const customers: Prisma.CustomerCreateManyInput[] = [];
  const links: Prisma.CustomerProductCreateManyInput[] = [];
  const stakeholders: Prisma.StakeholderCreateManyInput[] = [];
  const surveys: Prisma.SurveyResponseCreateManyInput[] = [];
  const now = new Date();
  // The first row for a customer defines it (and its champion and NPS); any
  // further rows for the same name are its additional products.
  const idByName = new Map<string, string>();
  for (const r of rows) {
    const key = nameKey(r.name);
    let id = idByName.get(key);
    if (!id) {
      id = randomUUID();
      idByName.set(key, id);
      const customFields: Record<string, string | number> = {};
      const held = valuesOf.get(key);
      if (held) held.values.forEach((v, s) => { if (v !== null) customFields[fieldIds[s]] = v; });
      customers.push({
        id,
        workspaceId,
        customFields,
        ref: r.ref ?? newRef(),
        name: r.name,
        country: r.country,
        industry: r.industry,
        region: r.region,
        city: r.city,
        subIndustry: r.subIndustry,
        tier: r.tier,
        renewalType: r.renewalType,
        interruptedReason: r.interruptedReason,
      });
      // The champion is a stakeholder. The stakeholders file identifies a person
      // by customer plus name and skips anyone who already exists, so a champion
      // listed in both files is created once.
      if (r.championName) {
        stakeholders.push({ customerId: id, name: r.championName, role: "Champion", isChampion: true, lastEngagedAt: r.championLastEngaged });
      }
      if (r.nps !== null) surveys.push({ customerId: id, type: "nps", score: r.nps, occurredAt: r.npsDate ?? now });
    }
    links.push({
      customerId: id,
      productId: productIds.get(nameKey(r.product))!,
      contractualArr: r.contractualArr,
      consumptionArr: r.consumptionArr,
      lifecycleStatus: r.lifecycleStatus,
      expectedGoLiveDate: r.expectedGoLiveDate,
      actualGoLiveDate: r.goLiveDate,
      renewalDate: r.renewalDate,
      paymentStatus: r.paymentStatus,
      daysPastDue: r.daysPastDue,
    });
  }
  await tx.customer.createMany({ data: customers });
  await tx.customerProduct.createMany({ data: links });
  if (stakeholders.length) await tx.stakeholder.createMany({ data: stakeholders });
  if (surveys.length) await tx.surveyResponse.createMany({ data: surveys });
  const createdText =
    plan && plan.created.length > 0
      ? ` Created ${plural(plan.created.length, "custom field", "custom fields")}: ${plan.created.map((c) => `${c.field.label} (${c.field.type === "pick_list" ? "pick-list" : c.field.type})`).join(", ")}.`
      : "";
  return {
    ok: true,
    imported: customers.length,
    errors: [],
    message: `Imported ${customers.length} customer${customers.length === 1 ? "" : "s"} (${links.length} product link${links.length === 1 ? "" : "s"}).${createdText}${note}`,
  };
}

export const IMPORT_MAX_BYTES = LIMITS.maxBytes;
