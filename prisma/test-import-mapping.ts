// Pure checks (no database, no network) for the flexible import's column
// mapping: guessing which file column is which Bearing field, keeping unknown
// columns as custom fields, refusing bad mappings, rewriting a file so the
// existing validators accept it, remembering a mapping by its columns, and
// reading a mapping that arrives from the browser (untrusted input).
import { parseCsv } from "../src/lib/import/csv";
import { validateCustomerRows } from "../src/lib/import/validate";
import { CUSTOM_FIELD_LIMITS, coerceCustomValue } from "../src/lib/import/customFields";
import {
  KNOWN_COLUMNS,
  applyMapping,
  customFieldKey,
  inferCustomType,
  mappingSignature,
  normaliseHeader,
  parseColumnMapping,
  requiredColumns,
  suggestMapping,
  suggestionsToMapping,
  validateMapping,
  type ColumnMapping,
  type MappingKind,
} from "../src/lib/import/mapping";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const suggest = (kind: MappingKind, headers: string[], rows: Record<string, string>[] = []) => suggestMapping(kind, headers, rows);
const targetOf = (kind: MappingKind, header: string) => {
  const s = suggest(kind, [header])[0];
  return s.action === "map" ? s.target : s.action;
};

// ---------- the catalogue matches the validators ----------
const validatorColumns: Record<MappingKind, string[]> = {
  customers: ["name", "ref", "country", "industry", "tier", "product", "lifecycle_status", "contractual_arr", "consumption_arr", "renewal_date", "expected_go_live_date", "go_live_date", "payment_status", "days_past_due", "renewal_type", "interrupted_reason", "nps", "champion_name", "champion_last_engaged"],
  tickets: ["customer", "date", "type", "severity", "text"],
  usage: ["customer", "capability", "metric_type", "date", "value"],
  outcomes: ["customer", "date", "type", "notes"],
};
for (const kind of Object.keys(validatorColumns) as MappingKind[]) {
  assert(JSON.stringify(KNOWN_COLUMNS[kind].map((c) => c.name)) === JSON.stringify(validatorColumns[kind]), `The ${kind} catalogue lists exactly the columns the validator reads, in the same names`);
}
assert(JSON.stringify(requiredColumns("customers")) === '["name"]', "Customers require only a name");
assert(JSON.stringify(requiredColumns("tickets")) === '["customer","date","text"]', "Tickets require customer, date and text");
assert(JSON.stringify(requiredColumns("usage")) === '["customer","capability","date","value"]', "Usage requires customer, capability, date and value");
assert(JSON.stringify(requiredColumns("outcomes")) === '["customer","date","type"]', "Outcomes require customer, date and type");
for (const kind of Object.keys(validatorColumns) as MappingKind[]) {
  const names = KNOWN_COLUMNS[kind].map((c) => c.name);
  const seen = new Map<string, string>();
  let clash = "";
  for (const c of KNOWN_COLUMNS[kind]) {
    for (const a of [c.name.replace(/_/g, " "), ...c.aliases.map(normaliseHeader)]) {
      const owner = seen.get(a);
      if (owner !== undefined && owner !== c.name) clash = `${a} (${owner} and ${c.name})`;
      seen.set(a, c.name);
    }
  }
  assert(clash === "" && new Set(names).size === names.length, `No two ${kind} fields share a name or an alias${clash ? `: ${clash}` : ""}`);
}

