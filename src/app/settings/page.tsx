import { prisma } from "@/lib/prisma";
import { updateWorkspace, addCompetitor, deleteCompetitor } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const workspace = await prisma.workspace.findFirst();
  const competitors = workspace
    ? await prisma.competitorConfig.findMany({ where: { workspaceId: workspace.id }, orderBy: { riskWeight: "desc" } })
    : [];

  if (!workspace) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-medium text-zinc-900">Settings</h1>
        <p className="mt-2 text-sm text-zinc-600">No workspace seeded yet.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-medium text-zinc-900 mb-5">Settings</h1>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Org profile &amp; localisation</h2>
      <form action={updateWorkspace} className="space-y-3 mb-8 rounded-xl bg-zinc-50 p-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Workspace name</label>
          <input name="name" defaultValue={workspace.name} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Brand primary colour</label>
            <input
              name="brandPrimaryColor"
              defaultValue={workspace.brandPrimaryColor ?? ""}
              placeholder="#378ADD"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Brand accent colour</label>
            <input
              name="brandAccentColor"
              defaultValue={workspace.brandAccentColor ?? ""}
              placeholder="#e6f1fb"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Currency</label>
            <input name="currency" defaultValue={workspace.currency} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Date format</label>
            <input name="dateFormat" defaultValue={workspace.dateFormat} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Language</label>
            <input name="language" defaultValue={workspace.language} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5">
          Save
        </button>
        <p className="text-xs text-zinc-400">
          Logo upload isn&apos;t built (would need file storage) - the field exists (<code>logoUrl</code>), only the
          upload UI is missing.
        </p>
      </form>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Competitor risk ({competitors.length}/20)</h2>
      <div className="rounded-xl bg-zinc-50 p-4 mb-2">
        {competitors.length === 0 && <p className="text-sm text-zinc-500 mb-2">No competitors configured.</p>}
        <div className="space-y-2 mb-3">
          {competitors.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2">
              <span className="text-zinc-900">{c.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">Risk weight {c.riskWeight}/5</span>
                <form action={deleteCompetitor.bind(null, c.id)}>
                  <button type="submit" className="text-xs text-red-700 hover:underline">
                    Remove
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
        <form action={addCompetitor} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input name="name" required className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Risk weight (1-5)</label>
            <input
              name="riskWeight"
              type="number"
              min={1}
              max={5}
              defaultValue={3}
              className="w-20 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5">
            Add
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-400 mb-8">
        Direct mentions and known-capability mentions of these are detected for real in interaction text (see the
        Health screen). Job-posting and competitor-website monitoring stay concept-only - see README.md.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Not built yet</h2>
      <p className="text-sm text-zinc-600">
        Team &amp; roles, billing (illustrative), other integrations (concept-only connectors), developer/API
        (concept-only), consumption/outcome metric configuration, and data export.
      </p>
    </div>
  );
}
