"use client";

import { useActionState } from "react";
import { importCsvAction, type ImportState } from "@/app/data/actions";
import type { ImportKind } from "@/lib/import/validate";

// One upload box. The server checks the whole file before it writes anything,
// so the result is either "imported N" or a list of the exact rows to fix.
export default function ImportForm({ kind, disabled }: { kind: ImportKind; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ImportState | null, FormData>(importCsvAction, null);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          disabled={disabled || pending}
          aria-label={`CSV file for ${kind}`}
          className="text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
        />
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
        >
          {pending ? "Importing..." : "Import"}
        </button>
      </div>
      {state && (
        <div
          role="status"
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          <p>{state.message}</p>
          {state.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {state.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
