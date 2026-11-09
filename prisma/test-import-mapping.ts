// Pure checks (no database, no network) for the flexible import's column
// mapping: guessing which file column is which Bearing field, keeping unknown
// columns as custom fields, refusing bad mappings, rewriting a file so the
// existing validators accept it, remembering a mapping by its columns, and
// reading a mapping that arrives from the browser (untrusted input).
import { parseCsv } from "../src/lib/import/csv";
import {
  KNOWN_COLUMNS as VALIDATOR_COLUMNS,
  validateCustomerRows,
  validateEventRows,
  validateGoalRows,
  validateStakeholderRows,
  validateSurveyRows,
  validateTrainingRows,
  validateUsageRows,
} from "../src/lib/import/validate";
import { dataAccessProblem } from "../src/lib/import/access";
import { DEMO_LOCK_NOTICE } from "../src/lib/demoGuard";
import { CUSTOM_FIELD_LIMITS, coerceCustomValue } from "../src/lib/import/customFields";
import {
  EXPORT_ONLY_COLUMNS,
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
// The importer's own list (validate.ts) is the truth. The mapping catalogue must
// offer exactly those columns for every kind, bar the Health results the export
// writes (which are never imported), so nothing a file can carry is unmappable
// and nothing is offered that the importer would not read.
const kinds = Object.keys(VALIDATOR_COLUMNS) as MappingKind[];
assert(kinds.length === 9 && Object.keys(KNOWN_COLUMNS).length === 9, "The mapping catalogue covers all nine kinds of file");
for (const kind of kinds) {
  const exportOnly = new Set(EXPORT_ONLY_COLUMNS[kind] ?? []);
  const expected = VALIDATOR_COLUMNS[kind].filter((c) => !exportOnly.has(c)).sort();
  const offered = KNOWN_COLUMNS[kind].map((c) => c.name).sort();
  assert(JSON.stringify(offered) === JSON.stringify(expected), `The ${kind} catalogue lists exactly the columns the importer reads (${offered.length})`);
  assert(new Set(offered).size === offered.length, `The ${kind} catalogue has no column twice`);
}
assert(JSON.stringify(EXPORT_ONLY_COLUMNS.customers) === JSON.stringify(["health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative"]), "The export's Health result columns are the ones never imported");
for (const col of ["region", "city", "sub_industry", "nps_date"]) assert(KNOWN_COLUMNS.customers.some((c) => c.name === col), `The customers catalogue includes ${col}`);
assert(KNOWN_COLUMNS.usage.some((c) => c.name === "product"), "The usage catalogue includes product");
assert(JSON.stringify(requiredColumns("customers")) === '["name"]', "Customers require only a name");
assert(JSON.stringify(requiredColumns("tickets")) === '["customer","date","text"]', "Tickets require customer, date and text");
assert(JSON.stringify(requiredColumns("usage")) === '["customer","capability","date","value"]', "Usage requires customer, capability, date and value");
assert(JSON.stringify(requiredColumns("outcomes")) === '["customer","date","type"]', "Outcomes require customer, date and type");
assert(JSON.stringify(requiredColumns("stakeholders")) === '["customer","name"]', "Stakeholders require customer and name");
assert(JSON.stringify(requiredColumns("goals")) === '["customer","name","target_value"]', "Goals require customer, name and target_value");
assert(JSON.stringify(requiredColumns("training")) === '["customer","course","date"]', "Training requires customer, course and date");
assert(JSON.stringify(requiredColumns("events")) === '["customer","event","date"]', "Events require customer, event and date");
assert(JSON.stringify(requiredColumns("surveys")) === '["customer","type","score","date"]', "Surveys require customer, type, score and date");
for (const kind of kinds) {
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
  ["customers", "Territory", "region"], ["customers", "HQ City", "city"], ["customers", "Sub Industry", "sub_industry"], ["customers", "NPS Survey Date", "nps_date"], ["usage", "Product Name", "product"],
  ["stakeholders", "Account", "customer"], ["stakeholders", "Contact Name", "name"], ["stakeholders", "Job Title", "role"], ["stakeholders", "Is Champion", "is_champion"], ["stakeholders", "Last Contacted", "last_engaged_date"],
  ["goals", "Account", "customer"], ["goals", "Objective", "name"], ["goals", "Target", "target_value"], ["goals", "Actual", "actual_value"], ["goals", "Unit of Measure", "unit"],
  ["training", "Account", "customer"], ["training", "Course Name", "course"], ["training", "Participants", "attendees"], ["training", "Completed On", "date"],
  ["events", "Account", "customer"], ["events", "Webinar", "event"], ["events", "Attended On", "date"],
  ["surveys", "Account", "customer"], ["surveys", "Survey Type", "type"], ["surveys", "Rating", "score"], ["surveys", "Responded On", "date"],
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
const unknown = suggest("customers", ["Name", "Account Manager", "Owner", "Health Notes", "Postcode"], [{ name: "A", "account manager": "x", owner: "y", "health notes": "z", postcode: "SW1A 1AA" }]);
assert(unknown.slice(1).every((s) => s.action === "custom"), "Columns Bearing has no field for become suggested custom fields in the customers file");
assert(unknown[3].label === "Health Notes" && unknown[1].label === "Account Manager", "A suggested custom field label is the heading, tidied");
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
const s2m = suggestionsToMapping(suggest("customers", ["Name", "Owner", ""], [{ name: "A", owner: "Sam" }]));
assert(s2m[0].action === "map" && s2m[1].action === "custom" && s2m[2].action === "ignore", "Accepting the suggestions gives one choice per column");
assert(s2m[1].action === "custom" && s2m[1].shareWithAi === false, "A custom field is NOT shared with the AI unless the person turns that on");

// ---------- validateMapping ----------
const ok: ColumnMapping = [{ header: "Name", action: "map", target: "name" }, { header: "Owner", action: "custom", label: "Owner", type: "text", shareWithAi: false }];
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
assert(validateMapping("customers", custom("Segment", { type: "pick_list" })).some((e) => /at least one choice/.test(e)), "A pick-list with no choices is refused");
assert(validateMapping("customers", custom("Segment", { type: "pick_list", options: Array.from({ length: 51 }, (_, i) => `o${i}`) })).some((e) => /at most 50/.test(e)), "A pick-list with 51 choices is refused");
assert(validateMapping("customers", custom("Segment", { type: "pick_list", options: Array.from({ length: 50 }, (_, i) => `o${i}`) })).length === 0, "A pick-list with exactly 50 choices is allowed");
assert(validateMapping("customers", custom("Segment", { type: "pick_list", options: ["A", "a"] })).some((e) => /different/.test(e)), "Pick-list choices that differ only by case are refused");
assert(validateMapping("customers", custom("Segment", { type: "pick_list", options: ["A", ""] })).some((e) => /1 to 60/.test(e)), "An empty pick-list choice is refused");
assert(validateMapping("customers", custom("Segment", { type: "text", options: ["A"] })).some((e) => /only a pick-list/.test(e)), "Choices on a non-pick-list field are refused");
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
assert(validateMapping("customers", ok, [], ["Name", "Owner", "Postcode"]).some((e) => /"Postcode" has no choice/.test(e)), "When the file's columns are known, a column with no choice is refused");
assert(validateMapping("customers", ok, [], ["Name", "Owner", ""]).length === 0, "A blank heading does not need a choice");

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
assert(byHeader["region"].action === "map" && byHeader["region"].target === "region", "Region is now a built-in Bearing column, so it is mapped rather than kept as a custom field");
assert(byHeader["owner"].action === "custom" && byHeader["owner"].type === "pick_list", "Owner (few repeated names) is suggested as a pick-list");
assert(byHeader["health notes"].action === "custom" && byHeader["health notes"].type === "text", "Health Notes is suggested as free text");
const mapping = suggestionsToMapping(sugg);
assert(validateMapping("customers", mapping, [], parsed.headers).length === 0, "Accepting the suggestions for the messy file gives a valid mapping");
const applied = applyMapping(parsed, mapping);
assert(applied.headers.join(",") === "name,contractual_arr,renewal_date,region", "The rewritten file has only canonical column names, in file order, with custom columns taken out");
assert(applied.rows.length === 8 && applied.rows[0].name === "Acme Freight" && applied.rows[4].name === "Epsilon Haulage" && applied.rows[7].name === "Theta Express", "Every row is kept in its original order, so row numbers still match the spreadsheet");
const check = validateCustomerRows(applied.headers, applied.rows, { refs: new Set(), names: new Set(), count: 0 });
assert(check.errors.length === 0 && check.rows.length === 8, "The EXISTING customers validator accepts the rewritten file without any change");
assert(check.rows[0].contractualArr === 48000 && check.rows[2].contractualArr === 120000 && check.rows[0].renewalDate instanceof Date, "Currency signs and thousands commas in the ACV column are read correctly");
assert(applied.customFields.map((f) => f.key).join(",") === "owner,health_notes", "Custom fields get stable keys made from their names");
assert(applied.customFieldValues.length === 8 && applied.customFieldValues[0].owner === "Sam" && applied.customFieldValues[2].health_notes === "" && applied.customFieldValues[3].owner === "Lee", "Each row's raw custom values are kept alongside it, row for row");
assert(applied.customFields[0].type === "pick_list" && applied.customFields[0].options?.join("|") === "Priya|Sam|Lee" && applied.customFields[0].shareWithAi === false, "Custom field definitions carry their type, choices and the AI-sharing choice");
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

// ---------- an existing custom field is a mapping target ----------
const owned = [{ id: "cf_segment", label: "Segment Group" }, { id: "cf_owner", label: "Account Owner" }, { id: "cf_notes", label: "Health Notes" }];
const rt = suggestMapping("customers", ["Name", "segment group", "ACCOUNT OWNER", "health_notes", "Postcode"], [{ name: "A", "segment group": "EMEA", "account owner": "Sam", health_notes: "ok", postcode: "x" }], owned);
assert(rt[1].action === "existing_custom" && rt[1].fieldId === "cf_segment", "A heading that equals an existing custom field's name (ignoring case) is suggested for that field");
assert(rt[2].action === "existing_custom" && rt[2].fieldId === "cf_owner" && rt[2].fieldLabel === "Account Owner", "...whatever the capitals or spacing, so an exported file reads back into the same fields");
assert(rt[3].action === "existing_custom" && rt[3].fieldId === "cf_notes", "...and punctuation does not matter (health_notes is Health Notes)");
assert(rt[4].action === "custom", "A column that matches nothing is still suggested as a new custom field");
assert(rt[1].confidence === 1 && /custom fields/.test(rt[1].reason), "The suggestion carries full confidence and a reason");
assert(suggestMapping("tickets", ["Customer", "Date", "Text", "Segment Group"], [{ customer: "a", date: "d", text: "t", "segment group": "x" }], owned)[3].action === "ignore", "Only the customers file has custom fields: in other files the same heading is ignored");
const twoSame = suggestMapping("customers", ["Name", "Segment Group", "segment group"], [{ name: "A", "segment group": "EMEA" }], owned);
assert(twoSame[1].action === "existing_custom" && twoSame[2].action === "ignore", "Two columns with the same heading: the first fills the field, the second is ignored");
const withHealth = suggestMapping("customers", ["Name", "health_score", "health_band", "health_narrative", "health_baseline", "health_adjustment"], [{ name: "A", health_score: "50", health_band: "watch", health_narrative: "x", health_baseline: "1", health_adjustment: "2" }]);
assert(withHealth.slice(1).every((s) => s.action === "ignore" && /export/.test(s.reason)), "The Health result columns the export writes are suggested as ignore, never kept as custom fields");
const exAccept = suggestionsToMapping(rt);
assert(exAccept[1].action === "existing_custom" && exAccept[1].fieldId === "cf_segment", "Accepting suggestions keeps the existing-field choice");

const ex = (fieldId: string, header = "Segment Group"): ColumnMapping => [{ header: "Name", action: "map", target: "name" }, { header, action: "existing_custom", fieldId }];
assert(validateMapping("customers", ex("cf_segment"), owned).length === 0, "A mapping to an existing custom field is accepted");
assert(validateMapping("customers", ex("cf_gone"), owned).some((e) => /no longer exists/.test(e)), "A field id the workspace does not have is refused");
assert(validateMapping("customers", ex("cf_segment"), [{ label: "Segment Group" }]).some((e) => /no longer exists/.test(e)), "Without the real field ids an existing-field choice cannot be trusted and is refused");
assert(validateMapping("customers", [...ex("cf_segment"), { header: "Territory", action: "existing_custom", fieldId: "cf_segment" }], owned).some((e) => /same custom field/.test(e)), "Two columns cannot fill the same custom field");
assert(validateMapping("tickets", [...KNOWN_COLUMNS.tickets.filter((c) => c.required).map((c) => ({ header: c.label, action: "map" as const, target: c.name })), { header: "R", action: "existing_custom", fieldId: "cf_segment" }], owned).some((e) => /only exist on the customers file/.test(e)), "An existing custom field cannot be used on a file other than customers");
assert(validateMapping("customers", [...ex("cf_segment"), { header: "Y", action: "custom", label: "Segment Group", type: "text", shareWithAi: false }], owned).some((e) => /already have/.test(e)), "A new custom field cannot reuse an existing one's name");
assert(validateMapping("customers", ex("cf_segment"), owned, ["Name", "Segment Group", "Other"]).some((e) => /"Other" has no choice/.test(e)), "File columns still need a choice when existing fields are involved");

const exParsed = parseCsv("Name,Segment Group,Account Owner,Notes\nAcme,EMEA,Sam,hello\nBeta,APAC,,\n");
const exApplied = applyMapping(exParsed, [{ header: "name", action: "map", target: "name" }, { header: "SEGMENT GROUP", action: "existing_custom", fieldId: "cf_segment" }, { header: "account owner", action: "existing_custom", fieldId: "cf_owner" }, { header: "notes", action: "ignore" }]);
assert(exApplied.headers.join() === "name" && exApplied.existingFields.length === 2, "Existing-field columns are taken out of the rewritten file and listed");
assert(exApplied.existingFieldValues.length === 2 && exApplied.existingFieldValues[0].cf_segment === "EMEA" && exApplied.existingFieldValues[0].cf_owner === "Sam" && exApplied.existingFieldValues[1].cf_owner === "", "Each row keeps its raw value for each existing field, row for row");
assert(exApplied.customFields.length === 0, "An existing field is not treated as a new custom field");

assert(parseColumnMapping([{ header: "Segment Group", action: "existing_custom", fieldId: "cf_segment" }]).ok, "A mapping with an existing_custom entry is accepted when read from the browser");
reject([{ header: "a", action: "existing_custom" }], "an existing_custom with no field id");
reject([{ header: "a", action: "existing_custom", fieldId: "" }], "an existing_custom with an empty field id");
reject([{ header: "a", action: "existing_custom", fieldId: 5 }], "an existing_custom with a non-text field id");
reject([{ header: "a", action: "existing_custom", fieldId: "x".repeat(501) }], "an existing_custom with a very long field id");
reject([{ header: "a", action: "existing_custom", fieldId: "cf_x", label: "L" }], "an existing_custom with a label as well");
reject([{ header: "a", action: "existing_custom", fieldId: "cf_x", shareWithAi: true }], "an existing_custom trying to change the AI setting");
reject(JSON.parse('[{"header":"a","action":"existing_custom","fieldId":"x","__proto__":{"polluted":true}}]'), "an existing_custom with a __proto__ key");

// ---------- a blank heading ----------
// Decision: a column with no heading can be neither mapped nor named, so the
// mapping screen shows it as "ignored" and leaves it out of the choices it sends.
// The file still imports; the result says how many such columns were ignored.
const blankFile = parseCsv("Name,,ARR,\nAcme,x,100,y\nBeta,,200,\n");
const blankSugg = suggestMapping("customers", blankFile.headers, blankFile.rows);
assert(blankSugg.length === 4 && blankSugg[1].action === "ignore" && blankSugg[3].action === "ignore", "A blank heading is suggested as ignore, one suggestion per column");
const blankMapping = suggestionsToMapping(blankSugg).filter((e) => e.header !== "");
assert(validateMapping("customers", blankMapping, [], blankFile.headers).length === 0, "Choices that leave out the blank-heading columns are valid for the whole file");
const blankApplied = applyMapping(blankFile, blankMapping);
assert(blankApplied.headers.join() === "name,contractual_arr" && blankApplied.rows[0].name === "Acme" && blankApplied.rows[0].contractual_arr === "100", "The blank-heading columns are dropped and the rest read normally");

// ---------- all nine kinds go through the existing validators ----------
const lookup = new Map([["acme freight", "c1"], ["cus-0001", "c1"]]);
const messyKinds: { kind: MappingKind; csv: string; check: (headers: string[], rows: Record<string, string>[]) => { errors: unknown[]; rows: unknown[] }; expectMapped: string }[] = [
  { kind: "stakeholders", csv: "Account Name,Contact Name,Job Title,Champion,Last Contacted,Extra\nAcme Freight,Alex,CTO,yes,2026-01-05,zzz\nCUS-0001,Bo,CFO,no,,zzz", check: (h, r) => validateStakeholderRows(h, r, lookup, 0), expectMapped: "customer,name,role,is_champion,last_engaged_date" },
  { kind: "goals", csv: "Account,Objective,Target,Actual,Unit of Measure\nAcme Freight,Cut handling time,100,40,hours", check: (h, r) => validateGoalRows(h, r, lookup, 0), expectMapped: "customer,name,target_value,actual_value,unit" },
  { kind: "training", csv: "Company,Course Name,Participants,Completed On\nAcme Freight,Onboarding 101,12,2026-02-01", check: (h, r) => validateTrainingRows(h, r, lookup, 0), expectMapped: "customer,course,attendees,date" },
  { kind: "events", csv: "Client,Webinar,Attended On\nAcme Freight,Spring launch,2026-03-01", check: (h, r) => validateEventRows(h, r, lookup, 0), expectMapped: "customer,event,date" },
  { kind: "surveys", csv: "Account,Survey Type,Rating,Responded On\nAcme Freight,nps,9,2026-03-02", check: (h, r) => validateSurveyRows(h, r, lookup, 0), expectMapped: "customer,type,score,date" },
  { kind: "usage", csv: "Account,Product Name,Feature,Kind,Month,Amount\nAcme Freight,Freight,Shipment tracking,adoption,2026-01-01,40", check: (h, r) => validateUsageRows(h, r, lookup, 0), expectMapped: "customer,product,capability,metric_type,date,value" },
];
for (const m of messyKinds) {
  const file = parseCsv(m.csv);
  const sug = suggestMapping(m.kind, file.headers, file.rows);
  const map = suggestionsToMapping(sug);
  assert(validateMapping(m.kind, map, [], file.headers).length === 0, `${m.kind}: the suggestions for a file with differently named columns make a valid mapping`);
  const applied = applyMapping(file, map);
  assert(applied.headers.join() === m.expectMapped, `${m.kind}: the columns are read as ${m.expectMapped}`);
  const checked = m.check(applied.headers, applied.rows);
  assert(checked.errors.length === 0 && checked.rows.length === file.rows.length, `${m.kind}: the existing validator accepts the rewritten file`);
}
const noCustomHere = suggestMapping("stakeholders", ["Customer", "Name", "Favourite colour"], [{ customer: "a", name: "b", "favourite colour": "red" }]);
assert(noCustomHere[2].action === "ignore", "stakeholders: an unknown column is ignored, because custom fields are customers-only");

// ---------- who may use the Data page ----------
assert(dataAccessProblem({ locked: true, isAdmin: true }, "import") === DEMO_LOCK_NOTICE, "The locked demo workspace refuses an import even to an admin");
assert(dataAccessProblem({ locked: true, isAdmin: true }, "custom fields") === DEMO_LOCK_NOTICE, "...and refuses custom-field changes");
assert(/Only a workspace admin/.test(dataAccessProblem({ locked: false, isAdmin: false }, "import") ?? ""), "A non-admin cannot import");
assert(/Only a workspace admin/.test(dataAccessProblem({ locked: false, isAdmin: false }, "custom fields") ?? ""), "A non-admin cannot change custom fields");
assert(dataAccessProblem({ locked: false, isAdmin: true }, "import") === null && dataAccessProblem({ locked: false, isAdmin: true }, "custom fields") === null, "An admin on an unlocked workspace may do both");
assert(dataAccessProblem({ locked: true, isAdmin: false }, "import") === DEMO_LOCK_NOTICE, "The demo lock is reported before the admin check");

// ---------- headings the export writes for custom fields ----------
assert(normaliseHeader("'=SUM(A1)") === normaliseHeader("=SUM(A1)") && normaliseHeader("'@mention") === normaliseHeader("@mention") && normaliseHeader("'+1 score") === normaliseHeader("+1 score") && normaliseHeader("'-x") === normaliseHeader("-x"), "A heading the export guarded with a leading apostrophe reads as the plain label");
assert(normaliseHeader("'hello") === "hello" && normaliseHeader("'") === "~'", "An apostrophe that is not a formula guard is only punctuation");
assert(normaliseHeader("@") === "~@" && normaliseHeader("'@") === "~@" && normaliseHeader("-") === "~-" && normaliseHeader("   ") === "" && normaliseHeader("") === "", "A heading made only of symbols is compared as written, and stays apart from a blank heading");
const guardFields = [{ id: "f1", label: "=SUM(A1)" }, { id: "f2", label: "@mention" }, { id: "f3", label: "-" }, { id: "f4", label: "Region" }, { id: "f5", label: "Health Score" }, { id: "f6", label: "Notes" }, { id: "f7", label: "Tier" }];
const guardHeaders = ["name", "region", "tier", "health_score", "'=sum(a1)", "'@mention", "'-", "region (custom)", "health score (custom)", "notes", "tier (custom)"];
const guarded = suggestMapping("customers", guardHeaders, [{ name: "A" }], guardFields);
const at = (h: string) => guarded[guardHeaders.indexOf(h)];
assert(at("'=sum(a1)").action === "existing_custom" && at("'=sum(a1)").fieldId === "f1", "A guarded formula-like heading maps to the existing field with that label");
assert(at("'@mention").fieldId === "f2" && at("'-").fieldId === "f3", "...also an @ label and a symbols-only label");
assert(at("region (custom)").action === "existing_custom" && at("region (custom)").fieldId === "f4", "A heading ending ' (custom)' maps to the existing field with that label (Region)");
assert(at("health score (custom)").fieldId === "f5" && at("tier (custom)").fieldId === "f7", "...for every label that clashes with a standard column");
assert(at("region").action === "map" && at("region").target === "region" && at("tier").target === "tier", "The plain standard heading stays the Bearing column even though a custom field has the same name");
assert(at("health_score").action === "ignore", "The Health result column is ignored even though a custom field is called Health Score");
assert(suggestMapping("customers", ["Name", "Health Score"], [{ name: "A", "health score": "7" }], guardFields)[1].fieldId === "f5", "...while a heading written as the field's own name (Health Score) is that field, beside the export's own health_score column");
const side = suggestMapping("customers", ["name", "health_score", "health score"], [{ name: "A", health_score: "50", "health score": "7" }], guardFields);
assert(side[1].action === "ignore" && side[2].action === "existing_custom" && side[2].fieldId === "f5", "The export's health_score and a custom field called Health Score, side by side, are told apart (the first is ignored, the second is the field)");
assert(suggestMapping("customers", ["Name", "Contract value (ARR)"], [{ name: "A", "contract value (arr)": "7" }], [{ id: "f9", label: "Contract value (ARR)" }])[1].fieldId === "f9", "A field named like a Bearing column LABEL (not its column name) is matched by its exact name");
assert(at("notes").fieldId === "f6", "An ordinary label still matches directly");
assert(suggestMapping("customers", ["Name", "Bonus (custom)"], [{ name: "A", "bonus (custom)": "x" }], guardFields)[1].action === "custom", "A '(custom)' heading with no such existing field is just a new custom field suggestion");
assert(suggestMapping("customers", ["Name", "Region (custom 2)"], [{ name: "A" }], guardFields)[1].fieldId === "f4", "A numbered '(custom 2)' heading, written when two names clash, also maps back");
assert(suggestMapping("tickets", ["Customer", "Date", "Text", "Notes (custom)"], [{ customer: "a" }], guardFields)[3].action === "ignore", "Only the customers file maps to custom fields");

console.log("\nAll import-mapping checks passed.");
