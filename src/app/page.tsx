export default function Home() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-medium text-zinc-900">Home</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Whole-book overview: NNAOV, Net Revenue Retention, and Gross Revenue
        Retention, a Health snapshot by band, an Action Briefing preview, and
        accounts by lifecycle stage.
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
        Not built yet. This screen depends on the Health-scoring engine,
        which is still being designed — see README.md for what&apos;s real
        vs. planned in this repo.
      </div>
    </div>
  );
}
