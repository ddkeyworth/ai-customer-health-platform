// Expansion's agentic layer - see docs/playbook-proposals.md #4. Runs on
// top of the existing deterministic rules (prisma/generate-opportunities.ts),
// the same two-layer shape Health already uses: the deterministic pass
// stays the always-on, free baseline, this is the optional richer pass a
// workspace opts into. Given the same signals the rules already use, plus
// interaction text and Health context a fixed rule can't weigh - e.g. an
// account that's also Health-Critical may warrant a different framing (or a
// caution) than the rules alone would produce.
import Anthropic from "@anthropic-ai/sdk";
import { noEmDash, withStyleRules } from "../text";

const REVIEW_TOOL = {
  name: "record_expansion_review",
  description: "Record a richer, evidence-grounded review of this deterministically-raised Expansion opportunity.",
  input_schema: {
    type: "object" as const,
    properties: {
      shouldRaise: {
        type: "boolean",
        description: "False if the context (e.g. Health-Critical) means this opportunity shouldn't be pursued as framed right now.",
      },
      reasoning: {
        type: "string",
        description: "Must cite specific interaction text, consumption numbers, or Health context provided - never a generic template sentence.",
      },
      cautionFlag: {
        type: "string",
        description: "e.g. 'Health is Critical - consider a save play before raising expansion.' Empty string if none.",
      },
      confidenceLevel: {
        type: "string",
        enum: ["early_read", "established"],
      },
    },
    required: ["shouldRaise", "reasoning", "confidenceLevel"],
  },
};

export interface ExpansionReviewResult {
  shouldRaise: boolean;
  reasoning: string;
  cautionFlag: string | null;
  confidenceLevel: "early_read" | "established";
}

export async function computeExpansionReview(
  customerName: string,
  opportunityType: string,
  estimatedArr: number,
  ruleReasoning: string,
  healthTier: string | null,
  healthNarrative: string | null,
  interactions: { type: string; severity: string | null; text: string }[],
  apiKey: string
): Promise<ExpansionReviewResult> {
  const anthropic = new Anthropic({ apiKey });

  const payload = {
    customerName,
    opportunityType,
    estimatedArr,
    ruleReasoning,
    healthTier,
    healthNarrative,
    interactionText: interactions.map((i) => ({ type: i.type, severity: i.severity, text: i.text })),
  };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system:
      withStyleRules("You review one Expansion opportunity that a deterministic rule already raised. You are given the rule's own reasoning plus the account's Health context and interaction history - context a fixed rule can't weigh. Decide whether raising it as framed still makes sense (e.g. expanding a churn-risk account is a different conversation than expanding a healthy one) and write a richer, evidence-grounded reasoning to replace the rule's generic sentence. Never invent facts not present in the data you were given."),
    tools: [REVIEW_TOOL],
    tool_choice: { type: "tool", name: "record_expansion_review" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    shouldRaise: boolean;
    reasoning: string;
    cautionFlag?: string;
    confidenceLevel: "early_read" | "established";
  };

  return {
    shouldRaise: parsed.shouldRaise,
    reasoning: noEmDash(parsed.reasoning),
    cautionFlag: parsed.cautionFlag?.trim() ? noEmDash(parsed.cautionFlag.trim()) : null,
    confidenceLevel: parsed.confidenceLevel,
  };
}
