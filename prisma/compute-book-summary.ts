// Computes and stores a whole-book executive summary for a workspace. One
// Anthropic call, not one per customer - see src/lib/health/bookSummary.ts.
// Requires the workspace's own Anthropic key (see Settings) - no fallback.
// Run with an explicit workspace ID: npx tsx prisma/compute-book-summary.ts <workspaceId>
import { PrismaClient } from "@prisma/client";
import { computeBookSummary } from "../src/lib/health/bookSummary";
import { decryptSecret } from "../src/lib/workspaceSecret";

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    throw new Error("Usage: npx tsx prisma/compute-book-summary.ts <workspaceId>");
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!workspace.anthropicApiKeyEncrypted) {
    console.log(`Skipping "${workspace.name}" - no Anthropic API key configured in Settings.`);
    return;
  }
  const apiKey = decryptSecret(workspace.anthropicApiKeyEncrypted);

  const customers = await prisma.customer.findMany({ where: { workspaceId } });

  console.log(`Computing book summary across ${customers.length} customers...`);
  const summary = await computeBookSummary(customers.map((c) => c.id), apiKey);

  await prisma.bookSummary.create({
    data: { workspaceId, scopeKey: "all", summary },
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
