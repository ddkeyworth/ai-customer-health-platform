// Builds the downloadable CSV files for one workspace. Every file except the
// recommendations report uses exactly the columns the importer reads, so a
// person can export their data and load it straight back in. Extra columns
// (Health score, narrative and so on) come after the import columns; the
// importer treats them as known and does not warn about them. The
// recommendations file is a report and is not importable.
//
// Everything is scoped to the workspace id passed in.
//
// Spreadsheet safety: a cell that begins with = + - @ or a tab or carriage
// return can be run as a formula when the file is opened in Excel or Sheets
// (CSV injection). Any text cell that starts that way, optionally after a run
// of apostrophes, gets one leading quote, and the CSV reader removes exactly one
// quote again on import, so a round trip returns the original text, including
// text that really does start with an apostrophe.
//
// Not carried by the round trip (see importData.ts): a customer with no product
// link comes back with a "Core product" link, and the customers file carries only
// the first champion (the stakeholders file carries everyone).
import { prisma } from "@/lib/prisma";

export type ExportKind =
  | "customers"
  | "tickets"
  | "usage"
  | "outcomes"
  | "stakeholders"
  | "goals"
  | "training"
  | "events"
  | "surveys"
  | "recommendations";
export const EXPORT_KINDS: ExportKind[] = [
  "customers",
  "tickets",
  "usage",
  "outcomes",
  "stakeholders",
  "goals",
  "training",
  "events",
  "surveys",
  "recommendations",
];

type Cell = string | number | Date | null | undefined;

export function neutraliseFormula(text: string): string {
  return /^'*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else if (typeof value === "number") return String(value); // numbers are never text, so a minus sign is safe
  else text = neutraliseFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}

const who = (c: { ref: string | null; name: string }) => c.ref ?? c.name;
const byCustomerThenDate = [{ customerId: "asc" as const }, { occurredAt: "asc" as const }];

