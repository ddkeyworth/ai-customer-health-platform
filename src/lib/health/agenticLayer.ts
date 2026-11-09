// Layer 2: bounded agentic adjustment + evidence-chain narrative + real
// competitor-mention detection over already-ingested interaction text.
// See README.md "Health scoring" section - this is deliberately NOT a
// freeform score generator. The model can nudge the baseline by a capped
// amount, and only with a reason it can point back to specific inputs.

import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { DriverResult } from "./drivers";
import { noEmDash, withStyleRules } from "../text";
import { CUSTOM_FIELDS_SYSTEM_NOTE, buildCustomFieldContext } from "../customFields/context";
import type { CustomFieldLike } from "../customFields/values";

const prisma = new PrismaClient();

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
      evidenceNotInDrivers: {
        type: "string",
        description: "Required if adjustmentDelta != 0, empty string otherwise. Quote the specific interaction text, event or fact that NONE of the 15 drivers already scores (a driver already counts usage, engagement, champion, payment, NPS, competitor mentions, support volume, silence, breadth, outcomes, training). If the only support for a change is something a driver already captures, the adjustment must be 0.",
      },
      adjustmentReason: {
        type: "string",
        description: "Required if adjustmentDelta != 0. Explain why the evidence above changes the read beyond what the drivers already say - never restate a driver's own score as the reason.",
      },
      narrative: {
        type: "string",
        description: "2-4 sentences explaining this account's Health read. Every claim must trace to a specific driver value or interaction quote actually provided - no invented correlations. Describe the account's situation only; do not say whether or how much you are adjusting the score, because the adjustment is recorded separately and may be set to zero.",
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
    required: ["adjustmentDelta", "evidenceNotInDrivers", "narrative", "confidenceLevel", "competitorMentions"],
  },
};

export interface AgenticResult {
  adjustmentDelta: number;
  adjustmentReason: string | null;
  evidenceNotInDrivers: string | null;
  narrative: string;
  confidenceLevel: "early_read" | "established";
  competitorMentions: { competitor: string; evidence: string }[];
}

// Upper score of the Health band a baseline falls in (bands match
// tierLabelFor in computeHealthScores.ts: 85 / 60 / 40).
export function bandCeiling(score: number): number {
  if (score >= 85) return 100;
  if (score >= 60) return 84;
  if (score >= 40) return 59;
  return 39;
}

// Enforced in code, not just asked for in the prompt. A non-zero adjustment
// only counts if the model named evidence no driver already scores. An
// earlier version without this lowered 89 of 120 scores (63 by exactly -8),
// mostly on usage, engagement and champion signals the baseline had already
// counted, which pulled 51 accounts into Watch. Optimism also has to be
// earned by the drivers: an upward nudge stays within the band the baseline
// put the account in. Downward moves are not capped that way, because a
// specific risk signal (a cancellation threat) is exactly what a baseline
// can miss.
export function applyAdjustmentGuards(claimed: number, evidenceNotInDrivers: string | undefined, baselineScore: number): number {
  const bounded = Math.max(-15, Math.min(15, Math.round(claimed)));
  const hasEvidence = (evidenceNotInDrivers ?? "").trim().length >= 15;
  const evidenced = bounded !== 0 && !hasEvidence ? 0 : bounded;
  return evidenced > 0 ? Math.min(evidenced, bandCeiling(baselineScore) - baselineScore) : evidenced;
}

export async function computeAgenticLayer(
  customerId: string,
  baselineScore: number,
  drivers: DriverResult[],
  apiKey: string,
  customFieldDefs: CustomFieldLike[] = []
): Promise<AgenticResult> {
  const anthropic = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 }); // see the time budget in capabilityBatches.ts
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { products: true },
  });
  const interactions = await prisma.interaction.findMany({ where: { customerId } });
  const competitors = await prisma.competitorConfig.findMany({ where: { workspaceId: customer.workspaceId } });

  // Only fields the workspace marked as shareable with the AI; empty when there are none.
  const customContext = buildCustomFieldContext(customFieldDefs, customer.customFields);

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
      withStyleRules("You compute a Customer Success Health read for one account. You are given a deterministic baseline score and the raw signals behind it. Your job: (1) decide whether a bounded adjustment (-15 to +15) to the baseline is warranted, (2) write a short evidence-grounded narrative, (3) scan the provided interaction text for mentions of the configured competitors' names or known capabilities. The baseline already scores all 15 drivers, including usage and engagement trend, champion engagement, engagement silence, payment health, NPS, support volume and severity, competitor risk, capability breadth, desired outcomes and training. Penalising or rewarding an account again for something a driver already scores counts it twice. The default adjustment is 0. Adjust only for evidence no driver captures, such as a stated intent in the interaction text that is specific and unusual (a cancellation threat, an executive sponsor leaving, a named internal decision), a one-off incident, or an interaction between signals that a per-driver score cannot express, and quote that evidence in evidenceNotInDrivers. A routine request or question is not evidence. Positive evidence is weighed against the account's overall risk: it does not outweigh declining usage, a silent champion or a late payment. Never invent facts not present in the data you were given." + (customContext ? CUSTOM_FIELDS_SYSTEM_NOTE : "")),
    tools: [ADJUSTMENT_TOOL],
    tool_choice: { type: "tool", name: "record_health_adjustment" },
    messages: [{ role: "user", content: JSON.stringify(customContext ? { ...payload, workspaceDefinedCustomFields: customContext } : payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    adjustmentDelta: number;
    evidenceNotInDrivers?: string;
    adjustmentReason?: string;
    narrative: string;
    confidenceLevel: "early_read" | "established";
    competitorMentions: { competitor: string; evidence: string }[];
  };

  // The tool schema marks narrative "required", but that only forces the
  // key to exist, not to be non-empty - seen in practice returning "" for
  // one seeded customer while adjustmentReason still had real content.
  // Fall back to adjustmentReason (it's evidence-grounded too) rather than
  // silently storing an empty narrative.
  const rawNarrative = parsed.narrative?.trim() || parsed.adjustmentReason?.trim() || null;
  if (!rawNarrative) {
    throw new Error(`Model returned no narrative and no adjustmentReason for customer ${customerId}.`);
  }

  const adjustmentDelta = applyAdjustmentGuards(parsed.adjustmentDelta, parsed.evidenceNotInDrivers, baselineScore);

  return {
    adjustmentDelta,
    adjustmentReason: adjustmentDelta !== 0 && parsed.adjustmentReason ? noEmDash(parsed.adjustmentReason) : null,
    evidenceNotInDrivers: adjustmentDelta !== 0 ? noEmDash((parsed.evidenceNotInDrivers ?? '').trim()) : null,
    narrative: noEmDash(rawNarrative),
    confidenceLevel: parsed.confidenceLevel,
    competitorMentions: parsed.competitorMentions ?? [],
  };
}

export async function disconnectAgenticPrisma() {
  await prisma.$disconnect();
}
