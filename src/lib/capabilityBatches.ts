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
//  - the lease is claimed with a condition on the run's status, and the run is
//    read again after the claim, so a caller holding a stale copy can never
//    replay a run that someone else finished, or set it running again;
//  - finding the active run or creating one is serialised per workspace and
//    capability, so two callers with no active run cannot each start their own;
//  - a failed run keeps its remaining work and resumes from the failed chunk,
//    and can be abandoned (and started over) if it can never succeed;
//  - every call makes progress even with a tiny budget (at least one chunk);
//  - a call never starts a chunk it could not finish inside the hosting limit.
import { prisma } from "@/lib/prisma";
import { recordRun, type Capability } from "@/lib/capabilityRuns";

// ---- The time budget, and the arithmetic behind it --------------------------
// A hosted function is killed at 300 s (Vercel Hobby). Every AI client is built
// with a 45 s timeout and one retry (see the agentic layers), so one AI call
// can take at most 2 x 45 s = 90 s, and we allow 10 s on top for the database
// work around it: AI_CALL_WORST_MS = 100 s. A chunk of N items is N such calls
// in a row, so its worst case is N x 100 s.
//
// A call may therefore use at most FUNCTION_LIMIT_MS - SAFETY_MS = 270 s in
// total, and it stops STARTING new chunks once the time left cannot cover one
// more worst-case chunk (the adapter's worstChunkMs). Examples:
//   Health, chunk of 1 item:     worst chunk 100 s, so new chunks start until 170 s
//   Other steps, chunk of 2:     worst chunk 200 s, so new chunks start until 70 s
// The first chunk of a call always runs (that is what guarantees progress), and
// it starts at about 0 s, so even its worst case (200 s) ends inside 270 s.
export const FUNCTION_LIMIT_MS = 300_000;
export const SAFETY_MS = 30_000;
export const DEFAULT_BUDGET_MS = FUNCTION_LIMIT_MS - SAFETY_MS;
export const AI_CALL_WORST_MS = 100_000;
// How long a call holds the lease. Longer than the function limit, so a call
// that died without releasing it frees itself shortly after.
export const LEASE_MS = 310_000;

export interface WorkAdapter {
  list(workspaceId: string): Promise<string[]>;
  process(workspaceId: string, apiKey: string | null, ids: string[]): Promise<void>;
  chunk: number; // ids processed per step
  // The longest one chunk could take. The engine keeps this much of the budget
  // in reserve before starting another chunk. Unset means no reserve.
  worstChunkMs?: number;
}

// "abandoned" is a run someone gave up on (see abandonRun); like "done" it is
// never picked up again.
export type RunStatus = "running" | "done" | "failed" | "busy" | "idle";
export interface RunProgress {
  status: RunStatus;
  processed: number;
  total: number;
  error: string | null;
}

const ACTIVE_STATUSES = ["running", "failed"];

export async function getActiveRun(workspaceId: string, capability: Capability) {
  return prisma.capabilityRun.findFirst({
    where: { workspaceId, capability, status: { in: ACTIVE_STATUSES } },
    orderBy: { startedAt: "desc" },
  });
}

// Gives up on the active run (running or failed) so a new one can be started.
// Work the run already finished is kept; only its remaining list is dropped.
// A call that is mid-chunk notices on its next save and stops. Returns how many
// runs were abandoned (0 when there was nothing active).
export async function abandonRun(workspaceId: string, capability: Capability): Promise<number> {
  const result = await prisma.capabilityRun.updateMany({
    where: { workspaceId, capability, status: { in: ACTIVE_STATUSES } },
    data: { status: "abandoned", leaseUntil: null },
  });
  return result.count;
}

// Takes the lease on a run. Succeeds only if the run is still running or failed
// (never a finished or abandoned one) and nobody else holds a live lease.
export async function claimRun(runId: string, now: () => number = () => Date.now()): Promise<boolean> {
  const claimed = await prisma.capabilityRun.updateMany({
    where: {
      id: runId,
      status: { in: ACTIVE_STATUSES },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date(now()) } }],
    },
    data: { leaseUntil: new Date(now() + LEASE_MS), status: "running", error: null },
  });
  return claimed.count === 1;
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

// The cron's cheap clean-up, run before any AI work so it always happens. It only
// ever deletes rows that are already dead: sessions past their expiry (on the
// demo they carry a visitor's per-visit changes, which should vanish with the
// visit) and rate-limit rows whose window has ended (nothing else removes
// them, so a flood of requests would grow the table without bound).
export async function runHousekeeping(now: Date): Promise<{ sessions: number; rateLimitRows: number }> {
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const rateLimitRows = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
  return { sessions: sessions.count, rateLimitRows: rateLimitRows.count };
}

