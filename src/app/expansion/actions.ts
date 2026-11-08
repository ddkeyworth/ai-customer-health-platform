"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { withinRateLimit } from "@/lib/rateLimit";
import { isSpendLocked } from "@/lib/demoGuard";
import { generateOpportunitiesForWorkspace } from "@/lib/expansion/generateOpportunities";

// Free (rules only, no AI). Refused on the locked demo so visitors cannot
// change the shared data.
export async function findOpportunities() {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return;
  if (!(await withinRateLimit(`findOpportunities:${workspace.id}`, 10, 60 * 60_000))) return;
  await generateOpportunitiesForWorkspace(workspace.id);
  revalidatePath("/expansion");
  revalidatePath("/briefing");
}
