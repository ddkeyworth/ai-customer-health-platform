// Pure checks (no database) for the CSV reader, the row rules for every import
// file, the column tidying, the hosted and self-hosted limits, and the export's
// spreadsheet safety. These cover the awkward inputs a real spreadsheet
// produces: quotes, commas and line breaks inside cells, Windows line endings,
// a byte-order mark, blank lines, spaces before quotes, wrong types, hostile
// sizes and formulas smuggled into text.
import { MAX_COLUMNS, MAX_RECORDS, headerProblems, parseCsv } from "../src/lib/import/csv";
import {
  KNOWN_COLUMNS,
  LIMITS,
  activeLimits,
  canonicaliseHeaders,
  ignoredColumns,
  nameKey,
  normaliseName,
  parseDate,
  parseMoney,
  validateCustomerRows,
  validateEventRows,
  validateGoalRows,
  validateInteractionRows,
  validateOutcomeRows,
  validateStakeholderRows,
  validateSurveyRows,
  validateTrainingRows,
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
  return validateCustomerRows(p.headers, p.rows, existing, p.lines);
};
const lookup = new Map([["cus-0001", "id-1"], ["acme ltd", "id-1"], ["cus-0002", "id-2"]]);
const savedSelfHosted = process.env.SELF_HOSTED;

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

// spaces before an opening quote
p = parseCsv('name,notes\nAcme, "x,y"\n');
assert(p.rows[0].notes === "x,y" && Object.keys(p.rows[0]).length === 2, "A space before an opening quote is allowed and the comma inside the quotes stays in the cell (a, \"x,y\")");
p = parseCsv('name,notes,extra\nAcme,\t "say ""hi""",z\n');
assert(p.rows[0].notes === 'say "hi"' && p.rows[0].extra === "z", "Tabs and spaces before a quote are dropped, and the next column is not shifted");
p = parseCsv('name,notes\nAcme,"x,y" \n');
assert(p.rows[0].notes === "x,y", "Spaces after a closing quote are trimmed");

// real line numbers
p = parseCsv('name,notes\n\nAcme,"a\nb"\nBeta,x\n');
assert(p.lines.join() === "3,5", "Row numbers are the physical lines: blank lines and lines inside a quoted cell count (rows start on lines 3 and 5)");
p = parseCsv("name\r\nA\r\n\r\nB\r\n");
assert(p.lines.join() === "2,4", "Line numbers are right with Windows line endings and a blank line");
p = parseCsv("\n\nname\nA\n");
assert(p.headers[0] === "name" && p.lines.join() === "4", "Leading blank lines before the header are counted too");

// the form guard is reversible, including real apostrophes
for (const original of ["=A1", "+1", "-1", "@SUM(1)", "'=A1", "''=A1", "'+1", "'-1", "'@x", "'plain", "'", "plain", "a=b", "\tfoo", "x'=y"]) {
  const out = parseCsv(toCsv(["text"], [[original]])).rows[0].text;
  assert(out === original, `The formula guard round-trips ${JSON.stringify(original)} exactly (got ${JSON.stringify(out)})`);
}
assert(neutraliseFormula("=x") === "'=x" && neutraliseFormula("'=x") === "''=x" && neutraliseFormula("'x") === "'x", "The guard adds one quote to a formula and to a formula that already begins with an apostrophe, and leaves other text alone");

