// Assert-based check of the "show more" helpers (src/lib/pagination.ts). Pure
// logic, no database. The value comes straight from the address bar, so it is
// treated as hostile: only a plain whole number from 25 to 500 is accepted.
import { MAX_SHOW, PAGE_SIZE, moreCount, nextShow, pageSlice, parseShow, showMoreHref } from "../src/lib/pagination";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

// ---------- parseShow ----------
assert(parseShow(undefined) === 25, "A missing value gives the default of 25");
assert(parseShow("") === 25, "An empty value gives the default");
assert(parseShow("25") === 25 && parseShow("26") === 26 && parseShow("50") === 50 && parseShow("125") === 125, "Whole numbers in range are accepted as written");
assert(parseShow("500") === 500, "The cap of 500 is accepted");
for (const [input, why] of [
  ["501", "just over the cap"],
  ["1000", "four digits"],
  ["99999999999999999999", "a huge number"],
  ["24", "just under the minimum"],
  ["0", "zero"],
  ["1", "one"],
  ["-25", "negative"],
  ["+30", "an explicit plus sign"],
  [" 30", "a leading space"],
  ["30 ", "a trailing space"],
  ["30.5", "a decimal"],
  ["30.0", "a decimal that looks whole"],
  ["1e2", "scientific notation"],
  ["0x20", "hexadecimal"],
  ["025", "a leading zero"],
  ["NaN", "NaN"],
  ["Infinity", "Infinity"],
  ["abc", "text"],
  ["30; DROP TABLE", "an injection attempt"],
  ["%32%35", "an encoded value"],
] as const) {
  assert(parseShow(input) === 25, `${JSON.stringify(input)} (${why}) falls back to 25`);
}
assert(parseShow(["50"]) === 25 && parseShow(["50", "100"]) === 25 && parseShow([]) === 25, "A repeated parameter (an array) falls back to 25");
for (const n of [25, 26, 100, 500]) assert(parseShow(String(n)) === n, `${n} survives a round trip through the address bar`);

// ---------- pageSlice ----------
const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
assert(pageSlice([], 25).length === 0, "Slicing an empty list gives an empty list");
assert(pageSlice([1, 2, 3], 25).join() === "1,2,3", "A list shorter than the page is returned whole");
assert(pageSlice(hundred.slice(0, 25), 25).length === 25, "A list of exactly one page is returned whole");
assert(pageSlice(hundred, 25).length === 25 && pageSlice(hundred, 25)[0] === 1 && pageSlice(hundred, 25)[24] === 25, "A longer list gives the first 25 in their original order");
assert(pageSlice(hundred, 50).length === 50 && pageSlice(hundred, 500).length === 100, "A bigger page shows more, up to everything");
const original = [...hundred];
pageSlice(hundred, 25);
assert(JSON.stringify(hundred) === JSON.stringify(original), "Slicing never changes the full list, so totals computed from it stay whole");
for (const bad of [0, -5, 2.5, NaN, Infinity]) assert(pageSlice(hundred, bad).length === PAGE_SIZE, `An invalid page size (${bad}) shows the default 25 rather than nothing or everything`);

// ---------- nextShow and moreCount ----------
assert(nextShow(25, 10) === null && nextShow(25, 25) === null, "No next step when everything is already shown");
assert(nextShow(25, 120) === 50 && nextShow(50, 120) === 75, "The next step adds 25");
assert(nextShow(475, 800) === 500 && nextShow(500, 800) === null, "The next step stops at the cap of 500");
assert(nextShow(100, 110) === 125, "The last step can go past the total (the slice simply ends)");
assert(moreCount(25, 120) === 25 && moreCount(100, 110) === 10 && moreCount(120, 120) === 0 && moreCount(500, 120) === 0, "The link label counts only what is left to reveal");

// ---------- showMoreHref ----------
assert(showMoreHref("/health", {}, 50) === "/health?show=50", "A link with no other parameters carries just show");
assert(showMoreHref("/health", { segment: "abc123" }, 50) === "/health?segment=abc123&show=50", "The active segment is kept");
assert(showMoreHref("/health", { segment: "abc", show: "25" }, 50) === "/health?segment=abc&show=50", "An old show value is replaced, not duplicated");
assert(showMoreHref("/health", { segment: undefined }, 50) === "/health?show=50", "An absent parameter is dropped");
assert(showMoreHref("/health", { tag: ["a", "b"] }, 50) === "/health?tag=a&tag=b&show=50", "A repeated parameter is kept as repeated");
assert(showMoreHref("/health", { segment: "a&b=c d" }, 50) === "/health?segment=a%26b%3Dc+d&show=50", "Unusual characters are encoded, so one value can never inject another parameter");
assert(MAX_SHOW === 500 && PAGE_SIZE === 25, "The limits are 25 per step and 500 at most");

console.log("\nAll pagination checks passed.");
