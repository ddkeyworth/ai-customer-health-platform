// "Show more" for long lists. Pages stay server-rendered and stateless: the
// number of rows to display lives in a `show` query parameter (25 by default).
// Only what is RENDERED is sliced; every total, tile, band count and ranking is
// still worked out from the full data by the page before it slices.
//
// Pure functions, so they are covered by prisma/test-pagination.ts.

export const PAGE_SIZE = 25;
export const MAX_SHOW = 500;

// Strict: a plain whole number from 25 to 500 written without a sign, spaces,
// decimals or exponent. Anything else (missing, repeated, negative, 24, 501,
// "30.5", "1e2", "99999999999999999999") falls back to the default of 25.
export function parseShow(value: string | string[] | undefined): number {
  if (typeof value !== "string") return PAGE_SIZE;
  if (!/^[1-9]\d{0,2}$/.test(value)) return PAGE_SIZE;
  const n = Number(value);
  return n >= PAGE_SIZE && n <= MAX_SHOW ? n : PAGE_SIZE;
}

// The first `show` items, in their existing order. A `show` that is not a whole
// number of at least 1 is treated as the default page size.
export function pageSlice<T>(items: readonly T[], show: number): T[] {
  const n = Number.isInteger(show) && show >= 1 ? show : PAGE_SIZE;
  return items.slice(0, n);
}

// The `show` value the "Show more" link should use, or null when there is
// nothing more to show or the cap has been reached.
export function nextShow(show: number, total: number): number | null {
  if (show >= total || show >= MAX_SHOW) return null;
  return Math.min(show + PAGE_SIZE, MAX_SHOW);
}

// How many more rows the next click reveals (for the link's label).
export function moreCount(show: number, total: number): number {
  return Math.max(0, Math.min(PAGE_SIZE, total - Math.min(show, total)));
}

type Params = Record<string, string | string[] | undefined>;

// The link for the next step: the current page's own query parameters (most
// importantly `segment`) are all kept, any old `show` is replaced.
export function showMoreHref(path: string, params: Params, next: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "show" || value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) query.append(key, v);
    else query.set(key, value);
  }
  query.set("show", String(next));
  return `${path}?${query.toString()}`;
}
