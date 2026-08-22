// Pure classification logic for the Calibration screen - extracted from
// src/app/calibration/page.tsx so it's directly testable from a plain
// script (prisma/test-calibration.ts) without needing a session/request
// context, the same reason src/lib/segments.ts takes an explicit workspaceId.
export const RISK_BANDS = ["Watch", "Critical"];

export type Verdict = "confirmed" | "missed" | "review" | "n/a";

export function judge(type: string, tierLabel: string | null): { verdict: Verdict; label: string } {
  if (!tierLabel) return { verdict: "n/a", label: "No score on file" };
  const wasRisk = RISK_BANDS.includes(tierLabel);

  if (type === "churned") {
    return wasRisk
      ? { verdict: "confirmed", label: "Score flagged risk, account churned" }
      : { verdict: "missed", label: "Score read healthy, account churned anyway" };
  }
  // renewed or expanded - a positive outcome
  return wasRisk
    ? { verdict: "review", label: "Score flagged risk, account did well anyway" }
    : { verdict: "confirmed", label: "Score read healthy, account did well" };
}
