# Testing log

This repo's logic was actually executed, not just written and left unverified - same pattern as `ai-job-pipeline-toolkit`'s `TESTING.md`. All data referenced below is synthetic, seeded by `prisma/seed.ts`; no real company or person appears anywhere in this repo.

**Note on scope:** the Health-scoring engine and the first pass at all 9 screens were built and verified in earlier sessions, documented in less granular form here than the detailed, test-by-test log this file keeps going forward. Where a specific number or quote is given below from that earlier work, it's carried over from the contemporaneous project notes, not reconstructed after the fact.

## Test 1 - Health scoring engine, Layer 1 + Layer 2

Ran the full pipeline (`prisma/seed.ts` → `prisma/compute-health-scores.ts`) against the four handcrafted seed customers, each built to exercise a specific driver behaviour, then inspected the stored `HealthScoreSnapshot` rows.

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
