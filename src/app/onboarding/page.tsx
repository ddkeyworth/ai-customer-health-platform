import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";
import { computeDaysOverdue } from "@/lib/onboarding/pace";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const rows = await prisma.customerProduct.findMany({
    where: {
      lifecycleStatus: "onboarding",
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: {
      customer: { include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } } },
      product: true,
    },
  });

  const now = new Date();
  const withPace = rows.map((r) => ({ ...r, daysOverdue: computeDaysOverdue(r.expectedGoLiveDate, now) }));
  withPace.sort((a, b) => (b.daysOverdue ?? -9999) - (a.daysOverdue ?? -9999));

  const totalNewLogoArr = rows.reduce((a, r) => a + Number(r.contractualArr), 0);
  const overdueCount = withPace.filter((r) => (r.daysOverdue ?? 0) > 0).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
        Onboarding{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-sm text-zinc-500 mb-6">{rows.length} accounts currently onboarding</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">New Logo ARR (onboarding)</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">£{totalNewLogoArr.toLocaleString("en-GB")}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">Behind expected go-live</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{overdueCount}</p>
        </div>
        <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
          <p className="text-xs text-zinc-500">On pace</p>
          <p className="text-2xl font-semibold text-zinc-900 mt-1">{rows.length - overdueCount}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Product</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Expected go-live</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Pace</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Health</th>
          </tr>
        </thead>
        <tbody>
          {withPace.map((r) => {
            const snap = r.customer.healthSnapshots[0];
            return (
              <tr key={r.id} className="border-b border-zinc-100">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${r.customerId}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
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
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Dates come from <code>CustomerProduct</code> (initial/expected/actual go-live). No date-change event log or
        cause tagging (customer/company/external) is built yet - the design calls for it, this screen doesn&apos;t
        have it. Health scores link through to the same driver-level detail as the Health screen.
      </p>
    </div>
  );
}
