import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierColor } from "@/lib/health/ui";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

const RISK_BANDS = ["Watch", "Critical"];

const TYPE_LABELS: Record<string, string> = {
  churned: "Churned",
  renewed: "Renewed",
  expanded: "Expanded",
};

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function judge(type: string, tierLabel: string | null) {
  if (!tierLabel) return { verdict: "n/a", label: "No score on file" } as const;
  const wasRisk = RISK_BANDS.includes(tierLabel);

  if (type === "churned") {
    return wasRisk
      ? ({ verdict: "confirmed", label: "Score flagged risk, account churned" } as const)
      : ({ verdict: "missed", label: "Score read healthy, account churned anyway" } as const);
  }
  // renewed or expanded - a positive outcome
  return wasRisk
    ? ({ verdict: "review", label: "Score flagged risk, account did well anyway" } as const)
    : ({ verdict: "confirmed", label: "Score read healthy, account did well" } as const);
}

const VERDICT_STYLE: Record<string, string> = {
  confirmed: "bg-green-50 text-green-800",
  missed: "bg-red-50 text-red-800",
  review: "bg-amber-50 text-amber-800",
  "n/a": "bg-zinc-100 text-zinc-500",
};

export default async function CalibrationPage() {
  const workspace = await getCurrentWorkspace();
  const events = await prisma.outcomeEvent.findMany({
    where: { customer: { workspaceId: workspace.id } },
    include: {
      customer: {
        include: { healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 } },
      },
    },
    orderBy: { occurredAt: "desc" },
  });

  const rows = events.map((e) => {
    const snap = e.customer.healthSnapshots[0] ?? null;
    return { event: e, snap, ...judge(e.type, snap?.tierLabel ?? null) };
  });

  const counts = { confirmed: 0, missed: 0, review: 0, "n/a": 0 } as Record<string, number>;
  for (const r of rows) counts[r.verdict]++;

  return (
    <div>
      <h1 className="text-lg font-medium text-zinc-900 mb-1">Calibration</h1>
      <p className="text-xs text-zinc-400 mb-5">
        {rows.length} real outcomes checked against the Health score on file
      </p>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Confirmed</p>
          <p className="text-xl font-medium text-zinc-900">{counts.confirmed}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Missed</p>
          <p className="text-xl font-medium text-zinc-900">{counts.missed}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">Worth reviewing</p>
          <p className="text-xl font-medium text-zinc-900">{counts.review}</p>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">No score on file</p>
          <p className="text-xl font-medium text-zinc-900">{counts["n/a"]}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No outcome events recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-200">
              <th className="pb-2 font-medium">Customer</th>
              <th className="pb-2 font-medium">Outcome</th>
              <th className="pb-2 font-medium">Score on file</th>
              <th className="pb-2 font-medium">Verdict</th>
              <th className="pb-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.event.id} className="border-b border-zinc-100 align-top">
                <td className="py-3 pr-3 whitespace-nowrap">
                  <Link href={`/health/${r.event.customerId}`} className="text-zinc-900 hover:underline">
                    {r.event.customer.name}
                  </Link>
                </td>
                <td className="py-3 pr-3 whitespace-nowrap text-zinc-600">
                  {TYPE_LABELS[r.event.type]} &middot; {fmtDate(r.event.occurredAt)}
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  {r.snap ? (
                    <span className={`text-xs px-2 py-0.5 rounded ${tierColor(r.snap.tierLabel)}`}>
                      {r.snap.compositeScore} &middot; {r.snap.tierLabel}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">n/a</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${VERDICT_STYLE[r.verdict]}`}>{r.label}</span>
                </td>
                <td className="py-3 text-zinc-600 max-w-sm">{r.event.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        Compares each real outcome against the most recent Health score on file for that customer - this build
        stores one current snapshot per customer, not a real historical series, so this isn&apos;t a true
        point-in-time backtest of &quot;what the score said before the outcome happened.&quot; &quot;Worth
        reviewing&quot; isn&apos;t necessarily a scoring error - a Watch/Critical account that renewed anyway may
        reflect a successful save-play, not a bad score. This surface exists so a human can spot patterns and decide
        whether driver weighting should change; nothing here adjusts anything automatically - see README.md.
      </p>
    </div>
  );
}
