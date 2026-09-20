// Synthetic data generator. Everything here is fictional - no real company,
// person, or dataset. See README.md "Governing principle" for why this
// matters: the whole point is a safe, zero-risk demo dataset, not a
// shortcut. Re-runnable: clears its own data first, doesn't touch anything
// else. Timestamps are relative to the moment the script runs, so renewal
// dates and go-live dates are always spread around "today" rather than
// drifting stale; re-run it to refresh them.
//
// Shape of the data (120 customers):
//   - 4 handcrafted accounts, each built to exercise one specific behaviour
//     (at-risk, thriving, late onboarding, engagement silence).
//   - 116 generated accounts from six profiles: thriving, stable, watch,
//     critical, churned, onboarding. A profile drives the account's signals
//     (usage trend, NPS, tickets, champion, payment) AND its outcome history,
//     so accounts that look unhealthy are more likely to have churned and
//     healthy ones to have renewed repeatedly. The correlation is deliberate
//     (it is what gives Calibration and Renewal's churn model something to
//     learn from) and it is synthetic, not evidence of anything real.
//   - Outcome history follows tenure: an account live for 4 years has up to 4
//     renewal events, one live for 8 months has none. Some accounts also
//     have expansions, and churned accounts have a churn event.
//   - Renewal dates fall on each account's contract anniversary, so they
//     spread across the next 12 months, with a few overdue and a few on
//     two-year terms.

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(p: number): boolean {
  return Math.random() < p;
}

