// The shared demo workspace runs on the site owner's own Anthropic key, and
// its login is public. Anyone using it must not be able to spend that key
// (Run now, a daily/weekly schedule) or replace or remove it. A workspace
// someone signs up for themselves is unaffected: it can only ever use the
// key that person adds, never the owner's.
export const DEMO_LOCK_NOTICE =
  "AI runs and the API key are locked on the shared demo workspace, because they would spend the site owner's own key. Sign up for your own workspace to run the AI with your own key.";

export function isSpendLocked(workspace: { isDemoSeed: boolean }): boolean {
  return workspace.isDemoSeed;
}
