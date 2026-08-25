# Playbook design proposals (awaiting sign-off)

Not implemented. No schema or code changes here - this document exists so the actual design decisions get reviewed before anything is built, rather than guessed on a public repo. Health's two-layer pattern (`src/lib/health/baseline.ts` + `agenticLayer.ts`) is the proven reference: a deterministic layer computes real numbers from real data, a bounded agentic layer reasons on top of it with a required evidence-grounded justification, and the result is a draft a human reviews - never something sent or executed automatically. These five proposals extend that same shape to the other four lifecycle areas, plus the shared storage model all of them need.

## 1. Generic `AgentAction` draft-storage model

**The gap it fills:** Health already writes its output to `HealthScoreSnapshot`, and Expansion's opportunities go to `Opportunity` - both area-specific tables. Onboarding, Adoption, and Renewal's proposed agentic layers below produce the same *kind* of thing (a recommendation with reasoning, awaiting human review) but there's no shared place for it to live, and Briefing has no review/dismiss/snooze state for anything it surfaces today.

**Proposed shape:**

```prisma
model AgentAction {
  id           String   @id @default(cuid())
  workspaceId  String
  customerId   String
  area         String   // "onboarding" | "adoption" | "expansion" | "renewal"
  actionType   String   // e.g. "recovery_plan", "usage_nudge", "save_play"
  status       String   @default("proposed") // "proposed" | "accepted" | "dismissed"
  headline     String   // one-line summary, shown in Briefing
  reasoning    String   // evidence-grounded narrative, same rule as Health's narrative
  suggestedNextStep String?
  impactArr    Decimal? // for £-impact ranking in Briefing, same pattern as today
  createdAt    DateTime @default(now())
  reviewedAt   DateTime?
  reviewedBy   String?

  workspace Workspace @relation(fields: [workspaceId], references: [id])
  customer  Customer  @relation(fields: [customerId], references: [id])

  @@index([workspaceId, status])
}
```

**Open decisions for sign-off:**
- Should `status` support more than three values (e.g. "snoozed" with a `snoozeUntil` date)? Simplest version above covers the "agent proposes, human decides" principle without over-building.
- Does Briefing read from `AgentAction` *in addition to* its current live Health/Expansion/Onboarding/Renewal queries, or does it eventually migrate to reading `AgentAction` exclusively once all four areas below are built? Recommend: additive at first, migrate later - avoids a big-bang rewrite of a screen that already works.
- One row per customer per area, or can an area raise multiple open actions for the same customer at once (mirroring how Expansion already allows multiple open opportunities per customer)? Recommend: allow multiple, since Expansion's existing behaviour already sets that precedent.

## 2. Onboarding agentic layer

**Trigger:** joins the existing `runCapability()` dispatcher (`src/lib/capabilityRuns.ts`) as a new allowed capability (`"onboarding"`) - same on-demand/daily/weekly schedule UI already built in Settings, same strict per-workspace BYOK key enforcement, no new infrastructure needed beyond a one-line array addition and a dispatch branch.

**Inputs:** for each `CustomerProduct` with `lifecycleStatus: "onboarding"` - `initialGoLiveDate`, `expectedGoLiveDate`, `computeDaysOverdue()` result (already built, `src/lib/onboarding/pace.ts`), the customer's interaction history, and training/stakeholder data where present (the same fields Health's Layer 2 already reads for its own scoring).

**Proposed output** (bounded tool-call, same pattern as `ADJUSTMENT_TOOL`):

```json
{
  "stalledReason": "customer_delay | internal_delay | external_dependency | unclear",
  "reasoning": "2-3 sentences, must cite specific interaction text or dates provided",
  "recoveryStep": "one concrete next action, e.g. 'schedule a re-kickoff call with the champion'",
  "confidence": "early_read | established"
}
```

Written as an `AgentAction` (area: `"onboarding"`, actionType: `"recovery_plan"`) only for accounts that are actually overdue (`daysOverdue > 0`) - never generated for on-pace accounts, so it doesn't create noise.

**Guardrail, matching Health's:** `stalledReason` and `recoveryStep` must never be generated without at least one piece of real supporting evidence (an interaction, a date) - if there's nothing to reason about beyond "it's late," the layer should decline to produce an action rather than inventing a plausible-sounding one.

## 3. Adoption agentic layer

**Trigger:** same `runCapability()` extension as above (`"adoption"`).

