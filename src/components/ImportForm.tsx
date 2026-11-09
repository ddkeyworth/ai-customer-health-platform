"use client";

import { useState, useTransition } from "react";
import { importCsvAction, previewImportAction, type ImportState } from "@/app/data/actions";
import type { PreviewColumn, PreviewResult } from "@/lib/import/preview";
import type { ImportKind } from "@/lib/import/validate";

// Two steps. "Check file" reads the file and shows what each column looks like
// it is; the person confirms or changes that; "Import" sends the same file and
// the choices back. The file stays in this page between the steps (a form action
// would empty the file box), and the server reads and checks the whole file
// again at step 2, so nothing here has to be trusted.

type Preview = Extract<PreviewResult, { ok: true }>;

interface Choice {
  action: PreviewColumn["action"];
  target: string;
  fieldId: string;
  label: string;
  type: "text" | "number" | "date" | "pick_list";
  optionsText: string;
  shareWithAi: boolean;
}

const TYPE_LABELS: Record<Choice["type"], string> = { text: "Text", number: "Number", date: "Date", pick_list: "Pick-list" };

function toChoice(c: PreviewColumn): Choice {
  return {
    action: c.action,
    target: c.target ?? "",
    fieldId: c.fieldId ?? "",
    label: c.label ?? "",
    type: c.type ?? "text",
    optionsText: (c.options ?? []).join(", "),
    shareWithAi: false, // a new field never starts shared with the AI
  };
}

const selectValue = (c: Choice) => (c.action === "map" ? `map:${c.target}` : c.action === "existing_custom" ? `existing:${c.fieldId}` : c.action === "custom" ? "new" : "ignore");

function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const o = part.trim();
    if (o !== "" && !seen.has(o.toLowerCase())) {
      seen.add(o.toLowerCase());
      out.push(o);
    }
  }
  return out;
}

