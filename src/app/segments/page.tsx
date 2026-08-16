import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createSegment, deleteSegment } from "./actions";
import { customersMatchingCriteria, SegmentCriteria } from "@/lib/segments";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";

export const dynamic = "force-dynamic";

const SEGMENT_CAP = 20;

export default async function SegmentsPage() {
  const workspace = await getCurrentWorkspace();

  const [segments, industries, regions, tiers] = await Promise.all([
    prisma.segment.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } }),
    prisma.customer.findMany({ where: { workspaceId: workspace.id }, distinct: ["industry"], select: { industry: true } }),
    prisma.customer.findMany({ where: { workspaceId: workspace.id }, distinct: ["region"], select: { region: true } }),
    prisma.customer.findMany({ where: { workspaceId: workspace.id }, distinct: ["tier"], select: { tier: true } }),
  ]);

  const counts = await Promise.all(
    segments.map(async (s) => ({
      id: s.id,
      count: (await customersMatchingCriteria(workspace.id, s.criteria as SegmentCriteria)).length,
    }))
  );
  const countById = new Map(counts.map((c) => [c.id, c.count]));

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-medium text-zinc-900 mb-1">Segments</h1>
      <p className="text-xs text-zinc-400 mb-5">
        {segments.length} of {SEGMENT_CAP} saved segments
      </p>

      <div className="space-y-2 mb-6">
        {segments.length === 0 && <p className="text-sm text-zinc-500">No segments saved yet.</p>}
        {segments.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
            <Link href={`/segments/${s.id}`} className="text-sm text-zinc-900 hover:underline">
              {s.name}
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">{countById.get(s.id) ?? 0} customers</span>
              <form action={deleteSegment.bind(null, s.id)}>
                <button type="submit" className="text-xs text-red-700 hover:underline">
                  Remove
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">New segment</h2>
      {segments.length >= SEGMENT_CAP ? (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Limit of {SEGMENT_CAP} segments reached. Remove one above to save a new one.
        </p>
      ) : (
        <form action={createSegment} className="space-y-3 rounded-xl bg-zinc-50 p-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input name="name" required maxLength={80} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Industry</label>
              <select name="industry" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                <option value="">Any</option>
                {industries.map((i) => i.industry && <option key={i.industry} value={i.industry}>{i.industry}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Region</label>
              <select name="region" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                <option value="">Any</option>
                {regions.map((r) => r.region && <option key={r.region} value={r.region}>{r.region}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Tier</label>
              <select name="tier" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                <option value="">Any</option>
                {tiers.map((t) => t.tier && <option key={t.tier} value={t.tier}>{t.tier}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Renewal type</label>
              <select name="renewalType" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                <option value="">Any</option>
                <option value="auto">Auto</option>
                <option value="interrupted">Interrupted</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Health band</label>
              <select name="healthBand" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
                <option value="">Any</option>
                <option value="Thriving">Thriving</option>
                <option value="Stable">Stable</option>
                <option value="Watch">Watch</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
          </div>
          <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5">
            Save segment
          </button>
        </form>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        Pick a segment from the selector in the top bar to re-scope every area (Home, Health, Onboarding, Adoption,
        Expansion, Renewal, Briefing) to it - it carries across navigation via the URL. Not yet built: a default
        segment per user profile (there&apos;s no user session yet to default from), and segment-scoped executive
        summaries (Health&apos;s narrative stays whole-book-only, to avoid a live per-segment Anthropic call on every
        page load).
      </p>
    </div>
  );
}
