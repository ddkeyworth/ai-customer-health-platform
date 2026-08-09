import { prisma } from "@/lib/prisma";
import { DriverResult } from "@/lib/health/drivers";

export const dynamic = "force-dynamic";

function tierColor(tier: string | null) {
  switch (tier) {
    case "Thriving":
      return "bg-green-50 text-green-800";
    case "Stable":
      return "bg-blue-50 text-blue-800";
    case "Watch":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-red-50 text-red-800";
  }
}

export default async function HealthPage() {
  const snapshots = await prisma.healthScoreSnapshot.findMany({
    include: { customer: true },
    orderBy: { computedAt: "desc" },
  });

  // Latest snapshot per customer (simple JS reduction - fine at this scale).
  const latestByCustomer = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByCustomer.has(s.customerId)) latestByCustomer.set(s.customerId, s);
  }
  const rows = [...latestByCustomer.values()].sort((a, b) => a.compositeScore - b.compositeScore);

  if (rows.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-medium text-zinc-900">Health</h1>
        <p className="mt-2 text-sm text-zinc-600">
          No Health scores computed yet. Run <code>npx tsx prisma/compute-health-scores.ts</code> after seeding.
        </p>
      </div>
    );
  }

  const bandCounts = { Thriving: 0, Stable: 0, Watch: 0, Critical: 0 } as Record<string, number>;
  for (const r of rows) bandCounts[r.tierLabel ?? "Critical"]++;

  // Executive summary: computed from the data, not a separate LLM call -
  // keeps this page cheap to load (no API call on render, see README.md).
  const atRisk = rows.filter((r) => (r.tierLabel === "Watch" || r.tierLabel === "Critical"));
  const negativeDriverCounts = new Map<string, number>();
  for (const r of atRisk) {
    const drivers = r.driverValues as unknown as DriverResult[];
    for (const d of drivers) {
      if (d.score !== null && d.score < 50) {
        negativeDriverCounts.set(d.label, (negativeDriverCounts.get(d.label) ?? 0) + 1);
      }
    }
  }
  const topNegativeDriver = [...negativeDriverCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const avgScore = Math.round(rows.reduce((a, r) => a + r.compositeScore, 0) / rows.length);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-medium text-zinc-900">Health</h1>
        <span className="text-xs text-zinc-400">
          {rows.length} customers &middot; computed {rows[0].computedAt.toLocaleDateString("en-GB")}
        </span>
      </div>

      <div className="rounded-xl bg-zinc-50 p-4 mb-5 text-sm text-zinc-800">
        Average composite score is {avgScore} across {rows.length} customers. {atRisk.length} account
        {atRisk.length === 1 ? " sits" : "s sit"} in Watch or Critical.
        {topNegativeDriver && (
          <> The most common negative driver among them is <strong>{topNegativeDriver[0]}</strong>, appearing in {topNegativeDriver[1]} of {atRisk.length}.</>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {(["Thriving", "Stable", "Watch", "Critical"] as const).map((band) => (
          <div key={band} className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">{band}</p>
            <p className="text-xl font-medium text-zinc-900">{bandCounts[band]}</p>
          </div>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 font-medium">Customer</th>
            <th className="pb-2 font-medium">Score</th>
            <th className="pb-2 font-medium">Band</th>
            <th className="pb-2 font-medium">Adjustment</th>
            <th className="pb-2 font-medium">Narrative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100 align-top">
              <td className="py-3 pr-3 text-zinc-900 whitespace-nowrap">{r.customer.name}</td>
              <td className="py-3 pr-3 font-medium text-zinc-900">{r.compositeScore}</td>
              <td className="py-3 pr-3">
                <span className={`text-xs px-2 py-0.5 rounded ${tierColor(r.tierLabel)}`}>{r.tierLabel}</span>
              </td>
              <td className="py-3 pr-3 text-zinc-500 whitespace-nowrap">
                {r.baselineScore} {r.adjustmentDelta >= 0 ? "+" : ""}
                {r.adjustmentDelta}
              </td>
              <td className="py-3 text-zinc-600 max-w-md">{r.narrative}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-xs text-zinc-400">
        Every score above was computed for real: a deterministic baseline (see <code>src/lib/health/baseline.ts</code>) plus a
        bounded, evidence-grounded Anthropic adjustment (see <code>src/lib/health/agenticLayer.ts</code>), stored in{" "}
        <code>HealthScoreSnapshot</code>. All customers and data are synthetic. See README.md.
      </p>
    </div>
  );
}
