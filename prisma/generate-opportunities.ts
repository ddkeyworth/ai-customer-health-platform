// Rule-based opportunity generation for the demo workspace (deterministic, no
// API call). The logic lives in src/lib/expansion/generateOpportunities.ts so
// the app's own "Find expansion opportunities" button uses exactly the same
// rules. This script first clears the demo's opportunities, as a reseed expects.
import { PrismaClient } from "@prisma/client";
import { generateOpportunitiesForWorkspace } from "../src/lib/expansion/generateOpportunities";

const prisma = new PrismaClient();

async function main() {
  const demo = await prisma.workspace.findFirstOrThrow({ where: { isDemoSeed: true } });
  await prisma.opportunity.deleteMany({ where: { customer: { workspaceId: demo.id } } });
  const { created, accounts } = await generateOpportunitiesForWorkspace(demo.id);
  console.log(`Created ${created} opportunities across ${accounts} live accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
