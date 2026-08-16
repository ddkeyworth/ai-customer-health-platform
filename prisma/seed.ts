// Synthetic data generator. Everything here is fictional - no real company,
// person, or dataset. See README.md "Governing principle" for why this
// matters: the whole point is a safe, zero-risk demo dataset, not a
// shortcut. Re-runnable: clears its own data first, doesn't touch anything
// else. Timestamps are relative to `now` passed in at call time, since
// Date.now() usage inside a long-running process would drift - here it's
// simply the wall-clock time when the script runs, which is fine for a
// one-shot seed.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const INDUSTRIES = [
  ["Logistics", "Freight forwarding"],
  ["Retail", "E-commerce fulfilment"],
  ["Manufacturing", "Industrial components"],
  ["Food & Beverage", "Cold chain distribution"],
  ["Construction", "Materials supply"],
];

const REGIONS = [
  ["United Kingdom", "South East", "London"],
  ["United Kingdom", "North West", "Manchester"],
  ["United States", "Northeast", "New York"],
  ["United States", "Midwest", "Chicago"],
  ["Germany", "Bavaria", "Munich"],
];

const RANDOM_NAMES = [
  "Ashgrove Freight", "Copperfield Logistics", "Denholm Supply Co",
  "Ellery Distribution", "Foxglove Transport", "Greymoor Industrial",
  "Halcyon Cargo", "Ironbridge Materials", "Juniper Fulfilment",
  "Kestrel Freight", "Larchmont Supply", "Mossbank Logistics",
  "Nettlewood Transport", "Osprey Distribution", "Pinehaven Cargo",
];

