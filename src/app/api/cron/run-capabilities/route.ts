// Daily Vercel Cron job (see vercel.json) - the only frequency Vercel's
// Hobby plan allows. Checks every workspace x capability pair and runs
// whichever are actually due per their own configured schedule (isDue()
// handles "daily" vs "weekly" against lastRunAt), so "weekly" still means
// roughly every 7 days even though this check itself runs every day.
// "on_demand" (the default) is never due here - it only ever runs via the
// Run Now button in Settings.
//
// Locked down with CRON_SECRET (see src/lib/rateLimit.ts's README note
// on why this matters): without it, anyone who found this URL could
// trigger every workspace's own Anthropic key to spend money on demand.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ALLOWED_CAPABILITIES, getRunConfig, isDue } from "@/lib/capabilityRuns";
import { getActiveRun } from "@/lib/capabilityBatches";
import { advanceCapabilityRun } from "@/lib/capabilityWork";
import { refreshDemoDatesIfDue } from "@/lib/demoDates";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // One function call may live 300 seconds. Stop starting new work after this
  // many, and stop each step early enough for its slowest chunk to finish.
  const CRON_BUDGET_MS = 200_000;
  const startedAt = Date.now();
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });

  const results: { workspace: string; capability: string; outcome: string }[] = [];

  for (const workspace of workspaces) {
    for (const capability of ALLOWED_CAPABILITIES) {
      const config = await getRunConfig(workspace.id, capability);
      const unfinished = await getActiveRun(workspace.id, capability);
      if (!isDue(config, now) && !unfinished) continue;

      const remaining = CRON_BUDGET_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        results.push({ workspace: workspace.name, capability, outcome: "waiting for the next run" });
        continue;
      }

      try {
        const progress = await advanceCapabilityRun(workspace.id, capability, { startNew: true, budgetMs: remaining });
        results.push({
          workspace: workspace.name,
          capability,
          outcome: progress.status === "done" ? "ran" : `${progress.status} ${progress.processed}/${progress.total}`,
        });
      } catch (e) {
        console.error(`Cron: "${workspace.name}"/${capability} failed`, e);
        results.push({ workspace: workspace.name, capability, outcome: "error" });
      }
    }
  }

  // Expired sessions are dead weight, and on the demo they carry a visitor's
  // per-visit changes, which should disappear with the visit.
  try {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  } catch (e) {
    console.error("Cron: expired-session cleanup failed", e);
  }

  // Keeps the demo workspace's dates current (no AI cost, a no-op until the
  // reference date is a week old). See src/lib/demoDates.ts.
  let demoDates: { shiftedDays: number } | null = null;
  try {
    demoDates = await refreshDemoDatesIfDue(now);
  } catch (e) {
    console.error("Cron: demo date refresh failed", e);
  }

  return NextResponse.json({ checkedAt: now.toISOString(), results, demoDates });
}
