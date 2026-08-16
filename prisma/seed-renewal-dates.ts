// Adds renewal dates to already-seeded live CustomerProduct rows - kept
// separate from seed.ts since renewalDate was added after the initial
// seed. Spreads dates across overdue/soon/later so the Renewal screen
// has something realistic to show.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  const live = await prisma.customerProduct.findMany({ where: { lifecycleStatus: "live" } });
  const spread = [-10, -3, 5, 12, 18, 25, 30, 40, 55, 60, 75, 88, 95, 110, 130, 150];

  for (let i = 0; i < live.length; i++) {
    const offset = spread[i % spread.length];
    await prisma.customerProduct.update({
      where: { id: live[i].id },
      data: { renewalDate: daysFromNow(offset) },
    });
  }

  console.log(`Set renewal dates for ${live.length} live accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
