// Database checks for custom fields and the two-step flexible import:
//  - the custom-field store (create, rename, delete, the 25 cap, label rules,
//    workspace isolation, deleting a field removes its values from every customer);
//  - the "Include in AI reads" setting (off for fields made by an import unless
//    ticked, flips off -> on -> off and survives a reload, through the same code
//    path the Custom fields panel uses);
//  - Step 1 (the preview) and Step 2 (the mapped import): fields of each type
//    with correctly read values, a realistic messy file, one bad value refusing
//    the WHOLE import (no field, no customer, no saved mapping), saved mappings
//    reused by column signature, hostile mappings refused, all nine kinds.
//
// Creates throwaway workspaces (unique names) and removes only the rows it made,
// by id. It never calls the AI and never touches the demo workspace.
import { PrismaClient } from "@prisma/client";
import { importCsv, importCsvMapped } from "../src/lib/import/importData";
import { buildExport } from "../src/lib/import/exportData";
import { buildPreview, type PreviewResult } from "../src/lib/import/preview";
import { MAX_SAVED_PER_WORKSPACE, mappingToSave, reconcileSavedMapping, saveMapping } from "../src/lib/import/savedMappings";
import { mappingSignature } from "../src/lib/import/mapping";
import { parseCsv } from "../src/lib/import/csv";
import { CustomFieldError, createCustomField, deleteCustomField, listCustomFields, updateCustomField } from "../src/lib/customFields/store";
import { removeField, renameField, setFieldAiSharing } from "../src/lib/customFields/admin";
import { deleteWorkspaceAndData } from "../src/lib/deleteWorkspace";

const prisma = new PrismaClient();
const reload = new PrismaClient(); // a second connection, to prove a change was really saved

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const created: string[] = [];
const savedSelfHosted = process.env.SELF_HOSTED;

async function makeWorkspace(name: string): Promise<string> {
  const w = await prisma.workspace.create({ data: { name: `Custom fields check ${suffix} ${name}` } });
  created.push(w.id);
  return w.id;
}

type Ready = Extract<PreviewResult, { ok: true }>;

// What the browser sends back: the preview's choices, one per column that is not
// locked, with a new custom field's AI tick off unless a test turns it on.
function choicesFrom(p: Ready, change: (header: string, entry: Record<string, unknown>) => Record<string, unknown> = (_h, e) => e): Record<string, unknown>[] {
  return p.columns
    .filter((c) => !c.locked)
    .map((c) => {
      let entry: Record<string, unknown>;
      if (c.action === "map") entry = { header: c.header, action: "map", target: c.target };
      else if (c.action === "existing_custom") entry = { header: c.header, action: "existing_custom", fieldId: c.fieldId };
      else if (c.action === "custom") entry = { header: c.header, action: "custom", label: c.label, type: c.type, ...(c.type === "pick_list" ? { options: c.options } : {}), shareWithAi: false };
      else entry = { header: c.header, action: "ignore" };
      return change(c.header, entry);
    });
}

async function preview(ws: string, kind: string, text: string): Promise<Ready> {
  const p = await buildPreview(ws, kind, text);
  if (!p.ok) throw new Error(`preview failed: ${p.message}`);
  return p;
}

const counts = async (ws: string) => ({
  customers: await prisma.customer.count({ where: { workspaceId: ws } }),
  fields: await prisma.customField.count({ where: { workspaceId: ws } }),
  saved: await prisma.importMapping.count({ where: { workspaceId: ws } }),
});

const customersByName = async (ws: string) => {
  const rows = await prisma.customer.findMany({ where: { workspaceId: ws }, select: { name: true, region: true, customFields: true, products: { select: { contractualArr: true, renewalDate: true } } } });
  return new Map(rows.map((r) => [r.name, r]));
};

