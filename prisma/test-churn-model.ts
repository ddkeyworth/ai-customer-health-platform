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
  // One customer per Health band under test, each with a snapshot in that
  // band and a controlled number of outcome events.
  const customers: { id: string }[] = [];
  const snapshotIds: string[] = [];
  const eventIds: string[] = [];

  async function seedBand(tierLabel: string, churned: number, other: number) {
    const customer = await prisma.customer.create({
      data: { workspaceId: workspace.id, name: `Test Churn Model ${tierLabel}`, tier: "enterprise" },
    });
    customers.push(customer);
    const snapshot = await prisma.healthScoreSnapshot.create({
      data: { customerId: customer.id, baselineScore: 30, compositeScore: 30, tierLabel, driverValues: {} },
    });
    snapshotIds.push(snapshot.id);
    for (let i = 0; i < churned + other; i++) {
      const event = await prisma.outcomeEvent.create({
        data: { customerId: customer.id, type: i < churned ? "churned" : "renewed", occurredAt: new Date() },
      });
      eventIds.push(event.id);
    }
  }

  // Exactly at the threshold: 2 churned out of MIN_SAMPLE_SIZE.
  await seedBand("Critical", 2, MIN_SAMPLE_SIZE - 2);
  // One below the threshold: must fall back, however extreme the numbers look.
  await seedBand("Stable", MIN_SAMPLE_SIZE - 1, 0);

  try {
    const rates = await computeBaselineChurnRates(workspace.id);

    assert(rates.Critical.source === "outcome_history", `Critical, with exactly ${MIN_SAMPLE_SIZE} recorded outcomes, uses the real observed rate`);
    assert(rates.Critical.sampleSize === MIN_SAMPLE_SIZE, "Critical's sample size counts every recorded outcome");
    assert(Math.abs(rates.Critical.rate - 2 / MIN_SAMPLE_SIZE) < 1e-9, `Critical's observed rate is exactly 2 churned of ${MIN_SAMPLE_SIZE}`);

    assert(rates.Stable.source === "illustrative_fallback", `Stable, with ${MIN_SAMPLE_SIZE - 1} outcomes (one below the minimum), falls back even though every one of them churned`);
    assert(rates.Stable.rate === ILLUSTRATIVE_CHURN_LIKELIHOOD.Stable, "Stable's fallback rate matches the illustrative constant, not the tiny-sample 100%");
    assert(rates.Stable.sampleSize === MIN_SAMPLE_SIZE - 1, "Stable's fallback still reports its true sample size");

    assert(rates.Watch.source === "illustrative_fallback", "Watch, with zero recorded outcomes in this workspace, falls back to the illustrative table");
    assert(rates.Watch.rate === ILLUSTRATIVE_CHURN_LIKELIHOOD.Watch, "Watch's fallback rate matches the illustrative constant exactly");
    assert(rates.Watch.sampleSize === 0, "Watch's fallback correctly reports zero real sample size, not a fabricated one");
  } finally {
    await prisma.outcomeEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.healthScoreSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }

  console.log("\nAll churn-model checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