// hostile sizes are refused while reading, before any row object is built
assert(MAX_COLUMNS === 60 && MAX_RECORDS === 20_001, "The reader's limits are 60 columns and 20,001 records (a header plus 20,000 rows)");
p = parseCsv(Array.from({ length: 60 }, (_, i) => `c${i}`).join(",") + "\n" + Array.from({ length: 60 }, () => "x").join(",") + "\n");
assert(p.headers.length === 60 && p.rows.length === 1, "A file with exactly 60 columns is read");
threw = false;
try {
  parseCsv(Array.from({ length: 61 }, (_, i) => `c${i}`).join(",") + "\nx\n");
} catch (e) {
  threw = /more than 60 columns/.test((e as Error).message);
}
assert(threw, "A file with 61 columns is refused with a plain message");
let t0 = Date.now();
threw = false;
try {
  parseCsv(",".repeat(100_000) + "\n" + "a\n".repeat(1000));
} catch (e) {
  threw = /more than 60 columns/.test((e as Error).message);
}
assert(threw && Date.now() - t0 < 1000, `A header of 100,000 commas is refused immediately (${Date.now() - t0} ms), not after rows times columns of work`);
p = parseCsv("name\n" + Array.from({ length: 20_000 }, (_, i) => `C${i}`).join("\n") + "\n");
assert(p.rows.length === 20_000, "A file of exactly 20,000 data rows is read");
t0 = Date.now();
threw = false;
try {
  parseCsv("name\n" + "a\n".repeat(400_000));
} catch (e) {
  threw = /more than 20000 rows/.test((e as Error).message);
}
assert(threw && Date.now() - t0 < 2000, `A file of 400,000 short lines is refused (${Date.now() - t0} ms)`);

// header problems
assert(headerProblems(["name", "tier"]).length === 0, "A clean header row has no problems");
assert(headerProblems(["name", "", "tier"]).length === 1 && /no name/.test(headerProblems(["name", "", "tier"])[0]), "An empty column name is refused with a clear message");
const hp = headerProblems(["name", "tier", "name", "tier"]);
assert(hp.length === 1 && /name, tier/.test(hp[0]), "Duplicate column names are refused and listed");
assert(headerProblems(["", ""]).length === 1 && /2 columns have no name/.test(headerProblems(["", ""])[0]), "Several empty column names are counted");

