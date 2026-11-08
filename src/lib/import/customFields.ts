// Custom fields: columns in an uploaded customers file that Bearing does not
// have a built-in field for. A person can keep such a column as a field of
// their own (text, number, date or pick-list) instead of losing it. This file
// holds the types, the limits and the value checks. It is pure (no database,
// no network) so every rule can be tested on its own.
import { parseDate } from "./validate";

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "pick_list"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_LIMITS = {
  maxFields: 25, // per workspace, existing plus new
  maxLabel: 60,
  maxOptions: 50,
  maxOptionLength: 60,
  maxText: 500,
  maxNumber: 1_000_000_000_000,
};

export type CoerceResult = { ok: true; value: string | number | null } | { ok: false; error: string };

const NUMBER_PATTERN = /^(-?)[£$€]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,6})?$/;

// Checks one cell against a custom field's type. Blank means "no value" (null).
// Never throws: a bad value comes back as a plain-English error the person can fix.
export function coerceCustomValue(type: CustomFieldType, raw: string, options: string[] = []): CoerceResult {
  if (typeof raw !== "string") return { ok: false, error: "The value is not text." };
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  if (type === "text") {
    return text.length > CUSTOM_FIELD_LIMITS.maxText
      ? { ok: false, error: `Text must be ${CUSTOM_FIELD_LIMITS.maxText} characters or fewer.` }
      : { ok: true, value: text };
  }

  if (type === "number") {
    const m = NUMBER_PATTERN.exec(text);
    if (!m) return { ok: false, error: `"${text.slice(0, 40)}" is not a number. Use digits only; a currency sign and thousands commas are fine.` };
    const n = Number(`${m[1]}${m[2].replace(/,/g, "")}${m[3] ?? ""}`);
    if (!Number.isFinite(n) || Math.abs(n) > CUSTOM_FIELD_LIMITS.maxNumber) return { ok: false, error: "That number is too large." };
    return { ok: true, value: n };
  }

  if (type === "date") {
    const d = parseDate(text);
    return d === "bad" || d === null
      ? { ok: false, error: `"${text.slice(0, 40)}" is not a date. Write it as YYYY-MM-DD, for example 2026-03-31.` }
      : { ok: true, value: text };
  }

  if (type === "pick_list") {
    const wanted = text.toLowerCase();
    const match = options.find((o) => o.trim().toLowerCase() === wanted);
    if (match !== undefined) return { ok: true, value: match };
    const shown = options.slice(0, 5).join(", ");
    return { ok: false, error: `"${text.slice(0, 40)}" is not one of the allowed choices (${shown}${options.length > 5 ? ", ..." : ""}).` };
  }

  return { ok: false, error: "Unknown field type." };
}
