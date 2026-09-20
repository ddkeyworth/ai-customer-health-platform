# ai-customer-health-platform

A conceptual exploration of an agentic-AI Customer Success platform – planned and built with Claude Code as a portfolio piece. **This is a prototype, not a production system, and not a real product.** Nothing here is a real company. It is live at [bearing360.vercel.app](https://bearing360.vercel.app) (see [Stage 2](#stage-2-live-deployment)) – demo login below, or sign up for your own isolated workspace – with no real customer data anywhere, and no outbound contact beyond the Anthropic API itself.

> No AI reads every account right. It gets you close enough, fast enough, to act. Across onboarding, health, expansion, and renewal.

<table>
<tr>
<td><b>Login</b><br><img src="docs/screenshots/login-screenshot.png" width="440" alt="Login screen"></td>
<td><b>Signup</b><br><img src="docs/screenshots/signup-screenshot.png" width="440" alt="Signup screen"></td>
</tr>
<tr>
<td><b>Home</b><br><img src="docs/screenshots/home-screenshot.png" width="440" alt="Home screen"></td>
<td><b>Health</b><br><img src="docs/screenshots/health-screenshot.png" width="440" alt="Health screen"></td>
</tr>
<tr>
<td><b>Health drill-in (one customer)</b><br><img src="docs/screenshots/customer-detail-screenshot.png" width="440" alt="Customer detail, Health drill-in"></td>
<td><b>Briefing</b><br><img src="docs/screenshots/briefing-screenshot.png" width="440" alt="Briefing screen"></td>
</tr>
<tr>
<td><b>Onboarding</b><br><img src="docs/screenshots/onboarding-screenshot.png" width="440" alt="Onboarding screen"></td>
<td><b>Adoption</b><br><img src="docs/screenshots/adoption-screenshot.png" width="440" alt="Adoption screen"></td>
</tr>
<tr>
<td><b>Expansion</b><br><img src="docs/screenshots/expansion-screenshot.png" width="440" alt="Expansion screen"></td>
<td><b>Renewal</b> (full page)<br><img src="docs/screenshots/renewal-screenshot.png" width="440" alt="Renewal screen"></td>
</tr>
<tr>
<td><b>Segments</b><br><img src="docs/screenshots/segments-screenshot.png" width="440" alt="Segments screen"></td>
<td><b>Calibration</b><br><img src="docs/screenshots/calibration-screenshot.png" width="440" alt="Calibration screen"></td>
</tr>
<tr>
<td><b>Settings</b> (full page)<br><img src="docs/screenshots/competitor-config-screenshot.png" width="440" alt="Settings screen"></td>
<td><b>Marketing page</b> (full page)<br><img src="docs/screenshots/marketing-screenshot.png" width="440" alt="Marketing page"></td>
</tr>
</table>

![Health scoring architecture](docs/screenshots/health-scoring-architecture.svg)

All fourteen screenshots are real captures of the live app (`/login`, `/signup`, `/`, `/health`, `/health/[customerId]`, `/briefing`, `/onboarding`, `/adoption`, `/expansion`, `/renewal`, `/segments`, `/calibration`, `/settings`, `/marketing`), taken against the production deployment with the synthetic data described below. None are mockups. Renewal, Settings and Marketing are full-page captures; the rest show the top of the page. Onboarding shows no AI recovery plan because both overdue accounts were correctly declined for lack of evidence (see [Playbook agentic layers](#playbook-agentic-layers)). `health-scoring-architecture.svg` is a diagram, not a screenshot. Regenerate the screenshots with `npm run screenshots` (`scripts/capture-screenshots.mjs`, Puppeteer-driven).

The repo is named descriptively for portfolio discoverability; **"Bearing"** is the working product name used within the app and mockups themselves.

## What this is

Most Customer Success tooling is a system of record – a place to manage accounts, log interactions, and store contracts. This project is deliberately **not** that. It's an insight layer that sits on top of the systems that already do that job, organised around five areas of the customer lifecycle:

- **Health** – a composite score built from 15 drivers (support friction, consumption trend, capability breadth/stickiness, competitor risk, engagement silence, and more), run continuously from Onboarding through Live. The flagship area, and the one genuinely load-bearing piece of the whole idea.
- **Onboarding** – pace to first Capability go-live, with a cause-tagged log of any slippage.
- **Adoption** – usage and consumption trends per Capability, and progress against the Desired Outcomes a customer actually bought the product to achieve.
- **Expansion** – Price Increase, Cross-sell, Upsell, and Consumption Growth opportunities, each with a Raised-By and an Owner.
- **Renewal** – Auto vs. Interrupted renewals, ARR and consumption revenue at risk, and a projected-churn estimate shown honestly as an estimate, not a fact.

Every screen is meant to carry its own synthesised narrative, not just a data table – because a re-skinned CRM view isn't the point. If the reasoning underneath isn't genuinely sound, this whole idea doesn't hold up. See [Health scoring – built, and how it actually works](#health-scoring--built-and-how-it-actually-works).

## Governing principle: safe by construction, not by promise

Every design decision in this repo follows one rule: **anything that would touch the outside world, real data, or a real compliance claim is shown as a concept only – never operationalised.**

- No real customer or personal data, anywhere, ever. All data is synthetic.
- No outbound network call except to the Anthropic API for the agent's own reasoning – see [Health scoring](#health-scoring--built-and-how-it-actually-works) below for what that actually does. Any other integration (a real CRM sync, a real email send, a real OAuth login, monitoring job boards or competitor websites) is represented as a UI concept, not a working connection, unless explicitly extended later with deliberate sign-off.
- No compliance claims that aren't true. No fabricated traction, testimonials, or results anywhere in this repo or its documentation.
- Every agent action is designed to be a draft a human reviews – nothing is ever sent or executed automatically.
- **No other GitHub user or self-hosted deployment can ever spend or touch the maintainer's own private API keys, database, or accounts.** Every capability that costs money (see [Automation](#automation)) requires that workspace's own configured key, with no fallback to a shared platform-wide one – enforced in code (`runCapability()` throws if a workspace has no key configured), not left as a documentation promise.

## What's real vs. planned

All 10 dashboard screens (Home, Health, Briefing, Onboarding, Adoption, Expansion, Renewal, Segments, Calibration, Settings) are wired to real data - nothing left as a static stub. They're not all equally deep, though - see the per-screen notes below for what's genuinely agentic vs. rule-based vs. read-only. A real public marketing page (`/marketing`) also exists, outside the dashboard shell.

**This has actually been run, not just written.** See [`TESTING.md`](TESTING.md) for the log: real Anthropic API calls against handcrafted seed customers with known-good expected behaviour, a real cross-tenant security gap found and fixed, a real bug the multi-product data exposed, and an honest account of a browser-automation false negative during testing that turned out not to be a real bug.

| Area | Status |
|---|---|
| Product definition, requirements, information architecture | Fully planned |
| Data model (Workspace, User, Customer, Product, Capability, Package, Health snapshot, Competitor config, Interaction, Usage, Survey, Event attendance, Opportunity, Segment, Desired Outcome, Stakeholder, Training completion, Outcome event, Session) | Built in `prisma/schema.prisma`, live on a real (free-tier) Postgres instance |
| App shell (navigation, layout, logo) | Built |
| Synthetic data generator (`prisma/seed.ts`) | **Built and run for real** - 19 fictional customers across 2 products, tickets, usage history, surveys, event attendance, renewal dates |
| Health-scoring engine (the actual "special sauce") | **Built and tested for real** - see below. Runs against each workspace's own configured Anthropic key (see [Automation](#automation)) - on-demand, or a Daily/Weekly schedule via a real Vercel Cron job, not just a manually-run script |
| `/health` | List view, per-customer drill-in (`/health/[customerId]`), and a real LLM-generated executive summary - all reading stored data, none recomputed on page load |
| `/` (Home) | Real Total ARR, Health bands, lifecycle-stage counts, and a "needs attention" list. Deliberately does not show NNAOV/NRR/GRR - those need realised bridge events this build doesn't track yet |
| `/onboarding` | Real three-date pace tracking and overdue sorting, plus a real agentic recovery-plan layer for genuinely overdue accounts - see [Playbook agentic layers](#playbook-agentic-layers) |
| `/adoption` | Real capability breadth and per-Capability adoption stats across live accounts, plus a real agentic usage-nudge layer below a configurable breadth threshold |
| `/expansion` | Real Opportunity model (4 types), always generated by **deterministic rules** (the free, always-on baseline), with a real optional agentic review layer on top - same two-layer shape as Health |
| `/renewal` | Real renewal dates, Auto/Interrupted status, ARR at risk. Churn likelihood now comes from real recorded outcomes per Health band where there's enough history, with an illustrative per-band fallback, plus a real agentic save-play layer for at-risk accounts |
| `/segments` | Real saved filters - create/view/delete all genuinely work, capped at 20 per workspace. Picking one from the top-bar selector re-scopes every area (Home, Health, Onboarding, Adoption, Expansion, Renewal, Briefing) to it, carried via the URL - the Micro view from the original design. Health's executive summary stays whole-book-only rather than generating a live per-segment Anthropic call on every page load |
| `/settings` | Org profile/branding/localisation and competitor risk config are real, writable forms (Server Actions). A data-export allowlist config is also real (which of Bearing's own generated fields would sync to a CRM), same concept-only treatment as Integrations/SSO - no actual export mechanism exists. A workspace can also store its own Anthropic API key, encrypted at rest (see [Bring your own Anthropic API key](#bring-your-own-anthropic-api-key)), a configurable Adoption threshold, and a real run schedule for all 5 capabilities - on-demand, daily, or weekly, plus a Run now override (see [Automation](#automation)). A real free-trial/subscription gate now sits in front of every capability's AI layer - the "subscribe" action itself stays illustrative, same concept-only treatment as billing. Team & roles, other integrations, developer/API stay honest "not built yet" |
| `/briefing` | Real cross-area action queue, consolidated by account and ranked by £ impact, pulled live from Health/Onboarding/Expansion/Renewal, plus Adoption once its agentic layer has actually proposed a nudge. Read-only - no approve/dismiss/snooze state yet |
| `/marketing` | Real public-facing landing page - positioning line, 5 lifecycle-area cards, illustrative two-axis pricing, and an honest "what's actually real" section. Rendered without the internal dashboard chrome via `AppShell`. Terms/Privacy/Security stay one-line honest placeholders, not real legal documents, per the governing safety principle |
| `/calibration` | Real calibration loop - every recorded `OutcomeEvent` (churned/renewed/expanded) compared against the Health score on file, classified as confirmed/missed/worth-reviewing. Not a true point-in-time backtest (one snapshot per customer, not a real historical series); nothing here adjusts driver weighting automatically - see the page's own footnote |
| `/login`, `/signup` | Real email/password authentication (bcrypt + database-backed sessions) - see [Authentication](#authentication). Signup creates a genuine new, empty, isolated workspace, not a new user in the shared demo one |
| Agent core / playbooks for areas beyond Health | **Built and tested for real.** All four (Onboarding, Adoption, Expansion, Renewal) now have their own agentic layer, matching Health's two-layer depth - see [Playbook agentic layers](#playbook-agentic-layers) and [`docs/playbook-proposals.md`](docs/playbook-proposals.md) for the original design this was built from |
| Live public deployment | **Done.** [bearing360.vercel.app](https://bearing360.vercel.app) - see [Stage 2: live deployment](#stage-2-live-deployment) |

## Health scoring – built, and how it actually works

The easy part of this project is the CRM-adjacent facts – ARR, package, who's assigned. Those aren't the point; a real CRM already shows them. The actual value must come from genuine insight: a composite score that reasons about context rather than averaging numbers, and a narrative that explains *why*, built from evidence, not a template.

The architecture (see `docs/screenshots/health-scoring-architecture.svg`) is implemented in `src/lib/health/`:

- **Two layers, not one formula.** Layer 1 (`baseline.ts`) is deterministic and reproducible: each of the 15 drivers normalised against the account's own history and a peer cohort, not a fixed global threshold – no AI involved. Layer 2 (`agenticLayer.ts`) is a real Anthropic API call (`claude-sonnet-4-5`, structured tool output) that applies a **bounded** adjustment on top of the baseline (capped at +-15 points), with a required, evidence-grounded reason – never a freeform, unexplained number.
- **Evidence-chain narrative.** Every claim the narrative makes must trace back to a specific input value it was given, not an invented correlation. Tested for real: the model has correctly cited exact usage-decline percentages, specific ticket dates and content, and even surfaced a genuine expansion signal ("asked about adding two more seats") that isn't one of the 15 formal drivers at all – reasoning beyond the baseline, not just restating it.
- **A real whole-book executive summary**, not a code-aggregated stat sentence. `src/lib/health/bookSummary.ts` makes one Anthropic call across all customers' scores and narratives, finding real cross-account patterns – tested for real, it independently spotted the same billing-sync defect recurring across four unrelated accounts, and noted that high-NPS accounts were nonetheless showing steep usage decline (sentiment lagging disengagement). Scoped by a list of customer IDs rather than hardcoded to "everyone," so the same function can serve a Segment-scoped summary later without changes. Computed by a batch script (`prisma/compute-book-summary.ts`), same "never live on page load" rule as everything else.
- **Stage-aware scoring.** A pre-Live account gets a narrow, honest read focused on onboarding pace, not the full 15-driver picture applied to an account that hasn't started yet.
- **Confidence labeling**, driven by how much data actually backs a score, not the agent's own self-assessment.
- **A calibration loop, built for real.** `/calibration` compares every recorded `OutcomeEvent` (churned/renewed/expanded) against the Health score on file for that customer, and classifies each as confirmed, missed, or worth reviewing – e.g. a Watch/Critical account that renewed anyway isn't auto-flagged as a scoring error, since it may reflect a successful save-play instead. Honest limitation: this build stores one current snapshot per customer, not a real historical series, so it's not a true point-in-time backtest of "what the score said before the outcome happened" – see the page's own footnote. Nothing here adjusts driver weighting automatically; it's a review surface for a human to spot patterns, same "agent proposes, human decides" pattern as everything else.

Two drivers worth calling out specifically, since they came from a skeptical pass on the model rather than an obvious first draft:

- **Competitor risk is multi-source, split on safety grounds.** Most churn is competitive displacement, not need disappearing, so a workspace admin can configure up to 20 competitors, each with a risk weight (not all competitors are equal threats – see `docs/screenshots/competitor-config-screenshot.png`; the seed data configures 3). Detection for **direct mentions** and **mentions of a competitor's known capabilities** is built for real, via the same Anthropic reasoning call used for Layer 2 – it only ever scans interaction text already in the system, so there's no new outbound contact and no dependency on a third-party product. Confirmed working against seeded ticket text (e.g. a mention of a competitor's predictive-ETA feature was correctly flagged with the supporting quote). Two further signal sources – **job postings** referencing a competitor's stack, and **references on a competitor's own website** – are deliberately **not implemented**. Both would require monitoring genuinely new external sources, which stays concept-only regardless of whether the competitor list is populated, pending explicit sign-off.
- **Engagement silence.** A noisy, complaining customer is easy to spot; a silent one – no support contact, no event attendance, flat usage, no communication – is often the bigger risk, and a naive per-driver model can actually score a quiet account as *healthier* than it should be, since fewer tickets alone looks like an improvement. This driver checks for sustained absence across multiple channels at once, and is confirmed (via the handcrafted "Silent Freight Ltd" seed customer) to override a falsely-reassuring "quiet = good" reading rather than just sit alongside it.

**A small but real fix worth naming:** Claude's prose defaults to em dashes fairly often, and this repo holds a strict no-em-dash style rule throughout, including AI-generated text. `src/lib/text.ts` sanitises every stored narrative/summary; found and fixed after the fact for the handful of records generated before the fix existed.

**All 15 drivers now have real data behind them (2026-08-16).** Desired Outcome progress, stakeholder/champion engagement, training consumption, and payment/billing health were the last four - each still returns `null` honestly for a specific account with no data of that kind (a customer with no Desired Outcome tracked, no identified champion, no training booked), but the underlying models (`DesiredOutcome`, `Stakeholder`, `TrainingCompletion`, plus `paymentStatus`/`daysPastDue` on `CustomerProduct`) are real and seeded. Confirmed working end-to-end: the whole-book summary independently picked up "champion disengagement... directly correlated with interrupted renewals" across the seeded cohort and cited a specific account's exact 45-day-late payment, without either signal being prompted for by name.

A real bug did surface during an earlier skeptical pass over the repo: the tool schema marks `narrative` "required", but that only forces the field to exist, not to be non-empty, and one customer's narrative came back as an empty string while `adjustmentReason` still held real, grounded reasoning. Fixed with a fallback (`agenticLayer.ts` now falls back to `adjustmentReason`, and throws rather than silently storing nothing if both are empty) and re-run for that customer.

## Playbook agentic layers

The design proposals in [`docs/playbook-proposals.md`](docs/playbook-proposals.md) are now built - the same
two-layer shape Health already proved (a deterministic layer computes real numbers, a bounded agentic layer reasons
on top with required, evidence-grounded justification, and the result is a draft a human reviews) extended to the
other four lifecycle areas.

- **Shared storage, `AgentAction`.** All four write to one shared model rather than each area inventing its own
  draft-storage shape - `status` (proposed/accepted/dismissed), `reasoning`, `suggestedNextStep`, and an area-specific
  `metadata` field for whatever's unique to that area (Onboarding's `stalledReason`, Renewal's `riskFactors`).
  Displayed in each area's own page, not just a shared list. A real bug caught only by actually running this end to
  end, not by the unit tests alone: a customer with two live Products (or two open Opportunities) needs two
  independent actions of the same area, not one silently overwriting the other - the same customer-vs-product mistake
  already found once in Briefing. Fixed with a `subjectId` field distinguishing them; both the bug and the fix are
  covered by `prisma/test-agent-actions.ts`.
- **Onboarding** - a recovery plan for accounts genuinely overdue on go-live: likely stalled reason, evidence-grounded
  reasoning, one concrete next step. Declines rather than inventing a reason when there's nothing beyond "it's
  late" - confirmed for real against the two accounts overdue in the seed data, both correctly declined.
- **Adoption** - a usage nudge for accounts below a workspace-configurable underused-capability threshold (Settings,
  default 50%), checking whether the account has actually asked about an unused capability versus never mentioned it
  at all.
- **Expansion** - runs on top of the existing deterministic rules (`prisma/generate-opportunities.ts`), not instead
  of them - that stays the free, always-on baseline. The agentic layer can flag that an opportunity shouldn't be
  pursued as framed right now (e.g. a Health-Critical account), given context a fixed rule can't weigh.
- **Renewal, the bigger rebuild.** Churn likelihood no longer comes from one flat, permanently illustrative table.
  `src/lib/renewal/churnModel.ts` now computes the real observed churn rate per Health band from Calibration's own
  `OutcomeEvent` history, falling back to the illustrative table per band only where there isn't yet enough recorded
  history (fewer than 3 outcomes) to trust a real rate - same honesty limitation already stated on `/calibration`:
  this compares against the Health score on file now, not a true point-in-time value at the moment of the outcome.
  On top of that per-band baseline, a bounded agentic layer (+-20 percentage points, same shape as Health's
  adjustment) reasons about that specific account's own signals and produces a save-play recommendation - only for
  interrupted renewals or Watch/Critical accounts within 90 days, matching the same at-risk condition Briefing
  already uses.
- **Free trial, real gate.** Every capability's AI layer - Health included - now runs behind a 14-day free trial
  (`src/lib/trialGate.ts`), computed from a workspace's own `createdAt`, no stored trial-end date to backfill.
  "Upgrade" past the trial is illustrative only, same concept-only treatment as billing elsewhere in Settings - no
  real payment processor exists. The demo workspace is permanently exempt, since it exists to showcase the product to
  visitors, not to simulate a real customer's trial economics.

`npx tsc --noEmit`, `npm run lint`, and `npm run build` all clean. Verified for real against the live demo
workspace's own configured key, not just unit-tested: real Anthropic calls producing real, evidence-grounded output
across Onboarding (including two accounts correctly declined - no evidence beyond "it's late"), all of Adoption and
Expansion, and 2 of 4 Renewal candidates before that key ran out of credit mid-run - see `TESTING.md` for the honest
account of what that partial run did and didn't cover, and the real dedup bug it caught.

## Stage 2: live deployment

**Live at [bearing360.vercel.app](https://bearing360.vercel.app) (2026-08-22, renamed to this domain 2026-08-25).** Hosted on Vercel, database on Neon (both free-tier, spend-capped) – no server for anyone to manage. All 6 gates that were tracked before going live:

1. ~~The Health-scoring engine actually being implemented~~ – **done** (see above).
2. ~~Deployment-scale rate limiting~~ – **done**. `src/lib/rateLimit.ts` (guards login/signup - 10 attempts/15min, 5 signups/hour, by email - and the write-heavy Settings/Segments Server Actions) is backed by this app's own Postgres (`RateLimitBucket`, a single atomic `INSERT ... ON CONFLICT` per check) rather than a separate paid Redis service - counts are genuinely shared across every serverless function instance, using infrastructure that's already free and already configured everywhere, no new account needed.
3. ~~A hard spending cap set on the Anthropic API account~~ – **done**, confirmed before deploying.
4. ~~The other 8 screens reaching real data, not static stubs~~ – **done** (see the table above) - though most are still rule-based or read-only rather than the same agentic depth as Health, which is its own remaining gap, separate from this gate.
5. ~~Real auth~~ – **done**, see [Authentication](#authentication) below.
6. ~~Actually deploying~~ – **done**. One real deployment issue caught: `npm run build` (never run before this point - only `npm run dev` had been) failed on a `useSearchParams()`/`Suspense` requirement that dev mode never surfaces. Fixed and verified in `TESTING.md`. Also note for anyone repeating this: Vercel gives every deployment a protected, per-deployment preview URL (gated behind Vercel's own login) in addition to the real public production domain - use the latter for anything meant to be publicly reachable. A second gotcha: Vercel caches `node_modules` between builds, so a new Prisma model can fail to build against a stale generated client even when local and CI builds pass. The build script is `prisma generate && next build` for exactly this reason.

## Authentication

Real email/password auth, hand-rolled rather than a library (Auth.js's Prisma adapter expects its own schema shape, which would fight this app's already-custom `User` model). Full reasoning and code in `src/lib/auth.ts`; the short version:

- **Passwords:** bcrypt, cost factor 12.
- **Sessions, not stateless JWTs:** a `Session` row in Postgres per login, referenced by a long random token in an httpOnly/sameSite=lax/secure-in-production cookie. A session can be genuinely revoked (logout deletes the row, not just the cookie) - confirmed by checking the database directly after logout, not just the redirect.
- **Fixed 7-day expiry, no silent renewal.**
- **Checked twice, not once:** `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`, now Node.js runtime by default) validates the session against the database - expired or forged tokens are rejected before a protected page even starts rendering. `getCurrentWorkspace()` validates it again independently at the page level, as defense-in-depth for any request path that might reach a page without going through the proxy.
- **Real multi-tenancy, not a shared demo account:** signing up creates a brand-new, empty `Workspace` and its first admin `User` - not a new user added to the existing seeded workspace. This is the only choice that actually exercises the workspace-isolation work done earlier (see below) - confirmed live: a fresh signup sees zero customers, zero ARR, and no trace of any other workspace's data. Both writes happen in one transaction, so a failed signup can't leave an orphaned empty workspace behind.
- **Login errors are deliberately generic** ("Invalid email or password" for both a wrong password and a nonexistent email) - and the comparison always runs the same bcrypt work either way, against a dummy hash when no account matches, so a timing difference can't be used to enumerate valid accounts even though the message alone couldn't. Verified with real timing measurements, not just by inspection - see `TESTING.md`.
- **The demo dataset is its own workspace, flagged, not name-matched:** `isDemoSeed` on `Workspace` is what `prisma/seed.ts`'s reset step targets, so a real signup can never collide with or be wiped by a reseed just by happening to share a name.

**Demo login** (seeded, not a secret - only ever holds synthetic data on a free-tier local database): `priya.chandra@meridian-ops.example` / `demo-password-123`. Or sign up for a fresh, empty workspace of your own at `/signup`.

**Verified live** (see `TESTING.md` for the full log): login success and failure, logout genuinely deleting the session row (checked the database directly, not just the client-side redirect), a real signup producing a workspace with zero visibility into the seeded demo data, and every dashboard page rendering a graceful empty state (not a crash) for that fresh workspace. A follow-up adversarial review then found and fixed a timing side-channel, a signup race condition, and the workspace-name collision risk above - full writeup in `TESTING.md`.

**Known limitations:** no password-reset flow (would need real email sending, out of scope by design); expired sessions are cleaned up lazily on next use rather than by a scheduled sweep; `/login` and `/signup` stay reachable even when already logged in rather than redirecting to Home. None of these are security gaps, just scope left for later.

**Test coverage:** `prisma/test-auth.ts` covers password verification, the demo-seed flag, and session-expiry logic - see [Test coverage](#test-coverage) below for the full set of assert-based scripts across the app.

## Bring your own Anthropic API key

A workspace can store its own Anthropic API key in Settings, encrypted at rest (AES-256-GCM, `src/lib/workspaceSecret.ts`, key from a separate `SECRET_ENCRYPTION_KEY` env var) - never displayed again in full once saved, only as a masked "ending in ****1234."

**Why this exists:** this repo is meant to be downloaded and run as someone else's own instance, not just viewed as a live demo - the point of that is their own usage should be billed to their own Anthropic account, never to the demo deployment's key.

**Fully real, not just at rest:** the storage and encryption are tested (`prisma/test-workspace-secret.ts` - round-trips correctly, and tampering with the stored ciphertext is detected and rejected via GCM's auth tag, not just decrypted into garbage) - and, since [Automation](#automation) below, it's actually read and used: Health scoring genuinely runs against whichever key a workspace has configured, with no fallback to a shared platform key. `runCapability()` throws if a workspace has none configured - a workspace that has not set up its own key cannot run this feature, by construction, not by convention.

## Automation

Every capability that costs real money (Health, Onboarding, Adoption, Expansion, Renewal) is configurable per
workspace in Settings - **On-demand only** (the default), **Daily**, or **Weekly** - plus a **Run now** button that
always works regardless of the schedule. On-demand means exactly what it says: nothing runs, and nothing is spent
against a workspace's key, until that workspace explicitly opts in. Every capability also now sits behind a real
free-trial/subscription gate (see [Playbook agentic layers](#playbook-agentic-layers)) - a workspace's own key is a
separate, additional requirement, not a substitute for an active trial.

**Why on-demand is the default, not just the safe choice:** the original batch-script pattern (`npx tsx prisma/compute-health-scores.ts`, still available for local/manual use) can only ever be run by whoever has terminal access to the deployment - which defeats the point of bring-your-own-key for anyone who isn't the maintainer. A real self-hosted instance needs an in-app way to make this run at all. Defaulting new workspaces to on-demand keeps the zero-spend-until-asked property that instinct suggested was needed, while still making the feature actually usable by someone who only has the deployed app, not a terminal.

**How the schedule actually runs:** a single Vercel Cron job (`vercel.json`, `/api/cron/run-capabilities`) fires once a day - the only frequency [Vercel's free Hobby plan allows](https://vercel.com/docs/cron-jobs/usage-and-pricing) (more frequent expressions fail at deploy time). It checks every workspace's own schedule against `src/lib/capabilityRuns.ts`'s `isDue()` (comparing `lastRunAt` to the interval), so "Weekly" still means roughly every 7 days even though the underlying check happens daily. The route is locked down with a `CRON_SECRET` env var - [Vercel's own documented pattern](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) - so a stranger can't hit the URL directly and trigger spend against other workspaces' stored keys. `src/proxy.ts`'s matcher excludes `/api/*` for this reason: an API route needs its own auth strategy, not the session-cookie check every page gets.

**Verified for real, including a genuine end-to-end run:** clicking Run now in Settings actually recomputed all 19 seeded customers' Health scores against the demo workspace's own configured key, took ~3.2 minutes (comfortably inside Vercel's 300-second Hobby function limit at this scale, though worth watching if the customer count grows much larger), and correctly showed "Health scores recomputed successfully" with an updated last-run timestamp afterward. See `TESTING.md` for the full log, including a real bug it caught (the proxy was redirecting the cron route to `/login` before this fix, since Vercel's cron invocation carries no session cookie to check).

## Test coverage

Twelve assert-based regression scripts (each throws and exits non-zero on failure, rather than printing output for a human to eyeball), all under `prisma/` and run via `npx tsx prisma/<name>.ts`:

| Script | Covers |
|---|---|
| `test-auth.ts` | Password verification, the demo-seed flag, session-expiry logic |
| `test-workspace-secret.ts` | Encryption round-trip, and that a tampered ciphertext is rejected, not silently decrypted |
| `test-settings-validation.ts` | Hex-colour/currency/date-format/language/Anthropic-key-shape rules, and risk-weight clamping |
| `test-calibration.ts` | Every (outcome type &times; Health tier) classification the Calibration screen can produce |
| `test-segments.ts` | Segment-criteria matching against the real seeded data - single and combined criteria, no false matches |
| `test-workspace-scoping.ts` | Cross-tenant isolation - creates a real throwaway second workspace and confirms its data never leaks into another workspace's queries, the actual IDOR guard, not just reasoned about |
| `test-rate-limit.ts` | The rate limiter - blocks over the limit, independent keys don't interfere, a window correctly expires, and a concurrency test proving the atomic upsert prevents a race from over-counting |
| `test-capability-runs.ts` | `isDue()`'s schedule math (on_demand/daily/weekly against every relevant time boundary) and that `runCapability()` refuses to run for a workspace with no key configured |
| `test-onboarding-pace.ts` | The days-overdue calculation shared by Onboarding and Briefing - no date, a past date, a future date, and the exact-today boundary |
| `test-trial-gate.ts` | The free-trial gate every capability's AI layer sits behind - within-trial, expired, subscribed, and the demo workspace's permanent exemption |
| `test-churn-model.ts` | Renewal's real churn-rate calculation from Calibration's outcome history, and its per-band fallback to the illustrative table below the minimum sample size |
| `test-agent-actions.ts` | The shared AgentAction upsert helper - refreshes an existing proposed row in place, leaves a reviewed one alone, and keeps two different subjects (e.g. two Products) independent rather than one overwriting the other |

Everything else (workspace scoping as exercised through the actual pages, and the marketing page) is still verified interactively only, logged in `TESTING.md` - a stated, known gap, not silently left implicit.

**CI:** `.github/workflows/ci.yml` runs `tsc`, `lint`, `build`, and the full assert-based suite above on every push - the same pattern already used on [ai-inbound-triage-agent](https://github.com/ddkeyworth/ai-inbound-triage-agent) and [exampleco-ai-test](https://github.com/ddkeyworth/exampleco-ai-test). Needs `DATABASE_URL` and `SECRET_ENCRYPTION_KEY` added as repo secrets to actually run - not `ANTHROPIC_API_KEY`, since nothing in the suite calls the real API.

## Tech stack

Next.js (App Router) + TypeScript, Tailwind CSS, Inter (Google Fonts, open-licensed), Prisma (pinned to v6 for its simpler schema-only datasource config) on Postgres (Neon free tier), Anthropic API for Layer 2 reasoning, bcrypt + hand-rolled database-backed sessions for auth (see [Authentication](#authentication)) – email/password only, no third-party OAuth, so no real identity provider is ever contacted. Deployment-scale rate limiting runs on the same Postgres database rather than a separate paid service (see [Stage 2](#stage-2-live-deployment)). A daily Vercel Cron job drives scheduled capability runs (see [Automation](#automation)). Both the database and the Anthropic key are free-tier/spend-capped with no payment method attached, and are local-only credentials, not deployed anywhere public.

## Running it locally

```
npm install
```

Create a `.env` file (copy `.env.example`) with your own `DATABASE_URL` (a free Neon/Supabase Postgres instance), `ANTHROPIC_API_KEY` (spend-capped), and `SECRET_ENCRYPTION_KEY` (generate your own - see `.env.example`, it encrypts any workspace's own stored Anthropic key, unrelated to your own key above). Then:

```
npx prisma db push
npx tsx prisma/seed.ts
npx tsx prisma/seed-renewal-dates.ts
npx tsx prisma/compute-health-scores.ts
npx tsx prisma/compute-book-summary.ts
npx tsx prisma/generate-opportunities.ts
npm run dev
```

Opens at `http://localhost:3000`, which redirects to `/login` - every dashboard route requires a real session now. Log in with the seeded demo account (`priya.chandra@meridian-ops.example` / `demo-password-123`, see [Authentication](#authentication)) to see the full synthetic dataset, or sign up at `/signup` for a fresh, empty workspace of your own. Once logged in, every screen reads real, seeded/computed data - start at `/health` for the deepest one (full driver breakdown per customer at `/health/[customerId]`, real LLM-generated executive summary), or `/briefing` for the consolidated cross-area view.

## License

MIT – see [LICENSE](LICENSE).
