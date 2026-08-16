import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
}

export default async function OnboardingPage() {
  const workspace = await getCurrentWorkspace();
  const rows = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "onboarding", customer: { workspaceId: workspace.id } },
    include: {
      customer: { include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } },
      product: true,
    },
  });

  const now = new Date();
  const withPace = rows.map((r) => {
    const daysOverdue = r.expectedGoLiveDate
      ? Math.round((now.getTime() - r.expectedGoLiveDate.getTime()) / 86400000)
      : null;
    return { ...r, daysOverdue };
  });
  withPace.sort((a, b) => (b.daysOverdue ?? -9999) - (a.daysOverdue ?? -9999));

  const totalNewLogoArr = rows.reduce((a, r) => a + Number(r.contractualArr), 0);
  const overdueCount = withPace.filter((r) => (r.daysOverdue ?? 0) > 0).length;

  return (
    <div>
      <h1 className="text-lg font-medium text-zinc-900 mb-1">Onboarding</h1>
      <p className="text-xs text-zinc-400 mb-5">{rows.length} accounts currently onboarding</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">New Logo ARR (onboarding)</p>
          <p className="text-xl font-medium text-zinc-900">£{totalNewLogoArr.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Behind expected go-live</p>
          <p className="text-xl font-medium text-zinc-900">{overdueCount}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">On pace</p>
          <p className="text-xl font-medium text-zinc-900">{rows.length - overdueCount}</p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium">Customer</th>
            <th className="pb-2 font-medium">Product</th>
            <th className="pb-2 font-medium">Expected go-live</th>
            <th className="pb-2 font-medium">Pace</th>
            <th className="pb-2 font-medium">Health</th>
          </tr>
        </thead>
        <tbody>
          {withPace.map((r) => {
            const snap = r.customer.healthSnapshots[0];
            return (
              <tr key={r.id} className="border-b border-zinc-100">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${r.customerId}`} className="text-zinc-900 hover:underline">
                    {r.customer.name}
                  </Link>
                </td>
                <td className="py-3 pr-3 text-zinc-600">{r.product.name}</td>
                <td className="py-3 pr-3 text-zinc-600 whitespace-nowrap">{fmtDate(r.expectedGoLiveDate)}</td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  {r.daysOverdue === null ? (
                    <span className="text-zinc-400">n/a</span>
                  ) : r.daysOverdue > 0 ? (
                    <span className="text-red-800">{r.daysOverdue} days overdue</span>
                  ) : (
                    <span className="text-green-800">on pace</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  {snap ? (
                    <span className={`text-xs px-2 py-0.5 rounded ${tierColor(snap.tierLabel)}`}>
                      {snap.compositeScore}
                    </span>
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
        Dates come from <code>CustomerProduct</code> (initial/expected/actual go-live). No date-change event log or
        cause tagging (customer/company/external) is built yet - the design calls for it, this screen doesn&apos;t
        have it. Health scores link through to the same driver-level detail as the Health screen.
      </p>
    </div>
  );
}
