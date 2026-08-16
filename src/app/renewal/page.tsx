import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";

export const dynamic = "force-dynamic";

// Illustrative, not a validated model - see README.md "Projected churn"
// section. Tied to Health band only; the real design calls for this to
// come from the same calibration loop as the rest of Health scoring,
// which isn't built yet.
const CHURN_LIKELIHOOD: Record<string, number> = {
  Critical: 0.6,
  Watch: 0.3,
  Stable: 0.1,
  Thriving: 0.02,
};

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
}

export default async function RenewalPage() {
  const rows = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "live", renewalDate: { not: null } },
    include: {
      customer: { include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } },
    },
    orderBy: { renewalDate: "asc" },
  });

  const now = new Date();
  const next90 = rows.filter((r) => r.renewalDate && r.renewalDate.getTime() - now.getTime() <= 90 * 86400000);

  let projectedChurnArr = 0;
  let projectedChurnUnits = 0;
  for (const r of next90) {
    const tier = r.customer.healthSnapshots[0]?.tierLabel ?? "Stable";
    const likelihood = CHURN_LIKELIHOOD[tier] ?? 0.1;
    const totalArr = Number(r.contractualArr) + Number(r.consumptionArr);
    projectedChurnArr += totalArr * likelihood;
    if (likelihood >= 0.3) projectedChurnUnits += 1;
  }

  return (
    <div>
      <h1 className="text-lg font-medium text-zinc-900 mb-1">Renewal</h1>
      <p className="text-xs text-zinc-400 mb-5">{next90.length} accounts renewing in the next 90 days</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Projected churn, next 90 days ($, estimate)</p>
          <p className="text-xl font-medium text-zinc-900">£{Math.round(projectedChurnArr).toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Projected churn (accounts, estimate)</p>
          <p className="text-xl font-medium text-zinc-900">{projectedChurnUnits}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium">Customer</th>
            <th className="pb-2 font-medium">Renewal date</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Base ARR at risk</th>
            <th className="pb-2 font-medium">Consumption ARR at risk</th>
            <th className="pb-2 font-medium">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const snap = r.customer.healthSnapshots[0];
            return (
              <tr key={r.id} className="border-b border-zinc-100">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${r.customerId}`} className="text-zinc-900 hover:underline">
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
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-6 text-xs text-zinc-400">
        Projected churn is illustrative, not a validated model - likelihood is read straight off the Health band
        (Critical 60%, Watch 30%, Stable 10%, Thriving 2%), not from the calibration loop the real design calls for
        (not built yet). Gross Renewal Rate isn&apos;t shown - it needs realized won/lost renewal outcomes over time,
        which this build has no history of yet. No renewal-strategy recommendation is generated here; that would be
        the natural next depth pass, same shape as Expansion&apos;s opportunities.
      </p>
    </div>
  );
}