// ---------- dates, money, names ----------
assert(parseDate("2026-02-28") instanceof Date && parseDate("") === null, "A real date parses and blank means no date");
for (const bad of ["2026-02-30", "28/02/2026", "2026-2-8", "20260228", "2026-13-01", "1850-01-01", "2200-01-01", "tomorrow"]) {
  assert(parseDate(bad) === "bad", `The date ${JSON.stringify(bad)} is refused`);
}
assert(parseMoney("48000") === 48000 && parseMoney("£1,200.50") === 1200.5 && parseMoney("1,200") === 1200 && parseMoney("1,000,000") === 1_000_000 && parseMoney("") === 0, "Amounts accept a currency sign, thousands commas in correct groups and two decimals; blank is zero");
for (const bad of ["12k", "-5", "1.234", "abc", "1e9", "2000000000", "1,50", "48,00", "1.234,56", "1,2345", ",100", "100,", "12,34,567", "1,2"]) {
  assert(parseMoney(bad) === "bad", `The amount ${JSON.stringify(bad)} is refused (a decimal comma must never be read as thousands)`);
}
assert(normaliseName("  Acme   Ltd  ") === "Acme Ltd" && normaliseName("Café") === "Café", "Names collapse spaces and compose accents");
assert(nameKey("ACME   Ltd") === "acme ltd", "Name comparison ignores case and extra spaces");

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
assert(r.errors.every((e) => e.row === 2), "Row numbers match the file (the header is row 1)");
r = customers("name,tier\nA,enterprise\nB,bogus\nC,enterprise\nD,bogus\n");
assert(r.rows.length === 0 && r.errors.map((e) => e.row).join() === "3,5", "Good rows are not imported when any row is bad (all or nothing), and every bad row is listed");
r = customers('name,tier\n\nA,bogus\n"B\nC",bogus\n');
assert(r.errors.map((e) => e.row).join() === "3,4", "Errors name the physical line of the file, counting blank lines and lines inside quotes");
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
r = customers("name\n  ACME    Ltd \n", { refs: new Set(), names: new Set(["acme ltd"]), count: 1 });
assert(r.errors.length === 1 && /already exists/.test(r.errors[0].message), "An existing customer is recognised despite different case and extra spaces");
r = customers("name,product\nAcme  Ltd,A\nAcme Ltd,A\n");
assert(r.errors.length === 1 && /listed twice/.test(r.errors[0].message), "Names that differ only by spaces are the same customer");
r = customers("name,product\nCafé,A\nCafé,A\n");
assert(r.errors.length === 1 && /listed twice/.test(r.errors[0].message), "Names that differ only by accent encoding (NFC and NFD) are the same customer");
r = customers("name\n  Acme   Ltd  \n");
assert(r.rows[0].name === "Acme Ltd", "A name is stored with its spaces collapsed");
r = customers("name,renewal_type,interrupted_reason\nA,auto,customer_requested\nB,interrupted,\nC,interrupted,company_defined\n");
assert(r.rows[0].interruptedReason === null && r.rows[1].interruptedReason === "customer_requested" && r.rows[2].interruptedReason === "company_defined", "An interrupted reason applies only to interrupted renewals and has a default");
r = customers("name,payment_status,days_past_due\nA,current,40\nB,late,40\n");
assert(r.rows[0].daysPastDue === 0 && r.rows[1].daysPastDue === 40, "Days past due is ignored for a payment that is current");
r = customers('name,contractual_arr,consumption_arr\nA,"£1,200.50",300\n');
assert(r.rows[0].contractualArr === 1200.5 && r.rows[0].consumptionArr === 300, "Amounts with a currency sign and thousands separators are read correctly");
r = customers('name,contractual_arr\nA,"1,50"\nB,"48,00"\n');
assert(r.errors.length === 2 && /thousands separators/.test(r.errors[0].message), "A European decimal comma is refused with a message about the format, not read as 150 or 4800");
r = customers("name\n" + "x".repeat(121) + "\n");
assert(r.errors.length === 1, "A name over 120 characters is refused");
r = customers("name,region,city,sub_industry\nA,EMEA,London,Freight forwarding\n");
assert(r.errors.length === 0 && r.rows[0].region === "EMEA" && r.rows[0].city === "London" && r.rows[0].subIndustry === "Freight forwarding", "Region, city and sub-industry are read");
r = customers(`name,region\nA,${"x".repeat(81)}\n`);
assert(r.errors.length === 1, "A region over 80 characters is refused");
r = customers("name,nps,nps_date\nA,8,2026-09-30\n");
assert(r.errors.length === 0 && r.rows[0].nps === 8 && r.rows[0].npsDate instanceof Date, "An NPS can carry the date it was given");
r = customers("name,nps,nps_date\nA,,2026-09-30\n");
assert(r.errors.length === 1 && /needs an nps score/.test(r.errors[0].message), "An NPS date without a score is refused");
r = customers("name,nps,nps_date\nA,8,30/09/2026\n");
assert(r.errors.length === 1, "A badly written NPS date is refused");
const many = "name\n" + Array.from({ length: LIMITS.maxCustomers + 1 }, (_, i) => `C${i}`).join("\n");
r = customers(many);
assert(r.errors.length === 1 && /at most/.test(r.errors[0].message), "A file over the customer limit is refused with one clear message");
r = customers("name\nA\nB\n", { refs: new Set(), names: new Set(), count: LIMITS.maxCustomersPerWorkspace - 1 });
assert(r.errors.length === 1 && /workspace can hold at most/.test(r.errors[0].message), "The per-workspace customer cap counts what is already there");