// ---------- alias families ----------
const aliasCases: [MappingKind, string, string][] = [
  ["customers", "Customer Name", "name"], ["customers", "Account", "name"], ["customers", "Company", "name"], ["customers", "Client", "name"], ["customers", "Organisation", "name"],
  ["customers", "Customer ID", "ref"], ["customers", "Account ID", "ref"], ["customers", "CRM ID", "ref"],
  ["customers", "ARR", "contractual_arr"], ["customers", "ACV", "contractual_arr"], ["customers", "Annual Contract Value", "contractual_arr"], ["customers", "Contract Value (GBP)", "contractual_arr"], ["customers", "Annual Recurring Revenue", "contractual_arr"],
  ["customers", "Consumption Revenue", "consumption_arr"], ["customers", "Overage", "consumption_arr"],
  ["customers", "Renewal", "renewal_date"], ["customers", "Contract End", "renewal_date"], ["customers", "Contract End Date", "renewal_date"], ["customers", "Renews On", "renewal_date"], ["customers", "Expiry Date", "renewal_date"],
  ["customers", "Target Go Live", "expected_go_live_date"], ["customers", "Went Live", "go_live_date"], ["customers", "Launch Date", "go_live_date"],
  ["customers", "Billing Status", "payment_status"], ["customers", "Payment", "payment_status"], ["customers", "Days Overdue", "days_past_due"], ["customers", "DPD", "days_past_due"],
  ["customers", "NPS Score", "nps"], ["customers", "Net Promoter Score", "nps"],
  ["customers", "Champion", "champion_name"], ["customers", "Executive Sponsor", "champion_name"], ["customers", "Last Contact", "champion_last_engaged"],
  ["customers", "Status", "lifecycle_status"], ["customers", "Stage", "lifecycle_status"], ["customers", "Sector", "industry"], ["customers", "Vertical", "industry"], ["customers", "Nation", "country"], ["customers", "Customer Tier", "tier"],
  ["tickets", "Created At", "date"], ["tickets", "Opened", "date"], ["tickets", "Raised On", "date"], ["tickets", "Priority", "severity"], ["tickets", "Channel", "type"],
  ["tickets", "Description", "text"], ["tickets", "Summary", "text"], ["tickets", "Body", "text"], ["tickets", "Account", "customer"], ["tickets", "Customer Ref", "customer"],
  ["usage", "Feature", "capability"], ["usage", "Metric", "capability"], ["usage", "Module", "capability"], ["usage", "Product Area", "capability"], ["usage", "Month", "date"], ["usage", "Period", "date"], ["usage", "Amount", "value"], ["usage", "Quantity", "value"], ["usage", "Kind", "metric_type"],
  ["outcomes", "Result", "type"], ["outcomes", "Outcome", "type"], ["outcomes", "Closed On", "date"], ["outcomes", "Comments", "notes"], ["outcomes", "Account", "customer"],
];
for (const [kind, header, expected] of aliasCases) {
  assert(targetOf(kind, header) === expected, `${kind}: the heading "${header}" is matched to ${expected}`);
}

// ---------- spelling, case, punctuation, hidden characters ----------
for (const variant of ["customer_name", "CUSTOMER NAME", "  Customer   Name  ", "customer-name", "Customer.Name", "﻿Customer Name", "Customer​ Name"]) {
  assert(targetOf("customers", variant) === "name", `The heading ${JSON.stringify(variant)} is still recognised as the customer name`);
}
assert(targetOf("customers", "﻿Name") === "name", "A heading with a byte-order mark glued to it is still recognised");
assert(targetOf("customers", "Customer Name (required)") === "name", "Extra words around a known name are tolerated");
assert(targetOf("customers", "Renewl Date") === "renewal_date", "A one-letter typo in a heading is still matched by spelling");
assert(targetOf("customers", "ACV (GBP)") === "contractual_arr", "A currency note in brackets does not stop a match");
assert(normaliseHeader("﻿ ACV (GBP) ") === "acv gbp", "A heading is normalised to lower case words with no hidden characters");
assert(suggest("customers", ["Name"])[0].confidence === 1, "A heading identical to the Bearing field has confidence 1");
assert(suggest("customers", ["Customer Name"])[0].confidence === 0.95, "A well-known alternative name has confidence 0.95");

