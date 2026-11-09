"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentWorkspace } from "@/lib/currentWorkspace";
import { destroySessionCookie, getSessionUser } from "@/lib/auth";
import { withinRateLimit } from "@/lib/rateLimit";
import { isSpendLocked, DEMO_LOCK_NOTICE } from "@/lib/demoGuard";
import { deleteWorkspaceAndData } from "@/lib/deleteWorkspace";
import { importCsv, importCsvMapped, decodeUpload, IMPORT_KINDS, IMPORT_MAX_BYTES, type ImportKind } from "@/lib/import/importData";
import { buildPreview, type PreviewResult } from "@/lib/import/preview";
import { dataAccessProblem } from "@/lib/import/access";
import { removeField, renameField, setFieldAiSharing, type PanelResult } from "@/lib/customFields/admin";

export interface ImportState {
  ok: boolean;
  message: string;
  errors: { row: number; message: string }[];
}

const PAGES = ["/", "/health", "/briefing", "/onboarding", "/adoption", "/expansion", "/renewal", "/segments", "/calibration", "/data"];

const refuse = (message: string): ImportState => ({ ok: false, message, errors: [] });

// The checks every import step shares: the demo lock, the admin role, a known
// file type, a file that is there and not too big, and strict UTF-8 text.
// A file that is not UTF-8 (a Windows "CSV" from Excel, say) is refused with a way
// forward instead of silently turning "Zürich" into "Z?rich".
async function readUpload(formData: FormData): Promise<{ ok: true; workspaceId: string; kind: ImportKind; text: string } | { ok: false; message: string }> {
  const workspace = await getCurrentWorkspace();
  const user = await getSessionUser();
  const problem = dataAccessProblem({ locked: isSpendLocked(workspace), isAdmin: user?.isAdmin === true }, "import");
  if (problem) return { ok: false, message: problem };

  const kind = String(formData.get("kind") ?? "") as ImportKind;
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return { ok: false, message: "Unknown import type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file first." };
  if (file.size > IMPORT_MAX_BYTES) return { ok: false, message: `That file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB. Split it into smaller files.` };

  if (!(await withinRateLimit(`importCsv:${workspace.id}`, 30, 60 * 60_000))) {
    return { ok: false, message: "You have imported a lot in the last hour. Try again shortly." };
  }

  let decoded;
  try {
    decoded = decodeUpload(await file.arrayBuffer());
  } catch {
    return { ok: false, message: "That file could not be read. Try saving it again as CSV UTF-8." };
  }
  if (!decoded.ok) return { ok: false, message: decoded.message };
  return { ok: true, workspaceId: workspace.id, kind, text: decoded.text };
}

// Step 1 of an import, "Check file": nothing is written. Returns what each column
// probably is, for the person to confirm. Same guards as importing.
export async function previewImportAction(formData: FormData): Promise<PreviewResult> {
  const upload = await readUpload(formData);
  if (!upload.ok) return { ok: false, message: upload.message };
  return buildPreview(upload.workspaceId, upload.kind, upload.text);
}

// Step 2, "Import". With a `mapping` field (the column choices as JSON) the file
// is imported through those choices; without one the columns must already be
// named as Bearing names them. Either way the server reads the whole file again
// and checks everything, so nothing the browser sends is trusted.
export async function importCsvAction(_previous: ImportState | null, formData: FormData): Promise<ImportState> {
  const upload = await readUpload(formData);
  if (!upload.ok) return refuse(upload.message);

  const mapping = formData.get("mapping");
  if (mapping !== null && typeof mapping !== "string") return refuse("The column choices could not be read.");
  const result = typeof mapping === "string" ? await importCsvMapped(upload.workspaceId, upload.kind, upload.text, mapping) : await importCsv(upload.workspaceId, upload.kind, upload.text);
  if (result.ok) for (const p of PAGES) revalidatePath(p);
  return { ok: result.ok, message: result.message, errors: result.errors.slice(0, 10) };
}

// ---- the Custom fields panel ----

async function customFieldAccess(): Promise<{ ok: true; workspaceId: string } | { ok: false; message: string }> {
  const workspace = await getCurrentWorkspace();
  const user = await getSessionUser();
  const problem = dataAccessProblem({ locked: isSpendLocked(workspace), isAdmin: user?.isAdmin === true }, "custom fields");
  return problem ? { ok: false, message: problem } : { ok: true, workspaceId: workspace.id };
}

const AFTER_FIELD_CHANGE = PAGES;

// "Include in AI reads" for one field. Saved the moment it is switched.
export async function setCustomFieldAiSharingAction(fieldId: string, on: boolean): Promise<PanelResult> {
  const access = await customFieldAccess();
  if (!access.ok) return { ok: false, message: access.message };
  const result = await setFieldAiSharing(access.workspaceId, fieldId, on);
  if (result.ok) for (const p of AFTER_FIELD_CHANGE) revalidatePath(p);
  return result;
}

export async function renameCustomFieldAction(fieldId: string, label: string): Promise<PanelResult> {
  const access = await customFieldAccess();
  if (!access.ok) return { ok: false, message: access.message };
  const result = await renameField(access.workspaceId, fieldId, label);
  if (result.ok) for (const p of AFTER_FIELD_CHANGE) revalidatePath(p);
  return result;
}

export async function deleteCustomFieldAction(fieldId: string): Promise<PanelResult> {
  const access = await customFieldAccess();
  if (!access.ok) return { ok: false, message: access.message };
  if (!(await withinRateLimit(`customFieldDelete:${access.workspaceId}`, 60, 60 * 60_000))) return { ok: false, message: "Too many changes. Try again shortly." };
  const result = await removeField(access.workspaceId, fieldId);
  if (result.ok) for (const p of AFTER_FIELD_CHANGE) revalidatePath(p);
  return result;
}

// ---- delete this workspace and all its data ----

export async function deleteWorkspaceAction(_previous: ImportState | null, formData: FormData): Promise<ImportState> {
  const workspace = await getCurrentWorkspace();
  if (isSpendLocked(workspace)) return refuse(DEMO_LOCK_NOTICE);
  const user = await getSessionUser();
  if (!user?.isAdmin) return refuse("Only a workspace admin can delete the workspace.");
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
