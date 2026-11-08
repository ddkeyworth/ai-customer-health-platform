// Pure checks (no database) for the CSV reader, the row rules for every import
// file, and the export's spreadsheet-safety. These cover the awkward inputs a
// real spreadsheet produces: quotes, commas and line breaks inside cells,
// Windows line endings, a byte-order mark, blank lines, wrong types, and
// formulas smuggled into text.
import { parseCsv } from "../src/lib/import/csv";
import {
  LIMITS,
  parseDate,
  parseMoney,
  validateCustomerRows,
  validateInteractionRows,
  validateOutcomeRows,
  validateUsageRows,
} from "../src/lib/import/validate";
import { neutraliseFormula, toCsv } from "../src/lib/import/exportData";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const noneExisting = { refs: new Set<string>(), names: new Set<string>(), count: 0 };
const customers = (csv: string, existing = noneExisting) => {
  const p = parseCsv(csv);
  return validateCustomerRows(p.headers, p.rows, existing);
};
const lookup = new Map([["cus-0001", "id-1"], ["acme ltd", "id-1"], ["cus-0002", "id-2"]]);

// ---------- the reader ----------
let p = parseCsv("name,tier\nAcme,enterprise\nBeta,mid_market\n");
assert(p.headers.join() === "name,tier" && p.rows.length === 2 && p.rows[1].name === "Beta", "A plain file is read into rows keyed by header");
p = parseCsv('name,notes\n"Acme, Inc.","said ""hello"""\n');
assert(p.rows[0].name === "Acme, Inc." && p.rows[0].notes === 'said "hello"', "Commas and doubled quotes inside a quoted cell are kept");
p = parseCsv('name,notes\nAcme,"line one\nline two"\n');
assert(p.rows[0].notes === "line one\nline two" && p.rows.length === 1, "A line break inside quotes stays inside the cell");
p = parseCsv("name,tier\r\nAcme,enterprise\r\nBeta,mid_market\r\n");
assert(p.rows.length === 2 && p.rows[0].tier === "enterprise", "Windows line endings are handled");
p = parseCsv("﻿name,tier\nAcme,enterprise\n");
assert(p.headers[0] === "name", "A leading byte-order mark (Excel adds one) does not corrupt the first header");
p = parseCsv("name,tier\n\nAcme,enterprise\n   ,  \n\nBeta,mid_market");
assert(p.rows.length === 2, "Blank lines and a missing final newline are fine");
p = parseCsv("  Name , TIER \nAcme,enterprise\n");
assert(p.headers.join() === "name,tier", "Headers are trimmed and lower-cased");
p = parseCsv("name,tier,country\nAcme\n");
assert(p.rows[0].tier === "" && p.rows[0].country === "", "A short row is padded with empty cells, not shifted");
p = parseCsv("name,extra\nAcme,whatever\n");
assert(p.rows[0].extra === "whatever", "Columns the importer does not know are carried through, not rejected");
let threw = false;
try {
  parseCsv('name,notes\nAcme,"never closed\n');
} catch {
  threw = true;
}
assert(threw, "A quote that is never closed is refused instead of guessed at");
assert(parseCsv("").headers.length === 0 && parseCsv("\n\n").rows.length === 0, "An empty file gives no headers and no rows");
p = parseCsv("name,notes\nAcme,'=SUM(A1)\nBeta,'plain\n");
assert(p.rows[0].notes === "=SUM(A1)" && p.rows[1].notes === "'plain", "The formula guard quote is removed on re-import, and ordinary apostrophes are untouched");

// ---------- dates and money ----------
assert(parseDate("2026-02-28") instanceof Date && parseDate("") === null, "A real date parses and blank means no date");
for (const bad of ["2026-02-30", "28/02/2026", "2026-2-8", "20260228", "2026-13-01", "1850-01-01", "2200-01-01", "tomorrow"]) {
  assert(parseDate(bad) === "bad", `The date ${JSON.stringify(bad)} is refused`);
}
assert(parseMoney("48000") === 48000 && parseMoney("£1,200.50") === 1200.5 && parseMoney("") === 0, "Amounts accept a currency sign, commas and two decimals; blank is zero");
for (const bad of ["12k", "-5", "1.234", "abc", "1e9", "2000000000"]) {
  assert(parseMoney(bad) === "bad", `The amount ${JSON.stringify(bad)} is refused`);
}

