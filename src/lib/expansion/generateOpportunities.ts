// Rule-based expansion opportunities (deterministic, no AI and no cost): a
// cross-sell when a ticket mentions adding seats, an upsell when a customer
// off the top tier is using nearly everything in its package, consumption
// growth when metered usage is climbing, and a price increase for Thriving
// accounts. The Expansion capability's AI review then reasons about each one.
//
// Safe to run again: it never creates a second open opportunity of the same
// type for the same customer, and never touches an existing one.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function generateOpportunitiesForWorkspace(workspaceId: string): Promise<{ created: number; accounts: number }> {
  const liveProducts = await prisma.customerProduct.findMany({
    where: { lifecycleStatus: "live", customer: { workspaceId } },
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
  const createOnce = async (args: { data: Prisma.OpportunityUncheckedCreateInput }) => {
    const exists = await prisma.opportunity.findFirst({
      where: { customerId: args.data.customerId, type: args.data.type, stage: "open" },
      select: { id: true },
    });
    if (exists) return;
    await prisma.opportunity.create(args);
    created++;
  };

  for (const cp of liveProducts) {
    const { customer } = cp;
    const snap = customer.healthSnapshots[0];

    // Cross-sell: interaction text mentions adding seats.
    const seatMention = customer.interactions.find((i) => /seat/i.test(i.text));
    if (seatMention) {
      await createOnce({
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
    }

    // Upsell: not on Enterprise and breadth is constrained by package.
    const entitled = cp.product.capabilities.length;
    const productCapabilityIds = new Set(cp.product.capabilities.map((c) => c.id));
    const usedIds = new Set(
      customer.usageSnapshots.filter((u) => productCapabilityIds.has(u.capabilityId)).map((u) => u.capabilityId)
    );
    const breadthPct = entitled > 0 ? (usedIds.size / entitled) * 100 : 0;
    if (customer.tier !== "enterprise" && breadthPct >= 80) {
      await createOnce({
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
    }

    // Consumption growth: consumption-type capability usage growing.
    const consumptionRows = customer.usageSnapshots.filter((u) => u.capability.metricType === "consumption");
    if (consumptionRows.length >= 2) {
      const first = Number(consumptionRows[0].value);
      const last = Number(consumptionRows[consumptionRows.length - 1].value);
      const pctChange = first === 0 ? 0 : ((last - first) / first) * 100;
      if (pctChange >= 30) {
        await createOnce({
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
        }
    }

    // Price increase: only thriving accounts, per the design (can the account sustain it).
    if (snap && snap.tierLabel === "Thriving") {
      await createOnce({
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
    }
  }

  return { created, accounts: liveProducts.length };
}