// ---------- unknown columns, empty columns, duplicates ----------
const unknown = suggest("customers", ["Name", "Region", "Owner", "Health Notes", "Postcode"], [{ name: "A", region: "x", owner: "y", "health notes": "z", postcode: "SW1A 1AA" }]);
assert(unknown.slice(1).every((s) => s.action === "custom"), "Columns Bearing has no field for become suggested custom fields in the customers file");
assert(unknown[3].label === "Health Notes" && unknown[1].label === "Region", "A suggested custom field label is the heading, tidied");
assert(unknown.slice(1).every((s) => s.confidence === 0.6 && s.reason.length > 0), "Custom suggestions carry a lower confidence and a reason");
const ticketUnknown = suggest("tickets", ["Customer", "Date", "Text", "Region"], [{ customer: "a", date: "2026-01-01", text: "t", region: "x" }]);
assert(ticketUnknown[3].action === "ignore", "In the tickets file an unknown column is ignored, because custom fields are customers-only");
const blank = suggest("customers", ["Name", "", "   ", "Notes"], [{ name: "A", "": "x", "   ": "y", notes: "" }]);
assert(blank[1].action === "ignore" && /no heading/.test(blank[1].reason) && blank[2].action === "ignore", "A column with no heading is ignored");
assert(blank[3].action === "ignore" && /empty/.test(blank[3].reason), "A column with every value empty is ignored");
const dup = suggest("customers", ["ARR", "arr", "Name"], [{ arr: "1", name: "A" }]);
assert(dup[0].action === "map" && dup[1].action === "ignore" && /same heading/.test(dup[1].reason), "A second column with the same heading is ignored");
assert(dup.length === 3 && dup.map((d) => d.index).join() === "0,1,2", "There is exactly one suggestion per column, in file order");

// ---------- two columns never share one target ----------
const twoArr = suggest("customers", ["ARR", "Annual Contract Value", "Name"], [{ arr: "1", "annual contract value": "2", name: "A" }]);
assert(twoArr.filter((s) => s.target === "contractual_arr").length === 1, "Two columns that both look like contract value: only one is mapped to it");
assert(twoArr.some((s) => s.action === "custom" && s.header === "Annual Contract Value"), "...and the other becomes a custom field suggestion");
const twoFeature = suggest("usage", ["Customer", "Feature", "Metric", "Date", "Value"], [{ customer: "a", feature: "f", metric: "m", date: "2026-01-01", value: "1" }]);
assert(twoFeature.filter((s) => s.target === "capability").length === 1 && twoFeature.some((s) => s.action === "ignore"), "In the usage file the losing duplicate is ignored");
const stronger = suggest("customers", ["Contract End Date", "renewal_date"], [{ "contract end date": "2027-01-01", renewal_date: "2027-02-02" }]);
assert(stronger[1].target === "renewal_date" && stronger[0].action === "custom", "The stronger match (the Bearing field's own name, 1.0) wins the target over a common alternative (0.95)");
const tie = suggest("customers", ["Contract End Date", "Renewal"], [{ "contract end date": "2027-01-01", renewal: "2027-02-02" }]);
assert(tie[0].target === "renewal_date" && tie[1].action === "custom", "When two columns match equally well, the earlier column wins and the later one becomes a custom field");

// ---------- samples ----------
const sam = suggest("customers", ["Region"], [{ region: " EMEA " }, { region: "EMEA" }, { region: "" }, { region: "APAC" }, { region: "AMER" }, { region: "LATAM" }])[0];
assert(sam.samples.join("|") === "EMEA|APAC|AMER", "Samples are up to 3 distinct trimmed non-empty values");
assert(suggest("customers", ["Region"], [{ region: "x".repeat(200) }])[0].samples[0].length === 60, "A long sample value is shortened to 60 characters");

