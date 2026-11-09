// Who may change a workspace's data through the Data page: importing files and
// managing custom fields. One pure rule, used by every Server Action there, so
// it can be tested without a web request.
//
// The shared demo workspace is locked on the hosted site (it runs on the site
// owner's own key and its login is public). Anyone else needs to be a workspace
// admin: whoever signs up for a workspace is its admin.
import { DEMO_LOCK_NOTICE } from "@/lib/demoGuard";

export type DataAction = "import" | "custom fields";

// A plain-English reason the person may not do this, or null if they may.
export function dataAccessProblem(state: { locked: boolean; isAdmin: boolean }, action: DataAction): string | null {
  if (state.locked) return DEMO_LOCK_NOTICE;
  if (!state.isAdmin) return action === "import" ? "Only a workspace admin can import data." : "Only a workspace admin can change custom fields.";
  return null;
}
