// Layer 1: deterministic, reproducible baseline. No AI involved here -
// see README.md "Health scoring" section for the two-layer design this
// is half of. Every driver is normalized 0-100 (higher is healthier)
// from real seeded data; drivers with no underlying data source return
// null rather than a fabricated default.

import { PrismaClient } from "@prisma/client";
import { DriverKey, DriverResult, DRIVER_LABELS } from "./drivers";

const prisma = new PrismaClient();

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function result(key: DriverKey, score: number | null, detail: string): DriverResult {
  return { key, label: DRIVER_LABELS[key], score: score === null ? null : clamp(score), detail };
}

export interface BaselineResult {
  baselineScore: number;
  drivers: DriverResult[];
}

export async function computeBaseline(customerId: string): Promise<BaselineResult> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: {
      products: { include: { package: { include: { product: { include: { capabilities: true } } } } } },
    },
  });

  const customerProduct = customer.products[0]; // this prototype seeds one product per customer
  const now = new Date();
  const drivers: DriverResult[] = [];

  // 1. Onboarding pace/delay
  if (customerProduct?.lifecycleStatus === "onboarding" && customerProduct.expectedGoLiveDate) {
    const daysOverdue = Math.round(
      (now.getTime() - customerProduct.expectedGoLiveDate.getTime()) / 86400000
    );
    const score = daysOverdue <= 0 ? 90 : clamp(90 - daysOverdue * 3);
    drivers.push(
      result(
        "onboarding_pace",
        score,
        daysOverdue <= 0
          ? `On pace, expected go-live ${customerProduct.expectedGoLiveDate.toDateString()}.`
          : `${daysOverdue} days past expected go-live (${customerProduct.expectedGoLiveDate.toDateString()}).`
      )
    );
  } else {
    drivers.push(result("onboarding_pace", null, "Not applicable - already Live."));
  }

  // 2 & 3. Usage/consumption trend, split by capability metricType
  const usage = await prisma.usageSnapshot.findMany({
    where: { customerId },
    include: { capability: true },
    orderBy: { occurredAt: "asc" },
  });
  for (const [key, metricType] of [
    ["usage_trend", "adoption"],
    ["consumption_trend", "consumption"],
  ] as const) {
    const rows = usage.filter((u) => u.capability.metricType === metricType);
    if (rows.length < 2) {
      drivers.push(result(key, null, "Not enough history yet."));
      continue;
    }
    const first = Number(rows[0].value);
    const last = Number(rows[rows.length - 1].value);
    const pctChange = first === 0 ? 0 : ((last - first) / first) * 100;
    const score = clamp(60 + pctChange);
    drivers.push(
      result(
        key,
        score,
        `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}% over the observed period (${first.toFixed(0)} -> ${last.toFixed(0)}).`
      )
    );
  }

  // 4. Desired Outcome progress - no data source yet in this prototype
  drivers.push(result("desired_outcome_progress", null, "Not tracked yet - no Desired Outcome model seeded."));

  // 5 & 6. Ticket volume trend, severity
  const interactions = await prisma.interaction.findMany({ where: { customerId } });
  const recent = interactions.filter((i) => now.getTime() - i.occurredAt.getTime() < 60 * 86400000);
  const older = interactions.filter((i) => now.getTime() - i.occurredAt.getTime() >= 60 * 86400000);
  if (interactions.length === 0) {
    drivers.push(result("ticket_volume_trend", null, "No interactions recorded."));
    drivers.push(result("ticket_severity", null, "No interactions recorded."));
  } else {
    const volumeScore = clamp(90 - recent.length * 6);
    drivers.push(
      result("ticket_volume_trend", volumeScore, `${recent.length} in the last 60 days, vs ${older.length} before that.`)
    );
    const severe = interactions.filter((i) => i.severity === "high" || i.severity === "critical").length;
    const severityScore = clamp(95 - (severe / interactions.length) * 100);
    drivers.push(
      result(
        "ticket_severity",
        severityScore,
        `${severe} of ${interactions.length} interactions were high/critical severity.`
      )
    );
  }

  // 7. Survey score
  const surveys = await prisma.surveyResponse.findMany({ where: { customerId } });
  if (surveys.length === 0) {
    drivers.push(result("survey_score", null, "No survey responses recorded."));
  } else {
    const avgNps = surveys.filter((s) => s.type === "nps").reduce((a, s) => a + s.score, 0) /
      Math.max(1, surveys.filter((s) => s.type === "nps").length);
    drivers.push(result("survey_score", avgNps * 10, `Average NPS ${avgNps.toFixed(1)}/10.`));
  }

  // 8. Champion engagement - no data source yet
  drivers.push(result("champion_engagement", null, "Not tracked yet - no stakeholder-engagement model seeded."));

  // 9. Commercial/contract signal
  if (customer.renewalType === "interrupted") {
    const score = customer.interruptedReason === "customer_requested" ? 15 : customer.interruptedReason === "company_defined" ? 55 : 45;
    drivers.push(result("commercial_signal", score, `Interrupted renewal (${customer.interruptedReason ?? "reason not set"}).`));
  } else {
    drivers.push(result("commercial_signal", 80, "Auto-renew, no interruption."));
  }

  // 10. Escalation - approximated from critical-severity interactions
  const criticalCount = interactions.filter((i) => i.severity === "critical").length;
  if (interactions.length === 0) {
    drivers.push(result("escalation", null, "No interactions recorded."));
  } else {
    drivers.push(result("escalation", clamp(95 - criticalCount * 25), `${criticalCount} critical-severity interaction(s).`));
  }

  // 11 & 12. Training consumption, payment health - no data source yet
  drivers.push(result("training_consumption", null, "Not tracked yet - no training-completion model seeded."));
  drivers.push(result("payment_health", null, "Not tracked yet - no billing model seeded."));

  // 13. Competitor risk - simple keyword pass here; Layer 2 does the real reasoning
  const competitors = await prisma.competitorConfig.findMany({ where: { workspaceId: customer.workspaceId } });
  const mentioned = competitors.filter((c) =>
    interactions.some((i) => i.text.toLowerCase().includes(c.name.toLowerCase()))
  );
  if (mentioned.length === 0) {
    drivers.push(result("competitor_risk", 85, "No configured competitor mentioned in interaction text."));
  } else {
    const maxWeight = Math.max(...mentioned.map((c) => c.riskWeight));
    drivers.push(
      result(
        "competitor_risk",
        clamp(85 - maxWeight * 14),
        `Mentioned: ${mentioned.map((c) => c.name).join(", ")}.`
      )
    );
  }

  // 14. Capability breadth/stickiness
  const entitled = customerProduct?.package?.product.capabilities ?? [];
  const usedCapIds = new Set(usage.map((u) => u.capabilityId));
  if (entitled.length === 0) {
    drivers.push(result("capability_breadth", null, "No package/entitlement data."));
  } else {
    const breadthPct = (usedCapIds.size / entitled.length) * 100;
    drivers.push(
      result("capability_breadth", breadthPct, `Using ${usedCapIds.size} of ${entitled.length} entitled Capabilities.`)
    );
  }

  // 15. Engagement silence - fires on the CONJUNCTION of channels, not any one alone
  const events = await prisma.eventAttendance.findMany({ where: { customerId } });
  const usageFlatOrDeclining = usage.length >= 2 && Number(usage[usage.length - 1].value) <= Number(usage[0].value) * 1.02;
  const silentChannels = [interactions.length === 0, events.length === 0, usageFlatOrDeclining].filter(Boolean).length;
  if (silentChannels >= 2) {
    drivers.push(
      result(
        "engagement_silence",
        20,
        `Silent across ${silentChannels}/3 channels (interactions, events, usage growth) - overrides an otherwise-quiet reading.`
      )
    );
  } else {
    drivers.push(result("engagement_silence", 80, "Engaged across enough channels."));
  }

  const scored = drivers.filter((d) => d.score !== null) as (DriverResult & { score: number })[];
  const baselineScore = scored.length === 0 ? 50 : Math.round(scored.reduce((a, d) => a + d.score, 0) / scored.length);

  return { baselineScore, drivers };
}

export async function disconnectHealthPrisma() {
  await prisma.$disconnect();
}