// ---------- value sniffing ----------
assert(inferCustomType(["2026-01-31", "2026-02-28"]).type === "date", "Real YYYY-MM-DD values are sniffed as a date");
assert(inferCustomType(["03/04/2026", "05/06/2026"]).type === "text", "03/04/2026 is ambiguous (3 April or 4 March) so it is NOT sniffed as a date");
assert(inferCustomType(["2026-02-30", "2026-01-01"]).type === "text", "An impossible date makes the column text, not a date");
assert(inferCustomType(["31 Mar 2026"]).type === "text", "A written-out date is not guessed");
assert(inferCustomType(["1,200", "£300", "45", "-7.5"]).type === "number", "Numbers with commas, a currency sign and decimals are sniffed as numbers");
assert(inferCustomType(["1,20", "5"]).type === "text", "A badly placed comma is not a number");
assert(inferCustomType(["00123", "00456"]).type === "text", "Numbers with a leading zero are treated as identifiers, not quantities");
assert(inferCustomType(["12", "twelve"]).type === "text", "A mix of numbers and words is text");
const pick = inferCustomType(["EMEA", "APAC", "EMEA", "AMER", "apac", "EMEA"]);
assert(pick.type === "pick_list" && pick.options?.join("|") === "EMEA|APAC|AMER", "A few repeated values become a pick-list, most common first, keeping the first spelling");
assert(inferCustomType(["EMEA", "APAC", "EMEA"]).type === "text", "Fewer than four values is not enough to call it a pick-list");
assert(inferCustomType(Array.from({ length: 20 }, (_, i) => `v${i % 9}`)).type === "text", "More than eight distinct values is text, not a pick-list");
assert(inferCustomType(["a", "b", "c", "d", "e", "f"]).type === "text", "All different values is text");
assert(inferCustomType(["yes", "yes", "yes", "yes"]).type === "text", "A single repeated value is text");
assert(inferCustomType(["", "  ", ""]).type === "text", "An all-blank column defaults to text");
assert(inferCustomType(["x".repeat(41), "x".repeat(41), "y".repeat(41), "y".repeat(41)]).type === "text", "Long values are never a pick-list");

// ---------- accepting the suggestions ----------
const s2m = suggestionsToMapping(suggest("customers", ["Name", "Region", ""], [{ name: "A", region: "EMEA" }]));
assert(s2m[0].action === "map" && s2m[1].action === "custom" && s2m[2].action === "ignore", "Accepting the suggestions gives one choice per column");
assert(s2m[1].action === "custom" && s2m[1].shareWithAi === false, "A custom field is NOT shared with the AI unless the person turns that on");

