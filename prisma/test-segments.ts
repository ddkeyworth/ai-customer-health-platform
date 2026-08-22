// Assert-based regression check for segment-criteria matching - the real
// customersMatchingCriteria() from src/lib/segments.ts, run against the
// actual seeded demo workspace rather than hardcoded expected values, so
// it stays correct across reseeds.
import { PrismaClient } from "@prisma/client";
import { customersMatchingCriteria } from "../src/lib/segments";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { isDemoSeed: true } });
  const allCustomers = await prisma.customer.findMany({ where: { workspaceId: workspace.id } });
  assert(allCustomers.length > 0, "The demo workspace has at least one seeded customer to test against");

  const noCriteria = await customersMatchingCriteria(workspace.id, {});
  assert(noCriteria.length === allCustomers.length, "Empty criteria returns every customer in the workspace, no more and no fewer");

  const sample = allCustomers.find((c) => c.industry !== null);
  assert(sample !== undefined, "At least one seeded customer has a non-null industry to test filtering against");
  if (!sample || !sample.industry) throw new Error("unreachable - asserted above");

  const byIndustry = await customersMatchingCriteria(workspace.id, { industry: sample.industry });
  assert(
    byIndustry.every((c) => c.industry === sample.industry),
    "Filtering by industry returns only customers matching that exact industry"
  );
  assert(
    byIndustry.some((c) => c.id === sample.id),
    "The sampled customer itself appears in its own industry's filtered results"
  );

  const byTier = await customersMatchingCriteria(workspace.id, { tier: sample.tier });
  assert(
    byTier.every((c) => c.tier === sample.tier),
    "Filtering by tier returns only customers matching that exact tier"
  );

  const combined = await customersMatchingCriteria(workspace.id, { industry: sample.industry, tier: sample.tier });
  assert(
    combined.every((c) => c.industry === sample.industry && c.tier === sample.tier),
    "Combining two criteria (industry + tier) requires both to match, not either"
  );
  assert(combined.length <= byIndustry.length, "Adding a second criterion never returns more results than the first alone");

  const nonsenseIndustry = await customersMatchingCriteria(workspace.id, { industry: "Not A Real Industry XYZ" });
  assert(nonsenseIndustry.length === 0, "A criterion matching no real data returns an empty list, not everyone");

  console.log("\nAll segments checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
