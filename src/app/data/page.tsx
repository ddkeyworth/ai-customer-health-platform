import { prisma } from "@/lib/prisma";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { demoLockEnabled, isSpendLocked, DEMO_LOCK_NOTICE } from "@/lib/demoGuard";
import { activeLimits } from "@/lib/import/validate";
import { isSelfHosted } from "@/lib/deployment";
import ImportForm from "@/components/ImportForm";
import DeleteWorkspaceForm from "@/components/DeleteWorkspaceForm";

export const dynamic = "force-dynamic";

const IMPORTS = [
  {
    kind: "customers" as const,
    title: "1. Customers",
    blurb:
      "One row per customer and product. Only name is required. To give a customer a second product, repeat the name on a new row with a different product; the customer-level columns (country, tier, NPS, champion and so on) go on the first row, and a later row may leave them blank or repeat them exactly. Dates are written YYYY-MM-DD; amounts are plain numbers (commas only as thousands separators).",
    columns:
      "name, ref, country, industry, region, city, sub_industry, tier, product, lifecycle_status, contractual_arr, consumption_arr, renewal_date, expected_go_live_date, go_live_date, payment_status, days_past_due, renewal_type, interrupted_reason, nps, nps_date, champion_name, champion_last_engaged",
  },
  {
    kind: "tickets" as const,
    title: "2. Support tickets (optional)",
    blurb: "What customers have raised with you. The AI reads this text, and Health counts the volume and severity. A blank severity is kept as not recorded.",
    columns: "customer, date, type, severity, text",
  },
  {
    kind: "usage" as const,
    title: "3. Usage (optional)",
    blurb:
      "Readings over time for each feature (adoption) or metered amount (consumption). Health looks at the trend. Leave product blank to attach a reading to the customer's first product.",
    columns: "customer, product, capability, metric_type, date, value",
  },
  {
    kind: "outcomes" as const,
    title: "4. Outcome history (optional)",
    blurb: "Past renewals, churn and expansions. The churn model and the Calibration page learn from this.",
    columns: "customer, date, type, notes",
  },
  {
    kind: "stakeholders" as const,
    title: "5. Stakeholders (optional)",
    blurb:
      "The people at the customer. Health's champion signal reads whether a champion is engaged. A person is identified by customer plus name, so a champion already created from the customers file is not added twice.",
    columns: "customer, name, role, is_champion, last_engaged_date",
  },
  {
    kind: "goals" as const,
    title: "6. Goals (optional)",
    blurb: "What each customer bought the product to achieve, and how far along they are. Health's desired-outcome signal reads these. Identified by customer plus goal name.",
    columns: "customer, name, target_value, actual_value, unit",
  },
  {
    kind: "training" as const,
    title: "7. Training (optional)",
    blurb: "Training sessions a customer has completed. Health's training signal looks at how recent and how well attended they are.",
    columns: "customer, course, attendees, date",
  },
  {
    kind: "events" as const,
    title: "8. Events (optional)",
    blurb: "Events and webinars a customer attended. Health's engagement-silence signal counts these.",
    columns: "customer, event, date",
  },
  {
    kind: "surveys" as const,
    title: "9. Surveys (optional)",
    blurb: "Every survey response over time: NPS, CSAT or CES, each a whole number from 0 to 10. Health reads NPS. An NPS given on the customers file is the same response, so it is not counted twice.",
    columns: "customer, type, score, date",
  },
];

const EXPORTS = [
  { kind: "customers", title: "Customers", blurb: "Everything you can import, plus each customer's Health score, band and narrative." },
  { kind: "tickets", title: "Support tickets", blurb: "In the same layout as the import file." },
  { kind: "usage", title: "Usage", blurb: "In the same layout as the import file." },
  { kind: "outcomes", title: "Outcome history", blurb: "In the same layout as the import file." },
  { kind: "stakeholders", title: "Stakeholders", blurb: "In the same layout as the import file." },
  { kind: "goals", title: "Goals", blurb: "In the same layout as the import file." },
  { kind: "training", title: "Training", blurb: "In the same layout as the import file." },
  { kind: "events", title: "Events", blurb: "In the same layout as the import file." },
  { kind: "surveys", title: "Surveys", blurb: "In the same layout as the import file." },
  { kind: "recommendations", title: "AI recommendations", blurb: "A report of every proposed action with its reasoning and status. Not importable." },
];

