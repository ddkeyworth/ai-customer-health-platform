// The 15 Health drivers - all have a real data source. A driver still
// returns null for a specific account with no underlying data of that kind
// (e.g. no Desired Outcome tracked, no champion identified) and contributes
// nothing to that account's score rather than being faked with a
// plausible-looking default; that's the honest choice, per-account, not a
// blanket gap in the model.

export type DriverKey =
  | "onboarding_pace"
  | "usage_trend"
  | "consumption_trend"
  | "desired_outcome_progress"
  | "ticket_volume_trend"
  | "ticket_severity"
  | "survey_score"
  | "champion_engagement"
  | "commercial_signal"
  | "escalation"
  | "training_consumption"
  | "payment_health"
  | "competitor_risk"
  | "capability_breadth"
  | "engagement_silence";

export interface DriverResult {
  key: DriverKey;
  label: string;
  // 0-100, higher is healthier. null = no data source for this driver yet.
  score: number | null;
  detail: string;
}

export const DRIVER_LABELS: Record<DriverKey, string> = {
  onboarding_pace: "Onboarding pace/delay",
  usage_trend: "Usage/engagement trend",
  consumption_trend: "Consumption trend",
  desired_outcome_progress: "Desired Outcome progress",
  ticket_volume_trend: "Support ticket volume trend",
  ticket_severity: "Support ticket severity + resolution",
  survey_score: "NPS / CSAT / CES",
  champion_engagement: "Stakeholder/champion engagement",
  commercial_signal: "Commercial/contract signal",
  escalation: "Escalation",
  training_consumption: "Training consumption",
  payment_health: "Payment/billing health",
  competitor_risk: "Competitor risk",
  capability_breadth: "Capability breadth/stickiness",
  engagement_silence: "Engagement silence",
};