// ---------- customers ----------
let r = customers("name\nAcme\n");
assert(r.errors.length === 0 && r.rows.length === 1, "A file with only a name column is valid");
assert(r.rows[0].tier === "mid_market" && r.rows[0].lifecycleStatus === "live" && r.rows[0].paymentStatus === "current" && r.rows[0].product === "Core product" && r.rows[0].renewalType === "auto", "Sensible defaults are filled in for everything left blank");
r = customers("country\nUK\n");
assert(r.errors.length === 1 && /missing the column: name/.test(r.errors[0].message), "A file with no name column is refused with a clear message");
r = customers("name\n");
assert(r.errors.length === 1 && /no customer rows/.test(r.errors[0].message), "A header with no rows is refused");
r = customers("name,tier,renewal_date,nps,days_past_due,contractual_arr,payment_status\nA,gold,2026-02-30,11,-1,12k,sometimes\n");
assert(r.rows.length === 0 && r.errors.length >= 6, "A row with several problems reports every one of them");
assert(r.errors.every((e) => e.row === 2), "Row numbers match the spreadsheet (the header is row 1)");
r = customers("name,tier\nA,enterprise\nB,bogus\nC,enterprise\nD,bogus\n");
assert(r.rows.length === 0 && r.errors.map((e) => e.row).join() === "3,5", "Good rows are not imported when any row is bad (all or nothing), and every bad row is listed");
r = customers("name,tier\nA,Enterprise\nB,mid-market\nC,SELF SERVE\n");
assert(r.errors.length === 0 && r.rows.map((x) => x.tier).join() === "enterprise,mid_market,self_serve", "Enum values are forgiving about case, hyphens and spaces");
r = customers("name,product\nAcme,Freight\nAcme,Warehouse\n");
assert(r.errors.length === 0 && r.rows.length === 2, "The same customer on two rows with different products is one customer with two products");
r = customers("name,product\nAcme,Freight\nacme,FREIGHT\n");
assert(r.errors.length === 1 && /listed twice/.test(r.errors[0].message), "The same customer and product twice is caught as an accidental duplicate (case-insensitive)");
r = customers("name,ref,product\nAcme,CUS-1,Freight\nAcme,CUS-9,Warehouse\n");
assert(r.errors.length === 1 && /second row/.test(r.errors[0].message), "A second row cannot give the customer a different ref");
r = customers("name,ref\nAcme,CUS-1\nBeta,cus-1\n");
assert(r.errors.length === 1 && /ref/.test(r.errors[0].message), "Two customers cannot share a ref (case-insensitive)");
r = customers("name,ref\nAcme,bad ref!\n");
assert(r.errors.length === 1, "A ref with spaces or symbols is refused");
r = customers("name,ref\nAcme,CUS-1\n", { refs: new Set(["cus-1"]), names: new Set(), count: 1 });
assert(r.errors.length === 1, "A ref that already exists in the workspace is refused");
r = customers("name\nAcme\n", { refs: new Set(), names: new Set(["acme"]), count: 1 });
assert(r.errors.length === 1 && /already exists/.test(r.errors[0].message), "A customer name that already exists in the workspace is refused");
r = customers("name,renewal_type,interrupted_reason\nA,auto,customer_requested\nB,interrupted,\nC,interrupted,company_defined\n");
assert(r.rows[0].interruptedReason === null && r.rows[1].interruptedReason === "customer_requested" && r.rows[2].interruptedReason === "company_defined", "An interrupted reason applies only to interrupted renewals and has a default");
r = customers("name,payment_status,days_past_due\nA,current,40\nB,late,40\n");
assert(r.rows[0].daysPastDue === 0 && r.rows[1].daysPastDue === 40, "Days past due is ignored for a payment that is current");
r = customers("name,contractual_arr,consumption_arr\nA,\"£1,200.50\",300\n");
assert(r.rows[0].contractualArr === 1200.5 && r.rows[0].consumptionArr === 300, "Amounts with a currency sign and thousands separators are read correctly");
r = customers("name\n" + "x".repeat(121) + "\n");
assert(r.errors.length === 1, "A name over 120 characters is refused");
const many = "name\n" + Array.from({ length: LIMITS.maxCustomers + 1 }, (_, i) => `C${i}`).join("\n");
r = customers(many);
assert(r.errors.length === 1 && /at most/.test(r.errors[0].message), "A file over the customer limit is refused with one clear message");
r = customers("name\nA\nB\n", { refs: new Set(), names: new Set(), count: LIMITS.maxCustomersPerWorkspace - 1 });
assert(r.errors.length === 1 && /workspace can hold at most/.test(r.errors[0].message), "The per-workspace customer cap counts what is already there");

