// Builds the downloadable CSV files for one workspace. The customers, tickets,
// usage and outcomes files use exactly the columns the importer reads, so a
// person can export their data and load it straight back in. Extra columns
// (Health score, narrative and so on) are added after the import columns; the
// importer ignores columns it does not know. The recommendations file is a
// report and is not importable.
//
// Everything is scoped to the workspace id passed in.
//
// Spreadsheet safety: a cell that begins with = + - @ or a tab or carriage
// return can be run as a formula when the file is opened in Excel or Sheets
// (CSV injection). Any text cell that starts that way gets a leading quote, and
// the CSV reader removes that quote again on import, so a round trip returns
// the original text.
import { prisma } from "@/lib/prisma";

export type ExportKind = "customers" | "tickets" | "usage" | "outcomes" | "recommendations";
export const EXPORT_KINDS: ExportKind[] = ["customers", "tickets", "usage", "outcomes", "recommendations"];

type Cell = string | number | Date | null | undefined;

export function neutraliseFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
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

export async function buildExport(workspaceId: string, kind: ExportKind): Promise<string> {
  if (kind === "customers") {
    const customers = await prisma.customer.findMany({
      where: { workspaceId },
      orderBy: { ref: "asc" },
      include: {
        products: { include: { product: true }, orderBy: { id: "asc" } },
        stakeholders: true,
        surveyResponses: { where: { type: "nps" }, orderBy: { occurredAt: "desc" }, take: 1 },
        healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    const rows: Cell[][] = [];
    for (const c of customers) {
      const champion = c.stakeholders.find((s) => s.isChampion);
      const snap = c.healthSnapshots[0];
      const links = c.products.length > 0 ? c.products : [null];
      links.forEach((cp, i) => {
        rows.push([
          c.ref, c.name, c.country, c.industry, c.tier, cp?.product.name ?? "Core product",
          cp?.lifecycleStatus ?? "live",
          cp ? Number(cp.contractualArr) : 0, cp ? Number(cp.consumptionArr) : 0,
          cp?.renewalDate, cp?.expectedGoLiveDate, cp?.actualGoLiveDate,
          cp?.paymentStatus ?? "current", cp?.daysPastDue ?? 0,
          // Customer-level fields appear on the customer's first row only.
          c.renewalType, i === 0 ? c.interruptedReason : null,
          i === 0 ? c.surveyResponses[0]?.score : null,
          i === 0 ? champion?.name : null, i === 0 ? champion?.lastEngagedAt : null,
          i === 0 ? snap?.compositeScore : null, i === 0 ? snap?.tierLabel : null,
          i === 0 ? snap?.baselineScore : null, i === 0 ? snap?.adjustmentDelta : null,
          i === 0 ? snap?.narrative : null,
        ]);
      });
    }
    return toCsv(
      ["ref", "name", "country", "industry", "tier", "product", "lifecycle_status", "contractual_arr", "consumption_arr", "renewal_date", "expected_go_live_date", "go_live_date", "payment_status", "days_past_due", "renewal_type", "interrupted_reason", "nps", "champion_name", "champion_last_engaged", "health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative"],
      rows
    );
  }

  if (kind === "tickets") {
    const rows = await prisma.interaction.findMany({
      where: { customer: { workspaceId } },
      orderBy: [{ customerId: "asc" }, { occurredAt: "asc" }],
      include: { customer: { select: { ref: true, name: true } } },
    });
    return toCsv(["customer", "date", "type", "severity", "text"], rows.map((r) => [r.customer.ref ?? r.customer.name, r.occurredAt, r.type, r.severity, r.text]));
  }

  if (kind === "usage") {
    const rows = await prisma.usageSnapshot.findMany({
      where: { customer: { workspaceId } },
      orderBy: [{ customerId: "asc" }, { occurredAt: "asc" }],
      include: { customer: { select: { ref: true, name: true } }, capability: true },
    });
    return toCsv(["customer", "capability", "metric_type", "date", "value"], rows.map((r) => [r.customer.ref ?? r.customer.name, r.capability.name, r.capability.metricType, r.occurredAt, Number(r.value)]));
  }

  if (kind === "outcomes") {
    const rows = await prisma.outcomeEvent.findMany({
      where: { customer: { workspaceId } },
      orderBy: [{ customerId: "asc" }, { occurredAt: "asc" }],
      include: { customer: { select: { ref: true, name: true } } },
    });
    return toCsv(["customer", "date", "type", "notes"], rows.map((r) => [r.customer.ref ?? r.customer.name, r.occurredAt, r.type, r.notes]));
  }

  // recommendations: a report of the AI's proposed actions, not importable
  const actions = await prisma.agentAction.findMany({
    where: { workspaceId },
    orderBy: [{ area: "asc" }, { createdAt: "asc" }],
    include: { customer: { select: { ref: true, name: true } } },
  });
  return toCsv(
    ["area", "customer_ref", "customer", "headline", "reasoning", "suggested_next_step", "status", "impact_arr", "confidence", "created"],
    actions.map((a) => [a.area, a.customer.ref, a.customer.name, a.headline, a.reasoning, a.suggestedNextStep, a.status, a.impactArr === null ? null : Number(a.impactArr), a.confidenceLevel, a.createdAt])
  );
}
