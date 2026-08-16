// Rule-based opportunity generation (deterministic, no API call - a real
// agentic version would reason about this the way Layer 2 does for Health,
// but that's a bigger build; this seeds something real to look at now).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.opportunity.deleteMany();

  const liveProducts = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "live" },
    include: {
      customer: {
        include: {
          interactions: true,
          healthSnapshots: { orderBy: { computedAt: "desc" }, take: 1 },
          usageSnapshots: { include: { capability: true }, orderBy: { occurredAt: "asc" } },
        },
      },
      product: { include: { capabilities: true } },
    },
  });

  let created = 0;

  for (const cp of liveProducts) {
    const { customer } = cp;
    const snap = customer.healthSnapshots[0];

    // Cross-sell: interaction text mentions adding seats.
    const seatMention = customer.interactions.find((i) => /seat/i.test(i.text));
    if (seatMention) {
      await prisma.opportunity.create({
        data: {
          customerId: customer.id,
          type: "cross_sell",
          raisedBy: "Agent",
          owner: "Sales",
          ownerRole: "sales",
          stage: "open",
          estimatedArr: Math.round(Number(cp.contractualArr) * 0.15),
          reasoning: `Interaction text: "${seatMention.text}"`,
        },
      });
      created++;
    }

    // Upsell: not on Enterprise and breadth is constrained by package.
    const entitled = cp.product.capabilities.length;
    const usedIds = new Set(customer.usageSnapshots.map((u) => u.capabilityId));
    const breadthPct = entitled > 0 ? (usedIds.size / entitled) * 100 : 0;
    if (customer.tier !== "enterprise" && breadthPct >= 80) {
      await prisma.opportunity.create({
        data: {
          customerId: customer.id,
          type: "upsell",
          raisedBy: "Agent",
          owner: "Sales",
          ownerRole: "sales",
          stage: "open",
          estimatedArr: Math.round(Number(cp.contractualArr) * 0.4),
          reasoning: `Using ${usedIds.size} of ${entitled} entitled Capabilities on the ${customer.tier} tier - package ceiling reached, not a Health issue.`,
        },
      });
      created++;
    }

    // Consumption growth: consumption-type capability usage growing.
    const consumptionRows = customer.usageSnapshots.filter((u) => u.capability.metricType === "consumption");
    if (consumptionRows.length >= 2) {
      const first = Number(consumptionRows[0].value);
      const last = Number(consumptionRows[consumptionRows.length - 1].value);
      const pctChange = first === 0 ? 0 : ((last - first) / first) * 100;
      if (pctChange >= 30) {
        await prisma.opportunity.create({
          data: {
            customerId: customer.id,
            type: "consumption_growth",
            raisedBy: "Agent",
            owner: "CSM",
            ownerRole: "csm",
            stage: "open",
            estimatedArr: Math.round(Number(cp.consumptionArr) * (pctChange / 100)),
            reasoning: `Consumption up ${pctChange.toFixed(0)}% (${first.toFixed(0)} -> ${last.toFixed(0)}) - projecting forward at the current rate.`,
          },
        });
        created++;
      }
    }

    // Price increase: only thriving accounts, per the design (can the account sustain it).
    if (snap && snap.tierLabel === "Thriving") {
      await prisma.opportunity.create({
        data: {
          customerId: customer.id,
          type: "price_increase",
          raisedBy: "Agent",
          owner: "Sales",
          ownerRole: "sales",
          stage: "open",
          estimatedArr: Math.round(Number(cp.contractualArr) * 0.05),
          reasoning: `Health score ${snap.compositeScore} (Thriving) - account can plausibly sustain a price increase at renewal.`,
        },
      });
      created++;
    }
  }

  console.log(`Created ${created} opportunities across ${liveProducts.length} live accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
