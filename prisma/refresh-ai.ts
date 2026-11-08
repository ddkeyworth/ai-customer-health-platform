// Re-runs the AI layers on the demo workspace, in dependency order, using
// that workspace's own configured key. Costs real API credit, so it never
// runs on its own: it is a manual command.
//
//   npm run refresh-ai                      everything (about 340 calls)
//   npm run refresh-ai -- health renewal    only the named steps
//
// Steps, in the order they run: health, summary, opportunities (free, rules
// only), onboarding, adoption, expansion, renewal. Expansion and Renewal
// quote a customer's Health tier, so re-run them after Health changes.
// Onboarding and Adoption do not depend on Health.
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { runCapability } from "../src/lib/capabilityRuns";
import { computeBookSummary } from "../src/lib/health/bookSummary";
import { decryptSecret } from "../src/lib/workspaceSecret";

const prisma = new PrismaClient();
const STEPS = ["health", "summary", "opportunities", "onboarding", "adoption", "expansion", "renewal"] as const;
type Step = (typeof STEPS)[number];

const requested = process.argv.slice(2);
const unknown = requested.filter((r) => !STEPS.includes(r as Step));
if (unknown.length > 0) {
  console.error(`Unknown step(s): ${unknown.join(", ")}. Valid: ${STEPS.join(", ")}`);
  process.exit(1);
}
const selected = STEPS.filter((s) => requested.length === 0 || requested.includes(s));

const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

(async () => {
  const ws = await prisma.workspace.findFirstOrThrow({ where: { isDemoSeed: true } });

  for (const step of selected) {
    console.log(`${stamp()} === ${step} ===`);
    if (step === "summary") {
      const customers = await prisma.customer.findMany({ where: { workspaceId: ws.id }, select: { id: true } });
      const summary = await computeBookSummary(customers.map((c) => c.id), decryptSecret(ws.anthropicApiKeyEncrypted!));
      await prisma.bookSummary.create({ data: { workspaceId: ws.id, scopeKey: "all", summary } });
    } else if (step === "opportunities") {
      console.log(execSync("npx tsx prisma/generate-opportunities.ts", { encoding: "utf8" }));
    } else {
      await runCapability(ws.id, step);
    }
  }
  console.log(`${stamp()} done: ${selected.join(", ")}`);
})()
  .catch((e) => {
    console.error("FAILED:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
