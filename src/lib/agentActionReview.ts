"use server";

// Accept/dismiss for the AI recommendations shown on Onboarding, Adoption,
// Expansion and Renewal - the "agent proposes, human decides" step the
// schema already had a status field for (proposed/accepted/dismissed) but
// no UI ever set. The actual workspace-scoped update lives in
// src/lib/agentActionStatus.ts, so it's directly testable without a
// request context; this file only resolves the session and revalidates.
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { getSessionUser } from "@/lib/auth";
import { setAgentActionStatus } from "@/lib/agentActionStatus";

const REVALIDATE_PATHS = ["/onboarding", "/adoption", "/expansion", "/renewal", "/briefing"];

async function review(id: string, status: "accepted" | "dismissed") {
  const workspace = await getCurrentWorkspace();
  const user = await getSessionUser();
  await setAgentActionStatus(workspace.id, id, status, user?.name ?? null);
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
}

export async function acceptAgentAction(id: string) {
  await review(id, "accepted");
}

export async function dismissAgentAction(id: string) {
  await review(id, "dismissed");
}
