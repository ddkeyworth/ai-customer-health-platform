import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DriverResult } from "@/lib/health/drivers";
import { tierColor, driverBarColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

export default async function CustomerHealthPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const workspace = await getCurrentWorkspace();

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { products: { include: { product: true, package: true } } },
  });
  if (!customer || customer.workspaceId !== workspace.id) notFound();

  const snapshot = await prisma.healthScoreSnapshot.findFirst({
    where: { customerId },
    orderBy: { computedAt: "desc" },
  });

  if (!snapshot) {
    return (
      <div className="max-w-2xl">
        <Link href="/health" className="text-sm text-zinc-500 hover:underline">
          &larr; Back to Health
        </Link>
        <h1 className="text-lg font-medium text-zinc-900 mt-3">{customer.name}</h1>
        <p className="mt-2 text-sm text-zinc-600">No Health score computed yet for this customer.</p>
      </div>
    );
  }

  const drivers = snapshot.driverValues as unknown as DriverResult[];
  const cp = customer.products[0];

  return (
    <div className="max-w-3xl">
      <Link href="/health" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to Health
      </Link>

      <div className="flex items-center justify-between mt-3 mb-1">
        <h1 className="text-lg font-medium text-zinc-900">{customer.name}</h1>
        <span className="text-2xl font-medium text-zinc-900">{snapshot.compositeScore}</span>
      </div>
      <div className="flex items-center gap-2 mb-5">
        <span className={`text-xs px-2 py-0.5 rounded ${tierColor(snapshot.tierLabel)}`}>{snapshot.tierLabel}</span>
        <span className="text-xs text-zinc-500">
          {customer.industry} &middot; {customer.country} &middot; {cp?.lifecycleStatus}
        </span>
        <span className="text-xs text-zinc-400">
          {snapshot.confidenceLevel === "early_read" ? "Early read" : "Established"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {customer.products.map((p) => (
          <span key={p.id} className="text-xs px-2 py-1 rounded-lg bg-zinc-50 text-zinc-600">
            {p.product.name} &middot; {p.package?.name ?? "no package"}
          </span>
        ))}
      </div>

      <div className="rounded-xl bg-zinc-50 p-4 mb-6 text-sm text-zinc-800">{snapshot.narrative}</div>

      <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500 mb-1">Baseline (Layer 1, deterministic)</p>
          <p className="text-lg font-medium text-zinc-900">{snapshot.baselineScore}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500 mb-1">Agentic adjustment (Layer 2)</p>
          <p className="text-lg font-medium text-zinc-900">
            {snapshot.adjustmentDelta >= 0 ? "+" : ""}
            {snapshot.adjustmentDelta}
          </p>
        </div>
      </div>

      {snapshot.adjustmentReason && (
        <div className="mb-6">
          <p className="text-xs text-zinc-500 mb-1">Why the adjustment</p>
          <p className="text-sm text-zinc-700">{snapshot.adjustmentReason}</p>
        </div>
      )}

      <p className="text-xs text-zinc-500 mb-2">All 15 drivers</p>
      <div className="space-y-2">
        {drivers.map((d) => (
          <div key={d.key} className="flex items-start gap-3 py-2 border-b border-zinc-100">
            <div className="w-48 shrink-0 text-sm text-zinc-800">{d.label}</div>
            <div className="w-16 shrink-0">
              {d.score === null ? (
                <span className="text-xs text-zinc-400">n/a</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-10 rounded-full bg-zinc-100 overflow-hidden">
                    <div className={`h-full ${driverBarColor(d.score)}`} style={{ width: `${d.score}%` }} />
                  </div>
                  <span className="text-xs text-zinc-600">{Math.round(d.score)}</span>
                </div>
              )}
            </div>
            <div className="flex-1 text-xs text-zinc-500">{d.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
