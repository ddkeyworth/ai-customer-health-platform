import { prisma } from "@/lib/prisma";
import {
  updateWorkspace,
  addCompetitor,
  deleteCompetitor,
  updateExportAllowlist,
  updateAnthropicApiKey,
  clearAnthropicApiKey,
  updateCapabilitySchedule,
  updateAdoptionThreshold,
  simulateSubscribe,
  cancelSimulatedSubscription,
} from "./actions";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { EXPORT_FIELDS } from "@/lib/exportFields";
import { ALLOWED_CAPABILITIES, getRunConfig, type Capability } from "@/lib/capabilityRuns";
import { getTrialStatus } from "@/lib/trialGate";
import { getActiveRun } from "@/lib/capabilityBatches";
import RunNowButton from "@/components/RunNowButton";
import { DEMO_LOCK_NOTICE, isSpendLocked } from "@/lib/demoGuard";
import { getSessionUser } from "@/lib/auth";
import { changeMyPassword, regenerateMyRecoveryKey } from "./security-actions";

const SECURITY_MESSAGES: Record<string, string> = {
  password_changed: "Password changed. Your other sessions were signed out.",
  current: "The current password is wrong.",
  weak: "The new password must be between 8 and 128 characters.",
  mismatch: "The two new passwords do not match.",
  missing: "Fill in every field.",
  locked: "This is switched off on the shared demo.",
  rate_limited: "Too many attempts - wait a while and try again.",
  invalid: "Something went wrong - try again.",
};

export const dynamic = "force-dynamic";

