"use client";

import { useState, useTransition } from "react";
import { deleteCustomFieldAction, renameCustomFieldAction, setCustomFieldAiSharingAction } from "@/app/data/actions";

export interface PanelField {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "pick_list";
  options: string[];
  shareWithAi: boolean;
}

const TYPE_NAMES: Record<PanelField["type"], string> = { text: "Text", number: "Number", date: "Date", pick_list: "Pick-list" };

// The workspace's custom fields. The "Include in AI reads" switch saves the
// moment it is flipped (and is read from the database again when the page
// loads, so what it shows after a reload is what was saved). Rename and delete
// are here too. Only an admin can change anything, and not on the shared demo.
export default function CustomFieldsPanel({ fields, disabled }: { fields: PanelField[]; disabled: boolean }) {
  const [rows, setRows] = useState(fields);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // When the server sends fresh fields (after a change or a reload), show them.
  const [seen, setSeen] = useState(fields);
  if (seen !== fields) {
    setSeen(fields);
    setRows(fields);
  }

  const toggle = (id: string, on: boolean) => {
    setRows((all) => all.map((f) => (f.id === id ? { ...f, shareWithAi: on } : f)));
    startTransition(async () => {
      const r = await setCustomFieldAiSharingAction(id, on).catch(() => ({ ok: false, message: "The change could not be saved." }));
      if (!r.ok) setRows((all) => all.map((f) => (f.id === id ? { ...f, shareWithAi: !on } : f)));
      setMessage({ ok: r.ok, text: r.message });
    });
  };

  const rename = () => {
    if (!editing) return;
    const { id, label } = editing;
    startTransition(async () => {
      const r = await renameCustomFieldAction(id, label).catch(() => ({ ok: false, message: "The change could not be saved.", field: undefined }));
      if (r.ok && r.field) {
        setRows((all) => all.map((f) => (f.id === id ? { ...f, label: r.field!.label } : f)));
        setEditing(null);
      }
      setMessage({ ok: r.ok, text: r.message });
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const r = await deleteCustomFieldAction(id).catch(() => ({ ok: false, message: "The field could not be deleted." }));
      if (r.ok) setRows((all) => all.filter((f) => f.id !== id));
      setConfirmDelete(null);
      setMessage({ ok: r.ok, text: r.message });
    });
  };

  if (rows.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No custom fields yet. When a customers file has a column Bearing has no built-in field for, you can keep it as a custom field while importing.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-zinc-100">
        {rows.map((f) => (
          <li key={f.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {editing?.id === f.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editing.label}
                      maxLength={60}
                      aria-label={`New name for ${f.label}`}
                      onChange={(e) => setEditing({ id: f.id, label: e.target.value })}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                    />
                    <button type="button" onClick={rename} disabled={busy} className="rounded-lg bg-[#0C447C] px-2.5 py-1 text-xs text-white disabled:opacity-60">
                      Save name
                    </button>
                    <button type="button" onClick={() => setEditing(null)} disabled={busy} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-800">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-zinc-900">{f.label}</p>
                )}
                <p className="mt-0.5 text-xs text-zinc-500">
                  {TYPE_NAMES[f.type]}
                  {f.type === "pick_list" && f.options.length > 0 ? `: ${f.options.join(", ")}` : ""}
                </p>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  role="switch"
                  checked={f.shareWithAi}
                  disabled={disabled || busy}
                  aria-label={`Include ${f.label} in AI reads`}
                  onChange={(e) => toggle(f.id, e.target.checked)}
                  className="mt-0.5"
                />
                <span className="max-w-xs">
                  <span className="text-zinc-900">Include in AI reads</span>
                  <span className="block text-zinc-500">When on, this field&apos;s values are sent to Anthropic, using your workspace&apos;s own key, whenever the AI reads a customer.</span>
                </span>
              </label>
            </div>
            {!disabled && editing?.id !== f.id && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <button type="button" onClick={() => setEditing({ id: f.id, label: f.label })} disabled={busy} className="text-[#378ADD] hover:underline">
                  Rename
                </button>
                {confirmDelete === f.id ? (
                  <span className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-2 py-1 text-red-900">
                    Delete &quot;{f.label}&quot;? Its values on every customer are removed too. This cannot be undone.
                    <button type="button" onClick={() => remove(f.id)} disabled={busy} className="rounded-lg bg-red-700 px-2.5 py-1 text-white disabled:opacity-60">
                      Delete field and values
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} disabled={busy} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-zinc-800">
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(f.id)} disabled={busy} className="text-red-700 hover:underline">
                    Delete
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-xs ${message.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
