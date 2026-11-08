// Assert-based regression check for the resumable-run engine
// (src/lib/capabilityBatches.ts) and the demo spend lock. Uses a fake adapter
// and a fake clock, so no AI is called and nothing costs money. Creates
// throwaway workspaces (unique names, deleted by id, never by name pattern, so
// it is safe to run while other tests run) and deletes everything it made.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  abandonRun,
  advanceRun,
  AI_CALL_WORST_MS,
  claimRun,
  DEFAULT_BUDGET_MS,
  fairOrder,
  FUNCTION_LIMIT_MS,
  getActiveRun,
  runHousekeeping,
  safeRunError,
  SAFETY_MS,
  sliceBudget,
  type WorkAdapter,
} from "../src/lib/capabilityBatches";
import { ADAPTERS } from "../src/lib/capabilityWork";
import type { Capability } from "../src/lib/capabilityRuns";
import { isSpendLocked } from "../src/lib/demoGuard";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const IDS = ["a", "b", "c", "d", "e", "f", "g"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const suffix = Math.random().toString(36).slice(2, 8);

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

  const wsIds: string[] = [];
  const mk = async (label: string) => {
    const w = await prisma.workspace.create({ data: { name: `Test Batches ${label} ${suffix} - safe to delete` } });
    wsIds.push(w.id);
    return w;
  };
  const wsA = await mk("A");
  const wsB = await mk("B");
  const userIds: string[] = [];
  const bucketKeys: string[] = [];

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

    // ---- 8. races, with real time and truly overlapping calls
    const wsC = await mk("C");
    const seen: string[] = [];
    const slow: WorkAdapter = {
      chunk: 2,
      list: async () => ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12"],
      process: async (_w, _k, ids) => {
        await sleep(300);
        seen.push(...ids);
      },
    };
    const callSlow = () => advanceRun({ workspaceId: wsC.id, capability: "renewal", adapter: slow, apiKey: "k", startNew: true, budgetMs: 1_000_000 });
    const raced = await Promise.all([callSlow(), callSlow(), callSlow()]);
    assert(seen.length === 12 && new Set(seen).size === 12, "Three callers starting at the same moment process every id exactly once between them, never twice (so a key is never charged twice)");
    assert((await prisma.capabilityRun.count({ where: { workspaceId: wsC.id, capability: "renewal" } })) === 1, "Three callers with no active run create one run, not three");
    assert(raced.filter((r) => r.status === "done").length === 1 && raced.filter((r) => r.status === "busy").length === 2, "One caller does the work and the other two are told it is busy");

    // ---- 9. a caller holding a stale copy can never replay or revive a finished run
    const wsD = await mk("D");
    const seenD: string[] = [];
    const quick: WorkAdapter = { chunk: 2, list: async () => ["s1", "s2", "s3", "s4"], process: async (_w, _k, ids) => void seenD.push(...ids) };
    const callQuick = (over: Partial<Parameters<typeof advanceRun>[0]> = {}) =>
      advanceRun({ workspaceId: wsD.id, capability: "adoption", adapter: quick, apiKey: "k", startNew: true, budgetMs: 0, ...over });
    await callQuick();
    const stale = (await getActiveRun(wsD.id, "adoption"))!;
    const staleCopyPending = stale.pendingIds;
    await callQuick({ budgetMs: 1_000_000 });
    assert(JSON.stringify(staleCopyPending) === JSON.stringify(["s3", "s4"]), "The stale copy still says two items are pending");
    assert(!(await claimRun(stale.id)), "A caller holding the stale copy cannot claim a run that someone else has finished");
    const finishedRow = await prisma.capabilityRun.findUniqueOrThrow({ where: { id: stale.id } });
    assert(finishedRow.status === "done" && finishedRow.processed === 4 && JSON.stringify(finishedRow.pendingIds) === "[]", "The finished run stays finished, with nothing pending");
    const callsBefore = seenD.length;
    const afterDone = await callQuick({ startNew: false });
    assert(afterDone.status === "idle" && seenD.length === callsBefore, "Nothing is replayed: continuing a finished run does nothing");
    assert(seenD.join() === "s1,s2,s3,s4", "Across the whole run each id was processed once, in order");
    const fresh = await callQuick();
    assert(fresh.status === "running" && (await prisma.capabilityRun.count({ where: { workspaceId: wsD.id, capability: "adoption" } })) === 2, "Asking to start while no run is active begins a NEW run, and the finished one is left untouched");

    // ---- 10. an impossible run can be abandoned and started over
    const wsE = await mk("E");
    const wsF = await mk("F");
    const seenE: string[] = [];
    let failMode = true;
    const flaky: WorkAdapter = {
      chunk: 1,
      list: async () => ["f1", "f2", "f3"],
      process: async (_w, _k, ids) => {
        if (failMode && ids[0] === "f2") throw new Error("always fails");
        seenE.push(...ids);
      },
    };
    const callFlaky = (ws: string) => advanceRun({ workspaceId: ws, capability: "expansion", adapter: flaky, apiKey: "k", startNew: true, budgetMs: 1_000_000 });
    let q = await callFlaky(wsE.id);
    assert(q.status === "failed" && q.processed === 1, "A run that hits a bad item fails at that item");
    q = await callFlaky(wsE.id);
    assert(q.status === "failed" && q.processed === 1 && seenE.join() === "f1", "Continuing a run with a bad item fails the same way each time, so later items are never reached");
    await callFlaky(wsF.id); // a different workspace has its own failed run
    assert((await abandonRun(wsE.id, "expansion")) === 1, "A failed run can be abandoned");
    assert((await getActiveRun(wsE.id, "expansion")) === null, "An abandoned run is no longer active");
    const abandoned = await prisma.capabilityRun.findFirstOrThrow({ where: { workspaceId: wsE.id, capability: "expansion" } });
    assert(abandoned.status === "abandoned" && abandoned.processed === 1 && abandoned.leaseUntil === null, "It is recorded as abandoned, keeping how far it got");
    assert((await abandonRun(wsE.id, "expansion")) === 0, "Abandoning when nothing is active changes nothing");
    assert((await getActiveRun(wsF.id, "expansion")) !== null, "Another workspace's failed run is untouched");
    assert(!(await claimRun(abandoned.id)), "An abandoned run can never be claimed again");
    failMode = false;
    q = await callFlaky(wsE.id);
    assert(q.status === "done" && q.total === 3, "After abandoning, starting again begins a fresh run from the whole list and finishes");
    assert((await prisma.capabilityRun.count({ where: { workspaceId: wsE.id, capability: "expansion" } })) === 2, "The abandoned run and the new run are separate records");
    const abandonedAfter = await prisma.capabilityRun.findUniqueOrThrow({ where: { id: abandoned.id } });
    assert(abandonedAfter.status === "abandoned" && abandonedAfter.processed === 1, "The abandoned run was not touched by the new one");

    // ---- 11. abandoned while a chunk is running: it stays abandoned
    const wsG = await mk("G");
    const midAdapter: WorkAdapter = {
      chunk: 1,
      list: async () => ["m1", "m2", "m3"],
      process: async (w, _k, ids) => {
        if (ids[0] === "m1") await abandonRun(w, "onboarding"); // as if someone pressed Start over in another tab
      },
    };
    const mid = await advanceRun({ workspaceId: wsG.id, capability: "onboarding", adapter: midAdapter, apiKey: "k", startNew: true, budgetMs: 1_000_000 });
    const midRow = await prisma.capabilityRun.findFirstOrThrow({ where: { workspaceId: wsG.id, capability: "onboarding" } });
    assert(mid.status === "idle" && midRow.status === "abandoned", "A call that finds its run was abandoned stops, and does not finish or revive it");
    const midCfg = await prisma.capabilityRunConfig.findUnique({ where: { workspaceId_capability: { workspaceId: wsG.id, capability: "onboarding" } } });
    assert(!midCfg?.lastRunAt, "...and does not record a completed run");

    // ---- 12. the time budget keeps room for the slowest chunk (fake clock)
    const wsH = await mk("H");
    let fc = 0;
    const nowF = () => fc;
    const timed = (worstChunkMs: number | undefined): WorkAdapter => ({
      chunk: 1,
      worstChunkMs,
      list: async () => ["t1", "t2", "t3", "t4", "t5", "t6"],
      process: async () => {
        fc += 60_000;
      },
    });
    const timedRun = (cap: Capability, adapter: WorkAdapter, budgetMs: number) => {
      fc = 0;
      return advanceRun({ workspaceId: wsH.id, capability: cap, adapter, apiKey: "k", startNew: true, budgetMs, now: nowF });
    };
    assert((await timedRun("health", timed(100_000), 200_000)).processed === 2, "With a 100 s worst-case chunk reserved out of a 200 s budget, the call stops starting chunks after 100 s (2 chunks)");
    assert((await timedRun("onboarding", timed(undefined), 200_000)).processed === 4, "With no reserve the same budget allows 4 chunks");
    assert((await timedRun("adoption", timed(500_000), 100_000)).processed === 1, "A reserve bigger than the whole budget still lets one chunk run, so progress is never blocked");

    // ---- 13. the arithmetic that keeps a call inside the hosting limit
    assert(DEFAULT_BUDGET_MS === FUNCTION_LIMIT_MS - SAFETY_MS && DEFAULT_BUDGET_MS === 270_000, "A call may use at most 270 s of the 300 s hosting limit");
    assert(AI_CALL_WORST_MS === 2 * 45_000 + 10_000, "One AI call is budgeted at its worst case: two tries of 45 s plus 10 s of database work");
    assert(ADAPTERS.health.chunk === 1, "Health runs one customer per step");
    for (const cap of Object.keys(ADAPTERS) as Capability[]) {
      const a = ADAPTERS[cap];
      assert(a.worstChunkMs === a.chunk * AI_CALL_WORST_MS, `${cap}: the reserved worst case is exactly chunk size times one AI call`);
      assert((a.worstChunkMs ?? 0) <= DEFAULT_BUDGET_MS, `${cap}: its first chunk, which always runs, cannot outlast the budget`);
      const lastStart = Math.max(0, DEFAULT_BUDGET_MS - (a.worstChunkMs ?? 0));
      assert(lastStart + (a.worstChunkMs ?? 0) <= FUNCTION_LIMIT_MS - SAFETY_MS, `${cap}: a chunk started at the last permitted moment still ends 30 s before the hosting limit`);
    }
    for (const file of ["health", "onboarding", "adoption", "expansion", "renewal"]) {
      const text = readFileSync(`src/lib/${file}/agenticLayer.ts`, "utf8");
      assert(/new Anthropic\(\{ apiKey, timeout: 45_000, maxRetries: 1 \}\)/.test(text), `${file}: the AI client has a 45 s timeout and one retry, so a hung call cannot outlast the hosting limit`);
    }

    // ---- 14. fair ordering and shares for the cron
    const d1 = new Date("2026-01-01T00:00:00Z");
    const d3 = new Date("2026-03-01T00:00:00Z");
    const input = [{ n: "c", lastRunAt: d3 }, { n: "n", lastRunAt: null }, { n: "a", lastRunAt: d1 }];
    const ordered = fairOrder(input);
    assert(ordered.map((x) => x.n).join() === "n,a,c", "The cron serves never-run work first, then the oldest, so nothing is starved");
    assert(input.map((x) => x.n).join() === "c,n,a", "Ordering does not change the list it was given");
    assert(sliceBudget(270_000, 4) === 67_500 && sliceBudget(100, 3) === 33 && sliceBudget(100, 0) === 0 && sliceBudget(-5, 2) === 0, "Each waiting piece of work gets an equal share of the time left (never negative)");

    // ---- 15. housekeeping removes only what is already dead
    const hkUser = await prisma.user.create({ data: { workspaceId: wsA.id, name: "HK", email: `hk-${suffix}@example.test`, passwordHash: "x", role: "csm" } });
    userIds.push(hkUser.id);
    const expiredSession = await prisma.session.create({ data: { userId: hkUser.id, expiresAt: new Date(Date.now() - 60_000) } });
    const liveSession = await prisma.session.create({ data: { userId: hkUser.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const oldKey = `test-hk-old-${suffix}`;
    const newKey = `test-hk-new-${suffix}`;
    bucketKeys.push(oldKey, newKey);
    await prisma.rateLimitBucket.createMany({
      data: [
        { key: oldKey, count: 1, resetAt: new Date(Date.now() - 60_000) },
        { key: newKey, count: 1, resetAt: new Date(Date.now() + 3_600_000) },
      ],
    });
    const hk = await runHousekeeping(new Date());
    assert(hk.sessions >= 1 && hk.rateLimitRows >= 1, "Housekeeping reports what it removed");
    assert((await prisma.session.findUnique({ where: { id: expiredSession.id } })) === null, "An expired session is removed");
    assert((await prisma.session.findUnique({ where: { id: liveSession.id } })) !== null, "A live session is kept");
    assert((await prisma.rateLimitBucket.findUnique({ where: { key: oldKey } })) === null, "A rate-limit row whose window has ended is removed");
    assert((await prisma.rateLimitBucket.findUnique({ where: { key: newKey } })) !== null, "A rate-limit row still counting is kept");
  } finally {
    // Only rows this test made, found by id or exact key, never by name pattern.
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rateLimitBucket.deleteMany({ where: { key: { in: bucketKeys } } });
    await prisma.capabilityRun.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.capabilityRunConfig.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
  }

  console.log("\nAll capability-batch checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
