# Handover: where things stand and what is left

## What this is

Bearing: an AI Customer Success platform (Health, Onboarding, Adoption, Expansion, Renewal). The owner's hosted site, bearing360.vercel.app, is a read-only demonstration: no signup, nothing saved there. Anyone who wants to save data runs their own copy on their own hosting and database (`SELF_HOSTED=true`); see the README, "Run your own copy".

## Next weekend (6 items, in this order)

1. **Flexible import screens.** The foundations exist: `src/lib/import/mapping.ts` and `customFields.ts` (pure column-mapping logic, 260 checks in `prisma/test-import-mapping.ts`) and the database tables `CustomField`, `ImportMapping` and `Customer.customFields`. Still to build: the mapping screen after upload (map to an existing field, create a custom field, or ignore), saved mappings for repeat uploads, custom fields shown on customer pages, usable as Segment filters, carried in the export, and offered to the AI reads (each field has an include-in-AI switch), all with tests. Custom fields apply to the customers file only; the other files get map-or-ignore. Also: teach the mapping catalogue the columns added since it was written (region, city, sub_industry, nps_date, usage product, and the five newer kinds: stakeholders, goals, training, events, surveys), and decide where the blank-header rule lives (the mapper ignores blank headers, the importer refuses them).
2. **Decide where the workspace login lives (the two-login question), straight after the flexible import.** The next version almost certainly has two kinds of login: a **demo login** that cannot do damage (what exists now: locked, per-visit changes only, no AI spend) and a **login for someone's own workspace**, with a trial and costs. The question is where that second login lives. Shape 1: on the owner's servers, with customers signing up on his site and paying a subscription; the trial can be enforced, but customer data is back on his free database, with the risk and cost that brings. Shape 2: on the customer's own copy, so the owner's site only ever has the demo login; his servers stay risk-free, but the trial cannot be enforced on code they run themselves, so it needs a licence key or the honour system. The two can coexist (a hosted tier later). The kept signup, caps and trial code is expected to be reused either way. Decide this first; the next two items follow from it.
3. **Decide how you get paid.** (Prep note from the owner, kept from before.) The next version will almost certainly have two kinds of login: a **demo login** that cannot do damage (what exists now: locked, per-visit changes only, no AI spend) and a **login for someone's own workspace**, with a trial, costs and a subscription. The signup, caps and trial code kept in the repo (tag `hosted-open-signup-snapshot`, `signupMode()`, `src/lib/trialGate.ts`, `src/lib/authLimits.ts`) is expected to be reused for the second kind. Details to work through together: where the second kind of workspace lives (the owner's servers or the customer's own), what the trial and the costs are, how Stripe fits, and whether the demo and own-workspace logins share one sign-in page. Two earlier options also stay on the table. Option A: a licence key for self-hosted copies, which run free for 14 days and then ask for a key bought through Stripe (nobody's data touches your servers; it needs your licence terms changed from open source, your decision and ideally legal advice). Option B: donations or sponsorship only, no Stripe needed. Also from before: Option A: a licence key for self-hosted copies, which run free for 14 days and then ask for a key bought through Stripe (nobody's data touches your servers; it needs your licence terms changed from open source, your decision and ideally legal advice). Option B: donations or sponsorship only, no Stripe needed. Recommendation was A if you want revenue. This decides what the next two items build.
4. **Set up Stripe test mode.** You create the Stripe account and fill in the keys file yourself, because keys are never pasted into chat.
5. **Payment tests.** The last part of the comprehensive test, after Stripe.
6. **Final comprehensive (skeptical) test of the whole solution**, covering payments, the flexible import and everything built so far, then improvements.

## How to run the checks

- **Unit and database tests:** `npx tsx prisma/<name>.ts` for each `prisma/test-*.ts` (23 scripts, about 1,200 checks; all are in `.github/workflows/ci.yml`). Set `SECRET_ENCRYPTION_KEY` from `.env` first. A test cut off part way can leave throwaway workspaces behind; never pipe a test's output into `head`.
- **Browser journey:** `npm run e2e` walks signup, nine imports, a refused file, free Health, exports, delete, the demo's per-visit behaviour, the recovery-key flow, closed signup, the security policy and phone width. It needs a production build running (`npm run build`, then `npx next start -p 3200` with `ALLOW_SIGNUP=true TRUSTED_PROXY_HOPS=1`, and a second server on 3201 without `ALLOW_SIGNUP` for the closed-signup check) and Chrome for Puppeteer (`npx puppeteer browsers install chrome`, or set `PUPPETEER_EXECUTABLE_PATH`). Never run it with `SELF_HOSTED=true`: it clicks on the shared demo, which is only safe while the demo is locked. Antivirus that injects scripts can stop network-idle waits settling; the script waits on responses instead.
- **CI** runs against a separate Neon branch (`ci-tests`, a copy of the demo database) held in the GitHub secret `DATABASE_URL`, and syncs its tables before the tests. After the demo is reseeded, use "Reset from parent" on that branch in Neon. Vercel's own `DATABASE_URL` points at the live database and must not be changed.
- **The demo seed** (`prisma/seed.ts`) refuses to run without `ALLOW_DEMO_SEED=true`, and wipes the demo's AI results (about £5 and hours to regenerate). Do not run it casually.
- **Screenshots:** `npm run screenshots` (needs the Chrome above).

## Decisions made

- The hosted site stores nobody's data. Monetisation therefore cannot rely on hosted workspaces; how paid licences work is item 2 above.
- Password reset uses a recovery key because the project sends no email.
- Custom fields (flexible import) apply to customers only; each custom field will have an include-in-AI switch; at most 25 per workspace.

## If hosted workspaces are ever wanted again

The hosted site was briefly built with open signup, caps and a 14-day trial before it was decided that nothing should be stored on the owner's servers. None of that was deleted:
- **Git tag `hosted-open-signup-snapshot`** (commit 57352a4) is the exact state where signup was open by default on the hosted site, with the per-address cap (3 a day), the 200-workspace cap, the trial gate and the sample-data warnings.
- **In the current code** it still exists, switched off by default: `ALLOW_SIGNUP=true` reopens signup on a hosted deployment (`signupMode()` in `src/lib/deployment.ts`), the caps are in `src/app/signup/actions.ts` and `src/lib/authLimits.ts`, the trial is `src/lib/trialGate.ts`, and the hosted import limits are in `src/lib/import/validate.ts` (the lower hosted limits apply whenever `SELF_HOSTED` is not `true`).
- Ideas that were dropped, not built: automatically deleting a workspace 30 days after its trial ends with a 7-day warning banner; a per-workspace storage ceiling beyond the row caps.

## Not built, stated honestly

Adding or editing a single customer by form, and team roles and invitations (each workspace has one admin). A customer with no product still gets a "Core product" link on import. The customers file carries only the first champion (the stakeholders file carries everyone). Accessibility has had a labelling pass only, not a full audit.
