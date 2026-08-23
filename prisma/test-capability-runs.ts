// Assert-based regression check for src/lib/capabilityRuns.ts - the shared
// "what's due" logic behind both the Run Now button and the daily cron.
// Deliberately does NOT exercise runCapability()'s success path here (that
// would mean a real Anthropic call) - covered instead by the CLI script and
// live Settings verification. This tests the pure date-math and the
// no-key-configured guard, both zero-cost.
import { PrismaClient } from "@prisma/client";
import { getRunConfig, setSchedule, isDue, runCapability } from "../src/lib/capabilityRuns";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

(async () => {
  const now = new Date();

  // isDue() - pure logic, no database involved.
  assert(!isDue({ schedule: "on_demand", lastRunAt: null }, now), "on_demand with no prior run is never automatically due");
  assert(!isDue({ schedule: "on_demand", lastRunAt: hoursAgo(1000) }, now), "on_demand stays never-due no matter how long ago it last ran");
  assert(isDue({ schedule: "daily", lastRunAt: null }, now), "daily with no prior run is due immediately");
  assert(!isDue({ schedule: "daily", lastRunAt: hoursAgo(23) }, now), "daily run 23h ago is not yet due");
  assert(isDue({ schedule: "daily", lastRunAt: hoursAgo(25) }, now), "daily run 25h ago is due");
  assert(isDue({ schedule: "weekly", lastRunAt: null }, now), "weekly with no prior run is due immediately");
  assert(!isDue({ schedule: "weekly", lastRunAt: hoursAgo(6 * 24) }, now), "weekly run 6 days ago is not yet due");
  assert(isDue({ schedule: "weekly", lastRunAt: hoursAgo(8 * 24) }, now), "weekly run 8 days ago is due");

  // getRunConfig/setSchedule round-trip against a real throwaway workspace.
  const testWorkspace = await prisma.workspace.create({ data: { name: "Test Capability Runs Workspace - safe to delete" } });
  try {
    const defaultConfig = await getRunConfig(testWorkspace.id, "health");
    assert(defaultConfig.schedule === "on_demand" && defaultConfig.lastRunAt === null, "A workspace with no saved row defaults to on_demand, never automatically due");

    await setSchedule(testWorkspace.id, "health", "daily");
    const afterSet = await getRunConfig(testWorkspace.id, "health");
    assert(afterSet.schedule === "daily", "setSchedule persists and getRunConfig reads it back correctly");

    // runCapability() must refuse to run for a workspace with no Anthropic
    // key configured - the actual enforcement of "no fallback to a shared
    // platform key," checked without needing a real API call.
    let threw = false;
    try {
      await runCapability(testWorkspace.id, "health");
    } catch {
      threw = true;
    }
    assert(threw, "runCapability refuses to run for a workspace with no Anthropic API key configured");
  } finally {
    await prisma.capabilityRunConfig.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await prisma.workspace.delete({ where: { id: testWorkspace.id } });
  }

  console.log("\nAll capability-run checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
