"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Run now, resumable. Calls /api/capability-run again and again; each call
// does about 170 seconds of the work and reports progress, so a run longer
// than a hosted function may live still finishes. If the tab is closed or the
// connection drops, the run keeps its place: the button then reads "Continue".
interface Initial {
  status: "running" | "failed";
  processed: number;
  total: number;
  error: string | null;
}

const MAX_BUSY_POLLS = 120; // another caller holds the run; wait at most about 10 minutes

export default function RunNowButton({ capability, initial }: { capability: string; initial: Initial | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(
    initial ? { processed: initial.processed, total: initial.total } : null
  );
  const [error, setError] = useState<string | null>(initial?.status === "failed" ? initial.error : null);
  const [finished, setFinished] = useState(false);

  async function drive() {
    setBusy(true);
    setError(null);
    setFinished(false);
    let start = true;
    let busyPolls = 0;
    try {
      for (;;) {
        const res = await fetch("/api/capability-run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capability, start }),
        });
        start = false;
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
          break;
        }
        if (data.status === "idle") break;
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
      : "Run now";
  const pct = progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={drive}
        disabled={busy}
        className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] disabled:opacity-60 transition-colors text-white text-sm px-3 py-1.5"
      >
        {label}
      </button>
      {(busy || unfinished) && progress && progress.total > 0 && (
        <div className="h-1 w-40 rounded-full bg-zinc-200" aria-hidden>
          <div className="h-1 rounded-full bg-[#378ADD]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {busy && <p className="text-xs text-zinc-500">Keep this page open. Closing it only pauses the run.</p>}
      {finished && <p className="text-xs text-green-800">Finished.</p>}
      {error && <p className="max-w-xs text-right text-xs text-red-800">{error}</p>}
    </div>
  );
}
