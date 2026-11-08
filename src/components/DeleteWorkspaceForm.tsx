"use client";

import { useActionState } from "react";
import { deleteWorkspaceAction, type ImportState } from "@/app/data/actions";

export default function DeleteWorkspaceForm({ workspaceName, disabled }: { workspaceName: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ImportState | null, FormData>(deleteWorkspaceAction, null);
  return (
    <form action={action} className="mt-3 space-y-2">
      <label className="block text-xs text-zinc-600" htmlFor="confirm-delete">
        Type <strong>{workspaceName}</strong> to confirm
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="confirm-delete"
          name="confirm"
          autoComplete="off"
          disabled={disabled || pending}
          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
        >
          {pending ? "Deleting..." : "Delete everything"}
        </button>
      </div>
      {state && !state.ok && (
        <p role="status" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
    </form>
  );
}
