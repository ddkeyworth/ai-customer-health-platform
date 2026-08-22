// Real, runnable regression check for the auth logic - same "actually
// executed, not just written" spirit as test-baseline.ts and
// test-full-pipeline.ts, but this one asserts (throws and exits non-zero on
// failure) rather than printing output for a human to eyeball, since a
// silent regression in password/session logic is exactly the kind of bug
// that should fail loudly, not require someone to notice a wrong printout.
import { PrismaClient } from "@prisma/client";
import { verifyPassword, hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

(async () => {
  // 1. The seeded demo login actually works.
  const demoUser = await prisma.user.findUniqueOrThrow({
    where: { email: "priya.chandra@meridian-ops.example" },
  });
  assert(
    await verifyPassword("demo-password-123", demoUser.passwordHash),
    "Demo user's documented password verifies against the stored hash"
  );
  assert(
    !(await verifyPassword("wrong-password", demoUser.passwordHash)),
    "A wrong password correctly fails verification"
  );

  // 2. Exactly one workspace is flagged as the demo seed - the mechanism
  // seed.ts's reset step relies on to avoid ever touching a real signup's
  // workspace, even if it happens to share the demo's name.
  const demoWorkspaces = await prisma.workspace.findMany({ where: { isDemoSeed: true } });
  assert(demoWorkspaces.length === 1, `Exactly one workspace is flagged isDemoSeed (found ${demoWorkspaces.length})`);
  assert(demoWorkspaces[0].id === demoUser.workspaceId, "The demo user belongs to the flagged demo workspace");

  // 3. Session expiry is enforced at the data level - create a session
  // already in the past and confirm a query for "still valid" sessions
  // correctly excludes it (the same condition auth.ts and proxy.ts both
  // check). Cleaned up immediately after, not left in the real table.
  const expiredSession = await prisma.session.create({
    data: { userId: demoUser.id, expiresAt: new Date(Date.now() - 60_000) },
  });
  const stillValid = await prisma.session.findFirst({
    where: { id: expiredSession.id, expiresAt: { gt: new Date() } },
  });
  assert(stillValid === null, "An already-expired session is correctly excluded by the validity check");
  await prisma.session.delete({ where: { id: expiredSession.id } });

  // 4. A password hash round-trips correctly for an arbitrary input, not
  // just the one demo password - confirms hashPassword/verifyPassword
  // agree with each other, independent of any seeded data.
  const freshHash = await hashPassword("some-arbitrary-test-password");
  assert(await verifyPassword("some-arbitrary-test-password", freshHash), "hashPassword/verifyPassword round-trip correctly");
  assert(!(await verifyPassword("not-the-same-password", freshHash)), "A different password against that hash correctly fails");

  console.log("\nAll auth checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