// a repeat row (another product) may not contradict the first row
r = customers("name,product,tier,country,nps,champion_name\nAcme,A,enterprise,UK,8,Alex\nAcme,B,enterprise,UK,8,Alex\nAcme,C,,,,\n");
assert(r.errors.length === 0 && r.rows.length === 3, "Later rows may leave customer-level values blank or repeat them exactly");
r = customers("name,product,tier\nAcme,A,enterprise\nAcme,B,mid_market\n");
assert(r.errors.length === 1 && /different tier/.test(r.errors[0].message) && r.errors[0].row === 3, "A later row that gives a different tier is refused, naming the row and the field");
r = customers("name,product,country\nAcme,A,UK\nAcme,B,Germany\n");
assert(r.errors.length === 1 && /different country/.test(r.errors[0].message), "A later row that gives a different country is refused");
r = customers("name,product,nps\nAcme,A,8\nAcme,B,3\n");
assert(r.errors.length === 1 && /different nps/.test(r.errors[0].message), "A later row that gives a different NPS is refused");
r = customers("name,product,champion_name\nAcme,A,Alex\nAcme,B,Sam\n");
assert(r.errors.length === 1 && /different champion_name/.test(r.errors[0].message), "A later row that names a different champion is refused");
r = customers("name,product,tier\nAcme,A,\nAcme,B,enterprise\n");
assert(r.errors.length === 1 && /different tier/.test(r.errors[0].message), "A later row cannot set a tier that the first row left to its default");
r = customers("name,product,tier\nAcme,A,\nAcme,B,mid_market\n");
assert(r.errors.length === 0, "A later row may state the same value the first row defaulted to");
r = customers("name,product,renewal_type,interrupted_reason\nAcme,A,auto,\nAcme,B,,customer_requested\n");
assert(r.errors.length === 1 && /interrupted_reason/.test(r.errors[0].message), "A later row cannot add an interrupted reason the first row does not have");
r = customers("name,product,country\nAcme,A,United  Kingdom\nAcme,B,united kingdom\n");
assert(r.errors.length === 0, "Customer-level text is compared ignoring case and extra spaces");

// real line numbers reach the validators
{
  const q = parseCsv("name,tier\nA,bogus\n\nB,bogus\n");
  const res = validateCustomerRows(q.headers, q.rows, noneExisting, q.lines);
  assert(res.errors.map((e) => e.row).join() === "2,4", "Validators report the line numbers the reader supplies");
  const res2 = validateCustomerRows(q.headers, q.rows, noneExisting);
  assert(res2.errors.map((e) => e.row).join() === "2,3", "Without line numbers the first data row is row 2");
}

// ---------- hosted and self-hosted limits ----------
delete process.env.SELF_HOSTED;
let lim = activeLimits();
assert(lim.maxChildRowsPerWorkspace === 2_000 && lim.maxCapabilitiesPerWorkspace === 50 && lim.maxNewCapabilitiesPerFile === 50, "The hosted site allows 2,000 rows per file type and 50 capabilities per workspace");
process.env.SELF_HOSTED = "true";
lim = activeLimits();
assert(lim.maxChildRowsPerWorkspace === 100_000 && lim.maxCapabilitiesPerWorkspace === 1_000, "A self-hosted copy keeps the large limits");
process.env.SELF_HOSTED = "yes";
assert(activeLimits().maxChildRowsPerWorkspace === 2_000, "A mistyped SELF_HOSTED keeps the hosted limits");
delete process.env.SELF_HOSTED;
let tk = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x" }], lookup, 2_000);
assert(tk.errors.length === 1 && /2000 tickets/.test(tk.errors[0].message), "On the hosted site the 2,000-row cap counts what is already there");
process.env.SELF_HOSTED = "true";
tk = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x" }], lookup, 2_000);
assert(tk.errors.length === 0, "The same file is fine on a self-hosted copy");
if (savedSelfHosted === undefined) delete process.env.SELF_HOSTED;
else process.env.SELF_HOSTED = savedSelfHosted;

