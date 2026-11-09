// What the "Custom fields" panel on the Data page does, as plain functions the
// Server Actions call after they have checked the session, the admin role and
// the demo lock. Each one validates its input strictly (it arrives from the
// browser), only ever touches the workspace id it is given, and answers in
// plain words. Kept apart from the Server Actions so the database tests can
// run the same code path without a web request.
import { CustomFieldError, deleteCustomField, listCustomFields, updateCustomField, type CustomFieldDef } from "./store";

export interface PanelResult {
  ok: boolean;
  message: string;
  field?: CustomFieldDef;
}

const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 64;

// Turns "Include in AI reads" on or off for one field. Saved immediately.
export async function setFieldAiSharing(workspaceId: string, fieldId: unknown, on: unknown): Promise<PanelResult> {
  if (!validId(fieldId) || typeof on !== "boolean") return { ok: false, message: "That change could not be read." };
  const field = await updateCustomField(workspaceId, fieldId, { shareWithAi: on });
  if (!field) return { ok: false, message: "That custom field no longer exists." };
  return {
    ok: true,
    field,
    message: on
      ? `"${field.label}" is now included in AI reads: its values are sent to Anthropic, using your own key, whenever the AI reads a customer.`
      : `"${field.label}" is no longer included in AI reads.`,
  };
}

export async function renameField(workspaceId: string, fieldId: unknown, label: unknown): Promise<PanelResult> {
  if (!validId(fieldId) || typeof label !== "string") return { ok: false, message: "That change could not be read." };
  try {
    const field = await updateCustomField(workspaceId, fieldId, { label });
    if (!field) return { ok: false, message: "That custom field no longer exists." };
    return { ok: true, field, message: `Renamed to "${field.label}".` };
  } catch (e) {
    if (e instanceof CustomFieldError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function removeField(workspaceId: string, fieldId: unknown): Promise<PanelResult> {
  if (!validId(fieldId)) return { ok: false, message: "That change could not be read." };
  const before = (await listCustomFields(workspaceId)).find((f) => f.id === fieldId);
  if (!before) return { ok: false, message: "That custom field no longer exists." };
  const removed = await deleteCustomField(workspaceId, fieldId);
  if (!removed) return { ok: false, message: "That custom field no longer exists." };
  return { ok: true, message: `Deleted "${before.label}" and removed its values from every customer.` };
}
