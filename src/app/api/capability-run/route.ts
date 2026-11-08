// Run now, resumable. The Settings page calls this repeatedly: each call
// advances the capability's run by up to about 4 minutes of work and reports
// progress, and the page keeps calling until it says "done". Because the
// state lives in the database, closing the tab loses nothing: the next visit
// (or the daily cron) carries on from exactly where it stopped.
//
// /api/* is excluded from the session proxy (see src/proxy.ts), so this route
// checks the session itself.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ALLOWED_CAPABILITIES, type Capability } from "@/lib/capabilityRuns";
import { abandonRun, getActiveRun, safeRunError } from "@/lib/capabilityBatches";
import { advanceCapabilityRun } from "@/lib/capabilityWork";
import { isSpendLocked, DEMO_LOCK_NOTICE } from "@/lib/demoGuard";
import { withinRateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Same-origin only: this spends the workspace's own key, so a request from
  // another site must never be able to trigger it with the user's cookie.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { capability?: string; start?: boolean; restart?: boolean } | null;
  const capability = body?.capability ?? "";
  if (!ALLOWED_CAPABILITIES.includes(capability as Capability)) {
    return NextResponse.json({ error: "Unknown capability" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: user.workspaceId } });
  if (isSpendLocked(workspace)) return NextResponse.json({ error: DEMO_LOCK_NOTICE }, { status: 403 });

  // The 3-per-hour limit protects the workspace's own wallet from repeated
  // new runs. Carrying on an unfinished run does not count against it; starting
  // over does, because it begins a new run. The allowance is checked BEFORE the
  // old run is abandoned, so someone who is rate limited never loses a run.
  const active = await getActiveRun(workspace.id, capability as Capability);
  const restart = body?.restart === true;
  const startNew = body?.start === true || restart;
  const beginsNewRun = restart || (!active && startNew);
  if (beginsNewRun && !(await withinRateLimit(`runCapabilityNow:${workspace.id}:${capability}`, 3, 60 * 60_000))) {
    return NextResponse.json({ error: "You have started this 3 times in the last hour. Try again shortly." }, { status: 429 });
  }
  // "Start over": give up on the stuck run (what it already finished is kept),
  // then begin a fresh one below.
  if (restart) await abandonRun(workspace.id, capability as Capability);

  try {
    const progress = await advanceCapabilityRun(workspace.id, capability as Capability, { startNew });
    return NextResponse.json(progress);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: safeRunError(e) },
      { status: 400 }
    );
  }
}
