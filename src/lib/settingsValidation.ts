// Pure validation rules used by Settings' Server Actions - extracted from
// src/app/settings/actions.ts so they're directly testable from a plain
// script (prisma/test-settings-validation.ts), the same reason
// src/lib/password.ts has no "server-only" guard.
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const CURRENCY_CODE = /^[A-Z]{3}$/;
export const ALLOWED_DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
export const ALLOWED_LANGUAGES = ["en-GB", "en-US"];
export const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export function clampRiskWeight(raw: number): number {
  return Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : 3;
}
