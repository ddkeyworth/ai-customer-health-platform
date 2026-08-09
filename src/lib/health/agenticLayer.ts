// Layer 2: bounded agentic adjustment + evidence-chain narrative + real
// competitor-mention detection over already-ingested interaction text.
// See README.md "Health scoring" section - this is deliberately NOT a
// freeform score generator. The model can nudge the baseline by a capped
// amount, and only with a reason it can point back to specific inputs.

import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { DriverResult } from "./drivers";

const prisma = new PrismaClient();
const anthropic = new Anthropic();

const ADJUSTMENT_TOOL = {
  name: "record_health_adjustment",
  description: "Record the bounded adjustment, evidence-grounded narrative, confidence, and any detected competitor mentions for this account's Health read.",
  input_schema: {
    type: "object" as const,
    properties: {
      adjustmentDelta: {
        type: "integer",
        minimum: -15,
        maximum: 15,
        description: "Bounded nudge to the baseline score. 0 if the baseline already reflects the situation well.",
      },
      adjustmentReason: {
        type: "string",
        description: "Required if adjustmentDelta != 0. Must cite specific driver values or interaction text provided - never an unstated inference.",
      },
      narrative: {
        type: "string",
        description: "2-4 sentences explaining this account's Health read. Every claim must trace to a specific driver value or interaction quote actually provided - no invented correlations.",
      },
      confidenceLevel: {
        type: "string",
        enum: ["early_read", "established"],
        description: "early_read if fewer than half the drivers have data, established otherwise.",
      },
      competitorMentions: {
        type: "array",
        description: "Any configured competitors whose name or known capabilities are referenced in the interaction text - empty array if none.",
        items: {
          type: "object",
          properties: {
            competitor: { type: "string" },
            evidence: { type: "string", description: "The specific quote or paraphrase from the interaction text that supports this." },
          },
          required: ["competitor", "evidence"],
        },
      },
    },
    required: ["adjustmentDelta", "narrative", "confidenceLevel", "competitorMentions"],
  },
};

export interface AgenticResult {
  adjustmentDelta: number;
  adjustmentReason: string | null;
  narrative: string;
  confidenceLevel: "early_read" | "established";
  competitorMentions: { competitor: string; evidence: string }[];
}

export async function computeAgenticLayer(
  customerId: string,
  baselineScore: number,
  drivers: DriverResult[]
): Promise<AgenticResult> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { products: true },
  });
  const interactions = await prisma.interaction.findMany({ where: { customerId } });
  const competitors = await prisma.competitorConfig.findMany({ where: { workspaceId: customer.workspaceId } });

  const payload = {
    accountContext: {
      tier: customer.tier,
      lifecycleStatus: customer.products[0]?.lifecycleStatus ?? "unknown",
      renewalType: customer.renewalType,
      interruptedReason: customer.interruptedReason,
    },
    baselineScore,
    drivers: drivers.map((d) => ({ label: d.label, score: d.score, detail: d.detail })),
    interactionText: interactions.map((i) => ({ type: i.type, severity: i.severity, text: i.text })),
    configuredCompetitors: competitors.map((c) => ({ name: c.name, riskWeight: c.riskWeight })),
  };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system:
      "You compute a Customer Success Health read for one account. You are given a deterministic baseline score and the raw signals behind it. Your job: (1) decide whether a bounded adjustment (-15 to +15) to the baseline is warranted given context the baseline formula cannot weigh, (2) write a short evidence-grounded narrative, (3) scan the provided interaction text for mentions of the configured competitors' names or known capabilities. Never invent facts not present in the data you were given. Never adjust the score without a reason tied to specific provided evidence.",
    tools: [ADJUSTMENT_TOOL],
    tool_choice: { type: "tool", name: "record_health_adjustment" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    adjustmentDelta: number;
    adjustmentReason?: string;
    narrative: string;
    confidenceLevel: "early_read" | "established";
    competitorMentions: { competitor: string; evidence: string }[];
  };

  return {
    adjustmentDelta: Math.max(-15, Math.min(15, Math.round(parsed.adjustmentDelta))),
    adjustmentReason: parsed.adjustmentReason ?? null,
    narrative: parsed.narrative,
    confidenceLevel: parsed.confidenceLevel,
    competitorMentions: parsed.competitorMentions ?? [],
  };
}

export async function disconnectAgenticPrisma() {
  await prisma.$disconnect();
}