// ---------- unrecognised and tidied columns ----------
assert(ignoredColumns("customers", ["name", "contractual_arr", "owner", "health notes"]).join("|") === "owner|health notes", "Columns the importer does not know are listed as ignored");
assert(ignoredColumns("customers", KNOWN_COLUMNS.customers).length === 0, "Every column the customers export writes is known, so a round trip never warns");
assert(ignoredColumns("tickets", ["customer", "date", "text", "priority"]).join() === "priority", "Each file kind has its own known columns");
assert(ignoredColumns("customers", ["name", ""]).length === 0, "A blank header is not reported as an ignored column (it is refused separately)");
let tidy = canonicaliseHeaders("customers", ["name", "contractual arr", "Renewal-Date".toLowerCase(), "go live date"], [{ name: "A", "contractual arr": "5", "renewal-date": "2027-01-01", "go live date": "2024-01-01" }]);
assert(tidy.headers.join() === "name,contractual_arr,renewal_date,go_live_date" && tidy.rows[0].contractual_arr === "5" && tidy.rows[0].renewal_date === "2027-01-01", "Headers written with spaces or hyphens are read as the column they obviously mean");
assert(tidy.renamed.length === 3, "Every renamed column is reported");
tidy = canonicaliseHeaders("customers", ["name", "renewal_date", "renewal date"], [{ name: "A", renewal_date: "2027-01-01", "renewal date": "2028-01-01" }]);
assert(tidy.headers.join() === "name,renewal_date,renewal date" && tidy.rows[0].renewal_date === "2027-01-01", "A column is not renamed onto one that is already there");
tidy = canonicaliseHeaders("customers", ["name", "foo bar"], [{ name: "A", "foo bar": "x" }]);
assert(tidy.renamed.length === 0, "A column that matches nothing stays as it is, to be reported as ignored");
const misspelt = parseCsv("Name,Contractual ARR\nAcme,48000\n");
const fixed = canonicaliseHeaders("customers", misspelt.headers, misspelt.rows);
assert(validateCustomerRows(fixed.headers, fixed.rows, noneExisting, misspelt.lines).rows[0].contractualArr === 48000, "A header such as Contractual ARR now imports its amount instead of silently importing 0");

// ---------- shared by every child file ----------
const resolved = validateInteractionRows(["customer", "date", "text"], [{ customer: "  ACME   LTD ", date: "2026-10-01", text: "Hi" }], lookup, 0);
assert(resolved.errors.length === 0 && resolved.rows[0].customerId === "id-1", "A customer can be named by exact name, ignoring case and extra spaces");

// ---------- tickets, usage, outcomes ----------
let t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "Hello" }], lookup, 0);
assert(t.errors.length === 0 && t.rows[0].type === "ticket" && t.rows[0].severity === null, "A ticket with only customer, date and text is valid; type defaults to ticket and a blank severity stays not recorded");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "Nobody", date: "2026-10-01", text: "Hi" }, { customer: "CUS-0002", date: "nope", text: "" }], lookup, 0);
assert(t.rows.length === 0 && t.errors.length === 3 && t.errors[0].row === 2 && t.errors[2].row === 3, "Unknown customer, bad date and empty text are each reported against their row");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "Nobody", date: "2026-10-01", text: "Hi" }], lookup, 0, [14]);
assert(t.errors[0].row === 14, "A child file reports the line numbers it is given");
t = validateInteractionRows(["customer", "date"], [], lookup, 0);
assert(/missing the column: text/.test(t.errors[0].message), "A tickets file without a text column is refused");
t = validateInteractionRows(["customer", "date", "text", "severity"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x", severity: "urgent" }], lookup, 0);
assert(t.errors.length === 1, "An unknown severity is refused");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "y".repeat(2001) }], lookup, 0);
assert(t.errors.length === 1, "A ticket longer than 2000 characters is refused");
t = validateInteractionRows(["customer", "date", "text"], [{ customer: "CUS-0001", date: "2026-10-01", text: "x" }], lookup, LIMITS.maxChildRowsPerWorkspace);
assert(t.errors.length === 1, "The per-workspace ticket cap counts what is already there");

