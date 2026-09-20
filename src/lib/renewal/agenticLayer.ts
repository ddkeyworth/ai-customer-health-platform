// Renewal's agentic layer - see docs/playbook-proposals.md #5. Two things,
// not one: a bounded adjustment to that account's own churn-likelihood
// (same shape as Health's baseline + bounded agentic delta - a single
// global per-band rate can't weigh one account's own signals), and a
// concrete save-play recommendation. Only called for the same "at risk"
// accounts Briefing already flags (interrupted renewal, or Health
// Watch/Critical) - a healthy, on-track renewal never reaches this.
import Anthropic from "@anthropic-ai/sdk";
import { noEmDash } from "../text";

const SAVE_PLAY_TOOL = {
  name: "record_renewal_save_play",
  description: "Record specific, cited risk factors, a bounded adjustment to the baseline churn likelihood, and one concrete save-play action.",
  input_schema: {
    type: "object" as const,
    properties: {
      riskFactors: {
        type: "array",
        items: { type: "string" },
        description: "Specific, cited reasons this renewal is at risk - must trace to data actually provided.",
      },
      likelihoodAdjustmentPct: {
        type: "integer",
        minimum: -20,
        maximum: 20,
        description: "Bounded percentage-point nudge to the baseline churn likelihood for this specific account. 0 if the baseline already reflects it well.",
      },
      savePlay: {
        type: "string",
        description: "One concrete recommended action for the CSM, e.g. 'schedule an executive check-in before the 45-day mark'.",
      },
      reasoning: {
        type: "string",
        description: "Must cite the actual renewal type, Health narrative, or interaction text provided.",
      },
      confidenceLevel: {
        type: "string",
        enum: ["early_read", "established"],
      },
    },
    required: ["riskFactors", "likelihoodAdjustmentPct", "savePlay", "reasoning", "confidenceLevel"],
  },
};

export interface RenewalSavePlayResult {
  riskFactors: string[];
  likelihoodAdjustmentPct: number;
  savePlay: string;
  reasoning: string;
  confidenceLevel: "early_read" | "established";
}

export async function computeRenewalSavePlay(
  customerName: string,
  renewalType: string,
  daysToRenewal: number,
  baselineLikelihood: number,
  baselineSource: string,
  healthTier: string | null,
  healthNarrative: string | null,
  interactions: { type: string; severity: string | null; text: string }[],
  apiKey: string
): Promise<RenewalSavePlayResult> {
  const anthropic = new Anthropic({ apiKey });

  const payload = {
    customerName,
    renewalType,
    daysToRenewal,
    baselineChurnLikelihoodPct: Math.round(baselineLikelihood * 100),
    baselineSource,
    healthTier,
    healthNarrative,
    interactionText: interactions.map((i) => ({ type: i.type, severity: i.severity, text: i.text })),
  };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system:
      "You review one at-risk renewal. You are given a baseline churn likelihood for this account's Health band (either from real historical outcomes, or an illustrative estimate if there isn't enough history yet) and the account's own specific context. Decide whether this specific account's own signals warrant a bounded adjustment (-20 to +20 percentage points) to that baseline, list specific cited risk factors, and recommend one concrete save-play action for the CSM. Never invent facts not present in the data you were given.",
    tools: [SAVE_PLAY_TOOL],
    tool_choice: { type: "tool", name: "record_renewal_save_play" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    riskFactors: string[];
    likelihoodAdjustmentPct: number;
    savePlay: string;
    reasoning: string;
    confidenceLevel: "early_read" | "established";
  };

  return {
    riskFactors: (parsed.riskFactors ?? []).map((f) => noEmDash(f)),
    likelihoodAdjustmentPct: Math.max(-20, Math.min(20, Math.round(parsed.likelihoodAdjustmentPct))),
    savePlay: noEmDash(parsed.savePlay),
    reasoning: noEmDash(parsed.reasoning),
    confidenceLevel: parsed.confidenceLevel,
  };
}
