"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Run now, resumable. Calls /api/capability-run again and again; each call
// does up to about 4 minutes of the work and reports progress, so a run longer
// than a hosted function may live still finishes. If the tab is closed or the
// connection drops, the run keeps its place: the button then reads "Continue".
// If a run has failed, "Start over" gives up on it and begins a new one; what
// it had already finished is kept.
interface Initial {
  status: "running" | "failed";
  processed: number;
  total: number;
  error: string | null;
}

const MAX_BUSY_POLLS = 120; // another caller holds the run; wait at most about 10 minutes

export default function RunNowButton({ capability, initial, label: idleLabel }: { capability: string; initial: Initial | null; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(
    initial ? { processed: initial.processed, total: initial.total } : null
  );
  const [error, setError] = useState<string | null>(initial?.status === "failed" ? initial.error : null);
  const [failed, setFailed] = useState(initial?.status === "failed");
  const [finished, setFinished] = useState(false);

  // mode "continue": carry on the unfinished run, or begin one if there is none.
  // mode "restart": abandon the failed run and begin a fresh one.
  async function drive(mode: "continue" | "restart") {
    setBusy(true);
    setError(null);
    setFailed(false);
    setFinished(false);
    if (mode === "restart") setProgress(null);
    let first = true;
    let busyPolls = 0;
    try {
      for (;;) {
        const res = await fetch("/api/capability-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(first && mode === "restart" ? { capability, restart: true } : { capability, start: first }),
        });
        first = false;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "The run could not continue.");
          break;
        }
        setProgress({ processed: data.processed, total: data.total });
        if (data.status === "done") {
          setFinished(true);
          setProgress(null);
          router.refresh();
          break;
        }
        if (data.status === "failed") {
          setError(data.error ?? "The run stopped.");
          setFailed(true);
          break;
        }
        if (data.status === "idle") {
          // The run was finished (or given up on) by someone else while we
          // waited. Clear the stale progress so the button never keeps saying
          // Continue, which would start a brand new paid run if clicked.
          setProgress(null);
          setFinished(true);
          router.refresh();
          break;
        }
        if (data.status === "busy") {
          busyPolls += 1;
          if (busyPolls > MAX_BUSY_POLLS) {
            setError("Another run is still working on this. Try again in a few minutes.");
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    } catch {
      setError("The connection dropped. Your progress is saved: click Continue to carry on.");
    }
    setBusy(false);
    router.refresh();
  }

  const unfinished = progress !== null && progress.total > 0;
  const label = busy
    ? progress
      ? `Working... ${progress.processed} of ${progress.total}`
      : "Starting..."
    : unfinished
      ? `Continue (${progress!.processed} of ${progress!.total} done)`
      : (idleLabel ?? "Run now");
  const pct = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {failed && !busy && (
          <button
            type="button"
            onClick={() => drive("restart")}
            className="rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-800 text-sm px-3 py-1.5"
          >
            Start over
          </button>
        )}
        <button
          type="button"
          onClick={() => drive("continue")}
          disabled={busy}
          className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
        >
          {label}
        </button>
      </div>
      {(busy || unfinished) && progress && progress.total > 0 && (
        <div className="h-1 w-40 rounded-full bg-zinc-200" aria-hidden>
          <div className="h-1 rounded-full bg-[#378ADD]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {busy && <p className="text-xs text-zinc-500">Keep this page open. Closing it only pauses the run.</p>}
      {finished && <p className="text-xs text-green-800">Finished.</p>}
      {failed && !busy && (
        <p className="max-w-xs text-right text-xs text-zinc-500">
          Continue tries the failed step again. Start over drops what is left of this run and begins a new one; everything already finished is kept.
        </p>
      )}
      {error && <p className="max-w-xs text-right text-xs text-red-800">{error}</p>}
    </div>
  );
}
