import AiKeyBanner from "@/components/AiKeyBanner";
import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";
import AgentActionReview from "@/components/AgentActionReview";
import CustomerRef from "@/components/CustomerRef";
import ShowMore from "@/components/ShowMore";
import { pageSlice, parseShow } from "@/lib/pagination";
import { notSnoozed } from "@/lib/agentActionStatus";
import { visibleToVisit } from "@/lib/demoVisit";
import { getHiddenActionIds } from "@/lib/demoVisitServer";

export const dynamic = "force-dynamic";

export default async function AdoptionPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string; show?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const hiddenIds = await getHiddenActionIds(workspace);
  const sp = await searchParams;
  const segmentId = sp.segment;
  const show = parseShow(sp.show);
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);
  const threshold = workspace.adoptionUnderusedThresholdPct;

  const liveProducts = await prisma.customerProduct.findMany({
    where: {
      lifecycleStatus: "live",
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: {
      customer: true,
      product: { include: { capabilities: true } },
      package: true,
    },
  });

  const capabilities = await prisma.capability.findMany({ where: { product: { workspaceId: workspace.id } } });
  const usage = await prisma.usageSnapshot.findMany({ where: { customer: { workspaceId: workspace.id } } });

  // Built once, so the work grows with the number of usage rows rather than
  // with customers times rows.
  const capsByCustomer = new Map<string, Set<string>>();
  const customersByCap = new Map<string, Set<string>>();
  for (const u of usage) {
    if (!capsByCustomer.has(u.customerId)) capsByCustomer.set(u.customerId, new Set());
    capsByCustomer.get(u.customerId)!.add(u.capabilityId);
    if (!customersByCap.has(u.capabilityId)) customersByCap.set(u.capabilityId, new Set());
    customersByCap.get(u.capabilityId)!.add(u.customerId);
  }
  const liveCustomerIds = new Set(liveProducts.map((cp) => cp.customerId));

  // Per-capability: how many live customers have any usage recorded at all.
  const capStats = capabilities.map((cap) => {
    const usedByCustomerIds = customersByCap.get(cap.id) ?? new Set<string>();
    const usedByLive = [...usedByCustomerIds].filter((id) => liveCustomerIds.has(id)).length;
    return { ...cap, usedByLive, liveTotal: liveCustomerIds.size };
  });

  const nudges = await prisma.agentAction.findMany({
    where: { workspaceId: workspace.id, area: "adoption", status: "proposed", ...notSnoozed(), ...visibleToVisit(hiddenIds) },
  });
  // Keyed by the CustomerProduct id, not customerId - a customer with two
  // live Products can have independently different breadth on each.
  const nudgeByProductId = new Map(nudges.filter((a) => a.subjectId).map((a) => [a.subjectId, a]));

  // Per-customer-product capability breadth.
  const rows = liveProducts.map((cp) => {
    const entitled = cp.product.capabilities.length;
    const entitledIds = new Set(cp.product.capabilities.map((c) => c.id));
    const usedIds = new Set([...(capsByCustomer.get(cp.customerId) ?? [])].filter((id) => entitledIds.has(id)));
    return {
      cp,
      entitled,
      used: usedIds.size,
      breadthPct: entitled > 0 ? Math.round((usedIds.size / entitled) * 100) : 0,
      nudge: nudgeByProductId.get(cp.id) ?? null,
    };
  });
  rows.sort((a, b) => a.breadthPct - b.breadthPct);

  const avgBreadth = Math.round(rows.reduce((a, r) => a + r.breadthPct, 0) / Math.max(1, rows.length));

  return (
    <div>
      <AiKeyBanner workspace={workspace} />
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
        Adoption{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-sm text-zinc-500 mb-6">{liveProducts.length} live accounts</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Average capability breadth</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{avgBreadth}%</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Accounts below {threshold}% breadth</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{rows.filter((r) => r.breadthPct < threshold).length}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500 mb-2">By Capability, across live accounts</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {capStats.map((c) => (
          <div key={c.id} className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
            <p className="text-xs text-zinc-500">{c.name}</p>
            <p className="text-2xl font-semibold text-zinc-900 mt-1">
              {c.usedByLive}/{c.liveTotal}
            </p>
            <p className="text-[10px] text-zinc-500">{c.metricType}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-500 mb-2">By account, lowest breadth first</p>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Package</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Capabilities used</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Breadth</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Consumption ARR</th>
          </tr>
        </thead>
        <tbody>
          {pageSlice(rows, show).map((r) => (
            <Fragment key={r.cp.id}>
              <tr className="border-b border-zinc-100">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${r.cp.customerId}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
                    {r.cp.customer.name}<CustomerRef value={r.cp.customer.ref} />
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
                        className={`h-full ${r.breadthPct < threshold ? "bg-amber-500" : "bg-green-500"}`}
                        style={{ width: `${r.breadthPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-600">{r.breadthPct}%</span>
                  </div>
                </td>
                <td className="py-3 pr-3 text-zinc-600">£{Number(r.cp.consumptionArr).toLocaleString("en-GB")}</td>
              </tr>
              {r.nudge && (
                <tr className="border-b border-zinc-100">
                  <td colSpan={5} className="pb-3">
                    <div className="rounded-xl bg-[#378ADD]/5 border border-[#378ADD]/20 p-3 text-sm text-zinc-800">
                      <p className="text-xs font-medium text-[#0C447C] mb-1">AI adoption nudge</p>
                      <p>{r.nudge.reasoning}</p>
                      {r.nudge.suggestedNextStep && (
                        <p className="mt-1 text-zinc-600">
                          <span className="font-medium">Suggested:</span> {r.nudge.suggestedNextStep}
                        </p>
                      )}
                      <AgentActionReview id={r.nudge.id} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
      <ShowMore path="/adoption" params={sp} show={show} total={rows.length} />

      <p className="mt-6 text-xs text-zinc-500">
        Usage-depth and consumption trend per account (growing/flat/declining), plus Desired Outcome progress
        (against &quot;why the customer bought this&quot;), are already computed for Health - see the driver
        breakdown on each account&apos;s Health page. Not yet shown here on Adoption itself, alongside the other
        Health-only drivers (champion engagement, training, payment health). The underused-breadth threshold above is
        configurable in Settings &gt; Automation, not a fixed constant.
      </p>
    </div>
  );
}
