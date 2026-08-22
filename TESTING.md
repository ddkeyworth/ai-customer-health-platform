# Testing log

This repo's logic was actually executed, not just written and left unverified - same pattern as `ai-job-pipeline-toolkit`'s `TESTING.md`. All data referenced below is synthetic, seeded by `prisma/seed.ts`; no real company or person appears anywhere in this repo.

**Note on scope:** the Health-scoring engine and the first pass at all 9 screens were built and verified in earlier sessions, documented in less granular form here than the detailed, test-by-test log this file keeps going forward. Where a specific number or quote is given below from that earlier work, it's carried over from the contemporaneous project notes, not reconstructed after the fact.

## Test 1 - Health scoring engine, Layer 1 + Layer 2

Ran the full pipeline (`prisma/seed.ts` → `prisma/compute-health-scores.ts`) against the four handcrafted seed customers, each built to exercise a specific driver behaviour, then inspected the stored `HealthScoreSnapshot` rows. `prisma/test-baseline.ts` and `prisma/test-full-pipeline.ts` are the small ad-hoc scripts from this pass, kept in the repo as real, runnable spot-checks against the three named handcrafted customers - `npx tsx prisma/test-full-pipeline.ts` reruns this exact verification.

- **Northwind Traders** (handcrafted at-risk): baseline 43 → Layer 2 adjusted -8 → composite 35. The narrative correctly cited the RouteWorks competitor mention with the actual supporting quote from the seeded interaction text.
- **Fenwick Logistics** (handcrafted thriving): baseline 91 → +5 → 96. Layer 2 caught a genuine expansion signal ("asked about adding two more seats") that isn't one of the 15 formal drivers at all - reasoning beyond the baseline, not just restating it.
- **Silent Freight Ltd** (handcrafted engagement-silence test): baseline 55 → -10 → 45, confirming the multi-channel silence override actually fires in code, not just in the design doc.

**Confidence:** confirmed - real Anthropic API calls (`claude-sonnet-4-5`), real stored output, not simulated.

## Test 2 - Whole-book executive summary and competitor detection

`prisma/compute-book-summary.ts` makes one Anthropic call across all customers' scores and narratives. Run against the full 19-customer set, it independently spotted the same billing-sync defect recurring across four unrelated accounts, and separately noted that several high-NPS accounts were nonetheless showing steep usage decline (sentiment lagging disengagement) - a real cross-account pattern, not something any single customer's own narrative stated.

Competitor detection (direct mentions + known-capability mentions, same Anthropic call as Layer 2) confirmed working against seeded ticket text: a mention of a competitor's predictive-ETA feature was correctly flagged with the supporting quote from the interaction record.

## Test 3 - All 9 screens wired to real data

Built and verified one at a time (Home, Onboarding, Adoption, Settings, Expansion, Renewal, Segments, Briefing, Health), each checked in-browser via DOM/console inspection before moving to the next - the screenshot tool was unreliable throughout these sessions, so verification relied on `get_page_text` and `read_console_messages` instead, which is if anything a stricter check since it can't be fooled by something that merely *looks* right.

Segments (create/view/delete) and Settings (workspace branding, competitor add/remove) were tested end-to-end as genuinely writable Server Actions, not just display.

## Test 4 - Workspace-scoping security fix (2026-08-16)