let u = validateUsageRows(["customer", "capability", "date", "value"], [{ customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "12.5" }], lookup, 0);
assert(u.errors.length === 0 && u.rows[0].metricType === "adoption" && u.rows[0].value === 12.5 && u.rows[0].product === null && u.rows[0].metricExplicit === false, "A usage row is valid; it defaults to adoption, no product, and remembers the metric was not stated");
u = validateUsageRows(["customer", "product", "capability", "date", "value", "metric_type"], [{ customer: "CUS-0001", product: "Freight", capability: "Tracking", date: "2026-10-01", value: "1", metric_type: "consumption" }], lookup, 0);
assert(u.rows[0].product === "Freight" && u.rows[0].metricExplicit === true && u.rows[0].metricType === "consumption", "A usage row can name its product and states its metric type");
u = validateUsageRows(["customer", "capability", "date", "value"], [{ customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "-3" }, { customer: "CUS-0001", capability: "Tracking", date: "2026-10-01", value: "abc" }, { customer: "CUS-0001", capability: "", date: "2026-10-01", value: "1" }], lookup, 0);
assert(u.rows.length === 0 && u.errors.length === 3, "Negative or non-numeric values and a missing capability are each refused");
u = validateUsageRows(["customer", "capability", "date", "value", "metric_type"], [{ customer: "CUS-0001", capability: "Calls", date: "2026-10-01", value: "5", metric_type: "metered" }], lookup, 0);
assert(u.errors.length === 1, "An unknown metric type is refused");
u = validateUsageRows(["customer", "capability", "date", "value", "metric_type"], [
  { customer: "CUS-0001", capability: "Calls", date: "2026-10-01", value: "5", metric_type: "adoption" },
  { customer: "CUS-0002", capability: "calls", date: "2026-10-02", value: "6", metric_type: "consumption" },
], lookup, 0);
assert(u.errors.length === 1 && /two different metric types/.test(u.errors[0].message) && u.errors[0].row === 3, "The same capability given two metric types in one file is refused");

let o = validateOutcomeRows(["customer", "date", "type"], [{ customer: "CUS-0001", date: "2026-03-31", type: "RENEWED" }], lookup, 0);
assert(o.errors.length === 0 && o.rows[0].type === "renewed", "An outcome type is case-insensitive");
o = validateOutcomeRows(["customer", "date", "type"], [{ customer: "CUS-0001", date: "2026-03-31", type: "lost" }], lookup, 0);
assert(o.errors.length === 1, "An unknown outcome type is refused");

// ---------- stakeholders ----------
let sk = validateStakeholderRows(["customer", "name"], [{ customer: "CUS-0001", name: "Alex" }], lookup, 0);
assert(sk.errors.length === 0 && sk.rows[0].role === "Contact" && sk.rows[0].isChampion === false && sk.rows[0].lastEngagedAt === null, "A stakeholder needs only a customer and a name; role defaults to Contact and champion to no");
for (const yes of ["yes", "Y", "TRUE", "1"]) {
  sk = validateStakeholderRows(["customer", "name", "is_champion"], [{ customer: "CUS-0001", name: "A", is_champion: yes }], lookup, 0);
  assert(sk.rows[0]?.isChampion === true, `is_champion ${JSON.stringify(yes)} means yes`);
}
for (const no of ["no", "N", "false", "0", ""]) {
  sk = validateStakeholderRows(["customer", "name", "is_champion"], [{ customer: "CUS-0001", name: "A", is_champion: no }], lookup, 0);
  assert(sk.rows[0]?.isChampion === false, `is_champion ${JSON.stringify(no)} means no`);
}
sk = validateStakeholderRows(["customer", "name", "is_champion", "last_engaged_date", "role"], [
  { customer: "CUS-0001", name: "A", is_champion: "maybe", last_engaged_date: "", role: "" },
  { customer: "Nobody", name: "", is_champion: "no", last_engaged_date: "31/01/2026", role: "r".repeat(81) },
], lookup, 0);
assert(sk.rows.length === 0 && sk.errors.length === 5, "A bad champion flag, unknown customer, empty name, bad date and over-long role are each refused");
sk = validateStakeholderRows(["customer", "name", "last_engaged_date"], [{ customer: "CUS-0001", name: "A", last_engaged_date: "2026-08-12" }], lookup, 0);
assert(sk.rows[0].lastEngagedAt instanceof Date, "A stakeholder's last engagement date is read");
assert(/missing the column: name/.test(validateStakeholderRows(["customer"], [], lookup, 0).errors[0].message), "A stakeholders file without a name column is refused");

