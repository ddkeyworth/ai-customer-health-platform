// Assert-based regression check for Renewal's real churn-model rebuild
// (src/lib/renewal/churnModel.ts) - the real outcome-based rate per Health
// band, with a per-band fallback to the illustrative table where there
// isn't yet enough recorded history. Creates a real, throwaway workspace
// with its own customer, snapshot, and outcome events; deletes everything
// it created.
import { PrismaClient } from "@prisma/client";
import { computeBaselineChurnRates, MIN_SAMPLE_SIZE, ILLUSTRATIVE_CHURN_LIKELIHOOD } from "../src/lib/renewal/churnModel";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  const workspace = await prisma.workspace.create({ data: { name: "Test Churn Model Workspace - safe to delete" } });
  const customer = await prisma.customer.create({
    data: { workspaceId: workspace.id, name: "Test Churn Model Customer", tier: "enterprise" },
  });
  const snapshot = await prisma.healthScoreSnapshot.create({
    data: { customerId: customer.id, baselineScore: 30, compositeScore: 30, tierLabel: "Critical", driverValues: {} },
  });

  const events = await Promise.all([
    prisma.outcomeEvent.create({ data: { customerId: customer.id, type: "churned", occurredAt: new Date() } }),
    prisma.outcomeEvent.create({ data: { customerId: customer.id, type: "churned", occurredAt: new Date() } }),
    prisma.outcomeEvent.create({ data: { customerId: customer.id, type: "renewed", occurredAt: new Date() } }),
  ]);

  try {
    const rates = await computeBaselineChurnRates(workspace.id);

    assert(rates.Critical.source === "outcome_history", "Critical, with 3 recorded outcomes, uses the real observed rate, not the illustrative fallback");
    assert(rates.Critical.sampleSize === MIN_SAMPLE_SIZE, "Critical's sample size correctly counts all 3 recorded outcomes");
    assert(Math.abs(rates.Critical.rate - 2 / 3) < 1e-9, "Critical's observed rate is exactly 2 churned of 3 recorded outcomes");

    assert(rates.Watch.source === "illustrative_fallback", "Watch, with zero recorded outcomes in this workspace, falls back to the illustrative table");
    assert(rates.Watch.rate === ILLUSTRATIVE_CHURN_LIKELIHOOD.Watch, "Watch's fallback rate matches the illustrative constant exactly");
    assert(rates.Watch.sampleSize === 0, "Watch's fallback correctly reports zero real sample size, not a fabricated one");
  } finally {
    await prisma.outcomeEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
    await prisma.healthScoreSnapshot.delete({ where: { id: snapshot.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }

  console.log("\nAll churn-model checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
