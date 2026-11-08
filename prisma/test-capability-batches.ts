// Assert-based regression check for the resumable-run engine
// (src/lib/capabilityBatches.ts) and the demo spend lock. Uses a fake adapter
// and a fake clock, so no AI is called and nothing costs money. Creates two
// throwaway workspaces and deletes everything it made.
import { PrismaClient } from "@prisma/client";
import { advanceRun, getActiveRun, safeRunError, type WorkAdapter } from "../src/lib/capabilityBatches";
import { isSpendLocked } from "../src/lib/demoGuard";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const IDS = ["a", "b", "c", "d", "e", "f", "g"];

(async () => {
  assert(isSpendLocked({ isDemoSeed: true }) === true, "The shared demo workspace is locked from spending the owner's AI key");
  assert(isSpendLocked({ isDemoSeed: false }) === false, "A workspace someone signed up for is not locked");
  process.env.SELF_HOSTED = "true";
  assert(isSpendLocked({ isDemoSeed: true }) === false, "Someone running their own copy turns the demo lock off with SELF_HOSTED=true");
  process.env.SELF_HOSTED = "yes";
  assert(isSpendLocked({ isDemoSeed: true }) === true, "Any value other than exactly true keeps the lock on, so a mistyped setting stays safe");
  delete process.env.SELF_HOSTED;
  assert(isSpendLocked({ isDemoSeed: true }) === true, "With the setting missing the demo is locked by default");
  assert(!/postgres|prisma/i.test(safeRunError(new Error("Can't reach database server at postgres://user:pw@host:5432"))), "A database error message is replaced, so connection details never reach the page");
  assert(safeRunError(new Error("credit balance is too low")) === "credit balance is too low", "An ordinary error message (for example a low AI credit balance) is shown as it is");

  const wsA = await prisma.workspace.create({ data: { name: "Test Batches A - safe to delete" } });
  const wsB = await prisma.workspace.create({ data: { name: "Test Batches B - safe to delete" } });

  let clock = 0;
  const now = () => clock;
  const processed: string[] = [];
  let failOn: string | null = null;
  const adapter: WorkAdapter = {
    chunk: 2,
    list: async () => [...IDS],
    process: async (_w, _k, ids) => {
      for (const id of ids) {
        if (failOn === id) throw new Error("simulated failure");
        processed.push(id);
        clock += 60_000; // each item takes a "minute"
      }
    },
  };
  const run = (workspaceId: string, over: Partial<Parameters<typeof advanceRun>[0]> = {}) =>
    advanceRun({ workspaceId, capability: "health", adapter, apiKey: "k", startNew: true, now, ...over });

  try {
    // 1. Nothing to continue and not asked to start: idle, and nothing is created.
    const idle = await run(wsA.id, { startNew: false });
    assert(idle.status === "idle", "With no run in progress and no request to start one, nothing happens");
    assert((await prisma.capabilityRun.count({ where: { workspaceId: wsA.id } })) === 0, "...and no run record is created");

    // 2. A tiny budget still makes progress: exactly one chunk.
    let p = await run(wsA.id, { budgetMs: 0 });
    assert(p.status === "running" && p.processed === 2 && p.total === 7, "Even with no time budget a call processes one chunk, so it always makes progress");
    assert(processed.join("") === "ab", "The first chunk is the first two ids, in order");

    // 3. Resume does not repeat finished work, and the budget stops it starting new chunks.
    p = await run(wsA.id, { budgetMs: 100_000 }); // each chunk is 120s of fake time, so one chunk fits
    assert(p.processed === 4, "A call with a 100 second budget stops after the chunk that used it up");
    assert(processed.join("") === "abcd", "Carrying on resumes at the next id, with nothing processed twice");
    assert((await prisma.capabilityRun.count({ where: { workspaceId: wsA.id } })) === 1, "Starting again while a run is unfinished continues it, it does not begin a second run");

    // 4. Failure keeps the remaining work and resumes at the failed chunk.
    failOn = "e"; // the first id of the next chunk, so nothing before it in that chunk was done
    p = await run(wsA.id, { budgetMs: 1_000_000 });
    assert(p.status === "failed" && p.error === "simulated failure", "A failing chunk marks the run failed and records why");
    assert(processed.join("") === "abcd", "Items finished before the failure are kept, nothing is lost");
    const failed = await getActiveRun(wsA.id, "health");
    assert(failed !== null && failed.status === "failed" && failed.processed === 4, "A failed run is still active, so it can be resumed");
    failOn = null;
    p = await run(wsA.id, { budgetMs: 1_000_000 });
    assert(p.status === "done" && p.processed === 7 && p.total === 7, "Resuming a failed run finishes it");
    assert(processed.join("") === "abcdefg" , "Every id was processed exactly once, in order, across all the calls");
    assert((await getActiveRun(wsA.id, "health")) === null, "A finished run is no longer active");
    const cfg = await prisma.capabilityRunConfig.findUnique({ where: { workspaceId_capability: { workspaceId: wsA.id, capability: "health" } } });
    assert(cfg?.lastRunAt != null, "Finishing a run records the last-run time, which scheduling relies on");

    // 5. The lease stops two callers working on the same run.
    processed.length = 0;
    p = await run(wsA.id, { budgetMs: 0 });
    const active = (await getActiveRun(wsA.id, "health"))!;
    await prisma.capabilityRun.update({ where: { id: active.id }, data: { leaseUntil: new Date(clock + 1_000_000) } });
    const before = processed.length;
    const busy = await run(wsA.id);
    assert(busy.status === "busy" && processed.length === before, "While another caller holds the run, a second caller does nothing, so nothing is processed (or paid for) twice");
    await prisma.capabilityRun.update({ where: { id: active.id }, data: { leaseUntil: new Date(clock - 1) } });
    const reclaimed = await run(wsA.id, { budgetMs: 1_000_000 });
    assert(reclaimed.status === "done", "A lease left behind by a call that died expires, and the run can be taken over");

    // 6. Runs are separate per workspace.
    const other = await run(wsB.id, { budgetMs: 0 });
    assert(other.processed === 2 && (await getActiveRun(wsA.id, "health")) === null, "Another workspace's run is independent of this one");

    // 7. An empty work list finishes cleanly.
    const emptyAdapter: WorkAdapter = { chunk: 2, list: async () => [], process: async () => {} };
    const empty = await advanceRun({ workspaceId: wsA.id, capability: "renewal", adapter: emptyAdapter, apiKey: "k", startNew: true, now });
    assert(empty.status === "done" && empty.total === 0, "A capability with nothing to review finishes straight away");
  } finally {
    await prisma.capabilityRun.deleteMany({ where: { workspaceId: { in: [wsA.id, wsB.id] } } });
    await prisma.capabilityRunConfig.deleteMany({ where: { workspaceId: { in: [wsA.id, wsB.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA.id, wsB.id] } } });
  }

  console.log("\nAll capability-batch checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
