import { PrismaClient } from "@prisma/client";
import { computeBaseline, disconnectHealthPrisma } from "../src/lib/health/baseline";

const p = new PrismaClient();

(async () => {
  const names = ["Northwind Traders", "Fenwick Logistics", "Silent Freight Ltd"];
  for (const name of names) {
    const c = await p.customer.findFirstOrThrow({ where: { name } });
    const { baselineScore, drivers } = await computeBaseline(c.id);
    console.log(`\n=== ${name} === baselineScore: ${baselineScore}`);
    for (const d of drivers) {
      console.log(`  ${d.label}: ${d.score === null ? "n/a" : d.score.toFixed(0)} - ${d.detail}`);
    }
  }
  await p.$disconnect();
  await disconnectHealthPrisma();
})();
