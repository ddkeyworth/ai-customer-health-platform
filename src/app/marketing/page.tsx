import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "Bearing — a portfolio concept for agentic Customer Success",
  description:
    "No AI reads every account right. It gets you close enough, fast enough, to act. A conceptual CS platform, built as a portfolio piece.",
};

const AREAS = [
  {
    name: "Onboarding",
    copy: "Real three-date pace tracking (initial/expected/actual go-live) and overdue sorting, so a stalled account surfaces before it becomes a renewal problem.",
  },
  {
    name: "Health",
    copy: "The flagship: a deterministic baseline across 15 real signals, plus a bounded, evidence-grounded AI adjustment — never a freeform score, always traceable back to specific data.",
  },
  {
    name: "Adoption",
    copy: "Capability breadth and per-account usage depth across every product a customer holds, not just the one they started with.",
  },
  {
    name: "Expansion",
    copy: "Opportunities surfaced from real usage signals — seat mentions, package-ceiling breadth, consumption growth — with Raised-by and Owner tracked separately.",
  },
  {
    name: "Renewal",
    copy: "Renewal dates, Auto vs. Interrupted status, and ARR at risk in one place, with projected churn read honestly off the Health band, not oversold as a calibrated model.",
  },
];

const TIERS = [
  {
    name: "Starter",
    blurb: "For a single small team getting Health scoring live.",
    seats: "Up to 5 seats",
    volume: "Up to 10,000 tracked accounts",
  },
  {
    name: "Growth",
    blurb: "For a CS org running Onboarding through Renewal as one pipeline.",
    seats: "Up to 20 seats",
    volume: "Up to 100,000 tracked accounts",
    highlighted: true,
  },
  {
    name: "Enterprise",
    blurb: "Custom team structures, unlocked consumption/outcome metric caps.",
    seats: "Custom seat count",
    volume: "Custom account volume",
  },
];

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Logo height="1.1em" />
          <span className="text-[10px] rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5">
            Mobile app — coming soon
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-zinc-600">
          <a href="#areas" className="hover:text-zinc-900">Product</a>
          <a href="#pricing" className="hover:text-zinc-900">Pricing</a>
          <a
            href="https://github.com/ddkeyworth/ai-customer-health-platform"
            className="hover:text-zinc-900"
          >
            Docs
          </a>
          <Link href="/" className="rounded-lg bg-zinc-900 text-white px-3 py-1.5 hover:bg-zinc-800">
            Open the app
          </Link>
        </nav>
      </header>

      <section className="max-w-3xl mx-auto text-center px-6 py-20">
        <h1 className="text-3xl font-medium text-zinc-900 mb-4">
          No AI reads every account right.
        </h1>
        <p className="text-lg text-zinc-600 mb-8">
          It gets you close enough, fast enough, to act — across onboarding, health, expansion, and renewal.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-zinc-900 text-white px-5 py-2.5 text-sm hover:bg-zinc-800"
        >
          Explore the live build
        </Link>
        <p className="mt-3 text-xs text-zinc-400">
          Real scoring engine, real synthetic data — not a static mockup. See{" "}
          <a href="#trust" className="underline">what&apos;s actually real</a> below.
        </p>
      </section>

      <section id="areas" className="max-w-5xl mx-auto px-6 py-16 border-t border-zinc-100">
        <h2 className="text-sm font-medium text-zinc-500 mb-6 text-center">One lifecycle, five areas</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {AREAS.map((a) => (
            <div key={a.name} className="rounded-xl bg-zinc-50 p-4">
              <p className="text-sm font-medium text-zinc-900 mb-1.5">{a.name}</p>
              <p className="text-xs text-zinc-600 leading-relaxed">{a.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="max-w-5xl mx-auto px-6 py-16 border-t border-zinc-100">
        <h2 className="text-sm font-medium text-zinc-500 mb-1 text-center">Illustrative pricing</h2>
        <p className="text-xs text-zinc-400 mb-8 text-center">
          Two-axis: seats and tracked-account volume, not seats alone — a CS org with few users but a large book
          shouldn&apos;t be priced like a seat-only tool. Figures are illustrative, not a real price list.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`rounded-xl p-5 border ${t.highlighted ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"}`}
            >
              <p className="text-sm font-medium mb-1">{t.name}</p>
              <p className={`text-xs mb-4 ${t.highlighted ? "text-zinc-300" : "text-zinc-500"}`}>{t.blurb}</p>
              <p className="text-xs mb-1">{t.seats}</p>
              <p className="text-xs">{t.volume}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="max-w-3xl mx-auto px-6 py-16 border-t border-zinc-100">
        <h2 className="text-sm font-medium text-zinc-500 mb-4">What&apos;s actually real</h2>
        <p className="text-sm text-zinc-600 leading-relaxed mb-3">
          This is a portfolio project, not a real company or live product. The Health-scoring engine, the 9 app
          screens, and the data model are genuinely built and run against real (synthetic) seeded data and real
          Anthropic API calls — see{" "}
          <a href="https://github.com/ddkeyworth/ai-customer-health-platform" className="underline">
            the repo&apos;s README and TESTING.md
          </a>{" "}
          for what&apos;s been verified, not just claimed.
        </p>
        <p className="text-sm text-zinc-600 leading-relaxed">
          There is no live public deployment — this runs locally only. If it were deployed, the stack would be
          Next.js on Vercel with Postgres on Neon (the same free-tier services already used for local development),
          gated on real auth and rate limiting first.
        </p>
      </section>

      <footer className="border-t border-zinc-200">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs text-zinc-500 mb-8">
            <div>
              <p className="font-medium text-zinc-700 mb-2">Product</p>
              <a href="#areas" className="block hover:text-zinc-900 mb-1">Areas</a>
              <a href="#pricing" className="block hover:text-zinc-900">Pricing</a>
            </div>
            <div>
              <p className="font-medium text-zinc-700 mb-2">Resources</p>
              <a
                href="https://github.com/ddkeyworth/ai-customer-health-platform"
                className="block hover:text-zinc-900 mb-1"
              >
                Docs / Help
              </a>
              <a
                href="https://github.com/ddkeyworth/ai-customer-health-platform/issues"
                className="block hover:text-zinc-900"
              >
                Contact / Support
              </a>
            </div>
            <div>
              <p className="font-medium text-zinc-700 mb-2">Legal (illustrative)</p>
              <a href="#legal" className="block hover:text-zinc-900 mb-1">Security</a>
              <a href="#legal" className="block hover:text-zinc-900 mb-1">Terms of Service</a>
              <a href="#legal" className="block hover:text-zinc-900">Privacy Policy</a>
            </div>
            <div>
              <p className="font-medium text-zinc-700 mb-2">Bearing</p>
              <p>Portfolio demo, not a real company.</p>
            </div>
          </div>

          <div id="legal" className="rounded-xl bg-zinc-50 p-4 text-xs text-zinc-500 leading-relaxed mb-6">
            <p className="mb-2">
              <span className="font-medium text-zinc-700">Security:</span> design principles only — no real
              security audit, certification, or hardened infrastructure exists for this local-only build.
            </p>
            <p className="mb-2">
              <span className="font-medium text-zinc-700">Terms of Service:</span> not a real service, so there are
              no real user obligations to state.
            </p>
            <p>
              <span className="font-medium text-zinc-700">Privacy Policy:</span> every customer, person, and
              interaction in this build is synthetic. Nothing real is ever collected, because this doesn&apos;t run
              as a live product.
            </p>
          </div>

          <p className="text-xs text-zinc-400">
            &copy; 2026 Bearing. Bearing is a portfolio demo project — not a real company or live product.
          </p>
        </div>
      </footer>
    </div>
  );
}