function weighted<T>(pairs: [T, number][]): T {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let roll = Math.random() * total;
  for (const [value, w] of pairs) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TOTAL_CUSTOMERS = 120;

const INDUSTRIES = [
  ["Logistics", "Freight forwarding"],
  ["Retail", "E-commerce fulfilment"],
  ["Manufacturing", "Industrial components"],
  ["Food & Beverage", "Cold chain distribution"],
  ["Construction", "Materials supply"],
  ["Healthcare", "Medical supplies"],
  ["Automotive", "Parts distribution"],
];

const REGIONS = [
  ["United Kingdom", "South East", "London"],
  ["United Kingdom", "North West", "Manchester"],
  ["United Kingdom", "West Midlands", "Birmingham"],
  ["United States", "Northeast", "New York"],
  ["United States", "Midwest", "Chicago"],
  ["United States", "South", "Atlanta"],
  ["Germany", "Bavaria", "Munich"],
  ["Netherlands", "South Holland", "Rotterdam"],
  ["Ireland", "Leinster", "Dublin"],
  ["Canada", "Ontario", "Toronto"],
];

// The original 15 names are kept so the seed stays recognisable across
// re-runs; the generator below adds the rest.
const ORIGINAL_NAMES = [
  "Ashgrove Freight", "Copperfield Logistics", "Denholm Supply Co",
  "Ellery Distribution", "Foxglove Transport", "Greymoor Industrial",
  "Halcyon Cargo", "Ironbridge Materials", "Juniper Fulfilment",
  "Kestrel Freight", "Larchmont Supply", "Mossbank Logistics",
  "Nettlewood Transport", "Osprey Distribution", "Pinehaven Cargo",
];

const HANDCRAFTED_NAMES = ["Northwind Traders", "Fenwick Logistics", "Harlow & Co", "Silent Freight Ltd"];

const NAME_PREFIXES = [
  "Alderley", "Bramwell", "Calloway", "Dunmore", "Everley", "Fairhaven", "Glenbrook", "Hartwell",
  "Isleworth", "Jarrow", "Kingsmead", "Lyndhurst", "Marlow", "Northgate", "Oakhurst", "Prestwick",
  "Queensway", "Ravensworth", "Stanmore", "Thornbury", "Upton", "Vantage", "Wexcombe", "Yardley",
  "Zetland", "Aldwych", "Broadmoor", "Cranleigh", "Dovedale", "Elmstead", "Fernbank", "Gladstone",
  "Hollins", "Ingleby", "Jesmond", "Kelbrook", "Lowther", "Moorcroft", "Newbold", "Otterburn",
];

const NAME_SUFFIXES = [
  "Freight", "Logistics", "Supply Co", "Distribution", "Transport", "Cargo",
  "Industrial", "Materials", "Fulfilment", "Haulage", "Warehousing", "Trading",
];

function generateNames(count: number, taken: Set<string>): string[] {
  const combos: string[] = [];
  for (const p of NAME_PREFIXES) for (const s of NAME_SUFFIXES) combos.push(`${p} ${s}`);
  const available = shuffle(combos.filter((n) => !taken.has(n)));
  if (available.length < count) throw new Error("Not enough unique generated names.");
  return available.slice(0, count);
}

const DEMO_WORKSPACE_NAME = "Meridian Ops";

type Archetype = "thriving" | "stable" | "watch" | "critical" | "churned" | "onboarding";
type Trend = "growing" | "flat" | "declining";

interface Profile {
  tenure: [number, number]; // days since go-live
  usage: Trend[]; // one is picked uniformly
  nps: [number, number];
  interactions: [number, number];
  competitor: number; // probability of a competitor mention
  desiredTracked: number; // probability a Desired Outcome is tracked
  desired: [number, number]; // % of target achieved
  champion: number; // probability of an identified champion
  championDays: [number, number]; // days since the champion was last engaged
  championNeverEngaged: number; // probability an identified champion was never engaged
  events: [number, number];
  training: [number, number];
  late: number; // probability of a late payment
  failed: number; // probability of a failed payment
  interrupted: number; // probability of an interrupted renewal
  expandedChance: number; // per renewal, probability of an expansion too
}

const PROFILES: Record<Exclude<Archetype, "onboarding">, Profile> = {
  thriving: {
    tenure: [500, 1800], usage: ["growing", "growing", "growing", "flat"], nps: [8, 10], interactions: [0, 4],
    competitor: 0.02, desiredTracked: 0.85, desired: [100, 150], champion: 0.9, championDays: [1, 30], championNeverEngaged: 0,
    events: [2, 3], training: [2, 3], late: 0, failed: 0, interrupted: 0.02, expandedChance: 0.5,
  },
  stable: {
    tenure: [200, 1400], usage: ["flat", "flat", "growing", "declining"], nps: [6, 9], interactions: [1, 5],
    competitor: 0.08, desiredTracked: 0.7, desired: [70, 110], champion: 0.65, championDays: [1, 90], championNeverEngaged: 0.05,
    events: [0, 2], training: [1, 2], late: 0.08, failed: 0.01, interrupted: 0.05, expandedChance: 0.2,
  },
  watch: {
    tenure: [150, 900], usage: ["flat", "declining", "declining"], nps: [4, 7], interactions: [3, 7],
    competitor: 0.2, desiredTracked: 0.6, desired: [40, 90], champion: 0.45, championDays: [60, 200], championNeverEngaged: 0.2,
    events: [0, 1], training: [0, 1], late: 0.25, failed: 0.03, interrupted: 0.25, expandedChance: 0.08,
  },
  critical: {
    tenure: [100, 700], usage: ["declining", "declining", "declining", "flat"], nps: [1, 5], interactions: [4, 9],
    competitor: 0.45, desiredTracked: 0.55, desired: [10, 55], champion: 0.35, championDays: [120, 300], championNeverEngaged: 0.35,
    events: [0, 0], training: [0, 0], late: 0.35, failed: 0.12, interrupted: 0.55, expandedChance: 0,
  },
  churned: {
    tenure: [300, 1100], usage: ["declining", "declining", "flat"], nps: [1, 5], interactions: [3, 9],
    competitor: 0.5, desiredTracked: 0.5, desired: [10, 50], champion: 0.3, championDays: [150, 350], championNeverEngaged: 0.4,
    events: [0, 0], training: [0, 1], late: 0.3, failed: 0.15, interrupted: 0.6, expandedChance: 0.05,
  },
};

const RENEWED_NOTES = [
  "Renewed for another term on schedule.",
  "Renewed after a CSM-led review of usage.",
  "Renewed with no CSM intervention.",
  "Renewed after a price conversation, no change to package.",
];
const EXPANDED_NOTES = [
  "Added seats and moved up a package.",
  "Added the second product alongside the first.",
  "Increased consumption tier following a strong quarterly review.",
];
const CHURNED_NOTES = [
  "Did not renew: budget cuts on the customer side.",
  "Did not renew: moved to a competitor after an evaluation.",
  "Did not renew: the sponsoring champion left the business.",
  "Did not renew: unresolved billing-sync issue.",
];

async function main() {
  console.log("Clearing existing demo data (the flagged demo workspace only - real signups are never touched)...");
  // Real auth now means real signups create their own workspaces - an
  // unscoped deleteMany() here would silently wipe every workspace on every
  // reseed, not just the demo one. Scoped by the isDemoSeed flag, not by
  // name - workspace names aren't unique, so a real signup happening to be
  // named "Meridian Ops" (coincidentally or deliberately) would otherwise
  // either get destroyed by a reseed, or worse, get treated as the demo
  // workspace and have its real data mixed into what this script manages.
  const existingDemo = await prisma.workspace.findFirst({ where: { isDemoSeed: true } });
  // The demo workspace's own configured Anthropic key and Adoption threshold
  // are settings, not seed data: carry them across the wipe so a reseed
  // never silently disconnects the AI layers.
  const preserved = existingDemo
    ? {
        anthropicApiKeyEncrypted: existingDemo.anthropicApiKeyEncrypted,
        anthropicApiKeyLast4: existingDemo.anthropicApiKeyLast4,
        adoptionUnderusedThresholdPct: existingDemo.adoptionUnderusedThresholdPct,
      }
    : {};

  if (existingDemo) {
    const wsId = existingDemo.id;
    const customerIds = (await prisma.customer.findMany({ where: { workspaceId: wsId }, select: { id: true } })).map(
      (c) => c.id
    );
    const productIds = (await prisma.product.findMany({ where: { workspaceId: wsId }, select: { id: true } })).map(
      (p) => p.id
    );
    const userIds = (await prisma.user.findMany({ where: { workspaceId: wsId }, select: { id: true } })).map(
      (u) => u.id
    );

    await prisma.agentAction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.healthScoreSnapshot.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.usageSnapshot.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.interaction.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.surveyResponse.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.eventAttendance.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.opportunity.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.desiredOutcome.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.stakeholder.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.trainingCompletion.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.outcomeEvent.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerProduct.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { workspaceId: wsId } });
    await prisma.segment.deleteMany({ where: { workspaceId: wsId } });
    await prisma.bookSummary.deleteMany({ where: { workspaceId: wsId } });
    await prisma.competitorConfig.deleteMany({ where: { workspaceId: wsId } });
    await prisma.capabilityRunConfig.deleteMany({ where: { workspaceId: wsId } });
    await prisma.package.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.capability.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { workspaceId: wsId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { workspaceId: wsId } });
    await prisma.workspace.delete({ where: { id: wsId } });
  }

  console.log("Creating workspace...");
  const workspace = await prisma.workspace.create({
    data: {
      name: DEMO_WORKSPACE_NAME,
      currency: "GBP",
      pricingTier: "growth",
      seatsIncluded: 20,
      dataVolumeIncluded: 100000,
      isDemoSeed: true,
      ...preserved,
    },
  });

  // Demo login for reviewers - a real bcrypt hash of a plainly-documented,
  // non-secret password (see README.md). Fine to publish: this account only
  // ever holds synthetic data on a free-tier, spend-capped local database.
  const demoPasswordHash = await hashPassword("demo-password-123");
  await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      name: "Priya Chandra",
      email: "priya.chandra@meridian-ops.example",
      passwordHash: demoPasswordHash,
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
    ["Route optimisation", "adoption"],
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
    ["Slotting optimisation", "consumption"],
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

  // Short, readable customer IDs (CUS-0001 ...) shown throughout the app.
  let refCounter = 0;
  function nextRef(): string {
    refCounter++;
    return `CUS-${String(refCounter).padStart(4, "0")}`;
  }

  const outcomeRows: { customerId: string; type: string; occurredAt: Date; notes: string }[] = [];

  async function seedCustomerData(
    customerId: string,
    pkgIds: string | string[],
    opts: {
      interactionCount: number;
      competitorMention: boolean;
      usageTrend: Trend;
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
    const usageRows: { customerId: string; capabilityId: string; occurredAt: Date; value: number }[] = [];
    for (const cap of entitled) {
      let base = randInt(40, 200);
      for (let m = 5; m >= 0; m--) {
        if (opts.usageTrend === "growing") base *= 1.12;
        if (opts.usageTrend === "declining") base *= 0.85;
        usageRows.push({
          customerId,
          capabilityId: cap.id,
          occurredAt: daysAgo(m * 30),
          value: Math.max(1, Math.round(base)),
        });
      }
    }
    await prisma.usageSnapshot.createMany({ data: usageRows });

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
      "Customer frustrated with slow load times on the route optimisation screen during peak hours.",
      "Complaint about a missed SLA on a support ticket raised two weeks ago.",
    ];
    const competitorTickets = [
      "Customer asked whether we support real-time carrier rate shopping the way RouteWorks does.",
      "Mentioned in passing that their ops director has been demoing CargoPilot for the driver app workflow.",
      "Asked if we have a feature comparable to RouteWorks' predictive ETA model.",
    ];

    const interactionRows: { customerId: string; type: string; text: string; severity: string; occurredAt: Date }[] = [];
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
      interactionRows.push({
        customerId,
        type: pick(["ticket", "call", "email"]),
        text,
        severity,
        occurredAt: daysAgo(randInt(0, 150)),
      });
    }
    if (interactionRows.length > 0) await prisma.interaction.createMany({ data: interactionRows });

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
    const eventRows = [];
    for (let i = 0; i < opts.eventCount; i++) {
      eventRows.push({
        customerId,
        eventName: pick(["Quarterly product webinar", "Freight ops roundtable", "Meridian user conference"]),
        occurredAt: daysAgo(randInt(5, 180)),
      });
    }
    if (eventRows.length > 0) await prisma.eventAttendance.createMany({ data: eventRows });

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
    const trainingRows = [];
    for (let i = 0; i < (opts.trainingSessionCount ?? 0); i++) {
      trainingRows.push({
        customerId,
        courseName: pick(["Platform onboarding", "Advanced route optimisation", "Admin & reporting"]),
        attendeeCount: randInt(1, 5),
        occurredAt: daysAgo(randInt(10, 300)),
      });
    }
    if (trainingRows.length > 0) await prisma.trainingCompletion.createMany({ data: trainingRows });
  }

  console.log("Creating handcrafted customers...");

  // 1. Clearly at-risk: declining usage, competitor mention, near renewal, low breadth
  const northwind = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      ref: nextRef(),
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
      renewalDate: daysFromNow(40),
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
      ref: nextRef(),
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
      renewalDate: daysFromNow(210),
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
      renewalDate: daysFromNow(75),
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
      ref: nextRef(),
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
      ref: nextRef(),
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
      renewalDate: daysFromNow(130),
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

  // Handcrafted outcome history (kept as it was: each one exercises a
  // Calibration classification).
  outcomeRows.push(
    { customerId: northwind.id, type: "churned", occurredAt: daysAgo(5), notes: "Did not renew: cited an unresolved billing-sync issue and a competitor evaluation." },
    { customerId: fenwick.id, type: "expanded", occurredAt: daysAgo(10), notes: "Added seats and upgraded consumption tier following a strong QBR." },
    { customerId: harlow.id, type: "renewed", occurredAt: daysAgo(15), notes: "Renewed on schedule despite the early onboarding delay." },
    { customerId: silent.id, type: "renewed", occurredAt: daysAgo(20), notes: "Renewed with no CSM intervention: stayed quiet throughout the term." }
  );

  // The next renewal falls on the account's contract anniversary, so dates
  // spread across the coming 12 months. A few are overdue (still open past
  // the date) and a few are on two-year terms.
  function nextRenewalDays(tenureDays: number): number {
    const completed = Math.floor(tenureDays / 365);
    let d = 365 * (completed + 1) - tenureDays;
    const roll = Math.random();
    if (roll < 0.08) d = -randInt(1, 60);
    else if (roll < 0.23) d += 365;
    return d;
  }

  console.log("Creating generated customers...");
  const generatedNames = shuffle([
    ...ORIGINAL_NAMES,
    ...generateNames(TOTAL_CUSTOMERS - HANDCRAFTED_NAMES.length - ORIGINAL_NAMES.length, new Set([...HANDCRAFTED_NAMES, ...ORIGINAL_NAMES])),
  ]);
  const generatedCount = generatedNames.length;

  const plan: Archetype[] = [
    ...Array(8).fill("onboarding"),
    ...Array(12).fill("churned"),
    ...Array(20).fill("thriving"),
    ...Array(36).fill("stable"),
    ...Array(26).fill("watch"),
  ];
  while (plan.length < generatedCount) plan.push("critical");
  const archetypes = shuffle(plan).slice(0, generatedCount);

  const tally: Record<string, number> = {};

  for (let idx = 0; idx < generatedCount; idx++) {
    const name = generatedNames[idx];
    const archetype = archetypes[idx];
    tally[archetype] = (tally[archetype] ?? 0) + 1;

    const [industry, subIndustry] = pick(INDUSTRIES);
    const [country, region, city] = pick(REGIONS);
    const tier = archetype === "thriving"
      ? weighted<string>([["enterprise", 0.4], ["mid_market", 0.4], ["self_serve", 0.2]])
      : weighted<string>([["enterprise", 0.22], ["mid_market", 0.45], ["self_serve", 0.33]]);
    const pkg = tier === "enterprise" ? enterprise : tier === "mid_market" ? pro : starter;
    const warehousePkg = tier === "enterprise" ? warehouseEnterprise : tier === "mid_market" ? warehousePro : warehouseStarter;

    const profile = archetype === "onboarding" ? PROFILES.stable : PROFILES[archetype];
    const interrupted = archetype !== "onboarding" && chance(profile.interrupted);

    const customer = await prisma.customer.create({
      data: {
        workspaceId: workspace.id,
        ref: nextRef(),
        name,
        country,
        region,
        city,
        industry,
        subIndustry,
        tier,
        renewalType: interrupted ? "interrupted" : "auto",
        interruptedReason: interrupted ? pick(["customer_requested", "contract_defined", "company_defined"]) : null,
      },
    });

    const contractualArr =
      tier === "enterprise" ? randInt(90, 260) * 1000 : tier === "mid_market" ? randInt(25, 90) * 1000 : randInt(6, 25) * 1000;
    const consumptionArr =
      tier === "enterprise" ? randInt(5, 50) * 1000 : tier === "mid_market" ? randInt(0, 25) * 1000 : randInt(0, 8) * 1000;

    const paymentRoll = archetype === "onboarding" ? 1 : Math.random();
    const paymentStatus = paymentRoll < profile.failed ? "failed" : paymentRoll < profile.failed + profile.late ? "late" : "current";
    const daysPastDue = paymentStatus === "failed" ? randInt(30, 90) : paymentStatus === "late" ? randInt(5, 60) : 0;

    const pkgIds = [pkg.id];

    if (archetype === "onboarding") {
      const overdue = chance(0.5);
      const expected = overdue ? daysAgo(randInt(3, 60)) : daysFromNow(randInt(5, 90));
      const initial = new Date(expected.getTime() - randInt(0, 45) * 86_400_000);
      await prisma.customerProduct.create({
        data: {
          customerId: customer.id,
          productId: product.id,
          packageId: pkg.id,
          contractualArr,
          consumptionArr: 0,
          lifecycleStatus: "onboarding",
          initialGoLiveDate: initial,
          expectedGoLiveDate: expected,
          actualGoLiveDate: null,
        },
      });
      await seedCustomerData(customer.id, pkgIds, {
        interactionCount: randInt(0, 3),
        competitorMention: false,
        usageTrend: "flat",
        eventCount: randInt(0, 1),
        npsScore: randInt(6, 9),
        desiredOutcomePct: null,
        hasChampion: chance(0.4),
        championDaysAgo: randInt(1, 30),
        trainingSessionCount: randInt(0, 2),
      });
      continue;
    }

    const tenure = randInt(profile.tenure[0], profile.tenure[1]);
    const churnAgo = archetype === "churned" ? randInt(15, Math.min(380, tenure - 60)) : 0;
    const lifecycle = archetype === "churned" ? "churned" : "live";

    await prisma.customerProduct.create({
      data: {
        customerId: customer.id,
        productId: product.id,
        packageId: pkg.id,
        contractualArr,
        consumptionArr,
        lifecycleStatus: lifecycle,
        initialGoLiveDate: daysAgo(tenure + randInt(0, 20)),
        expectedGoLiveDate: daysAgo(tenure + randInt(0, 20)),
        actualGoLiveDate: daysAgo(tenure),
        renewalDate: lifecycle === "live" ? daysFromNow(nextRenewalDays(tenure)) : null,
        paymentStatus,
        daysPastDue,
      },
    });

    // Around 30% of live accounts have also taken the second product.
    if (lifecycle === "live" && chance(0.3)) {
      const secondTenure = randInt(60, Math.max(61, tenure - 30));
      await prisma.customerProduct.create({
        data: {
          customerId: customer.id,
          productId: warehouseProduct.id,
          packageId: warehousePkg.id,
          contractualArr: randInt(5, 60) * 1000,
          consumptionArr: randInt(0, 15) * 1000,
          lifecycleStatus: "live",
          initialGoLiveDate: daysAgo(secondTenure + randInt(0, 15)),
          expectedGoLiveDate: daysAgo(secondTenure + randInt(0, 15)),
          actualGoLiveDate: daysAgo(secondTenure),
          renewalDate: daysFromNow(nextRenewalDays(secondTenure)),
        },
      });
      pkgIds.push(warehousePkg.id);
    }

    const hasChampion = chance(profile.champion);
    await seedCustomerData(customer.id, pkgIds, {
      interactionCount: randInt(profile.interactions[0], profile.interactions[1]),
      competitorMention: chance(profile.competitor),
      usageTrend: pick(profile.usage),
      eventCount: randInt(profile.events[0], profile.events[1]),
      npsScore: randInt(profile.nps[0], profile.nps[1]),
      desiredOutcomePct: chance(profile.desiredTracked) ? randInt(profile.desired[0], profile.desired[1]) : null,
      hasChampion,
      championDaysAgo: hasChampion && !chance(profile.championNeverEngaged) ? randInt(profile.championDays[0], profile.championDays[1]) : null,
      trainingSessionCount: randInt(profile.training[0], profile.training[1]),
    });

    // Outcome history follows tenure: one renewal per completed year (capped
    // at 5), an expansion alongside some of them, and a churn event for
    // churned accounts. A young account has none.
    const activeDays = archetype === "churned" ? tenure - churnAgo : tenure;
    const renewals = Math.min(5, Math.floor(activeDays / 365));
    for (let k = 1; k <= renewals; k++) {
      const when = tenure - 365 * k;
      outcomeRows.push({ customerId: customer.id, type: "renewed", occurredAt: daysAgo(when), notes: pick(RENEWED_NOTES) });
      if (chance(profile.expandedChance)) {
        outcomeRows.push({ customerId: customer.id, type: "expanded", occurredAt: daysAgo(when + randInt(5, 40)), notes: pick(EXPANDED_NOTES) });
      }
    }
    if (archetype === "churned") {
      outcomeRows.push({ customerId: customer.id, type: "churned", occurredAt: daysAgo(churnAgo), notes: pick(CHURNED_NOTES) });
    }
  }

  console.log("Creating outcome events (for the calibration loop and Renewal's churn model)...");
  await prisma.outcomeEvent.createMany({ data: outcomeRows });

  const counts = {
    customers: await prisma.customer.count({ where: { workspaceId: workspace.id } }),
    customerProducts: await prisma.customerProduct.count({ where: { customer: { workspaceId: workspace.id } } }),
    outcomes: outcomeRows.length,
    withNoOutcomes: await prisma.customer.count({ where: { workspaceId: workspace.id, outcomeEvents: { none: {} } } }),
  };
  console.log("Generated profile mix:", tally);
  console.log("Totals:", counts);
  console.log("Done seeding. Next: compute Health scores, generate opportunities, then run the other capabilities (Settings > Automation).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
