// Shared helper for every agentic layer beyond Health (Onboarding, Adoption,
// Expansion, Renewal) - see docs/playbook-proposals.md and prisma/schema.prisma's
// AgentAction model. A scheduled capability can run daily or weekly against
// the same still-open condition (an account that's still overdue, still
// underused, etc.) - without this, every run would create a fresh duplicate
// recommendation on top of one a human hasn't reviewed yet. Refreshes an
// existing "proposed" row in place instead of piling up copies; once a human
// marks one accepted/dismissed, the next run is free to raise a new one if
// the underlying condition still holds.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface AgentActionInput {
  workspaceId: string;
  customerId: string;
  area: string;
  actionType: string;
  // The specific CustomerProduct or Opportunity this action is about - a
  // customer with two live Products (or two open Opportunities) can have
  // two independent actions of the same area/actionType at once. Omit only
  // when an area is genuinely one-per-customer.
  subjectId?: string | null;
  headline: string;
  reasoning: string;
  suggestedNextStep?: string | null;
  impactArr?: Prisma.Decimal | number | null;
  confidenceLevel: "early_read" | "established";
  metadata?: object | null;
}

export async function upsertProposedAgentAction(input: AgentActionInput): Promise<void> {
  const existing = await prisma.agentAction.findFirst({
    where: {
      workspaceId: input.workspaceId,
      customerId: input.customerId,
      area: input.area,
      actionType: input.actionType,
      subjectId: input.subjectId ?? null,
      status: "proposed",
    },
  });

  const data = {
    headline: input.headline,
    reasoning: input.reasoning,
    suggestedNextStep: input.suggestedNextStep ?? null,
    impactArr: input.impactArr ?? null,
    confidenceLevel: input.confidenceLevel,
    metadata: input.metadata ?? undefined,
  };

  if (existing) {
    await prisma.agentAction.update({ where: { id: existing.id }, data });
  } else {
    await prisma.agentAction.create({
      data: {
        workspaceId: input.workspaceId,
        customerId: input.customerId,
        area: input.area,
        actionType: input.actionType,
        subjectId: input.subjectId ?? null,
        ...data,
      },
    });
  }
}