async function main() {
  console.log("Clearing existing synthetic data...");
  // Every table that FKs to Customer or Workspace must be cleared before its
  // parent - the FK constraints are RESTRICT, not CASCADE. Opportunity was
  // added later (the Expansion screen build) and missed this list until a
  // second seed run after real opportunities existed surfaced the bug;
  // DesiredOutcome/Stakeholder/TrainingCompletion/Segment/BookSummary added
  // here for the same reason rather than waiting to hit it again.
  await prisma.healthScoreSnapshot.deleteMany();
  await prisma.usageSnapshot.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.surveyResponse.deleteMany();
  await prisma.eventAttendance.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.desiredOutcome.deleteMany();
  await prisma.stakeholder.deleteMany();
  await prisma.trainingCompletion.deleteMany();
  await prisma.outcomeEvent.deleteMany();
  await prisma.customerProduct.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.segment.deleteMany();
  await prisma.bookSummary.deleteMany();
  await prisma.competitorConfig.deleteMany();
  await prisma.package.deleteMany();
  await prisma.capability.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();

  console.log("Creating workspace...");
  const workspace = await prisma.workspace.create({
    data: {
      name: "Meridian Ops",
      currency: "GBP",
      pricingTier: "growth",
      seatsIncluded: 20,
      dataVolumeIncluded: 100000,
    },
  });

  await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      name: "Priya Chandra",
      email: "priya.chandra@meridian-ops.example",
      role: "head_vp_cs",
      isAdmin: false,
    },
  });

  console.log("Creating products and capabilities...");
  const product = await prisma.product.create({
    data: { workspaceId: workspace.id, name: "Meridian Freight" },
  });

  const capNames: [string, string][] = [
    ["Freight tracking", "adoption"],
    ["Route optimization", "adoption"],
    ["Driver app", "adoption"],
    ["Customs docs", "adoption"],
    ["Payments processing", "consumption"],
  ];
  const capabilities = [];
  for (const [name, metricType] of capNames) {
    capabilities.push(
      await prisma.capability.create({
        data: { productId: product.id, name, metricType },
      })
    );
  }
  const [tracking, routing, driverApp, , payments] = capabilities;

  const starter = await prisma.package.create({
    data: { productId: product.id, name: "Starter" },
  });
  const pro = await prisma.package.create({
    data: { productId: product.id, name: "Pro" },
  });
  const enterprise = await prisma.package.create({
    data: { productId: product.id, name: "Enterprise" },
  });

  // Second product, so customers can hold more than one - some accounts
  // below deliberately have two CustomerProduct rows (one per product).
  const warehouseProduct = await prisma.product.create({
    data: { workspaceId: workspace.id, name: "Meridian Warehouse" },
  });

  const warehouseCapNames: [string, string][] = [
    ["Inventory sync", "adoption"],
    ["Pick & pack", "adoption"],
    ["Returns processing", "adoption"],
    ["Slotting optimization", "consumption"],
  ];
  const warehouseCapabilities = [];
  for (const [name, metricType] of warehouseCapNames) {
    warehouseCapabilities.push(
      await prisma.capability.create({
        data: { productId: warehouseProduct.id, name, metricType },
      })
    );
  }
  const [invSync, pickPack] = warehouseCapabilities;

  const warehouseStarter = await prisma.package.create({
    data: { productId: warehouseProduct.id, name: "Starter" },
  });
  const warehousePro = await prisma.package.create({
    data: { productId: warehouseProduct.id, name: "Pro" },
  });
  const warehouseEnterprise = await prisma.package.create({
    data: { productId: warehouseProduct.id, name: "Enterprise" },
  });

  console.log("Creating competitor config...");
  await prisma.competitorConfig.createMany({
    data: [
      { workspaceId: workspace.id, name: "RouteWorks", riskWeight: 5 },
      { workspaceId: workspace.id, name: "CargoPilot", riskWeight: 3 },
      { workspaceId: workspace.id, name: "FleetIQ", riskWeight: 2 },
    ],
  });

  // Package -> which capabilities it actually entitles
  const packageCapabilities: Record<string, typeof capabilities> = {
    [starter.id]: [tracking, driverApp],
    [pro.id]: [tracking, driverApp, routing, payments],
    [enterprise.id]: capabilities,
    [warehouseStarter.id]: [invSync],
    [warehousePro.id]: [invSync, pickPack],
    [warehouseEnterprise.id]: warehouseCapabilities,
  };

  async function seedCustomerData(
    customerId: string,
    pkgIds: string | string[],
    opts: {
      interactionCount: number;
      competitorMention: boolean;
      usageTrend: "growing" | "flat" | "declining";
      eventCount: number;
      npsScore: number;
      desiredOutcomePct?: number | null; // % of target achieved; null/undefined = not tracked for this account
      hasChampion?: boolean;
      championDaysAgo?: number | null; // null = champion exists but never engaged
      trainingSessionCount?: number;
    }
  ) {
    const ids = Array.isArray(pkgIds) ? pkgIds : [pkgIds];
    const entitled = ids.flatMap((id) => packageCapabilities[id]);

    // Usage history: 6 months, one snapshot per capability per month
    for (const cap of entitled) {
      let base = randInt(40, 200);
      for (let m = 5; m >= 0; m--) {
        if (opts.usageTrend === "growing") base *= 1.12;
        if (opts.usageTrend === "declining") base *= 0.85;
        await prisma.usageSnapshot.create({
          data: {
            customerId,
            capabilityId: cap.id,
            occurredAt: daysAgo(m * 30),
            value: Math.max(1, Math.round(base)),
          },
        });
      }
    }

    // Interactions
    const genericTickets = [
      "Question about exporting a shipment manifest to CSV.",
      "User couldn't reset their password, resolved via support link.",
      "Requested clarification on customs documentation requirements for EU shipments.",
      "Reported a minor display bug on the driver app's map view.",
      "Asked about adding two more seats to their plan.",
    ];
    const unhappyTickets = [
      "Escalated: repeated sync failures between billing and freight tracking, third time this month.",
      "Customer frustrated with slow load times on the route optimization screen during peak hours.",
      "Complaint about a missed SLA on a support ticket raised two weeks ago.",
    ];
    const competitorTickets = [
      "Customer asked whether we support real-time carrier rate shopping the way RouteWorks does.",
      "Mentioned in passing that their ops director has been demoing CargoPilot for the driver app workflow.",
      "Asked if we have a feature comparable to RouteWorks' predictive ETA model.",
    ];

    for (let i = 0; i < opts.interactionCount; i++) {
      let text = pick(genericTickets);
      let severity = "low";
      if (opts.competitorMention && i === 0) {
        text = pick(competitorTickets);
        severity = "medium";
      } else if (opts.usageTrend === "declining" && i < 2) {
        text = pick(unhappyTickets);
        severity = pick(["medium", "high"]);
      }
      await prisma.interaction.create({
        data: {
          customerId,
          type: pick(["ticket", "call", "email"]),
          text,
          severity,
          occurredAt: daysAgo(randInt(0, 150)),
        },
      });
    }

    // Survey responses
    await prisma.surveyResponse.create({
      data: {
        customerId,
        type: "nps",
        score: opts.npsScore,
        occurredAt: daysAgo(randInt(10, 90)),
      },
    });

    // Event attendance
    for (let i = 0; i < opts.eventCount; i++) {
      await prisma.eventAttendance.create({
        data: {
          customerId,
          eventName: pick([
            "Quarterly product webinar",
            "Freight ops roundtable",
            "Meridian user conference",
          ]),
          occurredAt: daysAgo(randInt(5, 180)),
        },
      });
    }

    // Desired Outcome - one tracked business result, target vs. actual
    if (opts.desiredOutcomePct != null) {
      await prisma.desiredOutcome.create({
        data: {
          customerId,
          name: pick(["Reduce manual dispatch hours", "Cut carrier-rate lookup time", "Automate customs paperwork"]),
          targetValue: 100,
          actualValue: opts.desiredOutcomePct,
          unit: "% of target",
        },
      });
    }

    // Stakeholders - a non-champion contact plus, sometimes, a champion
    await prisma.stakeholder.create({
      data: { customerId, name: pick(["Sam Okoye", "Priya Nair", "Tom Whitfield"]), role: "Ops Coordinator", isChampion: false },
    });
    if (opts.hasChampion) {
      await prisma.stakeholder.create({
        data: {
          customerId,
          name: pick(["Alex Reyes", "Jordan Blake", "Morgan Ellis"]),
          role: "Ops Director",
          isChampion: true,
          lastEngagedAt: opts.championDaysAgo != null ? daysAgo(opts.championDaysAgo) : null,
        },
      });
    }

    // Training completions
    for (let i = 0; i < (opts.trainingSessionCount ?? 0); i++) {
      await prisma.trainingCompletion.create({
        data: {
          customerId,
          courseName: pick(["Platform onboarding", "Advanced route optimization", "Admin & reporting"]),
          attendeeCount: randInt(1, 5),
          occurredAt: daysAgo(randInt(10, 300)),
        },
      });
    }
  }

  console.log("Creating handcrafted customers...");

  // 1. Clearly at-risk: declining usage, competitor mention, near renewal, low breadth
  const northwind = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      name: "Northwind Traders",
      country: "United Kingdom",
      region: "South East",
      city: "London",
      industry: "Logistics",
      subIndustry: "Freight forwarding",
      tier: "mid_market",
      renewalType: "interrupted",
      interruptedReason: "customer_requested",
    },
  });
  await prisma.customerProduct.create({
    data: {
      customerId: northwind.id,
      productId: product.id,
      packageId: starter.id,
      contractualArr: 42000,
      consumptionArr: 3000,
      lifecycleStatus: "live",
      initialGoLiveDate: daysAgo(400),
      expectedGoLiveDate: daysAgo(400),
      actualGoLiveDate: daysAgo(395),
      paymentStatus: "late",
      daysPastDue: 45,
    },
  });
  await seedCustomerData(northwind.id, starter.id, {
    interactionCount: 9,
    competitorMention: true,
    usageTrend: "declining",
    eventCount: 0,
    npsScore: 3,
    desiredOutcomePct: 35,
    hasChampion: true,
    championDaysAgo: 210,
    trainingSessionCount: 0,
  });

  // 2. Thriving: growing consumption, high breadth, happy
  const fenwick = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      name: "Fenwick Logistics",
      country: "United Kingdom",
      region: "South East",
      city: "London",
      industry: "Logistics",
      subIndustry: "Freight forwarding",
      tier: "enterprise",
      renewalType: "auto",
    },
  });
  await prisma.customerProduct.create({
    data: {
      customerId: fenwick.id,
      productId: product.id,
      packageId: enterprise.id,
      contractualArr: 140000,
      consumptionArr: 44000,
      lifecycleStatus: "live",
      initialGoLiveDate: daysAgo(700),
      expectedGoLiveDate: daysAgo(700),
      actualGoLiveDate: daysAgo(690),
    },
  });
  // Multi-product: a thriving account that has expanded into a second product.
  await prisma.customerProduct.create({
    data: {
      customerId: fenwick.id,
      productId: warehouseProduct.id,
      packageId: warehousePro.id,
      contractualArr: 52000,
      consumptionArr: 9000,
      lifecycleStatus: "live",
      initialGoLiveDate: daysAgo(220),
      expectedGoLiveDate: daysAgo(220),
      actualGoLiveDate: daysAgo(210),
    },
  });
  await seedCustomerData(fenwick.id, [enterprise.id, warehousePro.id], {
    interactionCount: 4,
    competitorMention: false,
    usageTrend: "growing",
    eventCount: 3,
    npsScore: 9,
    desiredOutcomePct: 130,
    hasChampion: true,
    championDaysAgo: 5,
    trainingSessionCount: 3,
  });

  // 3. Onboarding, slightly behind pace
  const harlow = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      name: "Harlow & Co",
      country: "United Kingdom",
      region: "North West",
      city: "Manchester",
      industry: "Retail",
      subIndustry: "E-commerce fulfilment",
      tier: "self_serve",
      renewalType: "auto",
    },
  });
  await prisma.customerProduct.create({
    data: {
      customerId: harlow.id,
      productId: product.id,
      packageId: starter.id,
      contractualArr: 8000,
      consumptionArr: 0,
      lifecycleStatus: "onboarding",
      initialGoLiveDate: daysAgo(30),
      expectedGoLiveDate: daysAgo(21),
      actualGoLiveDate: null,
    },
  });
  await seedCustomerData(harlow.id, starter.id, {
    interactionCount: 2,
    competitorMention: false,
    usageTrend: "flat",
    eventCount: 0,
    npsScore: 7,
    // No Desired Outcome tracked yet - too early in onboarding for a real reading.
    hasChampion: false,
    trainingSessionCount: 1,
  });

  // 4. Engagement silence: no tickets, no events, flat usage, looks fine on paper
  const silent = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      name: "Silent Freight Ltd",
      country: "Germany",
      region: "Bavaria",
      city: "Munich",
      industry: "Logistics",
      subIndustry: "Freight forwarding",
      tier: "mid_market",
      renewalType: "auto",
    },
  });
  await prisma.customerProduct.create({
    data: {
      customerId: silent.id,
      productId: product.id,
      packageId: pro.id,
      contractualArr: 38000,
      consumptionArr: 6000,
      lifecycleStatus: "live",
      initialGoLiveDate: daysAgo(500),
      expectedGoLiveDate: daysAgo(500),
      actualGoLiveDate: daysAgo(495),
    },
  });
  await seedCustomerData(silent.id, pro.id, {
    interactionCount: 0,
    competitorMention: false,
    usageTrend: "flat",
    eventCount: 0,
    npsScore: 6,
    desiredOutcomePct: 60,
    hasChampion: true,
    championDaysAgo: null, // champion identified, never actually engaged - same "silent" story as the other channels
    trainingSessionCount: 0,
  });

  console.log("Creating randomized peer-cohort customers...");
  for (const name of RANDOM_NAMES) {
    const [industry, subIndustry] = pick(INDUSTRIES);
    const [country, region, city] = pick(REGIONS);
    const tier = pick(["self_serve", "mid_market", "enterprise"]);
    const pkg = tier === "enterprise" ? enterprise : tier === "mid_market" ? pro : starter;
    const lifecycle = pick(["live", "live", "live", "onboarding"]);

    const c = await prisma.customer.create({
      data: {
        workspaceId: workspace.id,
        name,
        country,
        region,
        city,
        industry,
        subIndustry,
        tier,
        renewalType: pick(["auto", "auto", "auto", "interrupted"]),
        interruptedReason: null,
      },
    });

    const paymentRoll = lifecycle === "live" ? Math.random() : 1;
    const paymentStatus = paymentRoll < 0.04 ? "failed" : paymentRoll < 0.18 ? "late" : "current";
    const daysPastDue = paymentStatus === "failed" ? randInt(30, 90) : paymentStatus === "late" ? randInt(5, 60) : 0;

    await prisma.customerProduct.create({
      data: {
        customerId: c.id,
        productId: product.id,
        packageId: pkg.id,
        contractualArr: randInt(8, 120) * 1000,
        consumptionArr: randInt(0, 30) * 1000,
        lifecycleStatus: lifecycle,
        initialGoLiveDate: daysAgo(randInt(60, 700)),
        expectedGoLiveDate: daysAgo(randInt(60, 700)),
        actualGoLiveDate: lifecycle === "live" ? daysAgo(randInt(50, 690)) : null,
        paymentStatus,
        daysPastDue,
      },
    });
    const pkgIds = [pkg.id];

    // ~30% of live accounts have also expanded into the second product.
    if (lifecycle === "live" && Math.random() < 0.3) {
      const warehousePkg = tier === "enterprise" ? warehouseEnterprise : tier === "mid_market" ? warehousePro : warehouseStarter;
      await prisma.customerProduct.create({
        data: {
          customerId: c.id,
          productId: warehouseProduct.id,
          packageId: warehousePkg.id,
          contractualArr: randInt(5, 60) * 1000,
          consumptionArr: randInt(0, 15) * 1000,
          lifecycleStatus: "live",
          initialGoLiveDate: daysAgo(randInt(30, 400)),
          expectedGoLiveDate: daysAgo(randInt(30, 400)),
          actualGoLiveDate: daysAgo(randInt(20, 390)),
        },
      });
      pkgIds.push(warehousePkg.id);
    }

    const hasChampion = Math.random() < 0.55;

    await seedCustomerData(c.id, pkgIds, {
      interactionCount: randInt(0, 8),
      competitorMention: Math.random() < 0.15,
      usageTrend: pick(["growing", "flat", "flat", "declining"]),
      eventCount: randInt(0, 3),
      npsScore: randInt(2, 10),
      desiredOutcomePct: Math.random() < 0.65 ? randInt(25, 145) : null,
      hasChampion,
      championDaysAgo: hasChampion && Math.random() < 0.75 ? randInt(1, 150) : null,
      trainingSessionCount: randInt(0, 3),
    });
  }

  console.log("Creating outcome events (for the calibration loop)...");
  await prisma.outcomeEvent.createMany({
    data: [
      {
        customerId: northwind.id,
        type: "churned",
        occurredAt: daysAgo(5),
        notes: "Did not renew - cited unresolved billing-sync issue and a competitor evaluation.",
      },
      {
        customerId: fenwick.id,
        type: "expanded",
        occurredAt: daysAgo(10),
        notes: "Added seats and upgraded consumption tier following a strong QBR.",
      },
      {
        customerId: harlow.id,
        type: "renewed",
        occurredAt: daysAgo(15),
        notes: "Renewed on schedule despite the early onboarding delay.",
      },
      {
        customerId: silent.id,
        type: "renewed",
        occurredAt: daysAgo(20),
        notes: "Renewed with no CSM intervention - stayed quiet throughout the term.",
      },
    ],
  });

  console.log("Done seeding.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