A self-requested skeptical review found most page queries had no `workspaceId` filter at all, and that `Product` had no `workspaceId` column whatsoever - meaning Capability/Package (which hang off Product) had no tenant linkage. Fixed by adding the column (required a full DB wipe/reseed - `--accept-data-loss` doesn't cover "no backfill path for an existing row") and routing every page through a shared `getCurrentWorkspace()` helper.

The same sweep also found two IDOR-style gaps beyond the original page-query issue: `/health/[customerId]` and `/segments/[id]` fetched by ID with no ownership check against the current workspace, and `deleteSegment`/`deleteCompetitor` could delete any row by ID regardless of workspace.

**Verified:** `npx tsc --noEmit` and `npm run lint` both clean after the fix. Re-ran the full seed→score pipeline (20 real Anthropic calls, confirmed with Dan before running given the metered cost) and drove the rebuilt app in-browser: Home correctly reported "27 customer-product relationships" across 19 customers (confirms the workspace-scoped queries return the right rows post-fix), Health list and drill-in pages rendered real data with no console errors, and the ownership check was exercised structurally (every remaining query path requires a `workspaceId` match to return anything).

## Test 5 - Multi-product seed data and a real bug it exposed

Added a second product ("Meridian Warehouse", 4 capabilities, 3 packages) and gave Fenwick Logistics plus ~30% of the randomised live cohort a second `CustomerProduct` row. This exposed a real latent bug: `src/lib/health/baseline.ts` and `agenticLayer.ts` both read `customer.products[0]` only - a single-product assumption that was previously harmless but would have silently undercounted capability breadth for any multi-product account.

Fixed by aggregating entitled/used capabilities across every product a customer holds. **Verified live:** Fenwick Logistics's drill-in page (`/health/[customerId]`) correctly lists both products ("Meridian Freight · Enterprise" and "Meridian Warehouse · Pro") and the capability-breadth driver reads "Using 7 of 9 entitled Capabilities" - 5 Freight capabilities + 4 Warehouse capabilities entitled (9), 7 actually used, matching the two products' seeded usage data exactly.

## Test 6 - Segments capped at 20, delete-to-replace

Added a server-side cap (`createSegment` silently no-ops past 20, same style as the existing competitor cap) plus a UI treatment: header reads "N of 20 saved segments," and the create form is replaced by an explanatory message once full.

**Verified live, full cycle:** created a segment named "Test Segment," confirmed the header updated to "1 of 20" and the row appeared with its customer-match count; clicked Remove, confirmed the header returned to "0 of 20" and the row disappeared. Confirms create and delete both round-trip through the real database, not just client state.

## Test 7 - Settings field validation

`updateWorkspace` and `addCompetitor` previously accepted anything - free-text currency/date-format/language, unbounded name length, a `riskWeight` bypassable past its declared 1-5 range since the HTML `min`/`max` were client-side only. Added server-side validation (hex-color regex, 3-letter currency regex, an allowlist for date format/language, length caps, integer clamping on risk weight) and updated the UI to match (date format/language are now `<select>` dropdowns, since the server only accepts one of a fixed set).

**Verified:** `npx tsc --noEmit` clean, and the Settings page rendered correctly post-change with the existing seeded values (workspace name, 3 configured competitors) intact.

## Test 8 - Rate limiting and the export allowlist config screen

Added a small in-memory rate limiter (`src/lib/rateLimit.ts`) to the three write-heavy Server Actions (`createSegment`, `updateWorkspace`, `addCompetitor`), and a new "Data export allowlist" config section in Settings - a concept-only screen (same "show the concept, don't connect" treatment as Integrations/SSO) recording which of Bearing's own generated fields an org would want pushed back to a CRM, with no actual export mechanism behind it.

**A real gap this surfaced, not a happy-path test:** the first attempt to verify the export-allowlist save used the browser automation tool's ref-based clicks after scrolling the page - checkboxes appeared checked in the DOM immediately after clicking, but a direct database check afterward showed an empty array saved. Rather than assume the Server Action was broken, isolated the two possibilities: re-ran the exact same save via `javascript_tool` driving the DOM directly (setting `checked = true` and calling `.click()` on the real submit button, bypassing the ref/coordinate layer entirely). That attempt persisted correctly - `["health_score","health_narrative"]` confirmed in the database and again after a full page reload. Points to the earlier failure being a browser-automation coordinate issue after scroll, not a bug in the Server Action; noted here rather than silently retried and left unexplained.

**Confidence:** confirmed for the Server Action and schema (`exportAllowlist String[]` on Workspace) - both verified against the real database, not just DOM state.

## Test 9 - The 4 null Health drivers built for real, and a real seed-script bug it surfaced

Added three new models (`DesiredOutcome`, `Stakeholder`, `TrainingCompletion`) and two fields on `CustomerProduct` (`paymentStatus`, `daysPastDue`), extended `prisma/seed.ts` to generate story-consistent data for all 19 customers, and replaced all four `null`-returning drivers in `baseline.ts` with real computation.

**A real, pre-existing bug found while reseeding, not introduced by this change:** `seed.ts`'s clear-data step never included `Opportunity` in its delete order - added in an earlier session (the Expansion screen build) but missed from the list. Harmless the first time seed.ts ran after that (no opportunities existed yet to violate the foreign key), but re-running seed.ts a second time - which this work required - failed immediately with a Postgres `RESTRICT` violation on `opportunities_customerId_fkey`. Fixed by adding `Opportunity`, `DesiredOutcome`, `Stakeholder`, `TrainingCompletion`, `Segment`, and `BookSummary` to the delete order, all of which had the same latent gap for the same reason (added after the original delete order was written).

Ran the full pipeline (seed → renewal dates → Health scores → opportunities → book summary) after the fix - all steps completed cleanly, 19/19 customers scored with real Anthropic calls, no errors.

**Verified live, both ends of the story:**

- **Northwind Traders** (handcrafted at-risk, given a stale champion, a 45-day-late payment, and 35% Desired Outcome attainment): drill-in page correctly showed `Desired Outcome progress: 35`, `Champion engagement: 0` ("Champion Morgan Ellis last engaged 210 days ago"), `Training consumption: n/a` ("No training completions recorded"), `Payment/billing health: 25` ("Payment late by 45 days"). Layer 2's narrative wove all four into the reasoning unprompted: *"the champion has been disengaged for 210 days, and payment is 45 days late... achieving only 35% of desired outcomes."*
- **Fenwick Logistics** (handcrafted thriving, recent champion contact, real training history, outcome exceeding target): `Desired Outcome progress: 100` (detail correctly shows the un-clamped "130% of target" even though the 0-100 driver score clamps at 100), `Champion engagement: 93` ("last engaged 5 days ago"), `Training consumption: 75` ("3 sessions, 8 total attendee-completions"), `Payment/billing health: 90` ("all payments current").
- **Whole-book summary**, run fresh against the full 19-customer set: independently surfaced *"Champion disengagement is pervasive: 10 of 19 accounts show champion silence ranging from 50 to 210 days, directly correlated with interrupted renewals and declining usage"* and cited Northwind's exact "45-day late payment" - real evidence the new signals are being read and reasoned about, not just stored.

`npx tsc --noEmit` and `npm run lint` both clean throughout.

## Test 10 - Micro-view re-scoping: a saved Segment now filters every area, not just Segments itself

Added a top-bar selector (`SegmentSelector`, client component) that carries the active segment as a `?segment=` URL param across navigation - `Sidebar` appends it to every nav link, and each area page (Home, Health, Onboarding, Adoption, Expansion, Renewal, Briefing) resolves it via a shared `resolveActiveSegment()` helper and adds `customerId: { in: [...] }` to its existing queries.

**Verified live, full cycle:** created a real segment ("UK Logistics" - industry Logistics, region South East), matching 2 customers (Northwind Traders, Fenwick Logistics). Selected it in the top bar; confirmed the URL updated to `?segment=<id>`. Navigated to Home via the sidebar link (not a manual URL edit) - segment carried through automatically, header read "Home &middot; UK Logistics," and the whole-book stats (21 customer-product relationships, 19 customers) correctly narrowed to the segment's own numbers (3 customer-product relationships, matching Fenwick's 2 products + Northwind's 1). Repeated on Health: correctly showed just the 2 matching customers' real scores and narratives, and displayed an honest note in place of the whole-book executive summary rather than showing a stale or misleading one (segment-scoped summaries aren't precomputed, and generating one live per segment view would break the "never live on page load" cost rule). Cleared the segment (navigated to `/health` with no param) and confirmed it correctly reverted to the full 19-customer whole-book view with the real executive summary. No console errors throughout.

## Test 11 - Public marketing page, rendered without the internal dashboard chrome

Added `/marketing` and a shell-switching `AppShell` client component so the public landing page renders without Sidebar/TopBar, without restructuring every existing route into a Next.js route group. Verified two things independently:

- **The marketing page itself:** navigated directly, read the full page text (from `<body>`, not `<main>`) - confirmed no Sidebar/TopBar nav text present anywhere, and the per-page `<title>` metadata override took effect (browser tab title read "Bearing - a portfolio concept for agentic Customer Success" instead of the app-wide default).
- **No regression on the internal app:** navigated back to `/` immediately after, confirmed Sidebar (all 9 nav links) and TopBar (workspace name, segment selector) still render correctly - `AppShell`'s pathname check didn't break the default case.

**A real layout question surfaced and resolved, not just assumed correct:** an early real-browser screenshot of `/marketing` (captured via the same Chrome-app-mode + `PrintWindow` technique as the other screenshots) showed the header's "View the product" CTA clipped at the right edge. Rather than assume the centering CSS was broken, checked directly with `getBoundingClientRect()` in a properly connected browser tab at a standard 1280px viewport: the header measured exactly 1024px wide (matching `max-w-5xl`), centered with symmetric ~120px margins - the layout code was correct. The clipping was specific to the screenshot-capture window, which this display caps at ~1554 physical px regardless of the requested launch size, at an effective DPI where 1024px content leaves almost no margin. Shortened the CTA label ("View the product" → "Open the app") as a pragmatic fix for that width rather than chasing the capture environment further.

`npx tsc --noEmit` and `npm run lint` both clean.

## Test 13 - Real authentication: login, logout, signup isolation, and a real DB outage caught along the way

Added `User.passwordHash`, a `Session` model, `src/lib/auth.ts` (bcrypt + database-backed sessions, chosen over Auth.js - its Prisma adapter expects its own schema shape, which would fight this app's already-custom `User` model), `/login`, `/signup`, a logout Server Action, and `src/proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts` and made the Node.js runtime the default - which means it can now do the real, authoritative session check itself, not just a cheap cookie-presence check).

**A real migration correctness bug caught before it could bite anyone:** `seed.ts`'s reset step used to unconditionally `deleteMany()` every `Workspace`/`User` in the database. That was harmless when only one workspace could ever exist, but real signups now create their own workspaces - re-running the demo seed script would have silently wiped any real signup data on every reseed. Fixed by scoping the whole reset to the one named demo workspace ("Meridian Ops"), found by name, leaving every other workspace untouched.

**Verified live, the full cycle, not just the happy path:**

- **Unauthenticated access is blocked correctly:** `curl` against `/`, `/health` before logging in both returned `307 -> /login`; `/marketing` and `/login` themselves returned `200` (correctly public).
- **Login works** with the seeded demo account (`priya.chandra@meridian-ops.example` / `demo-password-123`) - landed on Home with the real 19-customer dataset. One real transient failure hit here first: Neon (serverless Postgres, auto-suspends when idle) returned "Can't reach database server" on the very first attempt after a period of no activity - not a bug in the auth code, confirmed by an identical retry succeeding immediately after.
- **Wrong password shows the correct generic error** ("Invalid email or password") - no crash, and deliberately the same message a nonexistent email would produce, so a failed attempt can't be used to enumerate valid accounts.
- **Logout is a real revocation, not just a client-side redirect:** after logging out, queried the database directly (`prisma.session.count()`) and confirmed 0 session rows remained - the server-side session was actually deleted, not just the cookie cleared.
- **Signup produces genuine tenant isolation:** signed up as "Jordan Test" / "Acme Testing Co" and landed on a Home page reading "0 customer-product relationships," £0 everywhere, and confirmed via `document.body.innerText.includes('Northwind')` returning `false` - zero visibility into the seeded demo workspace's data. Every other page (Health, Segments, Settings, Calibration, Adoption, Briefing) rendered its correct empty state for the new workspace with no crash. Cleaned up the test workspace afterward.
- **`proxy.ts`'s upgrade to a real database check verified**, not just assumed from reading the code: re-ran the full unauthenticated-redirect and login checks after the `middleware.ts` → `proxy.ts` migration, confirmed identical behavior, and confirmed the deprecation warning ("The middleware file convention is deprecated") no longer appears in the dev server log.

`npx tsc --noEmit` and `npm run lint` both clean throughout.

## Test 12 - Calibration loop: real outcomes checked against the Health score on file

Added `OutcomeEvent` (churned/renewed/expanded, with real notes) and `/calibration`, which joins every outcome against the customer's latest `HealthScoreSnapshot` and classifies it: `confirmed` (the score's implied read matched what happened), `missed` (a healthy score, but the account churned), or `review` (a risk score, but the account did well anyway - deliberately not auto-labeled a scoring error, since a Watch/Critical account renewing could just as easily mean a successful save-play).

Seeded 4 real outcome events for the handcrafted customers, chosen to exercise all three verdict types, not just the confirming case: Northwind Traders (churned), Fenwick Logistics (expanded), Harlow & Co (renewed), Silent Freight Ltd (renewed).

**Verified live** after a full pipeline re-run (seed → renewal dates → Health scores → opportunities → book summary): page correctly showed 2 confirmed, 2 worth-reviewing, 0 missed - Northwind (score 44, Watch) churned, correctly confirmed; Fenwick (89, Thriving) expanded, correctly confirmed; Harlow (52, Watch) and Silent Freight (53, Watch) both renewed despite a risk-band score, both correctly flagged for review rather than mislabeled as errors. The fresh book summary independently surfaced Northwind as "the single most actionable priority... representing imminent churn without immediate intervention" - written before the calibration page was even checked, and it matches the real outcome that had already occurred in the seed data.

**An honest limitation stated on the page itself, not glossed over:** this build stores one current Health snapshot per customer, not a real historical series, so the comparison is against "the score on file" rather than a true point-in-time backtest of what the score said *before* the outcome happened. Documented in the page's own footnote rather than silently presented as more rigorous than it is.

## Test 14 - Skeptical adversarial review of the auth build, and a first assert-based regression script

After Test 13's build, the auth code was reread specifically looking for what an attacker (not a normal user) would try, rather than re-confirming the happy path already covered. This surfaced five real issues, all fixed and reverified:

- **Timing side-channel (CWE-208) in login:** the original code only ran the slow bcrypt comparison when a matching user existed, so "wrong password" and "no such account" took measurably different amounts of time even though the error message was already generic - enough to let an attacker enumerate real email addresses by timing alone. Fixed by always comparing against a precomputed dummy hash when no user is found, so both paths do the same work. Verified with real timing measurements, not by inspection: a first naive test misleadingly showed a huge gap (0.8s vs 0.06s), traced to Next.js dev-mode compiling that route on its first-ever hit rather than a code issue; a proper warm-up-then-5-samples-each retest put both cases in the same 0.058-0.087s band.
- **TOCTOU race in signup:** the workspace and the first user were created as two separate writes after a separate email-existence check, so a race (or the second write simply failing) could leave an orphaned empty workspace behind and surface as an unhandled error instead of "email already taken." Fixed by wrapping both creates in one transaction and catching Prisma's unique-constraint error code directly. Verified by signing up twice with the same email and confirming a query for total workspace count still showed exactly 2 (demo + the one legitimate signup), no orphan.
- **Workspace-name collision risk in the seed script's reset step:** Test 13's fix scoped the demo reset by workspace *name* ("Meridian Ops"), but name isn't a unique field - a real signup that happened to reuse that name could get wiped on the next reseed, or have its data conflated with the demo set. Fixed by adding a dedicated `isDemoSeed` flag to the schema, set only on the seed-created workspace, and rescoping the reset to that flag instead of the name.
- **Unbounded growth in the in-memory rate limiter:** it was originally sized for a small, fixed set of keys (one per workspace); reusing it for login/signup keyed by attacker-supplied email addresses exposed it to unlimited distinct keys with nothing ever removing expired ones. Fixed with an opportunistic sweep every 500 calls that drops expired entries.
- **Redundant session checks:** a single protected page load ran the same session-validation query three times (`proxy.ts`, `TopBar`, and the page's own workspace lookup). Fixed by wrapping the session lookup in React's `cache()` so repeated calls within one request share a single database round-trip. Reverified login afterward to confirm nothing regressed.

**Test scripts were a real, direct gap for this feature** - Test 13's verification was entirely interactive (browser clicks, curl, one-off throwaway scripts deleted after use), so nothing would catch a future regression automatically. Added `prisma/test-auth.ts`: an assert-based script (throws and exits non-zero on any failure, rather than printing output for a human to eyeball) checking the demo password verifies, a wrong password is rejected, exactly one workspace is flagged as the demo seed, an already-expired session is correctly excluded by the validity check, and a fresh password round-trips through hash/verify correctly. Run via `npx tsx prisma/test-auth.ts` - all 7 checks pass.

**Known limitations, stated rather than silently left out:** there is no password-reset flow (a portfolio-scale trade-off, not an oversight - would need real email sending, which is out of scope by design); expired sessions are only cleaned up lazily, on next use, not by a scheduled sweep of the whole table; and `/login`/`/signup` remain reachable by an already-logged-in user rather than redirecting them straight to Home. None of these are security holes, just polish left for a future pass.

`npx tsc --noEmit` and `npm run lint` both clean throughout.

## Test 15 - A real production-build failure, only caught by actually running `npm run build`

Before Vercel deployment, ran `npm run build` for the first time in this project (`npm run dev` had been the only thing run all along, and dev mode doesn't prerender pages the same way). It failed: `useSearchParams() should be wrapped in a suspense boundary at page "/404"`.

**Real cause:** `Sidebar` and `SegmentSelector` are both client components that call `useSearchParams()` directly, and both render unconditionally from the root layout on every page - including Next.js's own built-in `/_not-found` page, which the production build tries to statically prerender. Prerendering a client hook that reads the URL without a `Suspense` boundary is exactly what Next.js's static-generation step rejects; `next dev` never hits this path, so it stayed invisible until a real build was attempted.

**Fixed** by wrapping `<Sidebar />` (in `src/app/layout.tsx`) and `<SegmentSelector />` (in `src/components/TopBar.tsx`) each in their own `<Suspense fallback={null}>`. Re-ran `npm run build` - succeeded, all 16 routes correctly listed as dynamic (`ƒ`, server-rendered per request, consistent with every page needing a session check).

**Verified live, not just by a clean build:** re-ran the full login flow in the browser afterward - Sidebar and the workspace's real data (Meridian Ops, 24 customer-product relationships, real Health bands) rendered exactly as before, no flash of a missing sidebar from the `null` Suspense fallback in practice.

`npx tsc --noEmit` and `npm run lint` both clean.

## Test 16 - Live deployment on Vercel, verified against the real public URL, not just the build

Deployed to Vercel (`ai-customer-health-platform.vercel.app`), Neon (database, switched to its pooled connection string first - a direct connection can exhaust Neon's connection limit once Vercel's serverless functions open several concurrent connections, unlike a single long-running local dev process).

**A real gotcha caught before it was mistaken for a bug:** the URL Vercel returns right after deploying is a per-deployment preview URL, and Vercel puts its own login wall (Vercel Authentication/SSO) in front of those by default - every route on it, including the public `/marketing` page, redirected to `vercel.com/sso-api`. That's Vercel's own access control, not this app's - confirmed by finding the real, unprotected production domain (`https://ai-customer-health-platform.vercel.app`, no random deployment hash in it) and getting a clean `200` on `/marketing` there instead.

**Verified against the real production domain, the same checks as Test 13's local run:**

- Unauthenticated `/` and `/health` both correctly `307`'d to `/login`; `/marketing`, `/login`, `/signup` all returned `200`.
- Logged in with the seeded demo account - landed on Home with the real 24 customer-product relationships, matching local exactly.
- Logged out, then requested `/health` directly again - redirected straight back to `/login`, confirming the session cookie was genuinely cleared server-side on the live deployment, not just locally.
- Signed up fresh ("Vercel Verify Co") - landed on Home showing 0 customer-product relationships and £0 everywhere, no trace of the demo data, confirming workspace isolation holds under the real deployment too. Cleaned up the test workspace from the database afterward via a one-off script, deleted after use (same pattern as every other throwaway test workspace this project has created).

**A concern raised and checked, not just asserted:** could a stranger using the live site ever cause an Anthropic API call, and so spend against the account owner's key? Traced both files that import the Anthropic SDK (`src/lib/health/agenticLayer.ts`, `src/lib/health/bookSummary.ts`) to their only callers - `prisma/compute-health-scores.ts`, `prisma/compute-book-summary.ts`, `prisma/seed.ts` - all one-off scripts run manually from a local terminal, never from a Server Action or page render. `src/app/health/page.tsx` only reads an already-computed `BookSummary` row from the database. No code path reachable from a live request calls the Anthropic API, confirmed by reading the actual call graph rather than assuming the architecture holds.

`npx tsc --noEmit` and `npm run lint` both clean.

## Test 17 - Bring-your-own Anthropic API key: real encryption at rest, honestly not yet wired to anything live

The concern above led to a follow-up point: this repo is meant to be downloaded and run as someone else's own instance, and their own usage should be billed to their own Anthropic account - not because the current demo needs it (it already can't spend the deployment owner's key, per Test 16), but because a real self-hosted instance would eventually need live agentic playbooks, and those must use *that deployer's own key*, not a shared one baked into the code. Added a Settings field for a workspace to store its own Anthropic API key.

**Built for real, not a cosmetic placeholder:** `src/lib/workspaceSecret.ts` encrypts the key with AES-256-GCM (Node's built-in `crypto`, no extra dependency) before it ever reaches the database, using a separate `SECRET_ENCRYPTION_KEY` env var unrelated to any user's own Anthropic key. `prisma/test-workspace-secret.ts` (assert-based, same rigor as `test-auth.ts`) checks: the stored ciphertext never contains the plaintext key as a substring, decrypting recovers the exact original value, encrypting the same key twice produces different ciphertext (a fresh random IV each call), and - deliberately tested, not assumed - tampering with a stored ciphertext byte is rejected by GCM's authentication tag rather than silently decrypting into garbage.

**Verified live in the browser, not just by the script:** saved a fake test key (`sk-ant-...-1234`) via the Settings form - UI correctly switched to "Configured - ending in ****1234" with no way to see the full value again. Queried the database directly afterward and confirmed the stored `anthropicApiKeyEncrypted` value has no relation to the plaintext beyond the shared last 4 characters (stored separately, in the clear, purely for that masked display). Clicked "Remove" - correctly cleared both fields and reverted the UI to the empty input state, with the workspace's existing competitor-config data (3 entries) untouched by the change.

**Honest about scope, stated in the README, not just here:** the storage is real and secure; nothing reads it yet. No live feature calls the Anthropic API today (see Test 16), so this key currently just sits there. Recorded as a stated design requirement for whenever the per-area agentic playbooks get built: they must read the active workspace's own decrypted key, not a single platform-wide one.

`npx tsc --noEmit` and `npm run lint` both clean.
