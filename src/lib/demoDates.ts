// Keeps the demo workspace's dates fresh without a reseed (a reseed wipes
// every stored AI result, which costs real money to regenerate). Every
// time-anchored customer fact (go-live and renewal dates, tickets, usage,
// surveys, events, training, champion contact, outcomes) moves forward by
// the same number of whole days, so every relative fact stays true:
// "champion silent 210 days" and "payment 45 days late" are unchanged,
// while "renews on 14 Nov" and "15 days to renewal" move with the calendar.
//
// Two things move with the data so stored AI text does not contradict it:
// dates quoted inside AI text (e.g. "21 September"), and the "N days
// overdue" / "N days to renewal" headlines, which are recalculated.
//
// Deliberately NOT shifted: when an AI run actually happened (computedAt,
// createdAt, lastRunAt, snoozeUntil). Those are real moments, and shifting
// them would put some in the future after a later real run.
//
// The reference date is the demo workspace's createdAt, which seed.ts sets
// to the moment it ran. Each refresh moves it forward by the days shifted.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDaysOverdue } from "@/lib/onboarding/pace";

const DAY_MS = 86_400_000;
export const REFRESH_AFTER_DAYS = 7;

// Fixed allowlist of table/column names, never user input, so it is safe to
// splice into SQL with Prisma.raw.
const CUSTOMER_DATE_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "customer_products", columns: ["initialGoLiveDate", "expectedGoLiveDate", "actualGoLiveDate", "renewalDate"] },
  { table: "interactions", columns: ["occurredAt"] },
  { table: "usage_snapshots", columns: ["occurredAt"] },
  { table: "survey_responses", columns: ["occurredAt"] },
  { table: "event_attendance", columns: ["occurredAt"] },
  { table: "training_completions", columns: ["occurredAt"] },
  { table: "stakeholders", columns: ["lastEngagedAt"] },
  { table: "outcome_events", columns: ["occurredAt"] },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const QUOTED_DATE = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join("|")})\\b`, "g");

// Moves every "21 September" style date in a piece of text forward by
// `days`. The text carries no year, so `refYear` (the year those dates were
// written in) is needed to do the arithmetic correctly across month ends.
export function shiftQuotedDates(text: string, days: number, refYear: number): string {
  return text.replace(QUOTED_DATE, (_m, d: string, month: string) => {
    const shifted = new Date(Date.UTC(refYear, MONTHS.indexOf(month), Number(d)) + days * DAY_MS);
    return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}`;
  });
}

export async function shiftWorkspaceDates(workspaceId: string, days: number): Promise<void> {
  if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive whole number");
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const refYear = workspace.createdAt.getUTCFullYear();

  await prisma.$transaction(
    async (tx) => {
      for (const { table, columns } of CUSTOMER_DATE_COLUMNS) {
        const sets = columns.map((c) => Prisma.sql`${Prisma.raw(`"${c}"`)} = ${Prisma.raw(`"${c}"`)} + (${days} * interval '1 day')`);
        await tx.$executeRaw`UPDATE ${Prisma.raw(table)} SET ${Prisma.join(sets)} WHERE "customerId" IN (SELECT id FROM customers WHERE "workspaceId" = ${workspaceId})`;
      }

      // Dates quoted inside stored AI text move with the data.
      const actions = await tx.agentAction.findMany({ where: { workspaceId } });
      for (const a of actions) {
        const meta = a.metadata as { riskFactors?: string[] } | null;
        await tx.agentAction.update({
          where: { id: a.id },
          data: {
            headline: shiftQuotedDates(a.headline, days, refYear),
            reasoning: shiftQuotedDates(a.reasoning, days, refYear),
            suggestedNextStep: a.suggestedNextStep ? shiftQuotedDates(a.suggestedNextStep, days, refYear) : null,
            ...(meta?.riskFactors
              ? { metadata: { ...meta, riskFactors: meta.riskFactors.map((f) => shiftQuotedDates(f, days, refYear)) } }
              : {}),
          },
        });
      }
      const snaps = await tx.healthScoreSnapshot.findMany({ where: { customer: { workspaceId } }, select: { id: true, narrative: true, adjustmentReason: true } });
      for (const s of snaps) {
        await tx.healthScoreSnapshot.update({
          where: { id: s.id },
          data: {
            narrative: s.narrative ? shiftQuotedDates(s.narrative, days, refYear) : null,
            adjustmentReason: s.adjustmentReason ? shiftQuotedDates(s.adjustmentReason, days, refYear) : null,
          },
        });
      }
      const summaries = await tx.bookSummary.findMany({ where: { workspaceId } });
      for (const b of summaries) {
        await tx.bookSummary.update({ where: { id: b.id }, data: { summary: shiftQuotedDates(b.summary, days, refYear) } });
      }

      await tx.workspace.update({ where: { id: workspaceId }, data: { createdAt: new Date(workspace.createdAt.getTime() + days * DAY_MS) } });
    },
    { timeout: 60_000 }
  );

  await refreshActionHeadlines(workspaceId);
}

// Recalculates the two headlines that embed a day count from the (now
// shifted) dates, using the same wording the capabilities write.
export async function refreshActionHeadlines(workspaceId: string, now: Date = new Date()): Promise<void> {
  const onboarding = await prisma.agentAction.findMany({ where: { workspaceId, area: "onboarding" } });
  for (const a of onboarding) {
    const cp = a.subjectId ? await prisma.customerProduct.findUnique({ where: { id: a.subjectId } }) : null;
    const meta = a.metadata as { stalledReason?: string | null } | null;
    const overdue = cp?.expectedGoLiveDate ? computeDaysOverdue(cp.expectedGoLiveDate, now) : null;
    if (overdue === null || overdue <= 0) continue;
    await prisma.agentAction.update({
      where: { id: a.id },
      data: {
        headline: `${overdue} days overdue - ${meta?.stalledReason?.replace("_", " ") ?? "unclear reason"}`,
        metadata: { ...(a.metadata as object), daysOverdue: overdue },
      },
    });
  }

  const renewal = await prisma.agentAction.findMany({ where: { workspaceId, area: "renewal" } });
  for (const a of renewal) {
    const cp = a.subjectId ? await prisma.customerProduct.findUnique({ where: { id: a.subjectId } }) : null;
    const meta = a.metadata as { adjustedLikelihood?: number } | null;
    if (!cp?.renewalDate || meta?.adjustedLikelihood === undefined) continue;
    const daysToRenewal = Math.round((cp.renewalDate.getTime() - now.getTime()) / DAY_MS);
    await prisma.agentAction.update({
      where: { id: a.id },
      data: {
        headline: `${Math.round(meta.adjustedLikelihood * 100)}% churn risk - ${
          daysToRenewal >= 0 ? `${daysToRenewal} days to renewal` : `renewal date passed ${-daysToRenewal} days ago`
        }`,
      },
    });
  }
}

// Called from the daily cron. A no-op until the reference date is a week
// old, so the demo drifts by at most a week before it is refreshed.
export async function refreshDemoDatesIfDue(now: Date = new Date()): Promise<{ shiftedDays: number } | null> {
  const demo = await prisma.workspace.findFirst({ where: { isDemoSeed: true } });
  if (!demo) return null;
  const elapsed = Math.floor((now.getTime() - demo.createdAt.getTime()) / DAY_MS);
  if (elapsed < REFRESH_AFTER_DAYS) return null;
  await shiftWorkspaceDates(demo.id, elapsed);
  return { shiftedDays: elapsed };
}