// ---------- goals ----------
let gl = validateGoalRows(["customer", "name", "target_value"], [{ customer: "CUS-0001", name: "Cut time", target_value: "40" }], lookup, 0);
assert(gl.errors.length === 0 && gl.rows[0].actualValue === 0 && gl.rows[0].unit === "units" && gl.rows[0].targetValue === 40, "A goal needs a customer, name and target; actual defaults to 0 and unit to units");
gl = validateGoalRows(["customer", "name", "target_value", "actual_value", "unit"], [{ customer: "CUS-0001", name: "Cut time", target_value: "40.5", actual_value: "26.25", unit: "hours/month" }], lookup, 0);
assert(gl.rows[0].targetValue === 40.5 && gl.rows[0].actualValue === 26.25 && gl.rows[0].unit === "hours/month", "Goal values may have decimals and a unit");
for (const bad of ["0", "-5", "abc", "", "1.1234567", "1e3", "2000000000000"]) {
  gl = validateGoalRows(["customer", "name", "target_value"], [{ customer: "CUS-0001", name: "g", target_value: bad }], lookup, 0);
  assert(gl.errors.length === 1, `A goal target of ${JSON.stringify(bad)} is refused`);
}
gl = validateGoalRows(["customer", "name", "target_value", "actual_value"], [{ customer: "CUS-0001", name: "g", target_value: "10", actual_value: "-1" }], lookup, 0);
assert(gl.errors.length === 1, "A negative actual value is refused");
gl = validateGoalRows(["customer", "name", "target_value", "unit"], [{ customer: "CUS-0001", name: "", target_value: "10", unit: "u".repeat(41) }, { customer: "Nobody", name: "g", target_value: "10", unit: "" }], lookup, 0);
assert(gl.errors.length === 3, "An empty goal name, an over-long unit and an unknown customer are each refused");
assert(/missing the column: target_value/.test(validateGoalRows(["customer", "name"], [], lookup, 0).errors[0].message), "A goals file without a target_value column is refused");

// ---------- training ----------
let tr = validateTrainingRows(["customer", "course", "date"], [{ customer: "CUS-0001", course: "Admin 101", date: "2026-05-14" }], lookup, 0);
assert(tr.errors.length === 0 && tr.rows[0].attendeeCount === 1, "A training session needs a customer, course and date; attendees default to 1");
tr = validateTrainingRows(["customer", "course", "date", "attendees"], [{ customer: "CUS-0001", course: "Admin 101", date: "2026-05-14", attendees: "6" }], lookup, 0);
assert(tr.rows[0].attendeeCount === 6, "Attendees are read");
for (const bad of ["0", "-2", "100001", "abc", "2.5"]) {
  tr = validateTrainingRows(["customer", "course", "date", "attendees"], [{ customer: "CUS-0001", course: "c", date: "2026-05-14", attendees: bad }], lookup, 0);
  assert(tr.errors.length === 1, `${JSON.stringify(bad)} attendees is refused`);
}
tr = validateTrainingRows(["customer", "course", "date"], [{ customer: "CUS-0001", course: "", date: "2026-13-14" }, { customer: "Nobody", course: "c", date: "" }], lookup, 0);
assert(tr.errors.length === 4, "An empty course, a bad date, an unknown customer and a missing date are each refused");

