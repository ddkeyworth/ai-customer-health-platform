// Free-trial gate for every capability's AI layer (Health included) - see
// docs/playbook-proposals.md decision 3. No stored trial-end date: computed
// from createdAt + TRIAL_DAYS at read time, so nothing needs backfilling.
// subscriptionActive is illustrative only - no real payment processor
// exists, same "concept, not a connection" treatment as billing elsewhere
// in Settings. The demo seed workspace is permanently exempt: it exists to
// showcase the product to visitors, not to simulate a real customer's trial
// economics, and its createdAt long predates this gate.
export const TRIAL_DAYS = 14;

export interface TrialWorkspace {
  isDemoSeed: boolean;
  subscriptionActive: boolean;
  createdAt: Date;
}

export interface TrialStatus {
  active: boolean; // has AI access right now
  exempt: boolean; // demo workspace - never gated
  subscribed: boolean;
  daysRemaining: number; // 0 once the trial has ended
  trialEndsAt: Date;
}

export function getTrialStatus(workspace: TrialWorkspace, now: Date = new Date()): TrialStatus {
  const trialEndsAt = new Date(workspace.createdAt.getTime() + TRIAL_DAYS * 86_400_000);
  const exempt = workspace.isDemoSeed;
  const withinTrial = now.getTime() < trialEndsAt.getTime();
  const daysRemaining = Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000));

  return {
    active: exempt || workspace.subscriptionActive || withinTrial,
    exempt,
    subscribed: workspace.subscriptionActive,
    daysRemaining,
    trialEndsAt,
  };
}
