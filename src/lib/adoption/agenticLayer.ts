// Adoption's agentic layer - see docs/playbook-proposals.md #3. Same
// bounded, evidence-grounded shape as Health's Layer 2. Only ever called
// for accounts already below the workspace's configured underused-breadth
// threshold - see Workspace.adoptionUnderusedThresholdPct.
import Anthropic from "@anthropic-ai/sdk";
import { noEmDash } from "../text";

const NUDGE_TOOL = {
  name: "record_adoption_nudge",
  description: "Record which unused capabilities are worth a nudge for this account, and what kind.",
  input_schema: {
    type: "object" as const,
    properties: {
      underusedCapabilities: {
        type: "array",
        items: { type: "string" },
        description: "Names of entitled-but-unused capabilities worth flagging.",
      },
      reasoning: {
        type: "string",
        description: "Must cite the actual entitled-vs-used gap and any relevant interaction text provided.",
      },
      nudgeType: {
        type: "string",
        enum: ["training_offer", "champion_outreach", "capability_walkthrough"],
      },
      confidenceLevel: {
        type: "string",
        enum: ["early_read", "established"],
      },
    },
    required: ["underusedCapabilities", "reasoning", "nudgeType", "confidenceLevel"],
  },
};

export interface AdoptionNudgeResult {
  underusedCapabilities: string[];
  reasoning: string;
  nudgeType: "training_offer" | "champion_outreach" | "capability_walkthrough";
  confidenceLevel: "early_read" | "established";
}

export async function computeAdoptionNudge(
  customerName: string,
  breadthPct: number,
  entitledCapabilities: string[],
  usedCapabilities: string[],
  interactions: { type: string; severity: string | null; text: string }[],
  apiKey: string
): Promise<AdoptionNudgeResult> {
  const anthropic = new Anthropic({ apiKey });

  const payload = {
    customerName,
    breadthPct,
    entitledCapabilities,
    usedCapabilities,
    unusedCapabilities: entitledCapabilities.filter((c) => !usedCapabilities.includes(c)),
    interactionText: interactions.map((i) => ({ type: i.type, severity: i.severity, text: i.text })),
  };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system:
      "You review one account using less than expected of what it's entitled to. You are given the entitled/used capability split and the account's interaction history. Decide which unused capabilities are worth a nudge and what kind - check whether the account has actually asked about an unused capability (a real signal) versus never mentioned it at all. Never invent facts not present in the data you were given.",
    tools: [NUDGE_TOOL],
    tool_choice: { type: "tool", name: "record_adoption_nudge" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    underusedCapabilities: string[];
    reasoning: string;
    nudgeType: "training_offer" | "champion_outreach" | "capability_walkthrough";
    confidenceLevel: "early_read" | "established";
  };

  return {
    underusedCapabilities: parsed.underusedCapabilities ?? [],
    reasoning: noEmDash(parsed.reasoning),
    nudgeType: parsed.nudgeType,
    confidenceLevel: parsed.confidenceLevel,
  };
}
