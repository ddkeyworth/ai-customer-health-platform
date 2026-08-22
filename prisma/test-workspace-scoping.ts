// Assert-based regression check for cross-tenant isolation - the actual
// security property behind this app's multi-tenancy. Creates a real,
// throwaway second workspace with its own customer and segment, confirms
// neither leaks into the demo workspace's queries (or vice versa) through
// the same library functions the app's pages actually call, then deletes
// everything it created.
import { PrismaClient } from "@prisma/client";
import { customersMatchingCriteria } from "../src/lib/segments";
import { resolveActiveSegment } from "../src/lib/activeSegment";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  const demoWorkspace = await prisma.workspace.findFirstOrThrow({ where: { isDemoSeed: true } });

  const otherWorkspace = await prisma.workspace.create({
    data: { name: "Test Scoping Workspace - safe to delete" },
  });
  const otherCustomer = await prisma.customer.create({
    data: {
      workspaceId: otherWorkspace.id,
      name: "Test Scoping Customer",
      industry: "UNIQUE_TEST_SCOPING_INDUSTRY",
      tier: "enterprise",
    },
  });
  const otherSegment = await prisma.segment.create({
    data: { workspaceId: otherWorkspace.id, name: "Test Scoping Segment", criteria: {} },
  });

  try {
    const leakCheck = await customersMatchingCriteria(demoWorkspace.id, { industry: "UNIQUE_TEST_SCOPING_INDUSTRY" });
    assert(leakCheck.length === 0, "A customer created in a different workspace never appears when querying the demo workspace, even with matching criteria");

    const ownCheck = await customersMatchingCriteria(otherWorkspace.id, { industry: "UNIQUE_TEST_SCOPING_INDUSTRY" });
    assert(
      ownCheck.some((c) => c.id === otherCustomer.id),
      "The same customer correctly appears when queried within its own workspace"
    );

    const crossTenantSegmentLookup = await resolveActiveSegment(demoWorkspace.id, otherSegment.id);
    assert(
      crossTenantSegmentLookup === null,
      "Resolving another workspace's real segment ID against the demo workspace returns null, not that workspace's data - the actual IDOR guard"
    );

    const correctSegmentLookup = await resolveActiveSegment(otherWorkspace.id, otherSegment.id);
    assert(
      correctSegmentLookup !== null && correctSegmentLookup.id === otherSegment.id,
      "The same segment ID resolves correctly when paired with its own workspace"
    );
  } finally {
    await prisma.segment.delete({ where: { id: otherSegment.id } });
    await prisma.customer.delete({ where: { id: otherCustomer.id } });
    await prisma.workspace.delete({ where: { id: otherWorkspace.id } });
  }

  console.log("\nAll workspace-scoping checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
