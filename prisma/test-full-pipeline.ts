import { PrismaClient } from "@prisma/client";
import { computeBaseline } from "../src/lib/health/baseline";
import { computeAgenticLayer } from "../src/lib/health/agenticLayer";
import { decryptSecret } from "../src/lib/workspaceSecret";

const p = new PrismaClient();

(async () => {
  const names = ["Northwind Traders", "Fenwick Logistics", "Silent Freight Ltd"];
  for (const name of names) {
    const c = await p.customer.findFirstOrThrow({ where: { name } });
    const workspace = await p.workspace.findUniqueOrThrow({ where: { id: c.workspaceId } });
    if (!workspace.anthropicApiKeyEncrypted) {
      console.log(`\n=== ${name} === skipped - "${workspace.name}" has no Anthropic key configured in Settings.`);
      continue;
    }
    const apiKey = decryptSecret(workspace.anthropicApiKeyEncrypted);
    const { baselineScore, drivers } = await computeBaseline(c.id);
    const agentic = await computeAgenticLayer(c.id, baselineScore, drivers, apiKey);
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
