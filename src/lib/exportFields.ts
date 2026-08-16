// Candidate fields for the export allowlist - config only, matching the
// "show the concept, don't operationalize" pattern used for Integrations/SSO.
// No export mechanism is built; this only records which of Bearing's own
// generated fields an org would want pushed back to their CRM if/when a real
// export pipeline exists. Scoped to fields that actually exist in this build.

export const EXPORT_FIELDS = [
  { key: "health_score", label: "Health score" },
  { key: "health_drivers", label: "Health driver breakdown" },
  { key: "health_narrative", label: "Health narrative (why the score is what it is)" },
  { key: "expansion_opportunities", label: "Expansion opportunities" },
  { key: "competitor_risk_flags", label: "Competitor-risk flags" },
] as const;

export const EXPORT_FIELD_KEYS = EXPORT_FIELDS.map((f) => f.key);
