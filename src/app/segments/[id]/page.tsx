import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { customersMatchingCriteria, SegmentCriteria } from "@/lib/segments";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

export default async function SegmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getCurrentWorkspace();
  const segment = await prisma.segment.findUnique({ where: { id } });
  if (!segment || segment.workspaceId !== workspace.id) notFound();

  const criteria = segment.criteria as SegmentCriteria;
  const customers = await customersMatchingCriteria(segment.workspaceId, criteria);

  return (
    <div className="max-w-3xl">
      <Link href="/segments" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to Segments
      </Link>
      <h1 className="text-2xl font-semibold text-zinc-900 mt-3 mb-1">{segment.name}</h1>
      <p className="text-sm text-zinc-500 mb-6">
        {customers.length} matching customers &middot;{" "}
        {Object.entries(criteria)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "no filters"}
      </p>

      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 overflow-x-auto">
      <table className="w-full text-sm">

        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Customer</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Industry</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Region</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Tier</th>
            <th className="pb-2 font-medium text-xs uppercase tracking-wide">Health</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => {
            const snap = c.healthSnapshots[0];
            return (
              <tr key={c.id} className="border-b border-zinc-100">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${c.id}`} className="text-zinc-900 font-medium hover:text-[#378ADD] hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="py-3 pr-3 text-zinc-600">{c.industry}</td>
                <td className="py-3 pr-3 text-zinc-600">{c.region}</td>
                <td className="py-3 pr-3 text-zinc-600">{c.tier}</td>
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
      </div>
    </div>
  );
}
