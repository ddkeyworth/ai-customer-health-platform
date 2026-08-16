// One-off batch: computes and stores a whole-book executive summary.
// One Anthropic call, not one per customer - see src/lib/health/bookSummary.ts.
import { PrismaClient } from "@prisma/client";
import { computeBookSummary } from "../src/lib/health/bookSummary";

const prisma = new PrismaClient();

async function main() {
  const workspace = await prisma.workspace.findFirstOrThrow();
  const customers = await prisma.customer.findMany({ where: { workspaceId: workspace.id } });

  console.log(`Computing book summary across ${customers.length} customers...`);
  const summary = await computeBookSummary(customers.map((c) => c.id));

  await prisma.bookSummary.create({
    data: { workspaceId: workspace.id, scopeKey: "all", summary },
  });

  console.log(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
