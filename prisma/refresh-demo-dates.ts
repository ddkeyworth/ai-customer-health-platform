// Moves the demo workspace's dates forward to today without a reseed, so no
// stored AI result is lost. The daily cron does this automatically once the
// reference date is a week old; this is the manual version. See
// src/lib/demoDates.ts.
import { PrismaClient } from "@prisma/client";
import { shiftWorkspaceDates } from "../src/lib/demoDates";

const prisma = new PrismaClient();

(async () => {
  const demo = await prisma.workspace.findFirstOrThrow({ where: { isDemoSeed: true } });
  const days = Math.floor((Date.now() - demo.createdAt.getTime()) / 86_400_000);
  if (days < 1) {
    console.log("Demo dates are already current (under a day old).");
    return;
  }
  await shiftWorkspaceDates(demo.id, days);
  console.log(`Shifted the demo workspace forward by ${days} days.`);
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
