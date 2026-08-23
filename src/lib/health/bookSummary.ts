// Whole-book executive summary. Real synthesis across accounts, not a
// restatement of the stat tiles - the point is patterns a human wouldn't
// piece together from a table (clusters, shared causes, outliers).
// Deliberately scoped by a list of customer IDs, not "all customers"
// hardcoded, so this same function can serve a Segment-scoped summary
// later without changes - see README.md.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { noEmDash } from "../text";

const SUMMARY_TOOL = {
  name: "record_book_summary",
  description: "Record a synthesized executive summary across the given set of customers' Health reads.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "3-5 sentences. Identify real patterns - shared causes across multiple accounts, notable outliers, the single most actionable insight. Every claim must cite specific customers or driver values actually provided - never an invented trend.",
      },
    },
    required: ["summary"],
  },
};

export async function computeBookSummary(customerIds: string[], apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey });
  const snapshots = await prisma.healthScoreSnapshot.findMany({
    where: { customerId: { in: customerIds } },
    include: { customer: true },
    orderBy: { computedAt: "desc" },
  });

  const latestByCustomer = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByCustomer.has(s.customerId)) latestByCustomer.set(s.customerId, s);
  }

  const payload = [...latestByCustomer.values()].map((s) => ({
    customer: s.customer.name,
    tier: s.customer.tier,
    compositeScore: s.compositeScore,
    tierLabel: s.tierLabel,
    baselineScore: s.baselineScore,
    adjustmentDelta: s.adjustmentDelta,
    narrative: s.narrative,
  }));

  if (payload.length === 0) {
    throw new Error("No Health scores found for the given customer IDs - run compute-health-scores.ts first.");
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system:
      "You write a short executive summary synthesizing Health reads across a set of customer accounts. You are given each account's score, tier, and its own per-account narrative. Find real cross-account patterns - shared root causes, clusters, the account most worth acting on first - rather than restating each account individually. Never invent a pattern not actually supported by the data given.",
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: "record_book_summary" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as { summary: string };
  const summary = parsed.summary?.trim();
  if (!summary) {
    throw new Error("Model returned an empty summary.");
  }
  return noEmDash(summary);
}