// ---------- validateMapping ----------
const ok: ColumnMapping = [{ header: "Name", action: "map", target: "name" }, { header: "Region", action: "custom", label: "Region", type: "text", shareWithAi: false }];
assert(validateMapping("customers", ok).length === 0, "A sound mapping has no errors");
assert(validateMapping("customers", [{ header: "A", action: "map", target: "name" }, { header: "B", action: "map", target: "name" }]).some((e) => /both set to/.test(e)), "Two columns mapped to the same field are refused");
assert(validateMapping("customers", [{ header: "A", action: "ignore" }]).some((e) => /Customer name/.test(e)), "A required column left unmapped is refused (customers need a name)");
for (const [kind, missing] of [["tickets", "Customer"], ["tickets", "Date"], ["tickets", "Text"], ["usage", "Capability"], ["usage", "Value"], ["outcomes", "Outcome"]] as [MappingKind, string][]) {
  const mapping: ColumnMapping = KNOWN_COLUMNS[kind].filter((c) => c.required && c.label !== missing).map((c) => ({ header: c.label, action: "map" as const, target: c.name }));
  assert(validateMapping(kind, mapping).some((e) => e.includes(`"${missing}"`)), `${kind}: leaving out the required ${missing} column is refused`);
}
const custom = (label: string, over: Record<string, unknown> = {}): ColumnMapping => [
  { header: "Name", action: "map", target: "name" },
  { header: "X", action: "custom", label, type: "text", shareWithAi: false, ...over } as ColumnMapping[number],
];
assert(validateMapping("customers", custom("   ")).some((e) => /needs a name/.test(e)), "A custom field with an empty name is refused");
assert(validateMapping("customers", custom("x".repeat(61))).some((e) => /60 characters/.test(e)), "A custom field name over 60 characters is refused");
assert(validateMapping("customers", custom("!!!")).some((e) => /letters or numbers/.test(e)), "A custom field name with no letters or numbers is refused");
assert(validateMapping("customers", custom("Tier")).some((e) => /built-in/.test(e)), "A custom field named like a built-in field is refused");
assert(validateMapping("customers", custom("Contract value (ARR)")).some((e) => /built-in/.test(e)), "A custom field named like a built-in field's label is refused");
assert(validateMapping("customers", custom("  champion NAME ")).some((e) => /built-in/.test(e)), "The built-in clash check ignores case and spacing");
assert(validateMapping("customers", custom("Owner"), [{ label: "owner" }]).some((e) => /already have/.test(e)), "A custom field that duplicates an existing one is refused, ignoring case");
assert(validateMapping("customers", [...custom("Owner"), { header: "Y", action: "custom", label: " OWNER ", type: "text", shareWithAi: false }]).some((e) => /both create/.test(e)), "Two new custom fields with the same name are refused");
assert(validateMapping("customers", custom("Owner", { type: "colour" })).some((e) => /must be one of/.test(e)), "An unknown field type is refused");
assert(validateMapping("customers", custom("Region", { type: "pick_list" })).some((e) => /at least one choice/.test(e)), "A pick-list with no choices is refused");
assert(validateMapping("customers", custom("Region", { type: "pick_list", options: Array.from({ length: 51 }, (_, i) => `o${i}`) })).some((e) => /at most 50/.test(e)), "A pick-list with 51 choices is refused");
assert(validateMapping("customers", custom("Region", { type: "pick_list", options: Array.from({ length: 50 }, (_, i) => `o${i}`) })).length === 0, "A pick-list with exactly 50 choices is allowed");
assert(validateMapping("customers", custom("Region", { type: "pick_list", options: ["A", "a"] })).some((e) => /different/.test(e)), "Pick-list choices that differ only by case are refused");
assert(validateMapping("customers", custom("Region", { type: "pick_list", options: ["A", ""] })).some((e) => /1 to 60/.test(e)), "An empty pick-list choice is refused");
assert(validateMapping("customers", custom("Region", { type: "text", options: ["A"] })).some((e) => /only a pick-list/.test(e)), "Choices on a non-pick-list field are refused");
const many = (n: number): ColumnMapping => [{ header: "Name", action: "map", target: "name" }, ...Array.from({ length: n }, (_, i) => ({ header: `C${i}`, action: "custom" as const, label: `Field ${i}`, type: "text" as const, shareWithAi: false }))];
assert(validateMapping("customers", many(25)).length === 0, "25 custom fields in total is allowed");
assert(validateMapping("customers", many(26)).some((e) => /at most 25/.test(e)), "26 custom fields in total is refused");
assert(validateMapping("customers", many(10), Array.from({ length: 16 }, (_, i) => ({ label: `old ${i}` }))).some((e) => /at most 25/.test(e)), "The cap counts custom fields the workspace already has");
for (const kind of ["tickets", "usage", "outcomes"] as MappingKind[]) {
  const base = KNOWN_COLUMNS[kind].filter((c) => c.required).map((c) => ({ header: c.label, action: "map" as const, target: c.name }));
  assert(validateMapping(kind, [...base, { header: "Extra", action: "custom", label: "Extra", type: "text", shareWithAi: false }]).some((e) => /only be added from the customers file/.test(e)), `${kind}: custom fields are refused, they are customers-only`);
}
assert(validateMapping("tickets", [{ header: "Z", action: "map", target: "region" }]).some((e) => /no such field/.test(e)), "Mapping to a field the file type does not have is refused");
assert(validateMapping("customers", [{ header: "Name", action: "map", target: "name" }, { header: " name ", action: "ignore" }]).some((e) => /more than once/.test(e)), "The same column chosen twice is refused");
assert(validateMapping("customers", ok, [], ["Name", "Region", "Owner"]).some((e) => /"Owner" has no choice/.test(e)), "When the file's columns are known, a column with no choice is refused");
assert(validateMapping("customers", ok, [], ["Name", "Region", ""]).length === 0, "A blank heading does not need a choice");

