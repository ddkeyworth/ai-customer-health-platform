// Onboarding's agentic layer - see docs/playbook-proposals.md #2. Same
// shape as Health's Layer 2 (src/lib/health/agenticLayer.ts): a bounded,
// evidence-grounded tool call, never a freeform recommendation. Only ever
// called for accounts already confirmed overdue (daysOverdue > 0) - an
// on-pace account never reaches this, so it can't generate noise.
import Anthropic from "@anthropic-ai/sdk";
import { noEmDash, withStyleRules } from "../text";

const RECOVERY_TOOL = {
  name: "record_onboarding_recovery",
  description: "Record why this account's onboarding has stalled and one concrete recovery step, or decline if there isn't enough evidence to say more than 'it's late'.",
  input_schema: {
    type: "object" as const,
    properties: {
      hasEnoughEvidence: {
        type: "boolean",
        description: "False if there is no real signal beyond the account being overdue - decline rather than inventing a plausible-sounding reason.",
      },
      stalledReason: {
        type: "string",
        enum: ["customer_delay", "internal_delay", "external_dependency", "unclear"],
      },
      reasoning: {
        type: "string",
        description: "2-3 sentences. Must cite specific interaction text or dates provided - never an unstated inference.",
      },
      recoveryStep: {
        type: "string",
        description: "One concrete next action, e.g. 'schedule a re-kickoff call with the champion'.",
      },
      confidenceLevel: {
        type: "string",
        enum: ["early_read", "established"],
      },
    },
    required: ["hasEnoughEvidence", "reasoning", "confidenceLevel"],
  },
};

export interface OnboardingRecoveryResult {
  hasEnoughEvidence: boolean;
  stalledReason: string | null;
  reasoning: string;
  recoveryStep: string | null;
  confidenceLevel: "early_read" | "established";
}

export async function computeOnboardingRecovery(
  customerName: string,
  daysOverdue: number,
  expectedGoLiveDate: Date,
  interactions: { type: string; severity: string | null; text: string; occurredAt: Date }[],
  apiKey: string
): Promise<OnboardingRecoveryResult> {
  const anthropic = new Anthropic({ apiKey });

  const payload = {
    customerName,
    daysOverdue,
    expectedGoLiveDate: expectedGoLiveDate.toISOString(),
    interactionText: interactions.map((i) => ({ type: i.type, severity: i.severity, text: i.text, occurredAt: i.occurredAt.toISOString() })),
  };

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system:
      withStyleRules("You review one customer account that is overdue on its expected go-live date. You are given the account's interaction history. Decide whether there is enough real evidence to say why it stalled and suggest one concrete recovery step - if the only fact you have is 'it's late,' decline rather than inventing a plausible-sounding reason. Never invent facts not present in the data you were given."),
    tools: [RECOVERY_TOOL],
    tool_choice: { type: "tool", name: "record_onboarding_recovery" },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return the expected structured output.");
  }
  const parsed = toolUse.input as {
    hasEnoughEvidence: boolean;
    stalledReason?: string;
    reasoning: string;
    recoveryStep?: string;
    confidenceLevel: "early_read" | "established";
  };

  return {
    hasEnoughEvidence: parsed.hasEnoughEvidence,
    stalledReason: parsed.stalledReason ?? null,
    reasoning: noEmDash(parsed.reasoning),
    recoveryStep: parsed.recoveryStep ? noEmDash(parsed.recoveryStep) : null,
    confidenceLevel: parsed.confidenceLevel,
  };
}
