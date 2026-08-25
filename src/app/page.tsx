import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor, tierBorderColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const customerProducts = await prisma.customerProduct.findMany({
    where: {
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: { customer: true },
  });

  const totalContractual = customerProducts.reduce((a, cp) => a + Number(cp.contractualArr), 0);
  const totalConsumption = customerProducts.reduce((a, cp) => a + Number(cp.consumptionArr), 0);
  const totalArr = totalContractual + totalConsumption;

  const stageCounts = { onboarding: 0, live: 0, churned: 0 } as Record<string, number>;
  for (const cp of customerProducts) {
    stageCounts[cp.lifecycleStatus] = (stageCounts[cp.lifecycleStatus] ?? 0) + 1;
  }

  const snapshots = await prisma.healthScoreSnapshot.findMany({
    where: {
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: { customer: true },
    orderBy: { computedAt: "desc" },
  });
  const latestByCustomer = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByCustomer.has(s.customerId)) latestByCustomer.set(s.customerId, s);
  }
  const healthRows = [...latestByCustomer.values()];
  const bandCounts = { Thriving: 0, Stable: 0, Watch: 0, Critical: 0 } as Record<string, number>;
  for (const r of healthRows) bandCounts[r.tierLabel ?? "Critical"]++;
  const needsAttention = [...healthRows].sort((a, b) => a.compositeScore - b.compositeScore).slice(0, 5);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
        Home{activeSegment ? <span className="text-zinc-400 font-normal"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-sm text-zinc-500 mb-6">
        {activeSegment ? "Segment overview" : "Whole-book overview"} &middot; {customerProducts.length} customer-product
        relationships
      </p>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Total ARR</p>
          <p className="text-2xl font-semibold text-[#0C447C] mt-1">£{totalArr.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Contractual</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">£{totalContractual.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Consumption</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">£{totalConsumption.toLocaleString("en-GB")}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-400 mb-6">
        NNAOV / Net Revenue Retention / Gross Revenue Retention aren&apos;t shown yet - those need period-over-period
        realized bridge events (New Logo, Expansion, Contraction, Churned ARR) from Renewal, which isn&apos;t built yet.
        This is a snapshot, not a bridge.
      </p>

      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Health snapshot</p>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {(["Thriving", "Stable", "Watch", "Critical"] as const).map((band) => (
          <div
            key={band}
            className={`rounded-xl bg-white border border-zinc-200 border-l-4 ${tierBorderColor(band)} shadow-sm p-4`}
          >
            <p className="text-xs text-zinc-500">{band}</p>
            <p className="text-2xl font-semibold text-zinc-900 mt-1">{bandCounts[band]}</p>
          </div>
        ))}
      </div>

      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Accounts by lifecycle stage</p>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Onboarding</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{stageCounts.onboarding}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Live</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{stageCounts.live}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Churned</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{stageCounts.churned}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Needs attention (lowest Health scores)</p>
        <Link href="/briefing" className="text-xs text-[#378ADD] hover:underline">
          See full Briefing &rarr;
        </Link>
      </div>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm divide-y divide-zinc-100 overflow-hidden">
        {needsAttention.map((r) => (
          <Link
            key={r.id}
            href={`/health/${r.customerId}`}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-zinc-50 transition-colors"
          >
            <span className="text-zinc-900 font-medium">{r.customer.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">{r.compositeScore}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${tierColor(r.tierLabel)}`}>{r.tierLabel}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