// ---------- applyMapping on a realistic messy file ----------
const messy = [
  "﻿Account Name,ACV (GBP),Contract End,Region,Owner,Health Notes",
  'Acme Freight,"£48,000",2027-03-31,EMEA,Sam,Quiet lately',
  "Beta Logistics,9000,2027-06-30,APAC,Priya,Asked about seats",
  "Gamma Supply,\"120,000\",2027-01-31,EMEA,Sam,",
  "Delta Cargo,15000,2026-12-31,AMER,Lee,Escalated twice",
  "Epsilon Haulage,7000,2027-09-30,EMEA,Priya,Happy",
  "Zeta Transport,22000,2027-02-28,APAC,Sam,Renewal at risk",
  "Eta Shipping,31000,2027-05-31,EMEA,Lee,Growing usage",
  "Theta Express,5000,2027-08-31,APAC,Priya,New champion",
].join("\n");
const parsed = parseCsv(messy);
const sugg = suggestMapping("customers", parsed.headers, parsed.rows);
const byHeader = Object.fromEntries(sugg.map((s) => [s.header, s]));
assert(byHeader["account name"].target === "name" && byHeader["acv (gbp)"].target === "contractual_arr" && byHeader["contract end"].target === "renewal_date", "The messy file's Account Name, ACV and Contract End are matched to Bearing fields");
assert(byHeader["region"].action === "custom" && byHeader["region"].type === "pick_list" && byHeader["region"].options?.join("|") === "EMEA|APAC|AMER", "Region is suggested as a pick-list of its values");
assert(byHeader["owner"].action === "custom" && byHeader["owner"].type === "pick_list", "Owner (few repeated names) is suggested as a pick-list");
assert(byHeader["health notes"].action === "custom" && byHeader["health notes"].type === "text", "Health Notes is suggested as free text");
const mapping = suggestionsToMapping(sugg);
assert(validateMapping("customers", mapping, [], parsed.headers).length === 0, "Accepting the suggestions for the messy file gives a valid mapping");
const applied = applyMapping(parsed, mapping);
assert(applied.headers.join(",") === "name,contractual_arr,renewal_date", "The rewritten file has only canonical column names, in file order, with custom columns taken out");
assert(applied.rows.length === 8 && applied.rows[0].name === "Acme Freight" && applied.rows[4].name === "Epsilon Haulage" && applied.rows[7].name === "Theta Express", "Every row is kept in its original order, so row numbers still match the spreadsheet");
const check = validateCustomerRows(applied.headers, applied.rows, { refs: new Set(), names: new Set(), count: 0 });
assert(check.errors.length === 0 && check.rows.length === 8, "The EXISTING customers validator accepts the rewritten file without any change");
assert(check.rows[0].contractualArr === 48000 && check.rows[2].contractualArr === 120000 && check.rows[0].renewalDate instanceof Date, "Currency signs and thousands commas in the ACV column are read correctly");
assert(applied.customFields.map((f) => f.key).join(",") === "region,owner,health_notes", "Custom fields get stable keys made from their names");
assert(applied.customFieldValues.length === 8 && applied.customFieldValues[0].region === "EMEA" && applied.customFieldValues[2].health_notes === "" && applied.customFieldValues[3].owner === "Lee", "Each row's raw custom values are kept alongside it, row for row");
assert(applied.customFields[0].type === "pick_list" && applied.customFields[0].shareWithAi === false, "Custom field definitions carry their type, choices and the AI-sharing choice");
const casedMapping: ColumnMapping = [{ header: "ACCOUNT NAME", action: "map", target: "name" }, { header: " Acv (GBP) ", action: "ignore" }];
const casedApplied = applyMapping(parsed, casedMapping);
assert(casedApplied.headers.join() === "name" && casedApplied.rows[0].acv === undefined, "A mapping written with different case or spacing still finds its column, and ignored columns are dropped");
const badRowCheck = applyMapping(parseCsv("name,arr\nA,1\nB,twelve\nC,3"), suggestionsToMapping(suggestMapping("customers", ["name", "arr"], [])));
const badRows = validateCustomerRows(badRowCheck.headers, badRowCheck.rows, { refs: new Set(), names: new Set(), count: 0 });
assert(badRows.errors.length === 1 && badRows.errors[0].row === 3, "A bad value after mapping is reported against the person's own spreadsheet row (row 3)");
const missingCol = applyMapping(parsed, [{ header: "No such column", action: "map", target: "name" }]);
assert(missingCol.headers.length === 0 && missingCol.rows.every((r) => Object.keys(r).length === 0), "A mapping that names a column the file does not have does nothing rather than failing");
assert(customFieldKey("Health Notes") === "health_notes" && customFieldKey("!!!") === "field" && customFieldKey("Owner", new Set(["owner"])) === "owner_2", "Custom field keys are tidy, never empty, and never collide");