// ---------- tickets, usage, outcomes ----------
let t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "Hello" }], lookup, 0);
assert(t.errors.length === 0 && t.rows[0].type === "ticket" && t.rows[0].severity === "low", "A ticket with only customer, date and text is valid, with defaults");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "ACME LTD", date: "2026-10-01", text: "Hi" }], lookup, 0);
assert(t.errors.length === 0 && t.rows[0].customerId === "id-1", "A customer can be named by exact name, ignoring case");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "Nobody", date: "2026-10-01", text: "Hi" }, { customer: "CUS-0002", date: "nope", text: "" }], lookup, 0);
assert(t.rows.length === 0 && t.errors.length === 3 && t.errors[0].row === 2 && t.errors[2].row === 3, "Unknown customer, bad date and empty text are each reported against their row");
t = validateInteractionRows(["customer", "date"], [], lookup, 0);
assert(/missing the column: text/.test(t.errors[0].message), "A tickets file without a text column is refused");
t = validateInteractionRows(["customer", "date", "text", "severity"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x", severity: "urgent" }], lookup, 0);
assert(t.errors.length === 1, "An unknown severity is refused");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "y".repeat(2001) }], lookup, 0);
assert(t.errors.length === 1, "A ticket longer than 2000 characters is refused");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x" }], lookup, LIMITS.maxChildRowsPerWorkspace);
assert(t.errors.length === 1, "The per-workspace ticket cap counts what is already there");

let u = validateUsageRows(["customer", "capability", "date", "value"], [{ customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "12.5" }], lookup, 0);
assert(u.errors.length === 0 && u.rows[0].metricType === "adoption" && u.rows[0].value === 12.5, "A usage row is valid and defaults to adoption");
u = validateUsageRows(["customer", "capability", "date", "value"], [{ customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "-3" }, { customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "abc" }, { customer: "CUS-0001", capability: "", date: "2026-10-01", value: "1" }], lookup, 0);
assert(u.rows.length === 0 && u.errors.length === 3, "Negative or non-numeric values and a missing capability are each refused");
u = validateUsageRows(["customer", "capability", "date", "value", "metric_type"], [{ customer: "CUS-0001", capability: "Calls", date: "2026-10-01", value: "5", metric_type: "metered" }], lookup, 0);
assert(u.errors.length === 1, "An unknown metric type is refused");

let o = validateOutcomeRows(["customer", "date", "type"], [{ customer: "CUS-0001", date: "2026-03-31", type: "RENEWED" }], lookup, 0);
assert(o.errors.length === 0 && o.rows[0].type === "renewed", "An outcome type is case-insensitive");
o = validateOutcomeRows(["customer", "date", "type"], [{ customer: "CUS-0001", date: "2026-03-31", type: "lost" }], lookup, 0);
assert(o.errors.length === 1, "An unknown outcome type is refused");

// ---------- export safety ----------
assert(neutraliseFormula("=HYPERLINK(\"http://x\")") === "'=HYPERLINK(\"http://x\")", "Text starting with = gets a guard quote");
for (const lead of ["+1", "-1", "@SUM(1)"]) assert(neutraliseFormula(lead) === `'${lead}`, `Text starting with ${lead[0]} gets a guard quote`);
assert(neutraliseFormula("Plain text") === "Plain text" && neutraliseFormula("2026-10-01") === "2026-10-01", "Ordinary text and dates are untouched");
const csv = toCsv(["a", "b", "c", "d", "e"], [["=cmd", -5, new Date("2026-10-01T00:00:00Z"), null, 'has "quote", and\nnewline']]);
assert(csv.split("\r\n")[1].startsWith("'=cmd,-5,2026-10-01,,"), "A formula-like cell is guarded, a negative NUMBER is not, dates are YYYY-MM-DD and null is empty");
const back = parseCsv(csv);
assert(back.rows[0].a === "=cmd" && back.rows[0].e === 'has "quote", and\nnewline', "Exporting then reading returns the original text exactly, including quotes, commas and line breaks");

console.log("\nAll CSV reader, row-rule and export-safety checks passed.");
