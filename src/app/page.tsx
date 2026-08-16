import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
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
      <h1 className="text-lg font-medium text-zinc-900 mb-1">
        Home{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-xs text-zinc-400 mb-5">
        {activeSegment ? "Segment overview" : "Whole-book overview"}, {customerProducts.length} customer-product relationships
      </p>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Total ARR</p>
          <p className="text-xl font-medium text-zinc-900">£{totalArr.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Contractual</p>
          <p className="text-xl font-medium text-zinc-900">£{totalContractual.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Consumption</p>
          <p className="text-xl font-medium text-zinc-900">£{totalConsumption.toLocaleString("en-GB")}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-400 mb-6">
        NNAOV / Net Revenue Retention / Gross Revenue Retention aren&apos;t shown yet - those need period-over-period
        realized bridge events (New Logo, Expansion, Contraction, Churned ARR) from Renewal, which isn&apos;t built yet
        (screen 6/8). This is a snapshot, not a bridge.
      </p>

      <p className="text-xs text-zinc-500 mb-2">Health snapshot</p>
      <div className="grid grid-cols-4 gap-3 mb-6">
        {(["Thriving", "Stable", "Watch", "Critical"] as const).map((band) => (
          <div key={band} className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">{band}</p>
            <p className="text-xl font-medium text-zinc-900">{bandCounts[band]}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-500 mb-2">Accounts by lifecycle stage</p>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Onboarding</p>
          <p className="text-xl font-medium text-zinc-900">{stageCounts.onboarding}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Live</p>
          <p className="text-xl font-medium text-zinc-900">{stageCounts.live}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Churned</p>
          <p className="text-xl font-medium text-zinc-900">{stageCounts.churned}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-2">
        Needs attention (lowest Health scores) &middot; a real Briefing (screen 8/8) will replace this once the other
        playbooks exist
      </p>
      <div className="space-y-1">
        {needsAttention.map((r) => (
          <Link
            key={r.id}
            href={`/health/${r.customerId}`}
            className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100"
          >
            <span className="text-zinc-900">{r.customer.name}</span>
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