// ---------- remembering a mapping ----------
const sig = mappingSignature(["Account Name", "ACV (GBP)", "Region"]);
assert(/^[0-9a-f]{64}$/.test(sig), "A mapping signature is a 64-character hash");
assert(sig === mappingSignature(["region", "account_name", "acv gbp"]), "The same columns in a different order, case or punctuation give the same signature");
assert(sig !== mappingSignature(["Account Name", "ACV (GBP)", "Owner"]), "A different set of columns gives a different signature");
assert(sig !== mappingSignature(["Account Name", "ACV (GBP)"]), "A file with a column missing gives a different signature");
assert(mappingSignature(["A", "", "  "]) === mappingSignature(["a"]), "Blank headings are not part of the signature");
assert(mappingSignature(["A", "a"]) === mappingSignature(["a"]), "Repeating a column does not change the signature");

// ---------- reading untrusted mapping JSON ----------
const good = parseColumnMapping(JSON.stringify([{ header: "Name", action: "map", target: "name" }, { header: "Region", action: "custom", label: "Region", type: "pick_list", options: ["EMEA", "APAC"], shareWithAi: true }, { header: "x", action: "ignore" }]));
assert(good.ok && good.mapping.length === 3, "A well-formed mapping (as JSON text) is accepted");
assert(parseColumnMapping(good.ok ? good.mapping : []).ok, "An already-parsed mapping is accepted too");
const reject = (value: unknown, why: string) => assert(!parseColumnMapping(value).ok, `Rejected: ${why}`);
reject("not json at all", "text that is not JSON");
reject("{}", "JSON that is an object, not a list");
reject("null", "JSON null");
reject(42, "a number");
reject([1, 2], "a list of numbers");
reject([[{ header: "a", action: "ignore" }]], "a list inside the list");
reject([{ header: 5, action: "ignore" }], "a heading that is not text");
reject([{ action: "ignore" }], "a missing heading");
reject([{ header: "a", action: "delete" }], "an unknown action");
reject([{ header: "a" }], "a missing action");
reject([{ header: "a", action: "map" }], "a map with no target");
reject([{ header: "a", action: "map", target: "" }], "a map with an empty target");
reject([{ header: "a", action: "map", target: 7 }], "a map with a non-text target");
reject([{ header: "a", action: "ignore", extra: 1 }], "an unknown key on an ignore");
reject([{ header: "a", action: "map", target: "name", label: "x" }], "an unknown key on a map");
reject([{ header: "a", action: "custom", label: "L", type: "text" }], "a custom field with no AI-sharing choice");
reject([{ header: "a", action: "custom", label: "L", type: "text", shareWithAi: "yes" }], "an AI-sharing choice that is not true or false");
reject([{ header: "a", action: "custom", label: "L", type: "colour", shareWithAi: false }], "an unknown custom field type");
reject([{ header: "a", action: "custom", label: 5, type: "text", shareWithAi: false }], "a custom label that is not text");
reject([{ header: "a", action: "custom", label: "L", type: "text", shareWithAi: false, options: ["x"] }], "choices on a text field");
reject([{ header: "a", action: "custom", label: "L", type: "pick_list", shareWithAi: false, options: "x" }], "choices that are not a list");
reject([{ header: "a", action: "custom", label: "L", type: "pick_list", shareWithAi: false, options: [1] }], "choices that are not text");
reject([{ header: "a", action: "custom", label: "L", type: "pick_list", shareWithAi: false, options: Array.from({ length: 201 }, (_, i) => `o${i}`) }], "more than 200 choices");
reject([{ header: "a", action: "ignore" }, { header: " A ", action: "ignore" }], "the same column twice");
reject(Array.from({ length: 201 }, (_, i) => ({ header: `h${i}`, action: "ignore" })), "more than 200 columns");
reject([{ header: "x".repeat(501), action: "ignore" }], "a heading over 500 characters");
reject(JSON.stringify([{ header: "x".repeat(250_000), action: "ignore" }]), "a mapping over 200,000 characters");
reject(JSON.parse('[{"header":"a","action":"ignore","__proto__":{"polluted":true}}]'), "a __proto__ key (prototype pollution)");
reject(JSON.parse('[{"header":"a","action":"ignore","constructor":{"prototype":{"polluted":true}}}]'), "a constructor key");
reject(JSON.parse('{"__proto__":[{"header":"a","action":"ignore"}]}'), "a __proto__ key at the top level");
reject([Object.create({ header: "a", action: "ignore" })], "an object with an inherited prototype");
assert(({} as Record<string, unknown>).polluted === undefined, "Nothing was added to the shared object prototype by any of those attempts");
const huge = parseColumnMapping(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ header: `h${i}`, action: "ignore" }))));
assert(huge.ok && huge.mapping.length === 200, "Exactly 200 columns is still accepted");