async function main(): Promise<void> {
  delete process.env.SELF_HOSTED; // hosted rules (the stricter ones) apply

  // =====================================================================
  // 1. The store
  // =====================================================================
  const w1 = await makeWorkspace("one");
  const w2 = await makeWorkspace("two");

  const text = await createCustomField(w1, { label: "  Account   Owner ", type: "text" });
  assert(text.label === "Account Owner" && text.type === "text" && text.options.length === 0, "A field is created with its label tidied (spaces collapsed)");
  assert(text.shareWithAi === true, "A field created directly in the store keeps the store's own default (on); imports pass the person's tick explicitly");
  const num = await createCustomField(w1, { label: "Seats", type: "number", shareWithAi: false });
  const dat = await createCustomField(w1, { label: "Go-live review", type: "date" });
  const pick = await createCustomField(w1, { label: "Segment", type: "pick_list", options: [" Gold ", "Silver", "", "Bronze"] });
  assert(JSON.stringify(pick.options) === JSON.stringify(["Gold", "Silver", "Bronze"]), "Pick-list choices are trimmed and blanks dropped");
  assert(num.shareWithAi === false, "An explicit AI setting of off is kept");
  const listed = await listCustomFields(w1);
  assert(listed.map((f) => f.label).join("|") === "Account Owner|Seats|Go-live review|Segment", "Fields are listed in the order they were created");
  assert((await listCustomFields(w2)).length === 0, "Another workspace sees none of them");

  const expectError = async (what: string, run: () => Promise<unknown>, pattern: RegExp) => {
    let message = "";
    try {
      await run();
    } catch (e) {
      message = e instanceof CustomFieldError ? e.message : `WRONG ERROR TYPE: ${String(e)}`;
    }
    assert(pattern.test(message), `${what} (${message || "no error"})`);
  };
  await expectError("A label that differs only by case is refused", () => createCustomField(w1, { label: "account owner", type: "text" }), /already a custom field/);
  await expectError("A label that differs only by spacing is refused", () => createCustomField(w1, { label: "ACCOUNT    OWNER", type: "text" }), /already a custom field/);
  await expectError("A blank label is refused", () => createCustomField(w1, { label: "   ", type: "text" }), /needs a name/);
  await expectError("A label over 60 characters is refused", () => createCustomField(w1, { label: "x".repeat(61), type: "text" }), /60 characters/);
  await expectError("A pick-list with no choices is refused", () => createCustomField(w1, { label: "Empty list", type: "pick_list", options: ["", " "] }), /between 1 and 50/);
  await expectError("A pick-list with 51 choices is refused", () => createCustomField(w1, { label: "Long list", type: "pick_list", options: Array.from({ length: 51 }, (_, i) => `c${i}`) }), /between 1 and 50/);
  await expectError("An unknown type is refused", () => createCustomField(w1, { label: "Odd", type: "colour" as never }), /Unknown field type/);
  assert((await createCustomField(w2, { label: "Account Owner", type: "text" })).label === "Account Owner", "The same label is fine in a different workspace");

  // The transaction client is honoured, so a later failure in an import removes the field too.
  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      await createCustomField(w2, { label: "Temporary", type: "text" }, tx);
      throw new Error("stop");
    });
  } catch {
    rolledBack = true;
  }
  assert(rolledBack && !(await listCustomFields(w2)).some((f) => f.label === "Temporary"), "A field created inside a transaction disappears if the transaction fails");

  // 25 per workspace
  const w25 = await makeWorkspace("cap");
  for (let i = 1; i <= 25; i++) await createCustomField(w25, { label: `Field ${i}`, type: "text" });
  assert((await listCustomFields(w25)).length === 25, "A workspace can have 25 custom fields");
  await expectError("The 26th custom field is refused", () => createCustomField(w25, { label: "Field 26", type: "text" }), /at most 25/);
  assert((await listCustomFields(w25)).length === 25, "...and nothing was added");

  // rename
  const renamed = await updateCustomField(w1, text.id, { label: "Owner" });
  assert(renamed?.label === "Owner" && (await listCustomFields(w1)).find((f) => f.id === text.id)?.label === "Owner", "A field can be renamed");
  const recased = await updateCustomField(w1, text.id, { label: "OWNER" });
  assert(recased?.label === "OWNER", "A field can be renamed to a different case of its own name");
  await expectError("Renaming to another field's name is refused", () => updateCustomField(w1, text.id, { label: "seats" }), /already a custom field/);
  assert((await updateCustomField(w2, text.id, { label: "Hijack" })) === null, "A field of another workspace cannot be renamed");
  assert((await listCustomFields(w1)).find((f) => f.id === text.id)?.label === "OWNER", "...and it is unchanged");
  assert((await renameField(w1, text.id, "Account owner")).ok, "Renaming through the panel's code path works");
  assert(/already a custom field/.test((await renameField(w1, text.id, "Seats")).message), "...and says plainly when the name is taken");
  assert(!(await renameField(w1, 42, "x")).ok && !(await renameField(w1, text.id, 42)).ok && !(await renameField(w1, "", "x")).ok, "The panel's rename refuses ids and names that are not text");
  assert(!(await renameField(w2, text.id, "Hijack")).ok, "The panel's rename refuses a field of another workspace");
  await updateCustomField(w1, text.id, { label: "Owner" });

  // =====================================================================
  // 2. "Include in AI reads"
  // =====================================================================
  assert((await listCustomFields(w1)).find((f) => f.id === dat.id)?.shareWithAi === true, "(the field made directly in the store started on)");
  const off = await updateCustomField(w1, dat.id, { shareWithAi: false });
  assert(off?.shareWithAi === false && (await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === false, "Switching a field off is saved (read back on a separate connection, as after a reload)");
  const on = await updateCustomField(w1, dat.id, { shareWithAi: true });
  assert(on?.shareWithAi === true && (await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === true, "Switching it on is saved and survives a reload");
  const offAgain = await updateCustomField(w1, dat.id, { shareWithAi: false });
  assert(offAgain?.shareWithAi === false && (await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === false, "Switching it off again is saved");
  assert((await updateCustomField(w1, dat.id, { label: "Go-live review" }))?.shareWithAi === false, "Renaming a field does not change its AI setting");

  const switchedOn = await setFieldAiSharing(w1, dat.id, true);
  assert(switchedOn.ok && switchedOn.field?.shareWithAi === true && /Anthropic/.test(switchedOn.message) && /own key/.test(switchedOn.message), "The panel's switch (on) saves and says what that means: values go to Anthropic, using the workspace's own key");
  assert((await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === true, "...and it is on after a reload");
  const switchedOff = await setFieldAiSharing(w1, dat.id, false);
  assert(switchedOff.ok && switchedOff.field?.shareWithAi === false && (await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === false, "The panel's switch (off) saves and survives a reload");
  for (const [label, id, value] of [["a string 'true'", dat.id, "true"], ["the number 1", dat.id, 1], ["null", dat.id, null], ["a missing value", dat.id, undefined], ["an empty id", "", true], ["a number id", 5, true], ["an object id", {}, true]] as [string, unknown, unknown][]) {
    const r = await setFieldAiSharing(w1, id, value);
    assert(!r.ok, `The panel's switch refuses ${label}`);
  }
  assert((await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === false, "...and the setting is unchanged after those refusals");
  const crossWs = await setFieldAiSharing(w2, dat.id, true);
  assert(!crossWs.ok && /no longer exists/.test(crossWs.message) && (await reload.customField.findUnique({ where: { id: dat.id } }))?.shareWithAi === false, "A field of another workspace cannot be switched from here");
  assert(!(await setFieldAiSharing(w1, "no-such-field", true)).ok, "A field that does not exist is refused");

  // =====================================================================
  // 3. A mapped import creating one field of each type
  // =====================================================================
  const wA = await makeWorkspace("import");
  const typed = [
    "Name,Owner,Seats,Review date,Segment,Notes",
    "Acme Freight,Sam,\"1,200\",2027-03-31, gold ,Quiet lately",
    "Beta Logistics,Priya,£3,2027-04-30,SILVER,",
    "Gamma Supply,,,,,",
    "Delta Cargo,Lee,45,2027-05-31,Gold,Escalated",
    "Eta Shipping,Sam,12.5,,Bronze,Fine",
    "Zeta Lines,Kim,9,2027-06-30,Silver,Ok",
    "Theta Lines,Kim,8,2027-07-31,gold,Ok",
  ].join("\n");
  const pA = await preview(wA, "customers", typed);
  assert(pA.columns[0].action === "map" && pA.columns[0].target === "name", "Step 1: the Name column is recognised");
  const owner = pA.columns.find((c) => c.header === "owner")!;
  const seats = pA.columns.find((c) => c.header === "seats")!;
  const review = pA.columns.find((c) => c.header === "review date")!;
  const segment = pA.columns.find((c) => c.header === "segment")!;
  assert(owner.action === "custom" && owner.shareWithAi === false && seats.type === "number" && review.type === "date", "Step 1: unknown columns are offered as new custom fields (typed by their values) with the AI tick off");
  assert(segment.type === "pick_list" && (segment.options ?? []).length === 3, "Step 1: a column of a few repeated values is offered as a pick-list with its choices");
  assert(pA.canCreateFields && pA.fieldRoom === 25 && pA.savedApplied === false && pA.existingFields.length === 0, "Step 1: a customers file can create fields, 25 are free, there is no saved mapping yet");
  assert(pA.known.some((k) => k.name === "name" && k.required) && pA.rowCount === 7, "Step 1: it lists the Bearing columns it can map to and counts the rows");
  assert(pA.columns.every((c) => c.samples.length <= 3), "Step 1: at most three sample values per column");
  assert((await counts(wA)).customers === 0 && (await counts(wA)).fields === 0 && (await counts(wA)).saved === 0, "Step 1 writes nothing");

  const choicesA = choicesFrom(pA, (h, e) => (h === "segment" ? { ...e, shareWithAi: true } : e));
  const rA = await importCsvMapped(wA, "customers", typed, JSON.stringify(choicesA));
  assert(rA.ok && rA.imported === 7, `Step 2: the file imports (${rA.message})`);
  assert(/Created 5 custom fields: /.test(rA.message) && /Seats \(number\)/.test(rA.message) && /Review Date \(date\)/.test(rA.message) && /Segment \(pick-list\)/.test(rA.message) && /Notes \(text\)/.test(rA.message), `The result lists the custom fields it created (${rA.message})`);
  assert(/These columns were ignored: notes/.test(rA.message) === false, "(Notes is kept as a custom field here, so it is not reported as ignored)");
  const fieldsA = await listCustomFields(wA);
  const byLabel = new Map(fieldsA.map((f) => [f.label, f]));
  assert(fieldsA.length === 5, "Five custom fields exist: Owner, Seats, Review date, Segment and Notes");
  assert(byLabel.get("Owner")!.shareWithAi === false && byLabel.get("Seats")!.shareWithAi === false && byLabel.get("Review Date")!.shareWithAi === false && byLabel.get("Notes")!.shareWithAi === false, "Fields made by the import are NOT shared with the AI by default");
  assert(byLabel.get("Segment")!.shareWithAi === true, "A field whose 'Include in AI reads' tick was on is saved as shared");
  assert(byLabel.get("Segment")!.type === "pick_list" && byLabel.get("Segment")!.options.join("|") === [...(segment.options ?? [])].join("|"), "The pick-list keeps its choices");
  const cA = await customersByName(wA);
  const acme = cA.get("Acme Freight")!.customFields as Record<string, unknown>;
  assert(acme[byLabel.get("Owner")!.id] === "Sam", "A text value is stored under the field's id");
  assert(acme[byLabel.get("Seats")!.id] === 1200 && typeof acme[byLabel.get("Seats")!.id] === "number", "A number with a thousands comma is stored as the number 1200");
  assert(acme[byLabel.get("Review Date")!.id] === "2027-03-31", "A date is stored as YYYY-MM-DD");
  assert(acme[byLabel.get("Segment")!.id] === segment.options?.find((o) => o.toLowerCase() === "gold"), "A pick-list value is stored as the canonical choice (' gold ' becomes the listed spelling)");
  const beta = cA.get("Beta Logistics")!.customFields as Record<string, unknown>;
  assert(beta[byLabel.get("Seats")!.id] === 3, "A currency sign is accepted on a number (£3 is 3)");
  assert(!(byLabel.get("Notes")!.id in beta), "A blank cell stores no value for that customer");
  assert(Object.keys(cA.get("Gamma Supply")!.customFields as object).length === 0, "A customer with every custom cell blank has an empty custom-fields object");
  assert((cA.get("Eta Shipping")!.customFields as Record<string, unknown>)[byLabel.get("Seats")!.id] === 12.5, "A decimal number is kept as a decimal");
  const savedA = await prisma.importMapping.findMany({ where: { workspaceId: wA } });
  assert(savedA.length === 1 && savedA[0].kind === "customers" && savedA[0].signature === mappingSignature(parseCsv(typed).headers), "The confirmed mapping is saved against the file's column signature");
  const savedEntries = savedA[0].mapping as { header: string; action: string; fieldId?: string }[];
  assert(savedEntries.every((e) => e.action !== "custom") && savedEntries.filter((e) => e.action === "existing_custom").every((e) => fieldsA.some((f) => f.id === e.fieldId)), "The saved mapping points at the fields the import created, never at 'create a new field' again");
  assert(!JSON.stringify(savedA[0].mapping).includes("shareWithAi"), "The saved mapping does not carry an AI setting: a field keeps its own");

  // =====================================================================
  // 4. The realistic messy file
  // =====================================================================
  const wB = await makeWorkspace("messy");
  const messy = [
    "﻿Account Name,ACV (GBP),Contract End,Region,Owner,Health Notes",
    'Acme Freight,"£48,000",2027-03-31,EMEA,Sam,Quiet lately',
    "Beta Logistics,9000,2027-06-30,APAC,Priya,Asked about seats",
    'Gamma Supply,"120,000",2027-01-31,EMEA,Sam,',
    "Delta Cargo,15000,2026-12-31,AMER,Lee,Escalated twice",
    "Epsilon Haulage,7000,2027-09-30,EMEA,Priya,Happy",
    "Zeta Transport,22000,2027-02-28,APAC,Sam,Renewal at risk",
    "Eta Shipping,31000,2027-05-31,EMEA,Lee,Growing usage",
    "Theta Express,5000,2027-08-31,APAC,Priya,New champion",
  ].join("\n");
  const pB = await preview(wB, "customers", messy);
  const act = (h: string) => pB.columns.find((c) => c.header === h)!;
  assert(act("account name").target === "name" && act("acv (gbp)").target === "contractual_arr" && act("contract end").target === "renewal_date" && act("region").target === "region", "Messy file: Account Name, ACV, Contract End and Region are matched to Bearing's own columns");
  assert(act("owner").action === "custom" && act("health notes").action === "custom" && act("health notes").type === "text", "Messy file: Owner and Health Notes are offered as custom fields");
  const rB = await importCsvMapped(wB, "customers", messy, choicesFrom(pB));
  assert(rB.ok && rB.imported === 8, `Messy file: imports all eight customers (${rB.message})`);
  const cB = await customersByName(wB);
  assert(Number(cB.get("Acme Freight")!.products[0].contractualArr) === 48000 && Number(cB.get("Gamma Supply")!.products[0].contractualArr) === 120000, "Messy file: '£48,000' and '120,000' are read as 48000 and 120000");
  assert(cB.get("Beta Logistics")!.products[0].renewalDate?.toISOString().slice(0, 10) === "2027-06-30" && cB.get("Delta Cargo")!.region === "AMER", "Messy file: the renewal date and Region reach their own Bearing fields");
  const fB = await listCustomFields(wB);
  assert(fB.map((f) => f.label).join("|") === "Owner|Health Notes" && fB.every((f) => f.shareWithAi === false), "Messy file: Owner and Health Notes became custom fields, both off for the AI");
  const ownerB = fB.find((f) => f.label === "Owner")!;
  assert(ownerB.type === "pick_list" && (cB.get("Zeta Transport")!.customFields as Record<string, unknown>)[ownerB.id] === "Sam", "Messy file: Owner is a pick-list and holds the right value");

  // =====================================================================
  // 5. One bad value refuses the whole import
  // =====================================================================
  const wC = await makeWorkspace("bad");
  await createCustomField(wC, { label: "Existing field", type: "text" });
  const preExisting = await prisma.customer.create({ data: { workspaceId: wC, name: "Already Here", ref: "CUS-0001", tier: "mid_market" } });
  const baseline = await counts(wC);
  const bad = [
    "Name,Seats,Segment",
    "Acme Freight,12,Gold",
    "Beta Logistics,40,Silver",
    "Gamma Supply,twelve,Gold",
    "Delta Cargo,7,Gold",
  ].join("\n");
  const pC = await preview(wC, "customers", bad);
  const rC = await importCsvMapped(wC, "customers", bad, choicesFrom(pC, (h, e) => (h === "seats" ? { ...e, type: "number" } : e)));
  assert(!rC.ok && rC.imported === 0, "A text value in a number field: the import is refused");
  assert(rC.errors.length === 1 && rC.errors[0].row === 4 && /Seats/.test(rC.errors[0].message) && /not a number/.test(rC.errors[0].message), `...against the right spreadsheet row (row 4) and field (${JSON.stringify(rC.errors)})`);
  const afterC = await counts(wC);
  assert(afterC.customers === baseline.customers && afterC.fields === baseline.fields && afterC.saved === baseline.saved, "...and no customer, no custom field and no saved mapping was created");
  assert((await prisma.customer.findUnique({ where: { id: preExisting.id } }))?.name === "Already Here", "...and the customers that were already there are untouched");

  const badBoth = ["Name,ARR,Seats", "Acme Freight,lots,12", "Beta Logistics,40,many"].join("\n");
  const pBoth = await preview(wC, "customers", badBoth);
  const rBoth = await importCsvMapped(wC, "customers", badBoth, choicesFrom(pBoth, (h, e) => (h === "seats" ? { ...e, type: "number" } : e)));
  assert(!rBoth.ok && rBoth.errors.length === 2 && rBoth.errors[0].row === 2 && rBoth.errors[1].row === 3, "A bad Bearing column and a bad custom value are reported together, in row order");
  assert((await counts(wC)).customers === baseline.customers, "...and nothing was written");

  const wrongPick = ["Name,Tier note", "Acme Freight,Gold", "Beta Logistics,Silver", "Gamma Supply,Gold", "Delta Cargo,Gold"].join("\n");
  const pPick = await preview(wC, "customers", wrongPick);
  const rPick = await importCsvMapped(wC, "customers", wrongPick, choicesFrom(pPick, (_h, e) => (e.action === "custom" ? { ...e, type: "pick_list", options: ["Gold", "Platinum"] } : e)));
  assert(!rPick.ok && rPick.errors.some((e) => e.row === 3 && /allowed choices/.test(e.message)), "A value outside a pick-list's choices is refused, naming the row");

  const contradiction = ["Name,Product,Owner", "Acme Freight,Freight,Sam", "Acme Freight,Warehouse,Priya", "Beta Logistics,Freight,Lee"].join("\n");
  const pCon = await preview(wC, "customers", contradiction);
  const rCon = await importCsvMapped(wC, "customers", contradiction, choicesFrom(pCon));
  assert(!rCon.ok && rCon.errors.some((e) => e.row === 3 && /same customer/.test(e.message)), "Two rows for one customer that disagree on a custom field are refused");
  const sameOk = ["Name,Product,Owner", "Acme Freight,Freight,Sam", "Acme Freight,Warehouse,", "Beta Logistics,Freight,Lee"].join("\n");
  const rSame = await importCsvMapped(wC, "customers", sameOk, choicesFrom(await preview(wC, "customers", sameOk)));
  const fieldsC = await listCustomFields(wC);
  const ownerC = fieldsC.find((f) => f.label === "Owner")!;
  const cC = await customersByName(wC);
  assert(rSame.ok && (cC.get("Acme Freight")!.customFields as Record<string, unknown>)[ownerC.id] === "Sam", "Rows for one customer may leave a custom cell blank: the customer keeps the value from the row that has it");

  // =====================================================================
  // 6. Saved mappings, reused by column signature
  // =====================================================================
  const reordered = [
    "SEGMENT,review date,Seats,name,OWNER,Notes",
    "Kappa Cargo,gold,5,2027-01-31,Lee,hello".split(",").reverse().join(",").split(",").reverse().join(","),
  ];
  // Same columns, different order and case; values written to match the new order.
  const sameColumns = ["SEGMENT,review date,Seats,NAME,OWNER,Notes", "Gold,2027-01-31,5,Kappa Cargo,Lee,hello", "Silver,2027-02-28,8,Lambda Lines,Priya,"].join("\n");
  void reordered;
  const pSame = await preview(wA, "customers", sameColumns);
  assert(pSame.savedApplied === true, "The same columns in a different order and case: the saved mapping is applied");
  assert(pSame.columns.filter((c) => !c.locked).every((c) => c.reason === "Saved mapping applied" && c.confidence === 1), "...and each column is labelled 'Saved mapping applied'");
  assert(pSame.columns.find((c) => c.header === "owner")?.action === "existing_custom" && pSame.columns.find((c) => c.header === "owner")?.fieldId === byLabel.get("Owner")!.id, "...with the columns pointing at the fields the first import created");
  assert(pSame.columns.find((c) => c.header === "name")?.target === "name", "...and Name still mapped to Name");
  assert(pSame.existingFields.length === 5, "The preview lists the workspace's existing custom fields");
  const rSameCols = await importCsvMapped(wA, "customers", sameColumns, choicesFrom(pSame));
  assert(rSameCols.ok && rSameCols.imported === 2, `Importing through the saved mapping works (${rSameCols.message})`);
  assert((await listCustomFields(wA)).length === 5 && !/Created/.test(rSameCols.message), "...and creates no new custom fields (the values go into the existing ones)");
  const kappa = (await customersByName(wA)).get("Kappa Cargo")!.customFields as Record<string, unknown>;
  assert(kappa[byLabel.get("Owner")!.id] === "Lee" && kappa[byLabel.get("Seats")!.id] === 5, "...and the values land in the right fields");
  assert((await prisma.importMapping.count({ where: { workspaceId: wA } })) === 1, "Saving again for the same columns updates the one saved mapping, it does not add another");
  const fewer = await preview(wA, "customers", "Name,Owner\nMu Marine,Sam");
  assert(fewer.savedApplied === false, "A file with a different set of columns does not use the saved mapping");
  const differentOne = await preview(wA, "customers", "Name,Owner,Seats,Review date,Segment,Something else\nNu Nets,Sam,1,2027-01-01,Gold,x");
  assert(differentOne.savedApplied === false, "...even if it differs by one column");
  assert(differentOne.columns.find((c) => c.header === "owner")?.action === "existing_custom", "...but a column headed like an existing custom field is still matched to it");

  // a deleted field falls back to a fresh suggestion; the rest of the saved choices still apply
  const wD = await makeWorkspace("saved-delete");
  const two = "Name,Owner,Region note\nOmega Oil,Sam,north\nPi Parcels,Lee,south\n";
  await importCsvMapped(wD, "customers", two, choicesFrom(await preview(wD, "customers", two)));
  const fieldsD = await listCustomFields(wD);
  await deleteCustomField(wD, fieldsD.find((f) => f.label === "Owner")!.id);
  const again = await preview(wD, "customers", "Name,Owner,Region note\nRho Rail,Kim,east\n");
  assert(again.savedApplied === true, "After a field is deleted, the saved mapping is still used for the other columns");
  assert(again.columns.find((c) => c.header === "owner")?.action === "custom" && again.columns.find((c) => c.header === "region note")?.action === "existing_custom", "...and the column whose field was deleted goes back to being a suggested new field");

  // saved mappings are capped per workspace
  const wE = await makeWorkspace("saved-cap");
  for (let i = 0; i < MAX_SAVED_PER_WORKSPACE + 5; i++) {
    await saveMapping(prisma, wE, "customers", `sig-${i}`, [{ header: "name", action: "map", target: "name" }]);
  }
  const savedE = await prisma.importMapping.findMany({ where: { workspaceId: wE }, select: { signature: true } });
  assert(savedE.length === MAX_SAVED_PER_WORKSPACE, `A workspace keeps at most ${MAX_SAVED_PER_WORKSPACE} saved mappings`);
  assert(savedE.some((s) => s.signature === `sig-${MAX_SAVED_PER_WORKSPACE + 4}`) && !savedE.some((s) => s.signature === "sig-0"), "...and it is the oldest that are dropped");

  // saved mapping helpers
  const conv = mappingToSave([{ header: "A", action: "custom", label: "A", type: "text", shareWithAi: true }, { header: "B", action: "map", target: "name" }, { header: "C", action: "custom", label: "C", type: "text", shareWithAi: false }], new Map([["a", "id-a"]]));
  assert(conv[0].action === "existing_custom" && (conv[0] as { fieldId: string }).fieldId === "id-a" && conv[1].action === "map" && conv[2].action === "ignore", "A new field is saved as a reference to the field it created (and never with its AI tick)");
  assert(reconcileSavedMapping("customers", [{ header: "Name", action: "map", target: "bogus" }], [], [], ["Name"]) === null, "A saved mapping that no longer passes the import's own checks is not used");
  assert(reconcileSavedMapping("customers", [{ header: "Name", action: "map", target: "name" }, { header: "X", action: "existing_custom", fieldId: "gone" }], [{ header: "Name", action: "map", target: "name" }, { header: "X", action: "ignore" }], [], ["Name", "X"])?.[1].action === "ignore", "A reference to a deleted field is replaced by today's suggestion");

  // =====================================================================
  // 7. Hostile mappings
  // =====================================================================
  const wH = await makeWorkspace("hostile");
  const wOther = await makeWorkspace("hostile-other");
  const foreign = await createCustomField(wOther, { label: "Foreign", type: "text" });
  const file = "Name,Owner\nQuincy Quay,Sam\n";
  const refused = async (what: string, kind: Parameters<typeof importCsvMapped>[1], csv: string, mapping: unknown, pattern?: RegExp) => {
    const before = await counts(wH);
    const r = await importCsvMapped(wH, kind, csv, mapping);
    const after = await counts(wH);
    assert(!r.ok && r.imported === 0, `Refused: ${what}`);
    if (pattern) assert(pattern.test(r.message + JSON.stringify(r.errors)), `...with a plain reason (${(r.message + r.errors.map((e) => e.message).join(" ")).slice(0, 110)})`);
    assert(after.customers === before.customers && after.fields === before.fields && after.saved === before.saved, "...and nothing was created");
  };
  await refused("mapping text that is not JSON", "customers", file, "not json", /could not be read/);
  await refused("a mapping with a __proto__ key", "customers", file, '[{"header":"name","action":"map","target":"name","__proto__":{"x":1}}]', /could not be read|not allowed|unknown/i);
  await refused("a mapping with a constructor key", "customers", file, '[{"header":"name","action":"map","target":"name","constructor":{"prototype":{"x":1}}}]');
  await refused("a mapping that is not a list", "customers", file, '{"header":"name"}');
  await refused("an empty mapping", "customers", file, "[]", /Customer name/);
  await refused("a required column left out", "customers", file, [{ header: "owner", action: "ignore" }, { header: "name", action: "ignore" }], /Customer name/);
  await refused("two columns to one Bearing column", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "map", target: "name" }], /both set to/);
  await refused("a column the mapping does not cover", "customers", file, [{ header: "name", action: "map", target: "name" }], /no choice/);
  await refused("an unknown Bearing column", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "map", target: "password" }], /no such field/);
  await refused("a custom field for a tickets file", "tickets", "Customer,Date,Text,Extra\nCUS-1,2026-01-01,hi,x\n", [{ header: "customer", action: "map", target: "customer" }, { header: "date", action: "map", target: "date" }, { header: "text", action: "map", target: "text" }, { header: "extra", action: "custom", label: "Extra", type: "text", shareWithAi: false }], /only be added from the customers file/);
  await refused("an existing custom field for a tickets file", "tickets", "Customer,Date,Text,Extra\nCUS-1,2026-01-01,hi,x\n", [{ header: "customer", action: "map", target: "customer" }, { header: "date", action: "map", target: "date" }, { header: "text", action: "map", target: "text" }, { header: "extra", action: "existing_custom", fieldId: foreign.id }], /only exist on the customers file/);
  await refused("a field id from another workspace", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "existing_custom", fieldId: foreign.id }], /no longer exists/);
  await refused("a field id that does not exist", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "existing_custom", fieldId: "cm0000000000000000000000" }], /no longer exists/);
  assert((await listCustomFields(wOther)).length === 1 && (await customersByName(wOther)).size === 0, "The other workspace's field and data were not touched by those attempts");
  await refused("a custom field named like a built-in field", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "custom", label: "Tier", type: "text", shareWithAi: false }], /built-in/);
  await refused("a custom field name over 60 characters", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "custom", label: "x".repeat(61), type: "text", shareWithAi: false }], /60 characters/);
  await refused("a pick-list with no choices", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "custom", label: "Owner", type: "pick_list", options: [], shareWithAi: false }], /at least one choice/);
  await refused("an AI setting that is not true or false", "customers", file, [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "custom", label: "Owner", type: "text", shareWithAi: "yes" }], /could not be read/);
  await refused("two files columns with exactly the same heading", "customers", "Name,Owner,Owner\nQuincy,Sam,Lee\n", [{ header: "name", action: "map", target: "name" }, { header: "owner", action: "ignore" }], /more than once/);
  const twentySix = ["Name", ...Array.from({ length: 26 }, (_, i) => `Extra ${i + 1}`)];
  await refused("26 new custom fields in one file", "customers", `${twentySix.join(",")}\n${twentySix.map((_, i) => (i === 0 ? "Quincy" : "v")).join(",")}\n`, [{ header: "name", action: "map", target: "name" }, ...twentySix.slice(1).map((h) => ({ header: h, action: "custom", label: h, type: "text", shareWithAi: false }))], /at most 25/);

  // 20 existing + 6 new = 26 in total
  const wF = await makeWorkspace("cap-import");
  for (let i = 1; i <= 20; i++) await createCustomField(wF, { label: `Old ${i}`, type: "text" });
  const sixNew = ["Name", ...Array.from({ length: 6 }, (_, i) => `New ${i + 1}`)];
  const rF = await importCsvMapped(wF, "customers", `${sixNew.join(",")}\n${sixNew.map((_, i) => (i === 0 ? "Quincy" : "v")).join(",")}\n`, [{ header: "name", action: "map", target: "name" }, ...sixNew.slice(1).map((h) => ({ header: h, action: "custom", label: h, type: "text", shareWithAi: false }))]);
  assert(!rF.ok && /at most 25/.test(JSON.stringify(rF.errors)) && (await listCustomFields(wF)).length === 20 && (await customersByName(wF)).size === 0, "The 25-field cap counts fields the workspace already has (20 + 6 is refused, nothing created)");

  // a name clash with an existing field
  const wG = await makeWorkspace("name-clash");
  await createCustomField(wG, { label: "Owner", type: "text" });
  const rG = await importCsvMapped(wG, "customers", "Name,Who\nQuincy,Sam\n", [{ header: "name", action: "map", target: "name" }, { header: "who", action: "custom", label: "owner", type: "text", shareWithAi: false }]);
  assert(!rG.ok && /already have a custom field/.test(JSON.stringify(rG.errors)) && (await listCustomFields(wG)).length === 1, "A new field named like an existing one (any case) is refused");

  // =====================================================================
  // 8. Isolation: customers only hold their own workspace's field ids
  // =====================================================================
  for (const [ws, label] of [[wA, "import"], [wB, "messy"], [wC, "bad"], [wD, "saved-delete"]] as [string, string][]) {
    const ids = new Set((await listCustomFields(ws)).map((f) => f.id));
    const rows = await prisma.customer.findMany({ where: { workspaceId: ws }, select: { customFields: true } });
    const stray = rows.flatMap((r) => Object.keys(r.customFields as object)).filter((k) => !ids.has(k));
    assert(stray.length === 0, `Workspace '${label}': every key in Customer.customFields is one of that workspace's own fields`);
  }
  const allIdsA = new Set((await listCustomFields(wA)).map((f) => f.id));
  const rowsB = await prisma.customer.findMany({ where: { workspaceId: wB }, select: { customFields: true } });
  assert(!rowsB.some((r) => Object.keys(r.customFields as object).some((k) => allIdsA.has(k))), "No customer holds a value keyed by another workspace's field");

  // =====================================================================
  // 9. Deleting a field removes its values from every customer
  // =====================================================================
  const wDel = await makeWorkspace("delete");
  const delFile = ["Name,Owner,Seats", "Alpha,Sam,10", "Bravo,Lee,20", "Charlie,,30"].join("\n");
  const rDel = await importCsvMapped(wDel, "customers", delFile, choicesFrom(await preview(wDel, "customers", delFile)));
  assert(rDel.ok, "(set up three customers with two custom fields)");
  const [fOwner, fSeats] = [(await listCustomFields(wDel)).find((f) => f.label === "Owner")!, (await listCustomFields(wDel)).find((f) => f.label === "Seats")!];
  const wDelOther = await makeWorkspace("delete-other");
  const otherFile = "Name,Owner\nDelta,Kim\n";
  await importCsvMapped(wDelOther, "customers", otherFile, choicesFrom(await preview(wDelOther, "customers", otherFile)));
  const otherBefore = JSON.stringify((await prisma.customer.findMany({ where: { workspaceId: wDelOther }, select: { name: true, customFields: true } })));
  assert(!(await removeField(wDelOther, fOwner.id)).ok, "The panel's delete refuses a field of another workspace");
  assert(!(await removeField(wDel, 7)).ok && !(await removeField(wDel, "")).ok, "The panel's delete refuses ids that are not text");
  const gone = await removeField(wDel, fOwner.id);
  assert(gone.ok && /every customer/.test(gone.message), "Deleting through the panel's code path works and says the values were removed from every customer");
  const afterDel = await prisma.customer.findMany({ where: { workspaceId: wDel }, select: { name: true, customFields: true } });
  assert(afterDel.length === 3 && afterDel.every((c) => !(fOwner.id in (c.customFields as object))), "The deleted field's values are gone from every customer");
  assert(afterDel.every((c) => fSeats.id in (c.customFields as object)), "...while the other field's values are untouched");
  assert((await prisma.customField.count({ where: { id: fOwner.id } })) === 0, "...and the definition is gone");
  assert(JSON.stringify(await prisma.customer.findMany({ where: { workspaceId: wDelOther }, select: { name: true, customFields: true } })) === otherBefore, "Another workspace's customers and fields (even with the same label) were not touched");
  assert(!(await removeField(wDel, fOwner.id)).ok, "Deleting it again says it no longer exists");

  // =====================================================================
  // 10. Other kinds: map / ignore only, through the same two steps
  // =====================================================================
  const wK = await makeWorkspace("kinds");
  const baseFile = "Name\nAcme Freight\nBeta Logistics\n";
  await importCsvMapped(wK, "customers", baseFile, choicesFrom(await preview(wK, "customers", baseFile)));
  const ticketCsv = "Account,Opened,Priority,Description,Internal code\nAcme Freight,2026-02-01,high,Invoices blocked,X1\nBeta Logistics,2026-02-02,low,Asked about seats,X2\n";
  const pT = await preview(wK, "tickets", ticketCsv);
  assert(pT.canCreateFields === false && pT.columns.find((c) => c.header === "internal code")?.action === "ignore", "Tickets: an unknown column is offered as 'ignore' (custom fields are customers-only)");
  const rT = await importCsvMapped(wK, "tickets", ticketCsv, choicesFrom(pT));
  assert(rT.ok && rT.imported === 2 && /These columns were ignored: internal code/.test(rT.message), `Tickets with renamed columns import, and the result names the ignored column (${rT.message})`);
  assert((await prisma.interaction.count({ where: { customer: { workspaceId: wK } } })) === 2 && (await counts(wK)).fields === 0, "...and no custom field was made");
  const nine: [string, string][] = [
    ["stakeholders", "Account Name,Contact Name,Job Title,Champion,Last Contacted\nAcme Freight,Alex,CTO,yes,2026-01-05\n"],
    ["goals", "Account,Objective,Target,Actual,Unit of Measure\nAcme Freight,Cut handling time,100,40,hours\n"],
    ["training", "Company,Course Name,Participants,Completed On\nAcme Freight,Onboarding 101,12,2026-02-01\n"],
    ["events", "Client,Webinar,Attended On\nAcme Freight,Spring launch,2026-03-01\n"],
    ["surveys", "Account,Survey Type,Rating,Responded On\nAcme Freight,nps,9,2026-03-02\n"],
    ["usage", "Account,Product Name,Feature,Kind,Month,Amount\nAcme Freight,Core product,Shipment tracking,adoption,2026-01-01,40\n"],
    ["outcomes", "Account,Closed On,Result,Comments\nAcme Freight,2026-01-01,renewed,Smooth\n"],
  ];
  for (const [kind, csv] of nine) {
    const r = await importCsvMapped(wK, kind as Parameters<typeof importCsvMapped>[1], csv, choicesFrom(await preview(wK, kind, csv)));
    assert(r.ok && r.imported === 1, `${kind}: a file with differently named columns imports through the mapping (${r.message})`);
  }
  assert((await prisma.importMapping.count({ where: { workspaceId: wK } })) === 9, "A mapping was saved for every kind that was imported (nine in all, customers included)");
  const rBlank = await importCsvMapped(wK, "customers", "Name,,Tier\nGamma Supply,x,enterprise\n", [{ header: "name", action: "map", target: "name" }, { header: "tier", action: "map", target: "tier" }]);
  assert(rBlank.ok && /1 column with no heading/.test(rBlank.message), `A column with no heading imports and is reported as ignored (${rBlank.message})`);
  const pBlank = await preview(wK, "customers", "Name,,Tier\nSigma Supply,x,enterprise\n");
  assert(pBlank.columns[1].locked && pBlank.columns[1].action === "ignore", "Step 1 shows a blank-heading column as ignored and leaves it out of the choices");
  assert((await buildPreview(wK, "customers", "Name,Tier,Tier\nA,b,c\n")).ok === false, "Step 1 refuses two columns with exactly the same heading, asking for one to be renamed");
  assert((await buildPreview(wK, "customers", "")).ok === false && (await buildPreview(wK, "customers", "Name\n")).ok === false, "Step 1 refuses an empty file and a file with no rows");
  assert((await buildPreview(wK, "bogus", "Name\nA\n")).ok === false, "Step 1 refuses an unknown file type");
  assert((await buildPreview(wK, "customers", "Name\u0000\nA\n")).ok === false, "Step 1 refuses a file containing a null character");

  // =====================================================================
  // 11. Round trip: export, then import again, every custom column finds its field
  // =====================================================================
  const wR = await makeWorkspace("roundtrip");
  const wR2 = await makeWorkspace("roundtrip-copy");
  // Labels that make awkward headers: formula-looking (the export guards them with an
  // apostrophe), symbols only, and names that clash with standard columns (the export
  // writes those as "<label> (custom)").
  const awkward: { label: string; type: "text" | "number" | "pick_list"; options?: string[]; sample: [string | number, string | number] }[] = [
    { label: "=SUM(A1)", type: "text", sample: ["=1+1", "plain"] },
    { label: "@mention", type: "text", sample: ["@sam", "@lee"] },
    { label: "+1 score", type: "number", sample: [1200.5, 3] },
    { label: "-", type: "text", sample: ["dash", "dot"] },
    { label: "Region", type: "text", sample: ["North cluster", "South cluster"] },
    { label: "Tier", type: "pick_list", options: ["Gold", "Silver"], sample: ["Gold", "Silver"] },
    { label: "Health Score", type: "number", sample: [7, 9] },
    { label: "Notes", type: "text", sample: ["hello, world", 'says "hi"'] },
  ];
  const makeAwkward = async (ws: string) => {
    const out = [];
    for (const a of awkward) out.push(await createCustomField(ws, { label: a.label, type: a.type, options: a.options, shareWithAi: false }));
    return out;
  };
  const fieldsR = await makeAwkward(wR);
  assert((await importCsv(wR, "customers", "ref,name,tier,region\nCUS-0001,Round Co,enterprise,EMEA\nCUS-0002,Trip Ltd,mid_market,APAC\n")).ok, "(set up two customers)");
  const custR = await prisma.customer.findMany({ where: { workspaceId: wR }, orderBy: { ref: "asc" } });
  for (let i = 0; i < custR.length; i++) {
    const values: Record<string, string | number> = {};
    fieldsR.forEach((f, n) => (values[f.id] = awkward[n].sample[i]));
    await prisma.customer.update({ where: { id: custR[i].id }, data: { customFields: values } });
  }
  const exported = await buildExport(wR, "customers");
  const header = exported.split("\r\n")[0];
  assert(header.includes("'=SUM(A1)") && header.includes("Region (custom)") && header.includes("Tier (custom)") && header.includes(",Health Score,"), "(the export guards a formula-like label, marks labels that clash with a standard column '(custom)', and writes the rest as they are)");
  const pRound = await preview(wR, "customers", exported);
  for (const f of fieldsR) {
    const col = pRound.columns.find((c) => c.action === "existing_custom" && c.fieldId === f.id);
    assert(col !== undefined, `Round trip: the exported column for the field "${f.label}" maps back to that field (${col ? JSON.stringify(col.header) : "not found"})`);
  }
  assert(pRound.columns.filter((c) => c.action === "existing_custom").length === awkward.length && pRound.columns.filter((c) => c.action === "custom").length === 0, "Round trip: no custom column is offered as a NEW field");
  assert(pRound.columns.find((c) => c.header === "region")?.target === "region" && pRound.columns.find((c) => c.header === "tier")?.target === "tier", "Round trip: the standard Region and Tier columns stay the Bearing columns, not the custom fields of the same name");
  assert(["health_score", "health_band", "health_baseline", "health_adjustment", "health_narrative"].every((h) => pRound.columns.find((c) => c.header === h)?.action === "ignore"), "Round trip: the Health result columns are ignored, even when a custom field is called Health Score");
  // Load the export into a workspace that has the same fields: the values must come back identical.
  const fieldsR2 = await makeAwkward(wR2);
  const pRound2 = await preview(wR2, "customers", exported);
  const rRound = await importCsvMapped(wR2, "customers", exported, choicesFrom(pRound2));
  assert(rRound.ok && rRound.imported === 2 && !/Created/.test(rRound.message), `Round trip: the exported file imports into a workspace with the same fields, creating no new ones (${rRound.message})`);
  const backR = await prisma.customer.findMany({ where: { workspaceId: wR2 }, orderBy: { ref: "asc" } });
  let same = backR.length === 2;
  awkward.forEach((a, n) => backR.forEach((c, i) => { if ((c.customFields as Record<string, unknown>)[fieldsR2[n].id] !== a.sample[i]) same = false; }));
  assert(same, "Round trip: every custom value comes back exactly (formula-like text, commas, quotes and numbers included)");
  assert((await listCustomFields(wR2)).length === awkward.length, "Round trip: still the same number of custom fields");

  console.log("\nAll custom-field and flexible-import checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (savedSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = savedSelfHosted;
    // Remove only what this run made, by id.
    for (const id of created) await deleteWorkspaceAndData(id).catch((e) => console.error("cleanup", e));
    await prisma.$disconnect();
    await reload.$disconnect();
  });