**Inputs:** per live `CustomerProduct` - capability breadth (`used`/`entitled`, already computed in `src/app/adoption/page.tsx`), which specific capabilities are unused, and interaction text (to check whether a low-breadth account has actually asked about an unused capability, vs. never mentioned it at all - a real signal difference the current page can't surface).

**Proposed output:**

```json
{
  "underusedCapabilities": ["capability name", "..."],
  "reasoning": "must cite the actual entitled-vs-used gap and any relevant interaction text",
  "nudgeType": "training_offer | champion_outreach | capability_walkthrough",
  "confidence": "early_read | established"
}
```

Written as an `AgentAction` (area: `"adoption"`, actionType: `"usage_nudge"`) only below a breadth threshold (e.g. the existing 50% line already drawn on the Adoption page) - **decision needed:** is that threshold configurable per workspace (a new Settings field) or a fixed constant to start, matching how the 50% split is currently just a hardcoded comparison in the page itself?

## 4. Expansion agentic layer (upgrading from rule-based)

**Current state, honestly:** `prisma/generate-opportunities.ts` already generates real `Opportunity` rows from real signals (seat mentions in interaction text, package-ceiling breadth, consumption growth, Health-band-qualified price increases) - but via fixed deterministic rules, not reasoning. The file's own comment already flags this: "a real agentic version would reason about this the way Layer 2 does for Health, but that's a bigger build."

**Proposed change:** replace (or run alongside, see decision below) the rule engine with a bounded agentic call per live `CustomerProduct`, given the same signals the rules already use (consumption trend, capability breadth vs. package ceiling, interaction text, current Health score) plus anything a fixed rule can't weigh contextually - e.g. a customer who mentioned seats *and* is also Health-Critical might warrant a different `Opportunity` framing (or none at all) than the current rules would produce, since expanding a churn-risk account is a different conversation than expanding a healthy one.

**Proposed output**, replacing the current hardcoded `reasoning` strings:

```json
{
  "shouldRaise": true,
  "type": "price_increase | cross_sell | upsell | consumption_growth",
  "estimatedArr": 12000,
  "reasoning": "must cite specific interaction text, consumption numbers, or Health context provided - never a generic template sentence",
  "cautionFlag": "e.g. 'Health is Critical - consider a save play before raising expansion' or null"
}
```

**Open decision for sign-off:** does this *replace* `generate-opportunities.ts` entirely, or does the deterministic version stay as the always-on baseline (cheap, no API cost, already proven) with the agentic layer as an optional richer pass a workspace opts into - mirroring exactly how Health itself has both a free deterministic baseline *and* a paid agentic adjustment on top, rather than one or the other? Recommend the latter: it's the same two-layer principle already validated on Health, not a new pattern.

## 5. Renewal agentic layer

**Current state, honestly:** projected churn is explicitly labelled illustrative - a flat lookup table (`CHURN_LIKELIHOOD` by Health band: Critical 60%, Watch 30%, Stable 10%, Thriving 2%) applied uniformly, with the page's own footnote saying the real design calls for this to come from the calibration loop instead, which isn't built.

**Proposed output** (this is the one area where "agentic" should mean *save-play generation*, not a better likelihood number - a single global percentage per band is a modelling problem outside this proposal's scope, and shouldn't be dressed up as agentic reasoning it isn't):

```json
{
  "riskFactors": ["specific, cited reasons this renewal is at risk"],
  "savePlay": "one concrete recommended action for the CSM, e.g. 'schedule an executive check-in before the 45-day mark given the interrupted-renewal flag and 3 unresolved tickets'",
  "reasoning": "must cite the actual renewal type, Health narrative, or interaction text provided",
  "confidence": "early_read | established"
}
```

Generated only for the same "within 90 days" window `/renewal` already filters to, and only when `renewalType === "interrupted"` or the Health band is Watch/Critical - matching the existing `atRisk` condition already used in `src/app/briefing/page.tsx`, so this genuinely adds save-play reasoning on top of a risk flag Briefing already raises, rather than duplicating it.

**Open decision for sign-off:** should the projected-churn *percentage* itself eventually move from the flat lookup table to the calibration loop (`/calibration`, already built and comparing real outcomes against Health scores)? That's a separate, larger piece of work than the save-play generation above, and is flagged here rather than silently bundled in.

---

## Common guardrails across all four (non-negotiable, not up for debate)

- Every proposed action requires `runCapability()`'s existing strict per-workspace BYOK check - no fallback to a shared platform key, exactly as Health already enforces.
- Every `AgentAction` is a draft only. Nothing here is ever sent to a customer, executed, or auto-approved - a human reviews and marks it accepted/dismissed, same as the "every agent action is a draft a human reviews" principle already stated in the README's governing-principle section.
- No `reasoning` field may be generated without evidence it can point back to in the data actually provided - the exact rule already enforced (and once found violated and fixed) in Health's `agenticLayer.ts`.