export async function buildExport(workspaceId: string, kind: ExportKind): Promise<string> {
  const mine = { customer: { workspaceId } };
  const customerSelect = { customer: { select: { ref: true, name: true } } };

  if (kind === "customers") {
    const customers = await prisma.customer.findMany({
      where: { workspaceId },
      orderBy: { ref: "asc" },
      include: {
        products: { include: { product: true }, orderBy: { id: "asc" } },
        stakeholders: { orderBy: { createdAt: "asc" } },
        surveyResponses: { where: { type: "nps" }, orderBy: { occurredAt: "desc" }, take: 1 },
        healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    const rows: Cell[][] = [];
    for (const c of customers) {
      const champion = c.stakeholders.find((s) => s.isChampion);
      const snap = c.healthSnapshots[0];
      const nps = c.surveyResponses[0];
      const links = c.products.length > 0 ? c.products : [null];
      links.forEach((cp, i) => {
        // Customer-level values that could differ between rows are written on
        // the first row only, except the ones that are identical on every row.
        const first = i === 0;
        rows.push([
          c.ref, c.name, c.country, c.industry, c.region, c.city, c.subIndustry, c.tier,
          cp?.product.name ?? "Core product",
          cp?.lifecycleStatus ?? "live",
          cp ? Number(cp.contractualArr) : 0, cp ? Number(cp.consumptionArr) : 0,
          cp?.renewalDate, cp?.expectedGoLiveDate, cp?.actualGoLiveDate,
          cp?.paymentStatus ?? "current", cp?.daysPastDue ?? 0,
          c.renewalType, first ? c.interruptedReason : null,
          first ? nps?.score : null, first ? nps?.occurredAt : null,
          first ? champion?.name : null, first ? champion?.lastEngagedAt : null,
          first ? snap?.compositeScore : null, first ? snap?.tierLabel : null,
          first ? snap?.baselineScore : null, first ? snap?.adjustmentDelta : null,
          first ? snap?.narrative : null,
        ]);
      });
    }
    return toCsv(
      [
        "ref", "name", "country", "industry", "region", "city", "sub_industry", "tier", "product", "lifecycle_status",
        "contractual_arr", "consumption_arr", "renewal_date", "expected_go_live_date", "go_live_date", "payment_status",
        "days_past_due", "renewal_type", "interrupted_reason", "nps", "nps_date", "champion_name", "champion_last_engaged",
        "health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative",
      ],
      rows
    );
  }

  if (kind === "tickets") {
    const rows = await prisma.interaction.findMany({ where: mine, orderBy: byCustomerThenDate, include: customerSelect });
    return toCsv(["customer", "date", "type", "severity", "text"], rows.map((r) => [who(r.customer), r.occurredAt, r.type, r.severity, r.text]));
  }

  if (kind === "usage") {
    const rows = await prisma.usageSnapshot.findMany({
      where: mine,
      orderBy: byCustomerThenDate,
      include: { ...customerSelect, capability: { include: { product: { select: { name: true } } } } },
    });
    return toCsv(
      ["customer", "product", "capability", "metric_type", "date", "value"],
      rows.map((r) => [who(r.customer), r.capability.product.name, r.capability.name, r.capability.metricType, r.occurredAt, Number(r.value)])
    );
  }

  if (kind === "outcomes") {
    const rows = await prisma.outcomeEvent.findMany({ where: mine, orderBy: byCustomerThenDate, include: customerSelect });
    return toCsv(["customer", "date", "type", "notes"], rows.map((r) => [who(r.customer), r.occurredAt, r.type, r.notes]));
  }

  if (kind === "stakeholders") {
    const rows = await prisma.stakeholder.findMany({ where: mine, orderBy: [{ customerId: "asc" }, { createdAt: "asc" }], include: customerSelect });
    return toCsv(
      ["customer", "name", "role", "is_champion", "last_engaged_date"],
      rows.map((r) => [who(r.customer), r.name, r.role, r.isChampion ? "yes" : "no", r.lastEngagedAt])
    );
  }

  if (kind === "goals") {
    const rows = await prisma.desiredOutcome.findMany({ where: mine, orderBy: [{ customerId: "asc" }, { createdAt: "asc" }], include: customerSelect });
    return toCsv(
      ["customer", "name", "target_value", "actual_value", "unit"],
      rows.map((r) => [who(r.customer), r.name, Number(r.targetValue), Number(r.actualValue), r.unit])
    );
  }

  if (kind === "training") {
    const rows = await prisma.trainingCompletion.findMany({ where: mine, orderBy: byCustomerThenDate, include: customerSelect });
    return toCsv(["customer", "course", "attendees", "date"], rows.map((r) => [who(r.customer), r.courseName, r.attendeeCount, r.occurredAt]));
  }

  if (kind === "events") {
    const rows = await prisma.eventAttendance.findMany({ where: mine, orderBy: byCustomerThenDate, include: customerSelect });
    return toCsv(["customer", "event", "date"], rows.map((r) => [who(r.customer), r.eventName, r.occurredAt]));
  }

  if (kind === "surveys") {
    const rows = await prisma.surveyResponse.findMany({ where: mine, orderBy: byCustomerThenDate, include: customerSelect });
    return toCsv(["customer", "type", "score", "date"], rows.map((r) => [who(r.customer), r.type, r.score, r.occurredAt]));
  }

  // recommendations: a report of the AI's proposed actions, not importable
  const actions = await prisma.agentAction.findMany({
    where: { workspaceId },
    orderBy: [{ area: "asc" }, { createdAt: "asc" }],
    include: customerSelect,
  });
  return toCsv(
    ["area", "customer_ref", "customer", "headline", "reasoning", "suggested_next_step", "status", "impact_arr", "confidence", "created"],
    actions.map((a) => [a.area, a.customer.ref, a.customer.name, a.headline, a.reasoning, a.suggestedNextStep, a.status, a.impactArr === null ? null : Number(a.impactArr), a.confidenceLevel, a.createdAt])
  );
}
