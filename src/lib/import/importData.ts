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

export async function importCsv(workspaceId: string, kind: ImportKind, text: string): Promise<ImportResult> {
  try {
    return await runImport(workspaceId, kind, text);
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

async function runImport(workspaceId: string, kind: ImportKind, text: string): Promise<ImportResult> {
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return fail([], "", `${NOTHING} Unknown import type.`);
  if (text.includes("\u0000")) return fail([], "", `${NOTHING} The file contains a null character, so it is not a plain CSV file.`);

  let raw: Parsed;
  try {
    raw = parseCsv(text);
  } catch (e) {
    return fail([{ row: 1, message: e instanceof Error ? e.message : "The file could not be read." }]);
  }
  if (raw.headers.length === 0) return fail([{ row: 1, message: "The file is empty." }]);
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

// ---------- customers ----------

async function importCustomers(tx: Tx, workspaceId: string, parsed: Parsed, note: string): Promise<ImportResult> {
  const existing = await tx.customer.findMany({ where: { workspaceId }, select: { ref: true, name: true } });
  const refs = new Set(existing.flatMap((c) => (c.ref ? [c.ref.toLowerCase()] : [])));
  const names = new Set(existing.map((c) => nameKey(c.name)));
  const { rows, errors } = validateCustomerRows(parsed.headers, parsed.rows, { refs, names, count: existing.length }, parsed.lines);
  if (errors.length > 0) return fail(errors, note);

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
      customers.push({
        id,
        workspaceId,
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
  return {
    ok: true,
    imported: customers.length,
    errors: [],
    message: `Imported ${customers.length} customer${customers.length === 1 ? "" : "s"} (${links.length} product link${links.length === 1 ? "" : "s"}).${note}`,
  };
}

export const IMPORT_MAX_BYTES = LIMITS.maxBytes;
