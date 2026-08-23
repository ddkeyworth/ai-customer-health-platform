// CLI entry point - real logic lives in src/lib/health/computeHealthScores.ts
// so it can also be imported by src/lib/capabilityRuns.ts (Run Now / the
// daily cron) without this file's own main() running as a side effect.
//
// Usage: npx tsx prisma/compute-health-scores.ts [workspaceId]
// With no argument, processes every workspace that has an Anthropic key
// configured in Settings, one after another.
import { PrismaClient } from "@prisma/client";
import { computeHealthScoresForWorkspace } from "../src/lib/health/computeHealthScores";

const prisma = new PrismaClient();

async function main() {
  const argWorkspaceId = process.argv[2];

  if (argWorkspaceId) {
    await computeHealthScoresForWorkspace(argWorkspaceId);
  } else {
    const workspaces = await prisma.workspace.findMany({ where: { anthropicApiKeyEncrypted: { not: null } } });
    for (const ws of workspaces) {
      await computeHealthScoresForWorkspace(ws.id);
    }
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
