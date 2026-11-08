// Daily Vercel Cron job (see vercel.json) - the only frequency Vercel's
// Hobby plan allows. Checks every workspace x capability pair and runs
// whichever are actually due per their own configured schedule (isDue()
// handles "daily" vs "weekly" against lastRunAt), so "weekly" still means
// roughly every 7 days even though this check itself runs every day.
// "on_demand" (the default) is never due here - it only ever runs via the
// Run Now button in Settings.
//
// Order of work, on purpose:
//   1. cheap housekeeping first (expired sessions, expired rate-limit rows,
//      demo dates), so it always happens however long the AI work takes;
//   2. the AI work, oldest-waiting first and with an equal share of the time
//      each, so one large workspace cannot starve the others;
//   3. it never starts a step it could not finish inside the hosting limit.
//
// Locked down with CRON_SECRET (see src/lib/rateLimit.ts's README note
// on why this matters): without it, anyone who found this URL could
// trigger every workspace's own Anthropic key to spend money on demand.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ALLOWED_CAPABILITIES, getRunConfig, isDue, type Capability } from "@/lib/capabilityRuns";
import { DEFAULT_BUDGET_MS, fairOrder, getActiveRun, runHousekeeping, sliceBudget } from "@/lib/capabilityBatches";
import { advanceCapabilityRun, worstChunkMsFor } from "@/lib/capabilityWork";
import { refreshDemoDatesIfDue } from "@/lib/demoDates";

export const maxDuration = 300;

// Time kept back after the housekeeping for the response itself.
const HOUSEKEEPING_ALLOWANCE_MS = 10_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startedAt = Date.now();

  // ---- 1. housekeeping ----
  // Expired sessions and expired rate-limit rows (see runHousekeeping).
  try {
    await runHousekeeping(now);
  } catch (e) {
    console.error("Cron: housekeeping failed", e);
  }

  // Keeps the demo workspace's dates current (no AI cost, a no-op until the
  // reference date is a week old). See src/lib/demoDates.ts.
  let demoDates: { shiftedDays: number } | null = null;
  try {
    demoDates = await refreshDemoDatesIfDue(now);
  } catch (e) {
    console.error("Cron: demo date refresh failed", e);
  }

  // ---- 2. the AI work ----
  // One function call may live 300 seconds. Everything below shares what is left.
  const totalBudgetMs = DEFAULT_BUDGET_MS - HOUSEKEEPING_ALLOWANCE_MS;
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });

  // Gather everything that is due or unfinished first, then order it fairly.
  const candidates: { workspaceId: string; workspace: string; capability: Capability; lastRunAt: Date | null }[] = [];
  for (const workspace of workspaces) {
    for (const capability of ALLOWED_CAPABILITIES) {
      const config = await getRunConfig(workspace.id, capability);
      const unfinished = await getActiveRun(workspace.id, capability);
      if (!isDue(config, now) && !unfinished) continue;
      candidates.push({ workspaceId: workspace.id, workspace: workspace.name, capability, lastRunAt: config.lastRunAt });
    }
  }
  const ordered = fairOrder(candidates);

  const results: { workspace: string; capability: string; outcome: string }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    // A step always runs at least one chunk, so do not start one that could not
    // finish inside the limit. It will be first in line next time (it has now
    // waited longer than the ones that did run).
    if (remaining < worstChunkMsFor(c.capability) + 5_000) {
      results.push({ workspace: c.workspace, capability: c.capability, outcome: "waiting for the next run" });
      continue;
    }

    try {
      const progress = await advanceCapabilityRun(c.workspaceId, c.capability, {
        startNew: true,
        budgetMs: sliceBudget(remaining, ordered.length - i),
      });
      results.push({
        workspace: c.workspace,
        capability: c.capability,
        outcome: progress.status === "done" ? "ran" : `${progress.status} ${progress.processed}/${progress.total}`,
      });
    } catch (e) {
      console.error(`Cron: "${c.workspace}"/${c.capability} failed`, e);
      results.push({ workspace: c.workspace, capability: c.capability, outcome: "error" });
    }
  }

  return NextResponse.json({ checkedAt: now.toISOString(), results, demoDates });
}