// ---------- coerceCustomValue ----------
const val = (type: Parameters<typeof coerceCustomValue>[0], raw: string, options?: string[]) => coerceCustomValue(type, raw, options);
assert(val("text", "   ").ok && (val("text", "   ") as { value: unknown }).value === null, "Blank (or only spaces) means no value, for any type");
for (const t of ["number", "date", "pick_list"] as const) assert((val(t, "") as { value: unknown }).value === null, `A blank ${t} value is null, not an error`);
assert((val("text", "  hello ") as { value: unknown }).value === "hello", "Text is trimmed");
assert(val("text", "x".repeat(500)).ok && !val("text", "x".repeat(501)).ok, "Text of 500 characters is allowed and 501 is not");
const nums: [string, number][] = [["1,200.50", 1200.5], ["£1,200", 1200], ["$5", 5], ["€ 5", NaN], ["-5", -5], ["-£5", -5], ["0", 0], ["1000", 1000], ["0.000001", 0.000001], ["1,000,000", 1_000_000]];
for (const [raw, expected] of nums) {
  const r = val("number", raw);
  if (Number.isNaN(expected)) assert(!r.ok, `The number ${JSON.stringify(raw)} is refused`);
  else assert(r.ok && (r as { value: number }).value === expected, `The number ${JSON.stringify(raw)} is read as ${expected}`);
}
for (const bad of ["12k", "1e9", "1,20", "1,2345", "1.1234567", "abc", "5 %", "--5", "1..2", "1,000,00", "١٢", "NaN", "Infinity"]) {
  assert(!val("number", bad).ok, `The number ${JSON.stringify(bad)} is refused`);
}
assert(val("number", "1000000000000").ok && !val("number", "1000000000001").ok, "A number up to 1 trillion is allowed and larger is refused");
assert(val("date", "2026-03-31").ok && (val("date", "2026-03-31") as { value: string }).value === "2026-03-31", "A real date is kept as written");
for (const bad of ["2026-02-30", "31/12/2026", "2026-3-1", "1850-01-01", "2200-01-01", "tomorrow", "2026-13-01"]) {
  assert(!val("date", bad).ok, `The date ${JSON.stringify(bad)} is refused`);
}
const opts = ["EMEA", "APAC"];
assert((val("pick_list", " emea ", opts) as { value: string }).value === "EMEA", "A pick-list value matches ignoring case and spaces, and returns the canonical choice");
const wrongPick = val("pick_list", "LATAM", opts);
assert(!wrongPick.ok && /EMEA, APAC/.test((wrongPick as { error: string }).error), "A value outside the pick-list is refused and the message lists the choices");
assert(!val("pick_list", "EMEA", []).ok, "A pick-list with no choices accepts nothing");
for (const weird of [null, undefined, 5, {}, [], Symbol.iterator]) {
  let threw = false;
  let result: ReturnType<typeof coerceCustomValue> | null = null;
  try {
    result = coerceCustomValue("number", weird as unknown as string);
  } catch {
    threw = true;
  }
  assert(!threw && result !== null && !result.ok, `A value that is not text (${typeof weird}) is refused, never thrown`);
}
assert(!coerceCustomValue("colour" as never, "x").ok, "An unknown field type is refused, never thrown");
assert(CUSTOM_FIELD_LIMITS.maxFields === 25 && CUSTOM_FIELD_LIMITS.maxLabel === 60 && CUSTOM_FIELD_LIMITS.maxOptions === 50, "The limits are 25 fields, 60-character names and 50 choices");

console.log("\nAll import-mapping checks passed.");
