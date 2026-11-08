// Removes one workspace and every row that belongs to it, in an order the
// database's foreign keys allow, inside a single transaction: either all of it
// goes or none of it does. Scoped to the workspace id passed in; nothing else
// is touched.
import { prisma } from "@/lib/prisma";

export async function deleteWorkspaceAndData(workspaceId: string): Promise<void> {
  const inCustomers = { customer: { workspaceId } };
  await prisma.$transaction(
    async (tx) => {
      await tx.agentAction.deleteMany({ where: { workspaceId } });
      await tx.healthScoreSnapshot.deleteMany({ where: inCustomers });
      await tx.interaction.deleteMany({ where: inCustomers });
      await tx.usageSnapshot.deleteMany({ where: inCustomers });
      await tx.surveyResponse.deleteMany({ where: inCustomers });
      await tx.eventAttendance.deleteMany({ where: inCustomers });
      await tx.opportunity.deleteMany({ where: inCustomers });
      await tx.desiredOutcome.deleteMany({ where: inCustomers });
      await tx.stakeholder.deleteMany({ where: inCustomers });
      await tx.trainingCompletion.deleteMany({ where: inCustomers });
      await tx.outcomeEvent.deleteMany({ where: inCustomers });
      await tx.customerProduct.deleteMany({ where: inCustomers });
      await tx.customer.deleteMany({ where: { workspaceId } });
      await tx.capability.deleteMany({ where: { product: { workspaceId } } });
      await tx.package.deleteMany({ where: { product: { workspaceId } } });
      await tx.product.deleteMany({ where: { workspaceId } });
      await tx.competitorConfig.deleteMany({ where: { workspaceId } });
      await tx.bookSummary.deleteMany({ where: { workspaceId } });
      await tx.segment.deleteMany({ where: { workspaceId } });
      await tx.capabilityRun.deleteMany({ where: { workspaceId } });
      await tx.capabilityRunConfig.deleteMany({ where: { workspaceId } });
      await tx.session.deleteMany({ where: { user: { workspaceId } } });
      await tx.user.deleteMany({ where: { workspaceId } });
      await tx.workspace.delete({ where: { id: workspaceId } });
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
}