// Orders the work the cron has to do so nothing is starved: the pair that has
// waited longest (oldest last finished run, never-run first) goes first.
export function fairOrder<T extends { lastRunAt: Date | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0));
}

// How much of the remaining time one piece of work may use when several are
// waiting: an equal share, so one large workspace cannot use the whole budget.
export function sliceBudget(remainingMs: number, itemsLeft: number): number {
  return itemsLeft <= 0 ? 0 : Math.max(0, Math.floor(remainingMs / itemsLeft));
}

export async function advanceRun(args: {
  workspaceId: string;
  capability: Capability;
  adapter: WorkAdapter;
  apiKey: string | null;
  startNew: boolean; // false: only continue an unfinished run, never begin one
  budgetMs?: number;
  now?: () => number; // injectable clock, for tests
}): Promise<RunProgress> {
  const { workspaceId, capability, adapter, apiKey, startNew } = args;
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = args.now ?? (() => Date.now());

  // Find the active run or create one, as one step per workspace and capability:
  // the lock means two callers with no active run cannot each create their own.
  const found = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"run:" + workspaceId + ":" + capability}))`;
      const active = await tx.capabilityRun.findFirst({
        where: { workspaceId, capability, status: { in: ACTIVE_STATUSES } },
        orderBy: { startedAt: "desc" },
      });
      if (active) return { run: active, empty: false };
      if (!startNew) return { run: null, empty: false };
      const ids = await adapter.list(workspaceId);
      const run = await tx.capabilityRun.create({
        data: { workspaceId, capability, pendingIds: ids, total: ids.length, status: ids.length === 0 ? "done" : "running" },
      });
      return { run, empty: ids.length === 0 };
    },
    { timeout: 60_000, maxWait: 15_000 }
  );

  if (!found.run) return { status: "idle", processed: 0, total: 0, error: null };
  if (found.empty) {
    await recordRun(workspaceId, capability, new Date(now()));
    return { status: "done", processed: 0, total: 0, error: null };
  }
  const runId = found.run.id;

  // Take the lease. Only one caller at a time may work on this run, and only
  // while it is still running or failed.
  if (!(await claimRun(runId, now))) {
    // Why it failed to claim: someone else is working on it (busy), or it has
    // finished or been abandoned since we looked.
    const current = await prisma.capabilityRun.findUnique({ where: { id: runId } });
    if (current && current.status === "done") return { status: "done", processed: current.processed, total: current.total, error: null };
    if (!current || current.status === "abandoned") return { status: "idle", processed: current?.processed ?? 0, total: current?.total ?? 0, error: null };
    return { status: "busy", processed: current.processed, total: current.total, error: null };
  }

  // Read the run again now that the lease is ours: anything another caller
  // saved before we claimed is in this copy, so we never replay finished work.
  const run = await prisma.capabilityRun.findUniqueOrThrow({ where: { id: runId } });
  let pending = asIds(run.pendingIds);
  let processed = run.processed;
  const startedAt = now();
  const deadline = startedAt + budgetMs - (adapter.worstChunkMs ?? 0);

  // Saves are conditional on the run still being "running", so a run that was
  // abandoned while we worked is never changed back, finished, or resurrected.
  const save = (data: Record<string, unknown>) =>
    prisma.capabilityRun.updateMany({ where: { id: runId, status: "running" }, data });

  // do-while: always process at least one chunk, so every call makes progress.
  do {
    const chunk = pending.slice(0, adapter.chunk);
    try {
      await adapter.process(workspaceId, apiKey, chunk);
    } catch (e) {
      const message = safeRunError(e);
      const failed = await save({ status: "failed", error: message, leaseUntil: null });
      if (failed.count === 0) return { status: "idle", processed, total: run.total, error: null };
      return { status: "failed", processed, total: run.total, error: message };
    }
    pending = pending.slice(chunk.length);
    processed += chunk.length;
    const saved = await save({ pendingIds: pending, processed });
    if (saved.count === 0) return { status: "idle", processed, total: run.total, error: null }; // abandoned while we worked
  } while (pending.length > 0 && now() < deadline);

  if (pending.length === 0) {
    const finished = await save({ status: "done", leaseUntil: null });
    if (finished.count === 0) return { status: "idle", processed, total: run.total, error: null };
    await recordRun(workspaceId, capability, new Date(now()));
    return { status: "done", processed, total: run.total, error: null };
  }
  await save({ leaseUntil: null });
  return { status: "running", processed, total: run.total, error: null };
}
