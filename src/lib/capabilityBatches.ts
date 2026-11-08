// The resumable-run engine. A capability run is split into small chunks of
// work; each call to advanceRun() processes chunks until its time budget is
// used, saves exactly what is left, and stops. Calling it again carries on
// from there. This exists because a full Health run for 120 customers takes
// far longer than the 300 seconds a Vercel Hobby function may live, and the
// old single-call Run now was simply cut off part way with no way to resume.
//
// This file knows nothing about Health, Renewal and so on: it works on a list
// of ids and an "adapter" (list the ids, process some of them), so it can be
// tested with a fake adapter. The real adapters are in capabilityWork.ts.
//
// Safety properties, each covered by prisma/test-capability-batches.ts:
//  - progress is saved after every chunk, so a crash loses at most one chunk;
//  - a lease stops two callers (two tabs, or a tab and the cron) processing
//    the same items twice, which would spend the API key twice;
//  - a failed run keeps its remaining work and resumes from the failed chunk;
//  - every call makes progress even with a tiny budget (at least one chunk).
import { prisma } from "@/lib/prisma";
import { recordRun, type Capability } from "@/lib/capabilityRuns";

// A call stops starting new chunks after this long. It must leave room for
// the slowest single chunk to finish inside the 300 second function limit.
export const DEFAULT_BUDGET_MS = 170_000;
// How long a call holds the lease. Longer than the function limit, so a call
// that died without releasing it frees itself shortly after.
export const LEASE_MS = 310_000;

export interface WorkAdapter {
  list(workspaceId: string): Promise<string[]>;
  process(workspaceId: string, apiKey: string, ids: string[]): Promise<void>;
  chunk: number; // ids processed per step
}

export type RunStatus = "running" | "done" | "failed" | "busy" | "idle";
export interface RunProgress {
  status: RunStatus;
  processed: number;
  total: number;
  error: string | null;
}

export async function getActiveRun(workspaceId: string, capability: Capability) {
  return prisma.capabilityRun.findFirst({
    where: { workspaceId, capability, status: { in: ["running", "failed"] } },
    orderBy: { startedAt: "desc" },
  });
}

// Run errors are shown to the person who clicked Run now. Our own messages
// and the AI provider's (for example a low credit balance on their key) are
// useful to them; a database error must not leak connection details.
export function safeRunError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/prisma|postgres|database|ECONN|neon|P[0-9]{4}/i.test(message)) {
    return "A temporary database problem stopped the run. Continue to resume where it left off.";
  }
  return message.slice(0, 200);
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export async function advanceRun(args: {
  workspaceId: string;
  capability: Capability;
  adapter: WorkAdapter;
  apiKey: string;
  startNew: boolean; // false: only continue an unfinished run, never begin one
  budgetMs?: number;
  now?: () => number; // injectable clock, for tests
}): Promise<RunProgress> {
  const { workspaceId, capability, adapter, apiKey, startNew } = args;
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = args.now ?? (() => Date.now());

  let run = await getActiveRun(workspaceId, capability);
  if (!run) {
    if (!startNew) return { status: "idle", processed: 0, total: 0, error: null };
    const ids = await adapter.list(workspaceId);
    run = await prisma.capabilityRun.create({
      data: { workspaceId, capability, pendingIds: ids, total: ids.length, status: ids.length === 0 ? "done" : "running" },
    });
    if (ids.length === 0) {
      await recordRun(workspaceId, capability, new Date(now()));
      return { status: "done", processed: 0, total: 0, error: null };
    }
  }

  // Take the lease. Only one caller at a time may work on this run.
  const claimed = await prisma.capabilityRun.updateMany({
    where: { id: run.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date(now()) } }] },
    data: { leaseUntil: new Date(now() + LEASE_MS), status: "running", error: null },
  });
  if (claimed.count === 0) {
    return { status: "busy", processed: run.processed, total: run.total, error: null };
  }

  let pending = asIds(run.pendingIds);
  let processed = run.processed;
  const deadline = now() + budgetMs;

  // do-while: always process at least one chunk, so every call makes progress.
  do {
    const chunk = pending.slice(0, adapter.chunk);
    try {
      await adapter.process(workspaceId, apiKey, chunk);
    } catch (e) {
      const message = safeRunError(e);
      await prisma.capabilityRun.update({
        where: { id: run.id },
        data: { status: "failed", error: message, leaseUntil: null },
      });
      return { status: "failed", processed, total: run.total, error: message };
    }
    pending = pending.slice(chunk.length);
    processed += chunk.length;
    await prisma.capabilityRun.update({ where: { id: run.id }, data: { pendingIds: pending, processed } });
  } while (pending.length > 0 && now() < deadline);

  if (pending.length === 0) {
    await prisma.capabilityRun.update({ where: { id: run.id }, data: { status: "done", leaseUntil: null } });
    await recordRun(workspaceId, capability, new Date(now()));
    return { status: "done", processed, total: run.total, error: null };
  }
  await prisma.capabilityRun.update({ where: { id: run.id }, data: { leaseUntil: null } });
  return { status: "running", processed, total: run.total, error: null };
}
