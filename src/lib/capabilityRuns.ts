// Shared "how often does this workspace's own capability run" logic - used
// by both the Run Now Server Action (src/app/settings/actions.ts) and the
// daily cron route (src/app/api/cron/run-capabilities/route.ts), so there is
// exactly one place that decides what's due and one place that dispatches
// to the right compute function.
//
// Defaults to "on_demand" (never runs automatically) for any
// workspace/capability with no saved row - a workspace does nothing, and
// spends nothing, until it explicitly opts into a schedule or clicks Run
// Now. "capability" is a plain string checked against an allowlist here,
// not a Prisma enum, so adding a new one later (onboarding, adoption, ...)
// is a one-line code change, not a migration - same pattern as
// ALLOWED_DATE_FORMATS in settingsValidation.ts.
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/workspaceSecret";
import { computeHealthScoresForWorkspace } from "@/lib/health/computeHealthScores";

export const ALLOWED_CAPABILITIES = ["health"] as const;
export type Capability = (typeof ALLOWED_CAPABILITIES)[number];

export const ALLOWED_SCHEDULES = ["on_demand", "daily", "weekly"] as const;
export type Schedule = (typeof ALLOWED_SCHEDULES)[number];

const SCHEDULE_INTERVAL_MS: Record<Exclude<Schedule, "on_demand">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export interface RunConfig {
  schedule: Schedule;
  lastRunAt: Date | null;
}

export async function getRunConfig(workspaceId: string, capability: Capability): Promise<RunConfig> {
  const row = await prisma.capabilityRunConfig.findUnique({
    where: { workspaceId_capability: { workspaceId, capability } },
  });
  if (!row) return { schedule: "on_demand", lastRunAt: null };
  return { schedule: row.schedule as Schedule, lastRunAt: row.lastRunAt };
}

// on_demand is never automatically due - it only ever runs via an explicit
// Run Now click, never the cron.
export function isDue(config: RunConfig, now: Date): boolean {
  if (config.schedule === "on_demand") return false;
  if (!config.lastRunAt) return true;
  return now.getTime() - config.lastRunAt.getTime() >= SCHEDULE_INTERVAL_MS[config.schedule];
}

export async function setSchedule(workspaceId: string, capability: Capability, schedule: Schedule): Promise<void> {
  await prisma.capabilityRunConfig.upsert({
    where: { workspaceId_capability: { workspaceId, capability } },
    create: { workspaceId, capability, schedule },
    update: { schedule },
  });
}

async function recordRun(workspaceId: string, capability: Capability, now: Date): Promise<void> {
  await prisma.capabilityRunConfig.upsert({
    where: { workspaceId_capability: { workspaceId, capability } },
    create: { workspaceId, capability, lastRunAt: now },
    update: { lastRunAt: now },
  });
}

// The single dispatch point - both Run Now and the cron call this, so
// there's one place that decides what actually happens for a capability,
// and one place that enforces "no key configured means it doesn't run."
export async function runCapability(workspaceId: string, capability: Capability): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!workspace.anthropicApiKeyEncrypted) {
    throw new Error(`Workspace "${workspace.name}" has no Anthropic API key configured - cannot run "${capability}".`);
  }
  decryptSecret(workspace.anthropicApiKeyEncrypted); // fail fast if the stored value is somehow corrupt, before doing any work

  if (capability === "health") {
    await computeHealthScoresForWorkspace(workspaceId);
  }

  await recordRun(workspaceId, capability, new Date());
}
