// The plain-language read of a Health score when no AI is involved: it only
// restates what the deterministic baseline already measured, strongest and
// weakest signals first, and says plainly that no AI read has been added. Used
// when a workspace has no Anthropic key, so Health still works for free.
import type { DriverResult } from "./drivers";

export function baselineNarrative(drivers: DriverResult[], baselineScore: number): string {
  const scored = drivers.filter((d): d is DriverResult & { score: number } => d.score !== null);
  if (scored.length === 0) {
    return "There is not enough data about this account to score any signal yet. Import its tickets, usage and contract details to get a read.";
  }
  const byScore = [...scored].sort((a, b) => a.score - b.score);
  const weakest = byScore.slice(0, 3).filter((d) => d.score < 60);
  const strongest = byScore.slice(-2).reverse().filter((d) => d.score >= 75);

  const parts = [`Baseline score ${baselineScore}, from ${scored.length} of the ${drivers.length} signals that have data.`];
  if (weakest.length > 0) {
    parts.push(`Weakest signals: ${weakest.map((d) => `${d.label} (${Math.round(d.score)}): ${d.detail}`).join(" ")}`);
  }
  if (strongest.length > 0) {
    parts.push(`Strongest: ${strongest.map((d) => `${d.label} (${Math.round(d.score)})`).join(", ")}.`);
  }
  parts.push("This is the free baseline only. Add your Anthropic key and run Health for an AI read of the evidence behind the score.");
  return parts.join(" ");
}

// How much data backs the score. With no AI there is no self-assessment to
// lean on, so this is purely how many of the signals had data.
export function baselineConfidence(drivers: DriverResult[]): "early_read" | "established" {
  return drivers.filter((d) => d.score !== null).length >= 10 ? "established" : "early_read";
}