export default async function DataPage() {
  const workspace = await getCurrentWorkspace();
  const locked = isSpendLocked(workspace);
  // A public demo instance is one that holds the demo workspace with the lock on.
  const demoWorkspaces = await prisma.workspace.count({ where: { isDemoSeed: true } });
  const publicDemo = demoLockEnabled() && demoWorkspaces > 0;
  // A real self-hosted copy that still contains the public demo workspace has a
  // login with a publicly known password in its database.
  const selfHostedWithDemo = isSelfHosted() && demoWorkspaces > 0;
  const limits = activeLimits();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">Data</h1>
      <p className="text-sm text-zinc-500 mb-5">Bring your own data in, take it out again, or delete it.</p>

      {locked && (
        <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{DEMO_LOCK_NOTICE}</p>
      )}
      {selfHostedWithDemo && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          This copy contains the public demo workspace (Meridian Ops), which has a login with a publicly known password.
          If this is a real deployment, delete that workspace: anyone who has read the README can sign in to it.
        </p>
      )}
      {publicDemo && !locked && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This is a public demonstration site. Use sample or anonymised data only, never real customer data. To use your
          own real data, run your own copy of Bearing on your own hosting (see the README on GitHub); it then stays in
          your own database under your control.
        </p>
      )}

      <h2 className="text-sm font-medium text-zinc-900 mb-2">Import</h2>
      <p className="text-xs text-zinc-500 mb-3">
        Upload CSV files, customers first. Each file is checked completely before anything is saved: if any row is wrong
        you are told which one and nothing is imported. Importing the same file again does not double your data: rows that
        already exist are skipped and counted. Limits: {Math.round(limits.maxBytes / 1000)} KB per file,{" "}
        {limits.maxCustomersPerWorkspace} customers and {limits.maxChildRowsPerWorkspace.toLocaleString("en-GB")} rows per
        file type per workspace. Every file after customers names a customer by its ref (such as CUS-0001) or its exact
        name. The file must be UTF-8: in Excel, save as CSV UTF-8.
      </p>
      <div className="space-y-3 mb-8">
        {IMPORTS.map((i) => (
          <div key={i.kind} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-900">{i.title}</h3>
              <a href={`/templates/${i.kind}.csv`} download className="text-xs text-[#378ADD] hover:underline">
                Download template
              </a>
            </div>
            <p className="mt-1 text-xs text-zinc-600">{i.blurb}</p>
            <p className="mt-1 text-xs text-zinc-400">Columns: {i.columns}</p>
            <ImportForm kind={i.kind} disabled={locked} />
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-zinc-900 mb-2">Export</h2>
      <p className="text-xs text-zinc-500 mb-3">
        Download your data as CSV. Every file except the recommendations report uses the import layout, so you can load it
        straight back into another workspace or another copy of Bearing.
      </p>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm mb-8 space-y-2">
        {EXPORTS.map((e) => (
          <div key={e.kind} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-zinc-900">{e.title}</p>
              <p className="text-xs text-zinc-500">{e.blurb}</p>
            </div>
            <a
              href={`/api/export/${e.kind}`}
              download
              className="rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-sm text-zinc-800 px-3 py-1.5"
            >
              Download CSV
            </a>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-red-800 mb-2">Delete this workspace</h2>
      <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
        <p className="text-xs text-zinc-600">
          Permanently deletes this workspace, every customer and all their data, the AI results, and your login. It
          cannot be undone. Download your data first if you want to keep it.
        </p>
        <DeleteWorkspaceForm workspaceName={workspace.name} disabled={locked} />
      </div>
    </div>
  );
}
