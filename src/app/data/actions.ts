"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { withinRateLimit } from "@/lib/rateLimit";
import { isSpendLocked, DEMO_LOCK_NOTICE } from "@/lib/demoGuard";
import { importCsv, IMPORT_MAX_BYTES, type ImportKind } from "@/lib/import/importData";

export interface ImportState {
  ok: boolean;
  message: string;
  errors: { row: number; message: string }[];
}

const KINDS: ImportKind[] = ["customers", "tickets", "usage", "outcomes"];
const PAGES = ["/", "/health", "/briefing", "/onboarding", "/adoption", "/expansion", "/renewal", "/segments", "/calibration", "/data"];

const refuse = (message: string): ImportState => ({ ok: false, message, errors: [] });

export async function importCsvAction(_previous: ImportState | null, formData: FormData): Promise<ImportState> {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return refuse(DEMO_LOCK_NOTICE);

  const kind = String(formData.get("kind") ?? "") as ImportKind;
  if (!KINDS.includes(kind)) return refuse("Unknown import type.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return refuse("Choose a CSV file first.");
  if (file.size > IMPORT_MAX_BYTES) return refuse(`That file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB. Split it into smaller files.`);

  if (!(await withinRateLimit(`importCsv:${workspace.id}`, 30, 60 * 60_000))) {
    return refuse("You have imported a lot in the last hour. Try again shortly.");
  }

  const result = await importCsv(workspace.id, kind, await file.text());
  if (result.ok) for (const p of PAGES) revalidatePath(p);
  return { ok: result.ok, message: result.message, errors: result.errors.slice(0, 10) };
}

// ---- delete this workspace and all its data ----
import { redirect } from "next/navigation";
import { destroySessionCookie } from "@/lib/auth";
import { deleteWorkspaceAndData } from "@/lib/deleteWorkspace";

export async function deleteWorkspaceAction(_previous: ImportState | null, formData: FormData): Promise<ImportState> {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return refuse(DEMO_LOCK_NOTICE);
  // Typing the workspace's exact name is the confirmation: it cannot be done by
  // an accidental click, and it makes clear exactly what is being deleted.
  if (String(formData.get("confirm") ?? "").trim() !== workspace.name) {
    return refuse(`Type the workspace name exactly (${workspace.name}) to confirm.`);
  }
  if (!(await withinRateLimit(`deleteWorkspace:${workspace.id}`, 5, 60 * 60_000))) {
    return refuse("Too many attempts. Try again shortly.");
  }
  await deleteWorkspaceAndData(workspace.id);
  await destroySessionCookie();
  redirect("/signup?deleted=1");
}
