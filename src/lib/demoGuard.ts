// Who may spend an Anthropic key, and who may change what, on the owner's
// hosted site. See deployment.ts for the one switch that turns all of this off
// for someone running their own copy.
//
// The shared demo workspace runs on the owner's own Anthropic key and its login
// is public, so on the hosted site it cannot run AI, set schedules, change the
// key, or be imported into or deleted. A workspace someone signs up for can
// only ever use a key that person adds, so it is never locked.
import { isSelfHosted } from "@/lib/deployment";

export const DEMO_LOCK_NOTICE =
  "AI runs, the API key and data changes are locked on the shared demo workspace, because it runs on the site owner's own key. Sign up for your own workspace, or run your own copy, to use the AI with your own key and your own data.";

export function demoLockEnabled(): boolean {
  return !isSelfHosted();
}

export function isSpendLocked(workspace: { isDemoSeed: boolean }): boolean {
  return workspace.isDemoSeed && demoLockEnabled();
}
