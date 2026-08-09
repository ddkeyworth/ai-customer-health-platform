import { PrismaClient } from "@prisma/client";
import { computeBaseline } from "../src/lib/health/baseline";
import { computeAgenticLayer } from "../src/lib/health/agenticLayer";

const p = new PrismaClient();

(async () => {
  const names = ["Northwind Traders", "Fenwick Logistics", "Silent Freight Ltd"];
  for (const name of names) {
    const c = await p.customer.findFirstOrThrow({ where: { name } });
    const { baselineScore, drivers } = await computeBaseline(c.id);
    const agentic = await computeAgenticLayer(c.id, baselineScore, drivers);
    const composite = Math.max(0, Math.min(100, baselineScore + agentic.adjustmentDelta));

    console.log(`\n=== ${name} ===`);
    console.log(`baselineScore: ${baselineScore}`);
    console.log(`adjustmentDelta: ${agentic.adjustmentDelta}`);
    console.log(`adjustmentReason: ${agentic.adjustmentReason ?? "(none)"}`);
    console.log(`compositeScore: ${composite}`);
    console.log(`confidenceLevel: ${agentic.confidenceLevel}`);
    console.log(`narrative: ${agentic.narrative}`);
    console.log(`competitorMentions: ${JSON.stringify(agentic.competitorMentions)}`);
  }
  await p.$disconnect();
})();
