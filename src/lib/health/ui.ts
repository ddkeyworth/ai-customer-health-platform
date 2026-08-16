// Shared display helpers for Health screens - kept separate from the
// scoring logic in baseline.ts/agenticLayer.ts.

export function tierColor(tier: string | null) {
  switch (tier) {
    case "Thriving":
      return "bg-green-50 text-green-800";
    case "Stable":
      return "bg-blue-50 text-blue-800";
    case "Watch":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-red-50 text-red-800";
  }
}

export function driverBarColor(score: number | null) {
  if (score === null) return "bg-zinc-200";
  if (score >= 85) return "bg-green-500";
  if (score >= 60) return "bg-blue-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}
