import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  price_increase: "Price increase",
  cross_sell: "Cross-sell",
  upsell: "Upsell",
  consumption_growth: "Consumption growth",
};

export default async function ExpansionPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const opportunities = await prisma.opportunity.findMany({
    where: {
      stage: "open",
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: { customer: true },
    orderBy: { estimatedArr: "desc" },
  });

  const reviews = await prisma.agentAction.findMany({
    where: { workspaceId: workspace.id, area: "expansion", status: "proposed" },
  });
  // subjectId is the Opportunity id - a customer with two open Opportunities
  // gets two independent reviews, not one shared between them.
  const reviewByOpportunityId = new Map(reviews.filter((a) => a.subjectId).map((a) => [a.subjectId, a]));

  const totalArr = opportunities.reduce((a, o) => a + Number(o.estimatedArr), 0);
  const byType = new Map<string, { count: number; arr: number }>();
  for (const o of opportunities) {
    const cur = byType.get(o.type) ?? { count: 0, arr: 0 };
    cur.count++;
    cur.arr += Number(o.estimatedArr);
    byType.set(o.type, cur);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
        Expansion{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-sm text-zinc-500 mb-6">{opportunities.length} open opportunities</p>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-6 inline-block">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Total open Expansion ARR</p>
        <p className="text-2xl font-semibold text-[#0C447C] mt-1">£{totalArr.toLocaleString("en-GB")}</p>
      </div>

      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">By type</p>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Object.entries(TYPE_LABELS).map(([key, label]) => {
          const stat = byType.get(key) ?? { count: 0, arr: 0 };
          return (
            <div key={key} className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-2xl font-semibold text-zinc-900 mt-1">{stat.count}</p>
              <p className="text-[11px] text-zinc-500">£{stat.arr.toLocaleString("en-GB")}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Type</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Raised by</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Owner</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Est. ARR</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => {
            const review = reviewByOpportunityId.get(o.id);
            return (
              <Fragment key={o.id}>
                <tr className="border-b border-zinc-100 align-top">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <Link href={`/health/${o.customerId}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
                      {o.customer.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-3 text-zinc-600 whitespace-nowrap">{TYPE_LABELS[o.type]}</td>
                  <td className="py-3 pr-3 text-zinc-500 whitespace-nowrap">{o.raisedBy}</td>
                  <td className="py-3 pr-3 text-zinc-500 whitespace-nowrap">
                    {o.owner} <span className="text-zinc-400">({o.ownerRole})</span>
                  </td>
                  <td className="py-3 pr-3 text-zinc-900 whitespace-nowrap">£{Number(o.estimatedArr).toLocaleString("en-GB")}</td>
                  <td className="py-3 text-zinc-600 max-w-md">{o.reasoning}</td>
                </tr>
                {review && (
                  <tr className="border-b border-zinc-100">
                    <td colSpan={6} className="pb-3">
                      <div className="rounded-xl bg-[#378ADD]/5 border border-[#378ADD]/20 p-3 text-sm text-zinc-800">
                        <p className="text-xs font-medium text-[#0C447C] mb-1">
                          AI review{(review.metadata as { shouldRaise?: boolean } | null)?.shouldRaise === false ? " - reconsider timing" : ""}
                        </p>
                        <p>{review.reasoning}</p>
                        {review.suggestedNextStep && <p className="mt-1 text-amber-800">{review.suggestedNextStep}</p>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Opportunities are always generated by deterministic rules from real seeded data (
        <code>prisma/generate-opportunities.ts</code>) - free, always-on baseline. The AI review above is an optional
        richer pass on top (Settings &gt; Automation), same two-layer shape as Health: it can flag that an
        opportunity shouldn&apos;t be pursued as framed right now, but it never removes or overwrites the underlying
        opportunity. Won/lost outcomes aren&apos;t tracked yet; every opportunity here is open.
      </p>
    </div>
  );
}