function fmtRunTime(d: Date | null): string {
  if (!d) return "Never run yet";
  return `Last run ${d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

const CAPABILITY_LABELS: Record<Capability, string> = {
  health: "Health scoring",
  onboarding: "Onboarding recovery plans",
  adoption: "Adoption nudges",
  expansion: "Expansion review",
  renewal: "Renewal save plays",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const workspace = await getCurrentWorkspace();
  const { security } = await searchParams;
  const sessionUser = await getSessionUser();
  const competitors = await prisma.competitorConfig.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { riskWeight: "desc" },
  });
  const trial = getTrialStatus(workspace);
  const activeRuns = Object.fromEntries(
    await Promise.all(ALLOWED_CAPABILITIES.map(async (c) => [c, await getActiveRun(workspace.id, c)] as const))
  ) as Record<Capability, Awaited<ReturnType<typeof getActiveRun>>>;
  const runConfigs = Object.fromEntries(
    await Promise.all(ALLOWED_CAPABILITIES.map(async (c) => [c, await getRunConfig(workspace.id, c)] as const))
  ) as Record<Capability, Awaited<ReturnType<typeof getRunConfig>>>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">Settings</h1>
      {isSpendLocked(workspace) && (
        <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          This is the shared demo, so changes here are switched off. Run your own copy to change settings and segments.
        </p>
      )}

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Org profile &amp; localisation</h2>
      <form action={updateWorkspace} className="space-y-3 mb-8 rounded-xl bg-white border border-zinc-200 shadow-sm p-4">
        <div>
          <label htmlFor="f-name-1" className="block text-xs text-zinc-500 mb-1">Workspace name</label>
          <input id="f-name-1"
            name="name"
            required
            maxLength={80}
            defaultValue={workspace.name}
            className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-brandPrimaryColor-1" className="block text-xs text-zinc-500 mb-1">Brand primary colour</label>
            <input id="f-brandPrimaryColor-1"
              name="brandPrimaryColor"
              defaultValue={workspace.brandPrimaryColor ?? ""}
              placeholder="#378ADD"
              pattern="^#[0-9a-fA-F]{6}$"
              title="6-digit hex colour, e.g. #378ADD"
              className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="f-brandAccentColor-1" className="block text-xs text-zinc-500 mb-1">Brand accent colour</label>
            <input id="f-brandAccentColor-1"
              name="brandAccentColor"
              defaultValue={workspace.brandAccentColor ?? ""}
              placeholder="#e6f1fb"
              pattern="^#[0-9a-fA-F]{6}$"
              title="6-digit hex colour, e.g. #e6f1fb"
              className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="f-currency-1" className="block text-xs text-zinc-500 mb-1">Currency</label>
            <input id="f-currency-1"
              name="currency"
              required
              defaultValue={workspace.currency}
              maxLength={3}
              pattern="^[A-Za-z]{3}$"
              title="3-letter ISO currency code, e.g. GBP"
              className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="f-dateFormat-1" className="block text-xs text-zinc-500 mb-1">Date format</label>
            <select id="f-dateFormat-1" name="dateFormat" defaultValue={workspace.dateFormat} className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent">
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-language-1" className="block text-xs text-zinc-500 mb-1">Language</label>
            <select id="f-language-1" name="language" defaultValue={workspace.language} className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent">
              <option value="en-GB">en-GB</option>
              <option value="en-US">en-US</option>
            </select>
          </div>
        </div>
        <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
          Save
        </button>
        <p className="text-xs text-zinc-400">
          Logo upload isn&apos;t built (would need file storage) - the field exists (<code>logoUrl</code>), only the
          upload UI is missing.
        </p>
      </form>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Anthropic API key (bring your own)</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2">
        {workspace.anthropicApiKeyLast4 ? (
          <div className="flex items-center justify-between text-sm bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            <span className="text-zinc-900">Configured - ending in ****{workspace.anthropicApiKeyLast4}</span>
            {workspace.isDemoSeed ? (
              <span className="text-xs text-zinc-400">Locked on the shared demo</span>
            ) : (
              <form action={clearAnthropicApiKey}>
                <button type="submit" className="text-xs text-red-700 hover:underline">
                  Remove
                </button>
              </form>
            )}
          </div>
        ) : (
          <form action={updateAnthropicApiKey} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="f-apiKey-1" className="block text-xs text-zinc-500 mb-1">API key</label>
              <input id="f-apiKey-1"
                name="apiKey"
                type="password"
                placeholder="sk-ant-..."
                pattern="^sk-ant-[A-Za-z0-9_-]{20,}$"
                title="Starts with sk-ant-"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
            </div>
            <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
              Save
            </button>
          </form>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        Stored encrypted (AES-256-GCM, see <code>src/lib/workspaceSecret.ts</code>), never shown again in full once
        saved. This field exists because the point of a downloadable, open-source project is that anyone running
        their own instance should use their own Anthropic key, not the demo deployment&apos;s - no capability below
        will run at all until this is configured.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Security: password and recovery key</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2">
        {isSpendLocked(workspace) ? (
          <p className="text-sm text-zinc-700">
            Switched off on the shared demo: its password and recovery key are public and cannot be changed. Run your own copy to manage them.
          </p>
        ) : (
          <div className="space-y-5">
            {security && (
              <p
                role="status"
                className={`text-xs rounded-lg px-3 py-2 ${security === "password_changed" ? "text-green-800 bg-green-50" : "text-red-800 bg-red-50"}`}
              >
                {SECURITY_MESSAGES[security] ?? "Something went wrong - try again."}
              </p>
            )}
            <form action={changeMyPassword} className="space-y-2">
              <p className="text-sm font-medium text-zinc-900">Change password</p>
              <div>
                <label htmlFor="sec-current" className="block text-xs text-zinc-500 mb-1">Current password</label>
                <input id="sec-current" name="current" type="password" required autoComplete="current-password" maxLength={128} className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label htmlFor="sec-next" className="block text-xs text-zinc-500 mb-1">New password (8 to 128 characters)</label>
                  <input id="sec-next" name="next" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm" />
                </div>
                <div>
                  <label htmlFor="sec-confirm" className="block text-xs text-zinc-500 mb-1">Confirm new password</label>
                  <input id="sec-confirm" name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm" />
                </div>
              </div>
              <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
                Change password
              </button>
              <p className="text-xs text-zinc-500">Your other sessions are signed out; this one stays signed in.</p>
            </form>

            <form action={regenerateMyRecoveryKey} className="space-y-2 border-t border-zinc-100 pt-4">
              <p className="text-sm font-medium text-zinc-900">Recovery key</p>
              <p className="text-xs text-zinc-600">
                {sessionUser?.recoveryKeyCreatedAt
                  ? `A recovery key was set on ${sessionUser.recoveryKeyCreatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}. It is not shown again. Make a new one if you have lost it: the old one stops working.`
                  : "You have no recovery key yet, so a forgotten password could not be reset. Make one now and keep it somewhere safe."}
              </p>
              <div>
                <label htmlFor="sec-key-current" className="block text-xs text-zinc-500 mb-1">Current password</label>
                <input id="sec-key-current" name="current" type="password" required autoComplete="current-password" maxLength={128} className="w-full max-w-xs rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm" />
              </div>
              <button type="submit" className="rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-sm text-zinc-800 px-3 py-1.5">
                {sessionUser?.recoveryKeyCreatedAt ? "Make a new recovery key" : "Make a recovery key"}
              </button>
            </form>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        Bearing sends no email, so a forgotten password is reset with the recovery key on the Forgot password page. Only a scrambled copy of the key is stored.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Plan &amp; trial</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2">
        {trial.exempt ? (
          <p className="text-sm text-zinc-700">{trial.selfHosted ? "Self-hosted copy - no trial and no subscription. You run it, you pay for your own key and servers." : "Demo workspace - always has full access, not on a trial."}</p>
        ) : trial.subscribed ? (
          <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            <span className="text-sm text-zinc-900">Subscribed (demo only - no real payment was taken)</span>
            <form action={cancelSimulatedSubscription}>
              <button type="submit" className="text-xs text-red-700 hover:underline">
                Cancel
              </button>
            </form>
          </div>
        ) : trial.active ? (
          <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            <span className="text-sm text-zinc-900">
              {trial.daysRemaining} day{trial.daysRemaining === 1 ? "" : "s"} left in your free trial
            </span>
            <form action={simulateSubscribe}>
              <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
                Upgrade (demo only)
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <span className="text-sm text-red-800">Your free trial ended on {trial.trialEndsAt.toDateString()}.</span>
            <form action={simulateSubscribe}>
              <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
                Upgrade (demo only)
              </button>
            </form>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        Every capability below (Health included) needs an active trial or subscription to run - a workspace&apos;s
        own configured Anthropic key is a separate, additional requirement, not a substitute. &quot;Upgrade&quot;
        here is illustrative only, matching the &quot;concept, not a connection&quot; treatment already used for
        billing elsewhere in this repo - no real payment processor exists, and nothing is ever actually charged.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Automation</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2 space-y-2">
        {workspace.isDemoSeed ? (
          <>
            <p className="text-sm text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">{DEMO_LOCK_NOTICE}</p>
            {ALLOWED_CAPABILITIES.map((capability) => (
              <div key={capability} className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <p className="text-sm text-zinc-900 font-medium">{CAPABILITY_LABELS[capability]}</p>
                <p className="text-xs text-zinc-500">{fmtRunTime(runConfigs[capability].lastRunAt)}</p>
              </div>
            ))}
          </>
        ) : !workspace.anthropicApiKeyLast4 ? (
          <>
            <p className="text-sm text-zinc-500">
              Add your Anthropic API key above to turn on the AI steps. Health scoring works without one: it runs the free baseline only.
            </p>
            {trial.active && (
              <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-900 font-medium">Health scoring (baseline only, free)</p>
                  <p className="text-xs text-zinc-500">{fmtRunTime(runConfigs.health.lastRunAt)}</p>
                </div>
                <RunNowButton
                  capability="health"
                  label="Run baseline now"
                  initial={
                    activeRuns.health
                      ? {
                          status: activeRuns.health.status as "running" | "failed",
                          processed: activeRuns.health.processed,
                          total: activeRuns.health.total,
                          error: activeRuns.health.error,
                        }
                      : null
                  }
                />
              </div>
            )}
          </>
        ) : !trial.active ? (
          <p className="text-sm text-zinc-500">Upgrade above to enable this - your free trial has ended.</p>
        ) : (
          ALLOWED_CAPABILITIES.map((capability) => (
            <div key={capability}>
              <div className="flex items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm text-zinc-900 font-medium">{CAPABILITY_LABELS[capability]}</p>
                  <p className="text-xs text-zinc-500">{fmtRunTime(runConfigs[capability].lastRunAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={updateCapabilitySchedule} className="flex items-center gap-1.5">
                    <input type="hidden" name="capability" value={capability} />
                    <select
                      name="schedule"
                      defaultValue={runConfigs[capability].schedule}
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
                  <RunNowButton
                    capability={capability}
                    initial={
                      activeRuns[capability]
                        ? {
                            status: activeRuns[capability]!.status as "running" | "failed",
                            processed: activeRuns[capability]!.processed,
                            total: activeRuns[capability]!.total,
                            error: activeRuns[capability]!.error,
                          }
                        : null
                    }
                  />
                </div>
              </div>
              {capability === "adoption" && (
                <form action={updateAdoptionThreshold} className="flex items-center gap-2 mt-1.5 px-3">
                  <label htmlFor="f-threshold-1" className="text-xs text-zinc-500">Underused-capability threshold</label>
                  <input id="f-threshold-1"
                    name="threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={workspace.adoptionUnderusedThresholdPct}
                    className="w-16 rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-zinc-500">%</span>
                  <button type="submit" className="rounded-lg border border-zinc-200 text-zinc-700 text-xs px-2 py-1">
                    Save
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        &quot;On-demand only&quot; (the default) means this never runs automatically - nothing is spent against your
        key until you click Run now or pick a schedule. Scheduled runs happen via a daily check (Vercel Hobby&apos;s
        cron plans only allow once-per-day jobs) that looks at every workspace&apos;s own schedule and runs whichever
        are actually due - so &quot;Weekly&quot; still only runs roughly every 7 days even though the check itself
        happens daily. Run now always works regardless of the schedule setting. A large workspace takes longer than a
        hosted function may run, so a run is done in pieces and saves its place after each one: keep the page open
        and it finishes by itself, or close it and click Continue later. A scheduled run continues each day until
        it is done.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Competitor risk ({competitors.length}/20)</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2">
        {competitors.length === 0 && <p className="text-sm text-zinc-500 mb-2">No competitors configured.</p>}
        <div className="space-y-2 mb-3">
          {competitors.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
              <span className="text-zinc-900 font-medium">{c.name}</span>
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
            <label htmlFor="f-name-2" className="block text-xs text-zinc-500 mb-1">Name</label>
            <input id="f-name-2" name="name" required maxLength={80} className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent" />
          </div>
          <div>
            <label htmlFor="f-riskWeight-1" className="block text-xs text-zinc-500 mb-1">Risk weight (1-5)</label>
            <input id="f-riskWeight-1"
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
            className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        Direct mentions and known-capability mentions of these are detected for real in interaction text (see the
        Health screen). Job-posting and competitor-website monitoring stay concept-only - see README.md.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Data export allowlist (concept)</h2>
      <div className="rounded-xl bg-white border border-zinc-200 shadow-sm p-4 mb-2">
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
          <button type="submit" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5 mt-2">
            Save
          </button>
        </form>
      </div>
      <p className="text-xs text-zinc-500 mb-8">
        Configuration only - no export mechanism is built. This records which of Bearing&apos;s own generated fields
        (not data pulled in from elsewhere) an org would want pushed back to their CRM if a real export pipeline
        existed later. Same &quot;show the concept, don&apos;t connect&quot; treatment as Integrations and SSO.
      </p>

      <h2 className="text-sm font-medium text-zinc-900 mb-3">Not built yet</h2>
      <p className="text-sm text-zinc-600">
        Team &amp; roles, other integrations (concept-only connectors), developer/API (concept-only), consumption/
        outcome metric configuration, and the actual export mechanism (the allowlist above only records intent).
        Plan &amp; trial above is a real, working gate - the &quot;Upgrade&quot; action within it stays illustrative
        only, since real payment processing is out of scope for this repo.
      </p>
    </div>
  );
}
