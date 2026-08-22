# ai-customer-health-platform

A conceptual exploration of an agentic-AI Customer Success platform – planned and built with Claude Code as a portfolio piece. **This is a prototype, not a production system, and not a real product.** Nothing here is a real company. It is live at [ai-customer-health-platform.vercel.app](https://ai-customer-health-platform.vercel.app) (see [Stage 2](#stage-2-live-deployment)) – demo login below, or sign up for your own isolated workspace – with no real customer data anywhere, and no outbound contact beyond the Anthropic API itself.

> No AI reads every account right. It gets you close enough, fast enough, to act. Across onboarding, health, expansion, and renewal.

![Home screen, real screenshot](docs/screenshots/home-screenshot.png)
![Health screen, real screenshot](docs/screenshots/health-screenshot.png)
![Health scoring architecture](docs/screenshots/health-scoring-architecture.svg)
![Customer detail (Health drill-in), real screenshot](docs/screenshots/customer-detail-screenshot.png)
![Settings, real screenshot](docs/screenshots/competitor-config-screenshot.png)
![Marketing page, real screenshot](docs/screenshots/marketing-screenshot.png)

All five screenshots above are real captures of the actual running app (`/`, `/health`, `/health/[customerId]`, `/settings`, `/marketing`), seeded with the synthetic data described below – not mockups. `health-scoring-architecture.svg` is the one remaining diagram, not a screenshot.

The repo is named descriptively for portfolio discoverability; **"Bearing"** is the working product name used within the app and mockups themselves.

## What this is

Most Customer Success tooling is a system of record – a place to manage accounts, log interactions, and store contracts. This project is deliberately **not** that. It's an insight layer that sits on top of the systems that already do that job, organised around five areas of the customer lifecycle:

- **Health** – a composite score built from 15 drivers (support friction, consumption trend, capability breadth/stickiness, competitor risk, engagement silence, and more), run continuously from Onboarding through Live. The flagship area, and the one genuinely load-bearing piece of the whole idea.
- **Onboarding** – pace to first Capability go-live, with a cause-tagged log of any slippage.
- **Adoption** – usage and consumption trends per Capability, and progress against the Desired Outcomes a customer actually bought the product to achieve.
- **Expansion** – Price Increase, Cross-sell, Upsell, and Consumption Growth opportunities, each with a Raised-By and an Owner.
- **Renewal** – Auto vs. Interrupted renewals, ARR and consumption revenue at risk, and a projected-churn estimate shown honestly as an estimate, not a fact.

Every screen is meant to carry its own synthesized narrative, not just a data table – because a re-skinned CRM view isn't the point. If the reasoning underneath isn't genuinely sound, this whole idea doesn't hold up. See [Health scoring – built, and how it actually works](#health-scoring--built-and-how-it-actually-works).

## Governing principle: safe by construction, not by promise

Every design decision in this repo follows one rule: **anything that would touch the outside world, real data, or a real compliance claim is shown as a concept only – never operationalized.**

- No real customer or personal data, anywhere, ever. All data is synthetic.
- No outbound network call except to the Anthropic API for the agent's own reasoning – see [Health scoring](#health-scoring--built-and-how-it-actually-works) below for what that actually does. Any other integration (a real CRM sync, a real email send, a real OAuth login, monitoring job boards or competitor websites) is represented as a UI concept, not a working connection, unless explicitly extended later with deliberate sign-off.
- No compliance claims that aren't true. No fabricated traction, testimonials, or results anywhere in this repo or its documentation.
- Every agent action is designed to be a draft a human reviews – nothing is ever sent or executed automatically.

## What's real vs. planned

All 10 dashboard screens (Home, Health, Briefing, Onboarding, Adoption, Expansion, Renewal, Segments, Calibration, Settings) are wired to real data - nothing left as a static stub. They're not all equally deep, though - see the per-screen notes below for what's genuinely agentic vs. rule-based vs. read-only. A real public marketing page (`/marketing`) also exists, outside the dashboard shell.

**This has actually been run, not just written.** See [`TESTING.md`](TESTING.md) for the log: real Anthropic API calls against handcrafted seed customers with known-good expected behaviour, a real cross-tenant security gap found and fixed, a real bug the multi-product data exposed, and an honest account of a browser-automation false negative during testing that turned out not to be a real bug.

| Area | Status |
|---|---|
| Product definition, requirements, information architecture | Fully planned |
| Data model (Workspace, User, Customer, Product, Capability, Package, Health snapshot, Competitor config, Interaction, Usage, Survey, Event attendance, Opportunity, Segment, Desired Outcome, Stakeholder, Training completion, Outcome event, Session) | Built in `prisma/schema.prisma`, live on a real (free-tier) Postgres instance |
| App shell (navigation, layout, logo) | Built |
| Synthetic data generator (`prisma/seed.ts`) | **Built and run for real** - 19 fictional customers across 2 products, tickets, usage history, surveys, event attendance, renewal dates |
| Health-scoring engine (the actual "special sauce") | **Built and tested for real** - see below. Computed and stored for all 19 seeded customers via `prisma/compute-health-scores.ts` |
| `/health` | List view, per-customer drill-in (`/health/[customerId]`), and a real LLM-generated executive summary - all reading stored data, none recomputed on page load |
| `/` (Home) | Real Total ARR, Health bands, lifecycle-stage counts, and a "needs attention" list. Deliberately does not show NNAOV/NRR/GRR - those need realized bridge events this build doesn't track yet |
| `/onboarding` | Real three-date pace tracking and overdue sorting. No date-change event log or cause-tagging yet |
| `/adoption` | Real capability breadth and per-Capability adoption stats across live accounts |
| `/expansion` | Real Opportunity model (4 types), seeded by **deterministic rules**, not yet the same agentic reasoning as Health's Layer 2 |
| `/renewal` | Real renewal dates, Auto/Interrupted status, ARR at risk. Projected churn is a real calculation but explicitly labeled illustrative (reads off the Health band, not a calibrated model) |
| `/segments` | Real saved filters - create/view/delete all genuinely work, capped at 20 per workspace. Picking one from the top-bar selector re-scopes every area (Home, Health, Onboarding, Adoption, Expansion, Renewal, Briefing) to it, carried via the URL - the Micro view from the original design. Health's executive summary stays whole-book-only rather than generating a live per-segment Anthropic call on every page load |
| `/settings` | Org profile/branding/localisation and competitor risk config are real, writable forms (Server Actions). A data-export allowlist config is also real (which of Bearing's own generated fields would sync to a CRM), same concept-only treatment as Integrations/SSO - no actual export mechanism exists. A workspace can also store its own Anthropic API key, encrypted at rest (see [Bring your own Anthropic API key](#bring-your-own-anthropic-api-key)) - real storage, not yet read by any live feature. Team & roles, billing, other integrations, developer/API stay honest "not built yet" |
| `/briefing` | Real cross-area action queue, consolidated by account and ranked by £ impact, pulled live from Health/Onboarding/Expansion/Renewal. Read-only - no approve/dismiss/snooze state yet |
| `/marketing` | Real public-facing landing page - positioning line, 5 lifecycle-area cards, illustrative two-axis pricing, and an honest "what's actually real" section. Rendered without the internal dashboard chrome via `AppShell`. Terms/Privacy/Security stay one-line honest placeholders, not real legal documents, per the governing safety principle |
| `/calibration` | Real calibration loop - every recorded `OutcomeEvent` (churned/renewed/expanded) compared against the Health score on file, classified as confirmed/missed/worth-reviewing. Not a true point-in-time backtest (one snapshot per customer, not a real historical series); nothing here adjusts driver weighting automatically - see the page's own footnote |
| `/login`, `/signup` | Real email/password authentication (bcrypt + database-backed sessions) - see [Authentication](#authentication). Signup creates a genuine new, empty, isolated workspace, not a new user in the shared demo one |
| Agent core / playbooks for areas beyond Health | Expansion uses rule-based generation; the others are plain data views. A full agentic pass (matching Health's two-layer depth) is the natural next step, not done |
| Live public deployment | **Done.** [ai-customer-health-platform.vercel.app](https://ai-customer-health-platform.vercel.app) - see [Stage 2: live deployment](#stage-2-live-deployment) |

## Health scoring – built, and how it actually works

The easy part of this project is the CRM-adjacent facts – ARR, package, who's assigned. Those aren't the point; a real CRM already shows them. The actual value has to come from genuine insight: a composite score that reasons about context rather than averaging numbers, and a narrative that explains *why*, built from evidence, not a template.

The architecture (see `docs/screenshots/health-scoring-architecture.svg`) is implemented in `src/lib/health/`:

- **Two layers, not one formula.** Layer 1 (`baseline.ts`) is deterministic and reproducible: each of the 15 drivers normalized against the account's own history and a peer cohort, not a fixed global threshold – no AI involved. Layer 2 (`agenticLayer.ts`) is a real Anthropic API call (`claude-sonnet-4-5`, structured tool output) that applies a **bounded** adjustment on top of the baseline (capped at +-15 points), with a required, evidence-grounded reason – never a freeform, unexplained number.
- **Evidence-chain narrative.** Every claim the narrative makes has to trace back to a specific input value it was given, not an invented correlation. Tested for real: the model has correctly cited exact usage-decline percentages, specific ticket dates and content, and even surfaced a genuine expansion signal ("asked about adding two more seats") that isn't one of the 15 formal drivers at all – reasoning beyond the baseline, not just restating it.
- **A real whole-book executive summary**, not a code-aggregated stat sentence. `src/lib/health/bookSummary.ts` makes one Anthropic call across all customers' scores and narratives, finding real cross-account patterns – tested for real, it independently spotted the same billing-sync defect recurring across four unrelated accounts, and noted that high-NPS accounts were nonetheless showing steep usage decline (sentiment lagging disengagement). Scoped by a list of customer IDs rather than hardcoded to "everyone," so the same function can serve a Segment-scoped summary later without changes. Computed by a batch script (`prisma/compute-book-summary.ts`), same "never live on page load" rule as everything else.
- **Stage-aware scoring.** A pre-Live account gets a narrow, honest read focused on onboarding pace, not the full 15-driver picture applied to an account that hasn't started yet.
- **Confidence labeling**, driven by how much data actually backs a score, not the agent's own self-assessment.
- **A calibration loop, built for real.** `/calibration` compares every recorded `OutcomeEvent` (churned/renewed/expanded) against the Health score on file for that customer, and classifies each as confirmed, missed, or worth reviewing – e.g. a Watch/Critical account that renewed anyway isn't auto-flagged as a scoring error, since it may reflect a successful save-play instead. Honest limitation: this build stores one current snapshot per customer, not a real historical series, so it's not a true point-in-time backtest of "what the score said before the outcome happened" – see the page's own footnote. Nothing here adjusts driver weighting automatically; it's a review surface for a human to spot patterns, same "agent proposes, human decides" pattern as everything else.

Two drivers worth calling out specifically, since they came from a skeptical pass on the model rather than an obvious first draft:

- **Competitor risk is multi-source, split on safety grounds.** Most churn is competitive displacement, not need disappearing, so a workspace admin can configure up to 20 competitors, each with a risk weight (not all competitors are equal threats – see `docs/screenshots/competitor-config-screenshot.png`; the seed data configures 3). Detection for **direct mentions** and **mentions of a competitor's known capabilities** is built for real, via the same Anthropic reasoning call used for Layer 2 – it only ever scans interaction text already in the system, so there's no new outbound contact and no dependency on a third-party product. Confirmed working against seeded ticket text (e.g. a mention of a competitor's predictive-ETA feature was correctly flagged with the supporting quote). Two further signal sources – **job postings** referencing a competitor's stack, and **references on a competitor's own website** – are deliberately **not implemented**. Both would require monitoring genuinely new external sources, which stays concept-only regardless of whether the competitor list is populated, pending explicit sign-off.
- **Engagement silence.** A noisy, complaining customer is easy to spot; a silent one – no support contact, no event attendance, flat usage, no communication – is often the bigger risk, and a naive per-driver model can actually score a quiet account as *healthier* than it should be, since fewer tickets alone looks like an improvement. This driver checks for sustained absence across multiple channels at once, and is confirmed (via the handcrafted "Silent Freight Ltd" seed customer) to override a falsely-reassuring "quiet = good" reading rather than just sit alongside it.

**A small but real fix worth naming:** Claude's prose defaults to em dashes fairly often, and this repo holds a strict no-em-dash style rule throughout, including AI-generated text. `src/lib/text.ts` sanitizes every stored narrative/summary; found and fixed after the fact for the handful of records generated before the fix existed.

**All 15 drivers now have real data behind them (2026-08-16).** Desired Outcome progress, stakeholder/champion engagement, training consumption, and payment/billing health were the last four - each still returns `null` honestly for a specific account with no data of that kind (a customer with no Desired Outcome tracked, no identified champion, no training booked), but the underlying models (`DesiredOutcome`, `Stakeholder`, `TrainingCompletion`, plus `paymentStatus`/`daysPastDue` on `CustomerProduct`) are real and seeded. Confirmed working end-to-end: the whole-book summary independently picked up "champion disengagement... directly correlated with interrupted renewals" across the seeded cohort and cited a specific account's exact 45-day-late payment, without either signal being prompted for by name.

A real bug did surface during an earlier skeptical pass over the repo: the tool schema marks `narrative` "required", but that only forces the field to exist, not to be non-empty, and one customer's narrative came back as an empty string while `adjustmentReason` still held real, grounded reasoning. Fixed with a fallback (`agenticLayer.ts` now falls back to `adjustmentReason`, and throws rather than silently storing nothing if both are empty) and re-run for that customer.

## Stage 2: live deployment

**Live at [ai-customer-health-platform.vercel.app](https://ai-customer-health-platform.vercel.app) (2026-08-22).** Hosted on Vercel, database on Neon (both free-tier, spend-capped) – no server for anyone to manage. All 6 gates that were tracked before going live:

1. ~~The Health-scoring engine actually being implemented~~ – **done** (see above).
2. ~~Deployment-scale rate limiting~~ – **done**. `src/lib/rateLimit.ts` (guards login/signup - 10 attempts/15min, 5 signups/hour, by email - and the write-heavy Settings/Segments Server Actions) now uses a real shared store, Upstash Redis via Vercel's Storage marketplace integration, once `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are configured - counts are shared across every serverless function instance, not reset per cold start. Falls back to the original per-process in-memory `Map` when those aren't set (e.g. local `npm run dev`), so running the app locally never needs its own Redis instance.
3. ~~A hard spending cap set on the Anthropic API account~~ – **done**, confirmed before deploying.
4. ~~The other 8 screens reaching real data, not static stubs~~ – **done** (see the table above) - though most are still rule-based or read-only rather than the same agentic depth as Health, which is its own remaining gap, separate from this gate.
5. ~~Real auth~~ – **done**, see [Authentication](#authentication) below.
6. ~~Actually deploying~~ – **done**. One real deployment issue caught along the way: `npm run build` (never run before this point - only `npm run dev` had been) failed on a `useSearchParams()`/`Suspense` requirement that dev mode never surfaces. Fixed and verified in `TESTING.md`. Also note for anyone repeating this: Vercel gives every deployment a protected, per-deployment preview URL (gated behind Vercel's own login) in addition to the real public production domain - use the latter for anything meant to be publicly reachable.

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

**Why this exists:** this repo is meant to be downloaded and run as someone else's own instance, not just viewed as a live demo - the point of that is their own usage should be billed to their own Anthropic account, never to the demo deployment's key. Separately, the live demo itself already can't spend the deployment owner's key no matter who uses it - verified by tracing every caller of the Anthropic SDK (see the paragraph below) back to manually-run local scripts, never a live request.

**Honest about what's real today:** the storage and encryption are fully real and tested (`prisma/test-workspace-secret.ts` - round-trips correctly, and tampering with the stored ciphertext is detected and rejected via GCM's auth tag, not just decrypted into garbage). What's *not* real yet: no live feature actually reads this key. Health scores and narratives are still only ever generated by batch scripts run manually against the platform's single shared key - nothing a workspace does today triggers a live Anthropic call. **This is a stated design requirement for whenever the per-area agentic playbooks get built:** they must read the active workspace's own decrypted key rather than a single shared platform key, so a self-hosted instance genuinely uses its owner's own credentials end to end, not just at rest.

## Test coverage

Seven assert-based regression scripts (each throws and exits non-zero on failure, rather than printing output for a human to eyeball), all under `prisma/` and run via `npx tsx prisma/<name>.ts`:

| Script | Covers |
|---|---|
| `test-auth.ts` | Password verification, the demo-seed flag, session-expiry logic |
| `test-workspace-secret.ts` | Encryption round-trip, and that a tampered ciphertext is rejected, not silently decrypted |
| `test-settings-validation.ts` | Hex-colour/currency/date-format/language/Anthropic-key-shape rules, and risk-weight clamping |
| `test-calibration.ts` | Every (outcome type &times; Health tier) classification the Calibration screen can produce |
| `test-segments.ts` | Segment-criteria matching against the real seeded data - single and combined criteria, no false matches |
| `test-workspace-scoping.ts` | Cross-tenant isolation - creates a real throwaway second workspace and confirms its data never leaks into another workspace's queries, the actual IDOR guard, not just reasoned about |
| `test-rate-limit.ts` | The in-memory rate-limiter fallback - blocks over the limit, independent keys don't interfere, and a window correctly expires rather than blocking forever |

Everything else (workspace scoping as exercised through the actual pages, the marketing page, Onboarding/Adoption/Expansion/Renewal) is still verified interactively only, logged in `TESTING.md` - a stated, known gap, not silently left implicit.

## Tech stack

Next.js (App Router) + TypeScript, Tailwind CSS, Inter (Google Fonts, open-licensed), Prisma (pinned to v6 for its simpler schema-only datasource config) on Postgres (Neon free tier), Anthropic API for Layer 2 reasoning, bcrypt + hand-rolled database-backed sessions for auth (see [Authentication](#authentication)) – email/password only, no third-party OAuth, so no real identity provider is ever contacted. Upstash Redis (free tier, via Vercel's Storage marketplace) for deployment-scale rate limiting, with an in-memory fallback when it isn't configured. Both the database and the Anthropic key are free-tier/spend-capped with no payment method attached, and are local-only credentials, not deployed anywhere public.

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
