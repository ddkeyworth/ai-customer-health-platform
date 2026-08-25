import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";

export const dynamic = "force-dynamic";

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const snapshots = await prisma.healthScoreSnapshot.findMany({
    where: {
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: { customer: true },
    orderBy: { computedAt: "desc" },
  });

  // Latest snapshot per customer (simple JS reduction - fine at this scale).
  const latestByCustomer = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByCustomer.has(s.customerId)) latestByCustomer.set(s.customerId, s);
  }
  const rows = [...latestByCustomer.values()].sort((a, b) => a.compositeScore - b.compositeScore);

  if (rows.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-zinc-900">Health</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {activeSegment
            ? `No customers in the "${activeSegment.name}" segment have a Health score yet.`
            : <>No Health scores computed yet. Run <code>npx tsx prisma/compute-health-scores.ts</code> after seeding.</>}
        </p>
      </div>
    );
  }

  const bandCounts = { Thriving: 0, Stable: 0, Watch: 0, Critical: 0 } as Record<string, number>;
  for (const r of rows) bandCounts[r.tierLabel ?? "Critical"]++;

  // Executive summary: a real Anthropic call, computed by a batch script
  // (prisma/compute-book-summary.ts), not live on this page load - see
  // src/lib/health/bookSummary.ts and README.md. Segment-scoped summaries
  // aren't precomputed, so the whole-book one is skipped rather than shown
  // misleadingly against a filtered list - generating one live per segment
  // would break the "never live on page load" cost rule.
  const bookSummary = activeSegment
    ? null
    : await prisma.bookSummary.findFirst({
        where: { scopeKey: "all", workspaceId: workspace.id },
        orderBy: { computedAt: "desc" },
      });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Health{activeSegment ? <span className="text-zinc-400 font-normal"> &middot; {activeSegment.name}</span> : null}
        </h1>
        <span className="text-xs text-zinc-500">
          {rows.length} customers &middot; computed {rows[0].computedAt.toLocaleDateString("en-GB")}
        </span>
      </div>

      <div className="rounded-xl bg-[#378ADD]/5 border border-[#378ADD]/20 p-4 mb-6 text-sm text-zinc-800">
        {activeSegment ? (
          <span className="text-zinc-500">
            Executive summaries are only precomputed for the whole book - not yet generated per segment.
          </span>
        ) : bookSummary ? (
          bookSummary.summary
        ) : (
          <span className="text-zinc-500">
            No executive summary computed yet. Run <code>npx tsx prisma/compute-book-summary.ts</code>.
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {(["Thriving", "Stable", "Watch", "Critical"] as const).map((band) => (
          <div key={band} className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
            <p className="text-xs text-zinc-500">{band}</p>
            <p className="text-2xl font-semibold text-zinc-900 mt-1">{bandCounts[band]}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Band</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Adjustment</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Narrative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100 align-top">
              <td className="py-3 pr-3 whitespace-nowrap">
                <Link href={`/health/${r.customerId}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
                  {r.customer.name}
                </Link>
              </td>
              <td className="py-3 pr-3 font-medium text-zinc-900">{r.compositeScore}</td>
              <td className="py-3 pr-3">
                <span className={`text-xs px-2 py-0.5 rounded ${tierColor(r.tierLabel)}`}>{r.tierLabel}</span>
              </td>
              <td className="py-3 pr-3 text-zinc-500 whitespace-nowrap">
                {r.baselineScore} {r.adjustmentDelta >= 0 ? "+" : ""}
                {r.adjustmentDelta}
              </td>
              <td className="py-3 text-zinc-600 max-w-md">{r.narrative}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Every score above was computed for real: a deterministic baseline (see <code>src/lib/health/baseline.ts</code>) plus a
        bounded, evidence-grounded Anthropic adjustment (see <code>src/lib/health/agenticLayer.ts</code>), stored in{" "}
        <code>HealthScoreSnapshot</code>. All customers and data are synthetic. See README.md.
      </p>
    </div>
  );
}
