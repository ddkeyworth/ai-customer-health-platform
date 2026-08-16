import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

export default async function AdoptionPage() {
  const workspace = await getCurrentWorkspace();
  const liveProducts = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "live", customer: { workspaceId: workspace.id } },
    include: {
      customer: true,
      product: { include: { capabilities: true } },
      package: true,
    },
  });

  const capabilities = await prisma.capability.findMany({ where: { product: { workspaceId: workspace.id } } });
  const usage = await prisma.usageSnapshot.findMany({ where: { customer: { workspaceId: workspace.id } } });

  // Per-capability: how many live customers have any usage recorded at all.
  const capStats = capabilities.map((cap) => {
    const usedByCustomerIds = new Set(usage.filter((u) => u.capabilityId === cap.id).map((u) => u.customerId));
    const liveCustomerIds = new Set(liveProducts.map((cp) => cp.customerId));
    const usedByLive = [...usedByCustomerIds].filter((id) => liveCustomerIds.has(id)).length;
    return { ...cap, usedByLive, liveTotal: liveCustomerIds.size };
  });

  // Per-customer capability breadth.
  const rows = liveProducts.map((cp) => {
    const entitled = cp.product.capabilities.length;
    const usedIds = new Set(
      usage.filter((u) => u.customerId === cp.customerId && cp.product.capabilities.some((c) => c.id === u.capabilityId)).map((u) => u.capabilityId)
    );
    return { cp, entitled, used: usedIds.size, breadthPct: entitled > 0 ? Math.round((usedIds.size / entitled) * 100) : 0 };
  });
  rows.sort((a, b) => a.breadthPct - b.breadthPct);

  const avgBreadth = Math.round(rows.reduce((a, r) => a + r.breadthPct, 0) / Math.max(1, rows.length));

  return (
    <div>
      <h1 className="text-lg font-medium text-zinc-900 mb-1">Adoption</h1>
      <p className="text-xs text-zinc-400 mb-5">{liveProducts.length} live accounts</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Average capability breadth</p>
          <p className="text-xl font-medium text-zinc-900">{avgBreadth}%</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Accounts below 50% breadth</p>
          <p className="text-xl font-medium text-zinc-900">{rows.filter((r) => r.breadthPct < 50).length}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-2">By Capability, across live accounts</p>
      <div className="grid grid-cols-5 gap-3 mb-6">
        {capStats.map((c) => (
          <div key={c.id} className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">{c.name}</p>
            <p className="text-lg font-medium text-zinc-900">
              {c.usedByLive}/{c.liveTotal}
            </p>
            <p className="text-[10px] text-zinc-400">{c.metricType}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-500 mb-2">By account, lowest breadth first</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium">Customer</th>
            <th className="pb-2 font-medium">Package</th>
            <th className="pb-2 font-medium">Capabilities used</th>
            <th className="pb-2 font-medium">Breadth</th>
            <th className="pb-2 font-medium">Consumption ARR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cp.id} className="border-b border-zinc-100">
              <td className="py-3 pr-3 whitespace-nowrap">
                <Link href={`/health/${r.cp.customerId}`} className="text-zinc-900 hover:underline">
                  {r.cp.customer.name}
                </Link>
              </td>
              <td className="py-3 pr-3 text-zinc-600">{r.cp.package?.name ?? "n/a"}</td>
              <td className="py-3 pr-3 text-zinc-600">
                {r.used} of {r.entitled}
              </td>
              <td className="py-3 pr-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className={`h-full ${r.breadthPct < 50 ? "bg-amber-500" : "bg-green-500"}`}
                      style={{ width: `${r.breadthPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-600">{r.breadthPct}%</span>
                </div>
              </td>
              <td className="py-3 pr-3 text-zinc-600">£{Number(r.cp.consumptionArr).toLocaleString("en-GB")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-xs text-zinc-400">
        Usage-depth and consumption trend per account (growing/flat/declining), plus Desired Outcome progress
        (against &quot;why the customer bought this&quot;), are already computed for Health - see the driver
        breakdown on each account&apos;s Health page. Not yet shown here on Adoption itself, alongside the other
        Health-only drivers (champion engagement, training, payment health).
      </p>
    </div>
  );
}
