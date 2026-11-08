# Handover: where things stand and what is left

Written when the work was stopped part way (laptop battery). Everything below is committed to `main`.

## The list (6 items)

1. Remainder of the last session
2. Stripe test mode
3. Payment tests
4. Flexible import with dynamic field mapping
5. Skeptical end-to-end test of the whole solution
6. Not built, stated honestly

## 1. Remainder of the last session (do these first)

Built and committed, but not yet fully verified or finished:

1. **Upgrade Next.js and fix the other vulnerable packages (security).** `npm audit --omit=dev` reports 4 vulnerabilities, one critical: `next` 16.3.0 (remote code execution on Windows-hosted servers, and in the image optimiser) with the fix at 16.4.5, which is not a major change. Also `sharp`, `zod` and `source-map-js`. Run `npm install next@16.4.5 eslint-config-next@16.4.5`, then `npm audit fix`, then rebuild and run every test.
2. **Find out why the browser journey timed out.** `npm run e2e` (needs a running production build, see the header of `scripts/e2e-journey.mjs`) passed 16 of 17 checks, then timed out after clicking "Find expansion opportunities" on the Expansion page. It may be the test's wait, or a real hang in `findOpportunities`. Diagnose first.
3. **Run the rest of the journey.** Not yet run: the export download checks, the security checks (logged-out export, cross-site run request, headers), the delete-workspace flow, the shared-demo isolation (one visitor's Dismiss must not change what another visitor sees, and must disappear after logout), and the phone-width checks.
4. **Clean up after failed journey runs.** A failed run leaves a "Journey Co ..." workspace. Delete it from Data, or with `deleteWorkspaceAndData`. Also: signup is capped at 3 per address per day on the hosted site, so delete the rate-limit row `signup-ip:unknown` before re-running the journey from your own machine.
5. **Run all 19 test scripts, the build, lint and CI, and confirm CI is green.** The new scripts are `test-csv-parse-validate` (68 checks), `test-import-export` (62 checks) and `test-deployment-modes`; they are in `.github/workflows/ci.yml`.
6. **Check production after the deploy.** This commit changes sessions (everyone is logged out once), adds security headers (a content security policy: check the live pages still render with no console errors), and adds the Data page, export, delete, per-visit demo state, signup limits and the free baseline Health run.
7. **Screenshots and docs.** Add a Data page screenshot to `scripts/capture-screenshots.mjs` and the README gallery (the README says fourteen screenshots, it will be fifteen). Add a TESTING.md entry for the skeptical test and its findings (below).
8. **Speed and accessibility checks** were not done. Known: some form labels are not tied to their inputs.
9. **CI uses the live database.** The tests create and delete throwaway workspaces in the same database the demo runs on. Create a separate test database (a Neon branch) and point the CI `DATABASE_URL` secret at it.
10. **A guarded seed.** `prisma/seed.ts` now refuses to run without `ALLOW_DEMO_SEED=true`. To reseed the hosted demo, set it for that one command.

Findings and fixes from the skeptical test so far: session tokens were database ids (now 256-bit random, only the hash stored); no security headers (added); no import or export (built); a new signup was a dead end (import, free baseline Health, free opportunity finding); the shared demo could be changed by any visitor (now per-visit, read-only elsewhere); the seed would have created a public-password login on any deployment (now guarded); `SELF_HOSTED` is the single switch between the hosted site and your own copy.

## 2. Stripe test mode

Create a Stripe account and fill in the keys file yourself, because keys are never pasted into chat. Then replace the placeholder "Upgrade (demo only)" with Stripe test-mode checkout for the hosted site's 14-day trial. Self-hosted copies (`SELF_HOSTED=true`) stay free.

## 3. Payment tests

The last part of the comprehensive test, after Stripe.

## 4. Flexible import with dynamic field mapping

The import currently reads fixed columns. Build a mapping step so an uploaded file's columns can be matched to existing fields, turned into new custom fields (text, number, date or pick-list, per workspace), or ignored; show suggested matches; save the mapping for repeat uploads; show custom fields on customer pages, as Segment filters, in the export (so a round trip keeps them) and as AI context; keep the all-or-nothing checks and limits, cap custom fields per workspace, and test unknown, missing and wrongly typed columns, mapping reuse and a round trip.

## 5. Skeptical end-to-end test of the whole solution

Repeat the full skeptical test, after items 2 to 4 so it also covers payments and the flexible import: weaknesses, errors and functional gaps, then improvements for a more robust final version.

## 6. Not built, stated honestly

Password reset (it needs email), forms to add or edit a single customer, and team roles.
