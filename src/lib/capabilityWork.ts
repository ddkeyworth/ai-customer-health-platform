// Wires the real capabilities into the resumable-run engine
// (capabilityBatches.ts). Each capability lists the ids it would review and
// can process any subset of them, so a run can be cut into pieces.
//
// chunk is how many ids one step handles. Health makes one slow call per
// customer, so it goes one at a time and the time budget is checked after
// every customer. The others review fewer, quicker items per step.
import { assertCanRun, type Capability } from "@/lib/capabilityRuns";
import { advanceRun, type RunProgress, type WorkAdapter } from "@/lib/capabilityBatches";
import { computeHealthScoresForWorkspace, listHealthWorkIds } from "@/lib/health/computeHealthScores";
import { computeOnboardingActionsForWorkspace, listOnboardingWorkIds } from "@/lib/onboarding/computeOnboardingActions";
import { computeAdoptionActionsForWorkspace, listAdoptionWorkIds } from "@/lib/adoption/computeAdoptionActions";
import { computeExpansionActionsForWorkspace, listExpansionWorkIds } from "@/lib/expansion/computeExpansionActions";
import { computeRenewalActionsForWorkspace, listRenewalWorkIds } from "@/lib/renewal/computeRenewalActions";

export const ADAPTERS: Record<Capability, WorkAdapter> = {
  health: {
    list: listHealthWorkIds,
    process: (workspaceId, _apiKey, ids) => computeHealthScoresForWorkspace(workspaceId, ids),
    chunk: 1,
  },
  onboarding: { list: listOnboardingWorkIds, process: computeOnboardingActionsForWorkspace, chunk: 4 },
  adoption: { list: listAdoptionWorkIds, process: computeAdoptionActionsForWorkspace, chunk: 4 },
  expansion: { list: listExpansionWorkIds, process: computeExpansionActionsForWorkspace, chunk: 4 },
  renewal: { list: listRenewalWorkIds, process: computeRenewalActionsForWorkspace, chunk: 4 },
};

// Checks the trial and key first (so a workspace that may not run never
// starts a run), then advances the capability's run by one time budget.
export async function advanceCapabilityRun(
  workspaceId: string,
  capability: Capability,
  options: { startNew: boolean; budgetMs?: number }
): Promise<RunProgress> {
  const apiKey = await assertCanRun(workspaceId, capability);
  return advanceRun({ workspaceId, capability, adapter: ADAPTERS[capability], apiKey, ...options });
}