function titleFromHeader(header: string): string {
  const words = header.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function ImportForm({ kind, disabled }: { kind: ImportKind; disabled?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<ImportState | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPreview(null);
    setChoices([]);
    setProblem(null);
  };

  const checkFile = () => {
    if (!file) {
      setProblem("Choose a CSV file first.");
      return;
    }
    setResult(null);
    setProblem(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      try {
        const r = await previewImportAction(fd);
        if (!r.ok) {
          setPreview(null);
          setProblem(r.message);
          return;
        }
        setPreview(r);
        setChoices(r.columns.map(toChoice));
      } catch {
        setProblem("The file could not be checked. Try again.");
      }
    });
  };

  const setChoice = (i: number, change: Partial<Choice>) => setChoices((all) => all.map((c, n) => (n === i ? { ...c, ...change } : c)));

  const onSelect = (i: number, value: string, column: PreviewColumn) => {
    if (value === "ignore") setChoice(i, { action: "ignore" });
    else if (value === "new") setChoice(i, { action: "custom", label: choices[i].label || column.label || titleFromHeader(column.display), shareWithAi: false });
    else if (value.startsWith("existing:")) setChoice(i, { action: "existing_custom", fieldId: value.slice("existing:".length) });
    else if (value.startsWith("map:")) setChoice(i, { action: "map", target: value.slice("map:".length) });
  };

  // What is still wrong, in plain words. The server checks all of this again.
  const problems: string[] = [];
  if (preview) {
    const owner = new Map<string, string>();
    const fieldOwner = new Map<string, string>();
    let newCount = 0;
    preview.columns.forEach((col, i) => {
      if (col.locked) return;
      const c = choices[i];
      if (!c) return;
      if (c.action === "map") {
        const other = owner.get(c.target);
        const label = preview.known.find((k) => k.name === c.target)?.label ?? c.target;
        if (other !== undefined) problems.push(`"${other}" and "${col.display}" are both set to ${label}. Choose one of them.`);
        else owner.set(c.target, col.display);
      } else if (c.action === "existing_custom") {
        const other = fieldOwner.get(c.fieldId);
        if (other !== undefined) problems.push(`"${other}" and "${col.display}" are both set to the same custom field. Choose one of them.`);
        else fieldOwner.set(c.fieldId, col.display);
      } else if (c.action === "custom") {
        newCount += 1;
        if (c.label.trim() === "") problems.push(`Give the new custom field for "${col.display}" a name.`);
        if (c.type === "pick_list" && parseOptions(c.optionsText).length === 0) problems.push(`Add the choices for the pick-list "${c.label || col.header}", separated by commas.`);
      }
    });
    for (const k of preview.known) {
      if (k.required && !owner.has(k.name)) problems.push(`Choose which column holds ${k.label}. This file needs it.`);
    }
    if (newCount > preview.fieldRoom) problems.push(`A workspace can have at most 25 custom fields. This would add ${newCount} and there is room for ${preview.fieldRoom}.`);
  }

  const runImport = () => {
    if (!file || !preview) return;
    const entries = preview.columns.flatMap((col, i) => {
      if (col.locked) return [];
      const c = choices[i];
      if (c.action === "map") return [{ header: col.header, action: "map", target: c.target }];
      if (c.action === "existing_custom") return [{ header: col.header, action: "existing_custom", fieldId: c.fieldId }];
      if (c.action === "custom") {
        return [
          {
            header: col.header,
            action: "custom",
            label: c.label.trim(),
            type: c.type,
            ...(c.type === "pick_list" ? { options: parseOptions(c.optionsText) } : {}),
            shareWithAi: c.shareWithAi,
          },
        ];
      }
      return [{ header: col.header, action: "ignore" }];
    });
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      fd.set("mapping", JSON.stringify(entries));
      try {
        const r = await importCsvAction(null, fd);
        setResult(r);
        if (r.ok) {
          reset();
          setFile(null);
          const input = document.querySelector<HTMLInputElement>(`input[aria-label="CSV file for ${kind}"]`);
          if (input) input.value = "";
        }
      } catch {
        setResult({ ok: false, message: "The import could not be completed. Nothing was changed. Try again.", errors: [] });
      }
    });
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || pending}
          aria-label={`CSV file for ${kind}`}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            reset();
          }}
          className="text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
        />
        {!preview && (
          <button
            type="button"
            onClick={checkFile}
            disabled={disabled || pending}
            className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
          >
            {pending ? "Checking..." : "Check file"}
          </button>
        )}
      </div>

      {problem && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {problem}
        </p>
      )}

      {preview && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-sm text-zinc-800">
            {preview.rowCount} {preview.rowCount === 1 ? "row" : "rows"} found. {preview.savedApplied ? "Saved mapping applied: these are the choices you made last time for a file with these columns. " : ""}
            Check what each column is, change anything that is wrong, then import.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 pr-3 font-medium">Column in your file</th>
                  <th className="py-1 pr-3 font-medium">What to do with it</th>
                </tr>
              </thead>
              <tbody>
                {preview.columns.map((col, i) => {
                  const c = choices[i];
                  if (!c) return null;
                  const existing = preview.existingFields.find((f) => f.id === c.fieldId);
                  return (
                    <tr key={i} className="border-t border-zinc-200 align-top">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-zinc-900">{col.display === "" ? "(no heading)" : col.display}</p>
                        {col.samples.length > 0 && <p className="mt-0.5 text-zinc-500">e.g. {col.samples.join(" | ")}</p>}
                      </td>
                      <td className="py-2 pr-3">
                        {col.locked ? (
                          <p className="text-zinc-600">Ignored. {col.reason}.</p>
                        ) : (
                          <>
                            <select
                              value={selectValue(c)}
                              disabled={pending}
                              aria-label={`What to do with the column ${col.display}`}
                              onChange={(e) => onSelect(i, e.target.value, col)}
                              className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm"
                            >
                              <optgroup label="A Bearing column">
                                {preview.known.map((k) => (
                                  <option key={k.name} value={`map:${k.name}`}>
                                    {k.label}
                                    {k.required ? " (needed)" : ""}
                                  </option>
                                ))}
                              </optgroup>
                              {preview.existingFields.length > 0 && (
                                <optgroup label="One of your custom fields">
                                  {preview.existingFields.map((f) => (
                                    <option key={f.id} value={`existing:${f.id}`}>
                                      {f.label}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {preview.canCreateFields && (
                                <optgroup label="Keep it">
                                  <option value="new">Create a new custom field</option>
                                </optgroup>
                              )}
                              <optgroup label="Leave it out">
                                <option value="ignore">Ignore this column</option>
                              </optgroup>
                            </select>
                            <p className="mt-0.5 text-zinc-500">{col.reason}</p>
                            {c.action === "existing_custom" && existing && (
                              <p className="mt-1 text-zinc-600">
                                {existing.shareWithAi ? "Included in AI reads" : "Not included in AI reads"}: this field keeps its current setting. Change it under Custom fields, lower down.
                              </p>
                            )}
                            {c.action === "custom" && (
                              <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-white p-2">
                                <label className="block">
                                  <span className="text-zinc-600">Field name</span>
                                  <input
                                    type="text"
                                    value={c.label}
                                    maxLength={60}
                                    disabled={pending}
                                    onChange={(e) => setChoice(i, { label: e.target.value })}
                                    className="mt-0.5 w-full max-w-xs rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-zinc-600">Type</span>
                                  <select
                                    value={c.type}
                                    disabled={pending}
                                    onChange={(e) => setChoice(i, { type: e.target.value as Choice["type"] })}
                                    className="mt-0.5 block rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm"
                                  >
                                    {(Object.keys(TYPE_LABELS) as Choice["type"][]).map((t) => (
                                      <option key={t} value={t}>
                                        {TYPE_LABELS[t]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {c.type === "pick_list" && (
                                  <label className="block">
                                    <span className="text-zinc-600">Choices, separated by commas</span>
                                    <input
                                      type="text"
                                      value={c.optionsText}
                                      disabled={pending}
                                      onChange={(e) => setChoice(i, { optionsText: e.target.value })}
                                      className="mt-0.5 w-full max-w-md rounded-lg border border-zinc-300 px-2 py-1 text-sm"
                                    />
                                  </label>
                                )}
                                <label className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={c.shareWithAi}
                                    disabled={pending}
                                    onChange={(e) => setChoice(i, { shareWithAi: e.target.checked })}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    <span className="text-zinc-900">Include in AI reads</span>
                                    <span className="block text-zinc-500">
                                      When on, this field&apos;s values are sent to Anthropic, using your workspace&apos;s own key, whenever the AI reads a customer.
                                    </span>
                                  </span>
                                </label>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {problems.length > 0 && (
            <ul role="alert" className="mt-2 list-disc rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runImport}
              disabled={disabled || pending || problems.length > 0}
              className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
            >
              {pending ? "Importing..." : "Import"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-sm text-zinc-800 px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div role="status" className={`mt-2 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          <p>{result.message}</p>
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
