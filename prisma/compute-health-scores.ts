// One-off batch: computes and stores a HealthScoreSnapshot for every
// Customer. Deliberately NOT run live on every page load - that would
// mean an Anthropic API call every time someone views the Health page.
// Re-run this manually whenever the seed data changes. See README.md.

import { PrismaClient } from "@prisma/client";
import { computeBaseline } from "../src/lib/health/baseline";
import { computeAgenticLayer } from "../src/lib/health/agenticLayer";

const prisma = new PrismaClient();

function tierLabelFor(score: number): string {
  if (score >= 85) return "Thriving";
  if (score >= 60) return "Stable";
  if (score >= 40) return "Watch";
  return "Critical";
}

async function main() {
  const customers = await prisma.customer.findMany();
  console.log(`Computing Health scores for ${customers.length} customers...`);

  for (const customer of customers) {
    const { baselineScore, drivers } = await computeBaseline(customer.id);
    const agentic = await computeAgenticLayer(customer.id, baselineScore, drivers);
    const compositeScore = Math.max(0, Math.min(100, baselineScore + agentic.adjustmentDelta));

    await prisma.healthScoreSnapshot.create({
      data: {
        customerId: customer.id,
        baselineScore,
        adjustmentDelta: agentic.adjustmentDelta,
        adjustmentReason: agentic.adjustmentReason,
        compositeScore,
        tierLabel: tierLabelFor(compositeScore),
        confidenceLevel: agentic.confidenceLevel,
        driverValues: drivers as unknown as object,
        narrative: agentic.narrative,
      },
    });

    console.log(`  ${customer.name}: baseline ${baselineScore}, adjustment ${agentic.adjustmentDelta}, composite ${compositeScore}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
