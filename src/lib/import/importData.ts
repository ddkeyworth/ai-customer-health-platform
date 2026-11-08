// Writes a validated CSV import into one workspace. All or nothing: every row
// is checked first, and the whole import runs in one database transaction, so
// a failure part way leaves the workspace exactly as it was.
//
// Everything is scoped to the workspace id passed in. Imports for the same
// workspace are serialised with a database lock, so two uploads at once cannot
// both pass the "does this customer already exist" check.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCsv } from "./csv";
import {
  LIMITS,
  validateCustomerRows,
  validateInteractionRows,
  validateOutcomeRows,
  validateUsageRows,
  type RowError,
} from "./validate";

export type ImportKind = "customers" | "tickets" | "usage" | "outcomes";

export interface ImportResult {
  ok: boolean;
  imported: number;
  errors: RowError[];
  message: string;
}

const fail = (errors: RowError[]): ImportResult => ({
  ok: false,
  imported: 0,
  errors,
  message: "Nothing was imported. Fix the rows below and upload the file again.",
});

// Customer lookup used by the tickets and usage files: a row may name a
// customer by its ref (CUS-0001) or by its exact name, ignoring case. A ref
// wins over a name if the two ever clash.
async function customerLookup(tx: Prisma.TransactionClient, workspaceId: string): Promise<Map<string, string>> {
  const customers = await tx.customer.findMany({ where: { workspaceId }, select: { id: true, ref: true, name: true } });
  const lookup = new Map<string, string>();
  for (const c of customers) lookup.set(c.name.toLowerCase(), c.id);
  for (const c of customers) if (c.ref) lookup.set(c.ref.toLowerCase(), c.id);
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

export async function importCsv(workspaceId: string, kind: ImportKind, text: string): Promise<ImportResult> {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    return fail([{ row: 1, message: e instanceof Error ? e.message : "The file could not be read." }]);
  }
  if (parsed.headers.length === 0) return fail([{ row: 1, message: "The file is empty." }]);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + workspaceId}))`;

      if (kind === "customers") {
        const existing = await tx.customer.findMany({ where: { workspaceId }, select: { ref: true, name: true } });
        const refs = new Set(existing.flatMap((c) => (c.ref ? [c.ref.toLowerCase()] : [])));
        const names = new Set(existing.map((c) => c.name.toLowerCase()));
        const { rows, errors } = validateCustomerRows(parsed.headers, parsed.rows, { refs, names, count: existing.length });
        if (errors.length > 0) return fail(errors);

        const newRef = nextRefGenerator(
          existing.flatMap((c) => (c.ref ? [c.ref] : [])),
          new Set([...refs, ...rows.flatMap((r) => (r.ref ? [r.ref.toLowerCase()] : []))])
        );

        const products = await tx.product.findMany({ where: { workspaceId } });
        const productIds = new Map(products.map((p) => [p.name.toLowerCase(), p.id]));
        for (const r of rows) {
          if (!productIds.has(r.product.toLowerCase())) {
            const created = await tx.product.create({ data: { workspaceId, name: r.product } });
            productIds.set(r.product.toLowerCase(), created.id);
          }
        }

        const customers: Prisma.CustomerCreateManyInput[] = [];
        const links: Prisma.CustomerProductCreateManyInput[] = [];
        const stakeholders: Prisma.StakeholderCreateManyInput[] = [];
        const surveys: Prisma.SurveyResponseCreateManyInput[] = [];
        const now = new Date();
        // The first row for a customer defines it (and its champion and NPS);
        // any further rows for the same name are its additional products.
        const idByName = new Map<string, string>();
        for (const r of rows) {
          const key = r.name.toLowerCase();
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
              tier: r.tier,
              renewalType: r.renewalType,
              interruptedReason: r.interruptedReason,
            });
            if (r.championName) {
              stakeholders.push({ customerId: id, name: r.championName, role: "Champion", isChampion: true, lastEngagedAt: r.championLastEngaged });
            }
            if (r.nps !== null) surveys.push({ customerId: id, type: "nps", score: r.nps, occurredAt: now });
          }
          links.push({
            customerId: id,
            productId: productIds.get(r.product.toLowerCase())!,
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
        return { ok: true, imported: customers.length, errors: [], message: `Imported ${customers.length} customer${customers.length === 1 ? "" : "s"} (${links.length} product link${links.length === 1 ? "" : "s"}).` };
      }

      const lookup = await customerLookup(tx, workspaceId);
      if (lookup.size === 0) return fail([{ row: 1, message: "This workspace has no customers yet. Import the customers file first." }]);

      if (kind === "tickets") {
        const existingCount = await tx.interaction.count({ where: { customer: { workspaceId } } });
        const { rows, errors } = validateInteractionRows(parsed.headers, parsed.rows, lookup, existingCount);
        if (errors.length > 0) return fail(errors);
        await tx.interaction.createMany({
          data: rows.map((r) => ({ customerId: r.customerId, type: r.type, severity: r.severity, occurredAt: r.occurredAt, text: r.text })),
        });
        return { ok: true, imported: rows.length, errors: [], message: `Imported ${rows.length} ticket${rows.length === 1 ? "" : "s"}.` };
      }

      if (kind === "outcomes") {
        const existingCount = await tx.outcomeEvent.count({ where: { customer: { workspaceId } } });
        const { rows, errors } = validateOutcomeRows(parsed.headers, parsed.rows, lookup, existingCount);
        if (errors.length > 0) return fail(errors);
        await tx.outcomeEvent.createMany({
          data: rows.map((r) => ({ customerId: r.customerId, type: r.type, occurredAt: r.occurredAt, notes: r.notes })),
        });
        return { ok: true, imported: rows.length, errors: [], message: `Imported ${rows.length} outcome${rows.length === 1 ? "" : "s"}.` };
      }

      // usage
      const existingCount = await tx.usageSnapshot.count({ where: { customer: { workspaceId } } });
      const { rows, errors } = validateUsageRows(parsed.headers, parsed.rows, lookup, existingCount);
      if (errors.length > 0) return fail(errors);

      // A capability belongs to a product. Use the product the customer is on.
      const customerProducts = await tx.customerProduct.findMany({
        where: { customer: { workspaceId } },
        orderBy: { id: "asc" },
        select: { customerId: true, productId: true },
      });
      const productOf = new Map<string, string>();
      for (const cp of customerProducts) if (!productOf.has(cp.customerId)) productOf.set(cp.customerId, cp.productId);

      const capabilities = await tx.capability.findMany({ where: { product: { workspaceId } } });
      const capabilityIds = new Map(capabilities.map((c) => [`${c.productId}|${c.name.toLowerCase()}`, c.id]));
      for (const r of rows) {
        const productId = productOf.get(r.customerId);
        if (!productId) return fail([{ row: 1, message: "A customer in the usage file has no product. Import it through the customers file." }]);
        const key = `${productId}|${r.capability.toLowerCase()}`;
        if (!capabilityIds.has(key)) {
          const created = await tx.capability.create({ data: { productId, name: r.capability, metricType: r.metricType } });
          capabilityIds.set(key, created.id);
        }
      }
      await tx.usageSnapshot.createMany({
        data: rows.map((r) => ({
          customerId: r.customerId,
          capabilityId: capabilityIds.get(`${productOf.get(r.customerId)}|${r.capability.toLowerCase()}`)!,
          occurredAt: r.occurredAt,
          value: r.value,
        })),
      });
      return { ok: true, imported: rows.length, errors: [], message: `Imported ${rows.length} usage reading${rows.length === 1 ? "" : "s"}.` };
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}

export const IMPORT_MAX_BYTES = LIMITS.maxBytes;
