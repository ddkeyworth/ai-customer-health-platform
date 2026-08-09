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
  await prisma.healthScoreSnapshot.deleteMany();
  await prisma.usageSnapshot.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.surveyResponse.deleteMany();
  await prisma.eventAttendance.deleteMany();
  await prisma.customerProduct.deleteMany();
  await prisma.customer.deleteMany();
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

  console.log("Creating product and capabilities...");
  const product = await prisma.product.create({
    data: { name: "Meridian Freight" },
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
  const [tracking, routing, driverApp, customsDocs, payments] = capabilities;

  const starter = await prisma.package.create({
    data: { productId: product.id, name: "Starter" },
  });
  const pro = await prisma.package.create({
    data: { productId: product.id, name: "Pro" },
  });
  const enterprise = await prisma.package.create({
    data: { productId: product.id, name: "Enterprise" },
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
  };

  async function seedCustomerData(
    customerId: string,
    pkgId: string,
    opts: {
      interactionCount: number;
      competitorMention: boolean;
      usageTrend: "growing" | "flat" | "declining";
      eventCount: number;
      npsScore: number;
    }
  ) {
    const entitled = packageCapabilities[pkgId];

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
    },
  });
  await seedCustomerData(northwind.id, starter.id, {
    interactionCount: 9,
    competitorMention: true,
    usageTrend: "declining",
    eventCount: 0,
    npsScore: 3,
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
  await seedCustomerData(fenwick.id, enterprise.id, {
    interactionCount: 4,
    competitorMention: false,
    usageTrend: "growing",
    eventCount: 3,
    npsScore: 9,
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
      },
    });

    await seedCustomerData(c.id, pkg.id, {
      interactionCount: randInt(0, 8),
      competitorMention: Math.random() < 0.15,
      usageTrend: pick(["growing", "flat", "flat", "declining"]),
      eventCount: randInt(0, 3),
      npsScore: randInt(2, 10),
    });
  }

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
