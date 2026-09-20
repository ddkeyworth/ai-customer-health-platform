import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";
import { computeBaselineChurnRates } from "@/lib/renewal/churnModel";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
}

interface SavePlayMetadata {
  riskFactors?: string[];
  baselineLikelihood?: number;
  baselineSource?: string;
  baselineSampleSize?: number;
  adjustedLikelihood?: number;
}

export default async function RenewalPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const rows = await prisma.customerProduct.findMany({
    where: {
      lifecycleStatus: "live",
      renewalDate: { not: null },
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: {
      customer: { include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } },
    },
    orderBy: { renewalDate: "asc" },
  });

  const savePlays = await prisma.agentAction.findMany({
    where: { workspaceId: workspace.id, area: "renewal", status: "proposed" },
  });
  // Keyed by the CustomerProduct id, not customerId - a customer with two
  // live Products (two distinct renewal dates) gets an independent save
  // play per product, same reasoning as Onboarding/Adoption above.
  const savePlayByProductId = new Map(savePlays.filter((a) => a.subjectId).map((a) => [a.subjectId, a]));

  const now = new Date();
  const next90 = rows.filter((r) => r.renewalDate && r.renewalDate.getTime() - now.getTime() <= 90 * 86400000);
  const baselineRates = await computeBaselineChurnRates(workspace.id);

  function likelihoodFor(tierLabel: string | null, customerProductId: string): number {
    const savePlay = savePlayByProductId.get(customerProductId);
    const meta = savePlay?.metadata as SavePlayMetadata | null;
    if (meta?.adjustedLikelihood !== undefined) return meta.adjustedLikelihood;
    return baselineRates[tierLabel ?? "Stable"]?.rate ?? baselineRates.Stable.rate;
  }

  let projectedChurnArr = 0;
  let projectedChurnUnits = 0;
  for (const r of next90) {
    const tier = r.customer.healthSnapshots[0]?.tierLabel ?? "Stable";
    const likelihood = likelihoodFor(tier, r.id);
    const totalArr = Number(r.contractualArr) + Number(r.consumptionArr);
    projectedChurnArr += totalArr * likelihood;
    if (likelihood >= 0.3) projectedChurnUnits += 1;
  }

  const usingRealOutcomes = Object.values(baselineRates).some((b) => b.source === "outcome_history");

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
        Renewal{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-sm text-zinc-500 mb-6">{next90.length} accounts renewing in the next 90 days</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Projected churn, next 90 days (&pound;, estimate)</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">£{Math.round(projectedChurnArr).toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Projected churn (accounts, estimate)</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{projectedChurnUnits}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Renewal date</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Type</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Base ARR at risk</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Consumption ARR at risk</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Health</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Churn risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const snap = r.customer.healthSnapshots[0];
            const savePlay = savePlayByProductId.get(r.id);
            const meta = savePlay?.metadata as SavePlayMetadata | null;
            const likelihood = likelihoodFor(snap?.tierLabel ?? null, r.id);
            const source = meta?.baselineSource ?? baselineRates[snap?.tierLabel ?? "Stable"]?.source;
            return (
              <Fragment key={r.id}>
                <tr className="border-b border-zinc-100">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <Link href={`/health/${r.customerId}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
                      {r.customer.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-3 text-zinc-600 whitespace-nowrap">{fmtDate(r.renewalDate)}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {r.customer.renewalType === "interrupted" ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-800">
                        Interrupted{r.customer.interruptedReason ? ` (${r.customer.interruptedReason.replace("_", " ")})` : ""}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-50 text-green-800">Auto</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-zinc-600">£{Number(r.contractualArr).toLocaleString("en-GB")}</td>
                  <td className="py-3 pr-3 text-zinc-600">£{Number(r.consumptionArr).toLocaleString("en-GB")}</td>
                  <td className="py-3 pr-3">
                    {snap ? (
                      <span className={`text-xs px-2 py-0.5 rounded ${tierColor(snap.tierLabel)}`}>{snap.compositeScore}</span>
                    ) : (
                      <span className="text-xs text-zinc-400">n/a</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className="text-zinc-900">{Math.round(likelihood * 100)}%</span>{" "}
                    <span className="text-[10px] text-zinc-400">
                      ({source === "outcome_history" ? "from outcomes" : "illustrative"}
                      {savePlay ? ", AI-adjusted" : ""})
                    </span>
                  </td>
                </tr>
                {savePlay && (
                  <tr className="border-b border-zinc-100">
                    <td colSpan={7} className="pb-3">
                      <div className="rounded-xl bg-[#378ADD]/5 border border-[#378ADD]/20 p-3 text-sm text-zinc-800">
                        <p className="text-xs font-medium text-[#0C447C] mb-1">AI save play</p>
                        <p>{savePlay.reasoning}</p>
                        {meta?.riskFactors && meta.riskFactors.length > 0 && (
                          <ul className="list-disc list-inside mt-1 text-zinc-600">
                            {meta.riskFactors.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        )}
                        {savePlay.suggestedNextStep && (
                          <p className="mt-1 text-amber-800">
                            <span className="font-medium">Save play:</span> {savePlay.suggestedNextStep}
                          </p>
                        )}
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
        Churn risk per Health band now comes from real recorded outcomes on <code>/calibration</code> where there&apos;s
        enough history (at least 3 recorded outcomes in that band) - {usingRealOutcomes ? "in use for at least one band right now" : "not enough history yet in this workspace, so every band is still on the illustrative fallback"}, per band, not
        all-or-nothing. Still an approximation, same limitation already stated on Calibration: this build compares
        against the Health score on file now, not a true point-in-time value at the moment of the outcome. Save plays
        (Settings &gt; Automation) apply a further bounded adjustment for that specific account&apos;s own signals, on
        top of the band-level baseline - only generated for interrupted renewals or Watch/Critical accounts within 90
        days. Gross Renewal Rate isn&apos;t shown - it needs realised won/lost renewal outcomes over time, which this
        build has limited history of yet.
      </p>
    </div>
  );
}
