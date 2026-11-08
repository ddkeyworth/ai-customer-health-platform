// Assert-based regression check for the demo date refresh
// (src/lib/demoDates.ts): customer facts move by exactly N days, nulls stay
// null, real AI-run timestamps and other workspaces are untouched, dates
// quoted in AI text move with the data, and the day-count headlines are
// recalculated. Creates two throwaway workspaces; deletes everything.
import { PrismaClient } from "@prisma/client";
import { shiftQuotedDates, shiftWorkspaceDates } from "../src/lib/demoDates";

const prisma = new PrismaClient();
const DAY = 86_400_000;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  assert(shiftQuotedDates("On 21 September the call", 10, 2026) === "On 1 October the call", "A quoted date moves forward across a month end");
  assert(shiftQuotedDates("28 December and 3 January", 5, 2026) === "2 January and 8 January", "Quoted dates roll over the year end");
  assert(
    shiftQuotedDates("usage fell 55% over 210 days", 10, 2026) === "usage fell 55% over 210 days",
    "Numbers and durations that are not dates are left alone"
  );

  const t0 = new Date("2026-03-01T00:00:00.000Z");
  const wsA = await prisma.workspace.create({ data: { name: "Test Dates A - safe to delete", createdAt: t0 } });
  const wsB = await prisma.workspace.create({ data: { name: "Test Dates B - safe to delete", createdAt: t0 } });
  const mk = async (workspaceId: string, name: string) => {
    const c = await prisma.customer.create({ data: { workspaceId, name, tier: "enterprise" } });
    const product = await prisma.product.create({ data: { workspaceId, name: `P ${name}` } });
    return { c, product };
  };
  const a = await mk(wsA.id, "A");
  const b = await mk(wsB.id, "B");

  const renewal = new Date("2026-03-20T00:00:00.000Z");
  const cpA = await prisma.customerProduct.create({
    data: {
      customerId: a.c.id,
      productId: a.product.id,
      renewalDate: renewal,
      expectedGoLiveDate: new Date("2026-02-20T00:00:00.000Z"),
      lifecycleStatus: "onboarding",
    },
  });
  const cpB = await prisma.customerProduct.create({ data: { customerId: b.c.id, productId: b.product.id, renewalDate: renewal } });
  const ranAt = new Date("2026-03-02T09:00:00.000Z");
  const action = await prisma.agentAction.create({
    data: {
      workspaceId: wsA.id,
      customerId: a.c.id,
      subjectId: cpA.id,
      area: "onboarding",
      actionType: "recovery_plan",
      headline: "9 days overdue - customer delay",
      reasoning: "The kickoff was rescheduled on 21 February.",
      confidenceLevel: "early_read",
      metadata: { stalledReason: "customer_delay", daysOverdue: 9 },
      createdAt: ranAt,
    },
  });
  const interaction = await prisma.interaction.create({
    data: { customerId: a.c.id, type: "ticket", text: "x", occurredAt: new Date("2026-02-21T00:00:00.000Z") },
  });

  try {
    await shiftWorkspaceDates(wsA.id, 10);

    const cpAAfter = await prisma.customerProduct.findUniqueOrThrow({ where: { id: cpA.id } });
    assert(cpAAfter.renewalDate!.getTime() === renewal.getTime() + 10 * DAY, "The renewal date moves forward by exactly 10 days");
    assert(cpAAfter.actualGoLiveDate === null && cpAAfter.initialGoLiveDate === null, "Dates that were null stay null");
    const iAfter = await prisma.interaction.findUniqueOrThrow({ where: { id: interaction.id } });
    assert(
      iAfter.occurredAt.getTime() === new Date("2026-02-21T00:00:00.000Z").getTime() + 10 * DAY,
      "Ticket dates move by the same 10 days, so relative facts are unchanged"
    );

    const cpBAfter = await prisma.customerProduct.findUniqueOrThrow({ where: { id: cpB.id } });
    assert(cpBAfter.renewalDate!.getTime() === renewal.getTime(), "Another workspace's dates are untouched");

    const actAfter = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert(actAfter.createdAt.getTime() === ranAt.getTime(), "When an AI run actually happened is not shifted, so nothing can end up dated in the future");
    assert(actAfter.reasoning === "The kickoff was rescheduled on 3 March.", "A date quoted in AI text moves with the data");
    assert(
      actAfter.headline.includes("days overdue - customer delay") && !actAfter.headline.startsWith("9 days"),
      "The day-count headline is recalculated from the shifted dates, not left stale"
    );

    const wsAAfter = await prisma.workspace.findUniqueOrThrow({ where: { id: wsA.id } });
    assert(wsAAfter.createdAt.getTime() === t0.getTime() + 10 * DAY, "The reference date moves forward by the days shifted, so the next refresh measures from here");

    let refused = false;
    try {
      await shiftWorkspaceDates(wsA.id, 0);
    } catch {
      refused = true;
    }
    assert(refused, "A zero or negative shift is refused");
  } finally {
    await prisma.interaction.deleteMany({ where: { customerId: a.c.id } });
    await prisma.agentAction.deleteMany({ where: { workspaceId: wsA.id } });
    await prisma.customerProduct.deleteMany({ where: { id: { in: [cpA.id, cpB.id] } } });
    await prisma.product.deleteMany({ where: { id: { in: [a.product.id, b.product.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [a.c.id, b.c.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA.id, wsB.id] } } });
  }

  console.log("\nAll demo-date checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
