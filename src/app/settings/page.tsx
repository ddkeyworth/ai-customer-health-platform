import { prisma } from "@/lib/prisma";
import {
  updateWorkspace,
  addCompetitor,
  deleteCompetitor,
  updateExportAllowlist,
  updateAnthropicApiKey,
  clearAnthropicApiKey,
  updateCapabilitySchedule,
  runCapabilityNow,
} from "./actions";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { EXPORT_FIELDS } from "@/lib/exportFields";
import { getRunConfig } from "@/lib/capabilityRuns";

export const dynamic = "force-dynamic";

function fmtRunTime(d: Date | null): string {
  if (!d) return "Never run yet";
  return `Last run ${d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ran?: string; runError?: string }>;
}) {
  const workspace = await getCurrentWorkspace();
  const { ran, runError } = await searchParams;
  const competitors = await prisma.competitorConfig.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { riskWeight: "desc" },
  });
  const healthRunConfig = await getRunConfig(workspace.id, "health");

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-medium text-zinc-900 mb-5">Settings</h1>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Org profile &amp; localisation</h2>
      <form action={updateWorkspace} className="space-y-3 mb-8 rounded-xl bg-zinc-50 p-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Workspace name</label>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={workspace.name}
            className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Brand primary colour</label>
            <input
              name="brandPrimaryColor"
              defaultValue={workspace.brandPrimaryColor ?? ""}
              placeholder="#378ADD"
              pattern="^#[0-9a-fA-F]{6}$"
              title="6-digit hex colour, e.g. #378ADD"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Brand accent colour</label>
            <input
              name="brandAccentColor"
              defaultValue={workspace.brandAccentColor ?? ""}
              placeholder="#e6f1fb"
              pattern="^#[0-9a-fA-F]{6}$"
              title="6-digit hex colour, e.g. #e6f1fb"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Currency</label>
            <input
              name="currency"
              required
              defaultValue={workspace.currency}
              maxLength={3}
              pattern="^[A-Za-z]{3}$"
              title="3-letter ISO currency code, e.g. GBP"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Date format</label>
            <select name="dateFormat" defaultValue={workspace.dateFormat} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Language</label>
            <select name="language" defaultValue={workspace.language} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm">
              <option value="en-GB">en-GB</option>
              <option value="en-US">en-US</option>
            </select>
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

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Anthropic API key (bring your own)</h2>
      <div className="rounded-xl bg-zinc-50 p-4 mb-2">
        {workspace.anthropicApiKeyLast4 ? (
          <div className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2">
            <span className="text-zinc-900">Configured - ending in ****{workspace.anthropicApiKeyLast4}</span>
            <form action={clearAnthropicApiKey}>
              <button type="submit" className="text-xs text-red-700 hover:underline">
                Remove
              </button>
            </form>
          </div>
        ) : (
          <form action={updateAnthropicApiKey} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">API key</label>
              <input
                name="apiKey"
                type="password"
                placeholder="sk-ant-..."
                pattern="^sk-ant-[A-Za-z0-9_-]{20,}$"
                title="Starts with sk-ant-"
                className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
              />
            </div>
            <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5">
              Save
            </button>
          </form>
        )}
      </div>
      <p className="text-xs text-zinc-400 mb-8">
        Stored encrypted (AES-256-GCM, see <code>src/lib/workspaceSecret.ts</code>), never shown again in full once
        saved. This field exists because the point of a downloadable, open-source project is that anyone running
        their own instance should use their own Anthropic key, not the demo deployment&apos;s - no capability below
        will run at all until this is configured.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Automation</h2>
      <div className="rounded-xl bg-zinc-50 p-4 mb-2">
        {ran === "health" && (
          <p className="text-xs text-green-800 bg-green-50 rounded-lg px-3 py-2 mb-3">Health scores recomputed successfully.</p>
        )}
        {runError === "health" && (
          <p className="text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2 mb-3">
            Couldn&apos;t run Health scoring - check the API key above is valid, or try again shortly if you&apos;ve
            run this 3 times in the last hour.
          </p>
        )}
        {!workspace.anthropicApiKeyLast4 ? (
          <p className="text-sm text-zinc-500">Configure your Anthropic API key above to enable this.</p>
        ) : (
          <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
            <div>
              <p className="text-sm text-zinc-900">Health scoring</p>
              <p className="text-xs text-zinc-400">{fmtRunTime(healthRunConfig.lastRunAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <form action={updateCapabilitySchedule} className="flex items-center gap-1.5">
                <input type="hidden" name="capability" value="health" />
                <select
                  name="schedule"
                  defaultValue={healthRunConfig.schedule}
                  className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                >
                  <option value="on_demand">On-demand only</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <button type="submit" className="rounded-lg border border-zinc-200 text-zinc-700 text-sm px-2.5 py-1.5">
                  Save
                </button>
              </form>
              <form action={runCapabilityNow}>
                <input type="hidden" name="capability" value="health" />
                <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5">
                  Run now
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-400 mb-8">
        &quot;On-demand only&quot; (the default) means this never runs automatically - nothing is spent against your
        key until you click Run now or pick a schedule. Scheduled runs happen via a daily check (Vercel Hobby&apos;s
        cron plans only allow once-per-day jobs) that looks at every workspace&apos;s own schedule and runs whichever
        are actually due - so &quot;Weekly&quot; still only runs roughly every 7 days even though the check itself
        happens daily. Run now always works regardless of the schedule setting.
      </p>

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
            <input name="name" required maxLength={80} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Risk weight (1-5)</label>
            <input
              name="riskWeight"
              type="number"
              min={1}
              max={5}
              step={1}
              defaultValue={3}
              className="w-20 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={competitors.length >= 20}
            className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-400 mb-8">
        Direct mentions and known-capability mentions of these are detected for real in interaction text (see the
        Health screen). Job-posting and competitor-website monitoring stay concept-only - see README.md.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Data export allowlist (concept)</h2>
      <div className="rounded-xl bg-zinc-50 p-4 mb-2">
        <form action={updateExportAllowlist} className="space-y-2">
          {EXPORT_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm text-zinc-800">
              <input
                type="checkbox"
                name="field"
                value={f.key}
                defaultChecked={workspace.exportAllowlist.includes(f.key)}
                className="rounded border-zinc-300"
              />
              {f.label}
            </label>
          ))}
          <button type="submit" className="rounded-lg bg-zinc-900 text-white text-sm px-3 py-1.5 mt-2">
            Save
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-400 mb-8">
        Configuration only - no export mechanism is built. This records which of Bearing&apos;s own generated fields
        (not data pulled in from elsewhere) an org would want pushed back to their CRM if a real export pipeline
        existed later. Same &quot;show the concept, don&apos;t connect&quot; treatment as Integrations and SSO.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Not built yet</h2>
      <p className="text-sm text-zinc-600">
        Team &amp; roles, billing (illustrative), other integrations (concept-only connectors), developer/API
        (concept-only), consumption/outcome metric configuration, and the actual export mechanism (the allowlist
        above only records intent).
      </p>
    </div>
  );
}
