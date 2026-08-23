import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { resolveActiveSegment } from "@/lib/activeSegment";
import { computeDaysOverdue } from "@/lib/onboarding/pace";

export const dynamic = "force-dynamic";

interface Flag {
  area: string;
  headline: string;
  impact: number;
}

export default async function BriefingPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { segment: segmentId } = await searchParams;
  const activeSegment = await resolveActiveSegment(workspace.id, segmentId);

  const customerProducts = await prisma.customerProduct.findMany({
    where: {
      customer: { workspaceId: workspace.id },
      ...(activeSegment ? { customerId: { in: activeSegment.customerIds } } : {}),
    },
    include: {
      customer: {
        include: {
          healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
          opportunities: { where: { stage: "open" } },
        },
      },
    },
  });

  const now = new Date();

  // Grouped by customer first, not iterated flat - Health and Expansion are
  // customer-level facts (one snapshot, one opportunity list per customer),
  // not per-product ones. Iterating customerProducts directly and pushing a
  // Health/Expansion flag inside that loop meant a customer with more than
  // one product got the identical flag duplicated once per extra product.
  // Onboarding and Renewal genuinely do vary by product, so those stay
  // inside the per-product loop.
  const productsByCustomer = new Map<string, typeof customerProducts>();
  for (const cp of customerProducts) {
    const list = productsByCustomer.get(cp.customerId) ?? [];
    list.push(cp);
    productsByCustomer.set(cp.customerId, list);
  }

  const byCustomer = new Map<string, { name: string; flags: Flag[] }>();

  for (const [customerId, cps] of productsByCustomer) {
    const c = cps[0].customer;
    const flags: Flag[] = [];
    const snap = c.healthSnapshots[0];
    const totalArrAllProducts = cps.reduce((a, cp) => a + Number(cp.contractualArr) + Number(cp.consumptionArr), 0);

    // Health risk - once per customer, impact is the whole relationship's ARR.
    if (snap && (snap.tierLabel === "Watch" || snap.tierLabel === "Critical")) {
      flags.push({
        area: "Health",
        headline: `${snap.tierLabel} (score ${snap.compositeScore})`,
        impact: totalArrAllProducts,
      });
    }

    // Expansion opportunities - once per customer.
    if (c.opportunities.length > 0) {
      const arr = c.opportunities.reduce((a, o) => a + Number(o.estimatedArr), 0);
      flags.push({
        area: "Expansion",
        headline: `${c.opportunities.length} open opportunit${c.opportunities.length === 1 ? "y" : "ies"}, £${arr.toLocaleString("en-GB")}`,
        impact: arr,
      });
    }

    for (const cp of cps) {
      const totalArr = Number(cp.contractualArr) + Number(cp.consumptionArr);

      // Onboarding overdue - per product.
      if (cp.lifecycleStatus === "onboarding" && cp.expectedGoLiveDate && cp.expectedGoLiveDate < now) {
        const daysOverdue = computeDaysOverdue(cp.expectedGoLiveDate, now);
        flags.push({
          area: "Onboarding",
          headline: `${daysOverdue} days overdue on go-live`,
          impact: Number(cp.contractualArr),
        });
      }

      // Renewal risk: within 45 days and interrupted or at-risk - per product.
      if (cp.renewalDate) {
        const daysToRenewal = Math.round((cp.renewalDate.getTime() - now.getTime()) / 86400000);
        const atRisk = c.renewalType === "interrupted" || (snap && (snap.tierLabel === "Watch" || snap.tierLabel === "Critical"));
        if (daysToRenewal >= 0 && daysToRenewal <= 45 && atRisk) {
          flags.push({
            area: "Renewal",
            headline: `Renews in ${daysToRenewal} days, ${c.renewalType === "interrupted" ? "interrupted" : "Health at risk"}`,
            impact: totalArr,
          });
        }
      }
    }

    if (flags.length > 0) byCustomer.set(customerId, { name: c.name, flags });
  }

  const rows = [...byCustomer.entries()]
    .map(([id, v]) => ({ id, ...v, totalImpact: v.flags.reduce((a, f) => a + f.impact, 0) }))
    .sort((a, b) => b.totalImpact - a.totalImpact);

  const areaColor: Record<string, string> = {
    Health: "bg-red-50 text-red-800",
    Onboarding: "bg-amber-50 text-amber-800",
    Expansion: "bg-green-50 text-green-800",
    Renewal: "bg-blue-50 text-blue-800",
  };

  return (
    <div>
      <h1 className="text-lg font-medium text-zinc-900 mb-1">
        Briefing{activeSegment ? <span className="text-zinc-400"> &middot; {activeSegment.name}</span> : null}
      </h1>
      <p className="text-xs text-zinc-400 mb-5">{rows.length} accounts with something to review, ranked by impact</p>

      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/health/${r.id}`}
            className="block rounded-lg bg-zinc-50 px-4 py-3 hover:bg-zinc-100"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-zinc-900">{r.name}</span>
              <span className="text-xs text-zinc-500">£{Math.round(r.totalImpact).toLocaleString("en-GB")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.flags.map((f, i) => (
                <span key={i} className={`text-[11px] px-2 py-0.5 rounded ${areaColor[f.area]}`}>
                  {f.area}: {f.headline}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-xs text-zinc-400">
        Consolidated by account, ranked by combined £ impact - not a raw per-signal activity feed. Pulled live from
        Health, Onboarding, Expansion, and Renewal (all real, already-computed data), not a separate stored item with
        its own review/dismiss state - approve/dismiss/snooze and the on-demand refresh the design calls for
        aren&apos;t built yet. Nothing here is ever sent anywhere; this is a read-only prioritized view.
      </p>
    </div>
  );
}