// ---------- events ----------
let ev = validateEventRows(["customer", "event", "date"], [{ customer: "CUS-0001", event: "Summit", date: "2026-06-18" }], lookup, 0);
assert(ev.errors.length === 0 && ev.rows[0].eventName === "Summit", "An event attendance is read");
ev = validateEventRows(["customer", "event", "date"], [{ customer: "CUS-0001", event: "", date: "bad" }, { customer: "Nobody", event: "x".repeat(121), date: "2026-06-18" }], lookup, 0);
assert(ev.errors.length === 4, "An empty or over-long event name, a bad date and an unknown customer are each refused");
assert(/missing the column: event/.test(validateEventRows(["customer", "date"], [], lookup, 0).errors[0].message), "An events file without an event column is refused");

// ---------- surveys ----------
let sv = validateSurveyRows(["customer", "type", "score", "date"], [
  { customer: "CUS-0001", type: "NPS", score: "8", date: "2026-09-30" },
  { customer: "CUS-0001", type: "csat", score: "9", date: "2026-10-05" },
  { customer: "CUS-0002", type: "ces", score: "0", date: "2026-11-01" },
], lookup, 0);
assert(sv.errors.length === 0 && sv.rows.map((x) => x.type).join() === "nps,csat,ces", "NPS, CSAT and CES responses are read (type is case-insensitive)");
for (const bad of ["11", "-1", "abc", "7.5", ""]) {
  sv = validateSurveyRows(["customer", "type", "score", "date"], [{ customer: "CUS-0001", type: "nps", score: bad, date: "2026-09-30" }], lookup, 0);
  assert(sv.errors.length === 1, `A survey score of ${JSON.stringify(bad)} is refused`);
}
sv = validateSurveyRows(["customer", "type", "score", "date"], [{ customer: "CUS-0001", type: "star", score: "5", date: "2026-09-30" }, { customer: "Nobody", type: "nps", score: "5", date: "" }], lookup, 0);
assert(sv.errors.length === 3, "An unknown survey type, an unknown customer and a missing date are each refused");

// ---------- every kind: the shared opening checks ----------
for (const [label, fn, headers] of [
  ["tickets", validateInteractionRows, ["customer", "date", "text"]],
  ["usage", validateUsageRows, ["customer", "capability", "date", "value"]],
  ["outcomes", validateOutcomeRows, ["customer", "date", "type"]],
  ["stakeholders", validateStakeholderRows, ["customer", "name"]],
  ["goals", validateGoalRows, ["customer", "name", "target_value"]],
  ["training", validateTrainingRows, ["customer", "course", "date"]],
  ["events", validateEventRows, ["customer", "event", "date"]],
  ["surveys", validateSurveyRows, ["customer", "type", "score", "date"]],
] as const) {
  const empty = (fn as (h: string[], r: Record<string, string>[], l: Map<string, string>, n: number) => { errors: { message: string }[] })(headers as unknown as string[], [], lookup, 0);
  assert(empty.errors.length === 1 && /no rows/.test(empty.errors[0].message), `A ${label} file with a header and no rows is refused`);
}

// ---------- export safety ----------
assert(neutraliseFormula("=HYPERLINK(\"http://x\")") === "'=HYPERLINK(\"http://x\")", "Text starting with = gets a guard quote");
for (const lead of ["+1", "-1", "@SUM(1)"]) assert(neutraliseFormula(lead) === `'${lead}`, `Text starting with ${lead[0]} gets a guard quote`);
assert(neutraliseFormula("Plain text") === "Plain text" && neutraliseFormula("2026-10-01") === "2026-10-01", "Ordinary text and dates are untouched");
const csv = toCsv(["a", "b", "c", "d", "e"], [["=cmd", -5, new Date("2026-10-01T00:00:00Z"), null, 'has "quote", and\nnewline']]);
assert(csv.split("\r\n")[1].startsWith("'=cmd,-5,2026-10-01,,"), "A formula-like cell is guarded, a negative NUMBER is not, dates are YYYY-MM-DD and null is empty");
const back = parseCsv(csv);
assert(back.rows[0].a === "=cmd" && back.rows[0].e === 'has "quote", and\nnewline', "Exporting then reading returns the original text exactly, including quotes, commas and line breaks");

console.log("\nAll CSV reader, row-rule, limit and export-safety checks passed.");
