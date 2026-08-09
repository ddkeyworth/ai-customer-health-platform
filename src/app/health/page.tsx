export default function HealthPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-medium text-zinc-900">Health</h1>
      <p className="mt-2 text-sm text-zinc-600">
        The flagship area. A composite score built from 14 drivers, run
        continuously from Onboarding through Live — plus the visualisation
        and AI-generated narrative on top of it. This is the load-bearing
        part of the whole product, deliberately not faked here.
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
        Not built yet — the scoring architecture is designed (see README.md)
        but not yet implemented. This page will not show placeholder scores
        or a fake narrative; that would misrepresent what the product
        actually does.
      </div>
    </div>
  );
}
