# ai-customer-health-platform

A conceptual exploration of an agentic-AI Customer Success platform — planned and built with Claude Code as a portfolio piece. **This is a prototype, not a production system, and not a real product.** Nothing here is a real company. There is no live deployment yet, no real customer data anywhere, and no outbound contact of any kind.

> No AI reads every account right. It gets you close enough, fast enough, to act. Across onboarding, health, expansion, and renewal.

![Health screen concept](docs/screenshots/health-mockup.svg)
![Positioning concept](docs/screenshots/marketing-concept.svg)

Both images above are illustrative mockups made while planning this repo, not real screenshots of a working feature — see [What's real vs. planned](#whats-real-vs-planned) below.

## What this is

Most Customer Success tooling is a system of record — a place to manage accounts, log interactions, and store contracts. This project is deliberately **not** that. It's an insight layer that sits on top of the systems that already do that job, organised around five areas of the customer lifecycle:

- **Health** — a composite score built from 14 drivers (support friction, consumption trend, capability breadth/stickiness, competitor risk, and more), run continuously from Onboarding through Live. The flagship area, and the one genuinely load-bearing piece of the whole idea.
- **Onboarding** — pace to first Capability go-live, with a cause-tagged log of any slippage.
- **Adoption** — usage and consumption trends per Capability, and progress against the Desired Outcomes a customer actually bought the product to achieve.
- **Expansion** — Price Increase, Cross-sell, Upsell, and Consumption Growth opportunities, each with a Raised-By and an Owner.
- **Renewal** — Auto vs. Interrupted renewals, ARR and consumption revenue at risk, and a projected-churn estimate shown honestly as an estimate, not a fact.

Every screen is meant to carry its own synthesized narrative, not just a data table — because a re-skinned CRM view isn't the point. If the reasoning underneath isn't genuinely sound, this whole idea doesn't hold up. See [Health scoring, and why it isn't built yet](#health-scoring-and-why-it-isnt-built-yet).

## Governing principle: safe by construction, not by promise

Every design decision in this repo follows one rule: **anything that would touch the outside world, real data, or a real compliance claim is shown as a concept only — never operationalized.**

- No real customer or personal data, anywhere, ever. All data is synthetic.
- No outbound network call except to the Anthropic API for the agent's own reasoning (and only once that's actually built — see below). Any other integration (a real CRM sync, a real email send, a real OAuth login) is represented as a UI concept, not a working connection, unless explicitly extended later with deliberate sign-off.
- No compliance claims that aren't true. No fabricated traction, testimonials, or results anywhere in this repo or its documentation.
- Every agent action is designed to be a draft a human reviews — nothing is ever sent or executed automatically.

## What's real vs. planned

| Area | Status |
|---|---|
| Product definition, requirements, information architecture | Fully planned |
| Data model (Workspace, User, Customer, Product, Capability, Package, Health snapshot) | Defined in `prisma/schema.prisma` |
| App shell (navigation, layout) | Built |
| Individual screens (Home, Health, Briefing, Onboarding, Adoption, Expansion, Renewal, Segments, Settings) | Stubbed — each states clearly what it will do and that it isn't built yet |
| Health-scoring engine (the actual "special sauce") | **Designed, not implemented** — see below |
| Agent core / playbooks | Not started |
| Synthetic data generator | Not started |
| Live public deployment | **Not started — deliberately.** See [Stage 2: live deployment](#stage-2-live-deployment-not-yet-started) |

## Health scoring, and why it isn't built yet

The easy part of this project is the CRM-adjacent facts — ARR, package, who's assigned. Those aren't the point; a real CRM already shows them. The actual value has to come from genuine insight: a composite score that reasons about context rather than averaging numbers, and a narrative that explains *why*, built from evidence, not a template.

The architecture for that is designed:

- **Two layers** — a deterministic signal layer (each of 14 drivers normalized against the account's own history and a peer cohort, not a fixed global threshold), and an agentic judgment layer on top of it (the same signals interpreted in context — lifecycle stage, proximity to renewal, whether a champion just left — producing both a judgment-adjusted score and an evidence-chain narrative).
- **Stage-aware scoring** — a pre-Live account gets a narrow, honest read focused on onboarding pace, not the full 14-driver picture applied to an account that hasn't started yet.
- **Confidence labeling** — a score's presented confidence reflects how much data actually backs it, rather than showing every account with equal false authority.
- **A calibration loop** — real outcomes get tagged after the fact (did a "healthy" account churn anyway?) and surfaced periodically for a human to review and adjust the weighting, not a silently self-tuning system.

None of that is implemented yet, and this repo won't fake it with a placeholder score or a templated sentence dressed up as AI reasoning. That would misrepresent the entire premise of the project.

## Stage 2: live deployment — not yet started

This repo is code and documentation only. There is no running app anywhere, no public URL, no database with anything in it. A live deployment is a deliberate future step, gated on:

1. The Health-scoring engine actually being implemented (see above) — no point deploying an app whose flagship feature is a stub.
2. Rate limiting and usage caps being in place, so a public sign-up flow can't run up hosting or API costs.
3. A hard spending cap set on the Anthropic API account *before* any real key is wired in.

## Tech stack

Next.js (App Router) + TypeScript, Tailwind CSS, Prisma targeting Postgres. Auth (when built) will be email/password only — no third-party OAuth, so no real identity provider is ever contacted. Intended hosting: Vercel + a managed Postgres provider (Neon/Supabase), both on free tiers with no payment method attached until a live deployment is deliberately decided.

## Running it locally

```
npm install
npm run dev
```

Opens at `http://localhost:3000`. There's no database connected yet — the schema exists but nothing reads from or writes to it. This just renders the navigation shell and the stub pages described above.

## License

MIT — see [LICENSE](LICENSE).
