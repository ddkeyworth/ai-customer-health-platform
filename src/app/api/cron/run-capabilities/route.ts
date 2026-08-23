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
import { ALLOWED_CAPABILITIES, getRunConfig, isDue, runCapability } from "@/lib/capabilityRuns";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });

  const results: { workspace: string; capability: string; outcome: string }[] = [];

  for (const workspace of workspaces) {
    for (const capability of ALLOWED_CAPABILITIES) {
      const config = await getRunConfig(workspace.id, capability);
      if (!isDue(config, now)) continue;

      try {
        await runCapability(workspace.id, capability);
        results.push({ workspace: workspace.name, capability, outcome: "ran" });
      } catch (e) {
        console.error(`Cron: "${workspace.name}"/${capability} failed`, e);
        results.push({ workspace: workspace.name, capability, outcome: "error" });
      }
    }
  }

  return NextResponse.json({ checkedAt: now.toISOString(), results });
}
