// Database checks for the real-use journey: import nine kinds of file into a
// workspace, prove a bad file changes nothing (including a usage file that
// fails half way), prove re-importing does not double data, prove workspaces
// cannot see each other, apply the hosted limits, score every imported
// customer with no AI key and show Health reading the imported detail, export
// everything, load the export into a brand-new workspace and compare field by
// field, then delete a workspace completely. Also covers the per-visit state
// used on the shared demo.
//
// Creates throwaway workspaces (unique names) and removes only the rows it made,
// by id. It never calls the AI and never touches the demo workspace.
import { PrismaClient } from "@prisma/client";
import { decodeUpload, importCsv } from "../src/lib/import/importData";
import { buildExport, toCsv } from "../src/lib/import/exportData";
import { advanceRun } from "../src/lib/capabilityBatches";
import { ADAPTERS } from "../src/lib/capabilityWork";
import { computeBaseline } from "../src/lib/health/baseline";
import { generateOpportunitiesForWorkspace } from "../src/lib/expansion/generateOpportunities";
import { deleteWorkspaceAndData } from "../src/lib/deleteWorkspace";
import { MAX_HIDDEN_PER_VISIT, hiddenIdsForSession, hideActionForVisit } from "../src/lib/demoVisit";
import { hashSessionToken, newSessionToken } from "../src/lib/sessionToken";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const suffix = Date.now().toString(36);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const savedSelfHosted = process.env.SELF_HOSTED;

const CUSTOMERS_CSV = [
  "ref,name,country,industry,region,city,sub_industry,tier,product,lifecycle_status,contractual_arr,consumption_arr,renewal_date,expected_go_live_date,go_live_date,payment_status,days_past_due,renewal_type,interrupted_reason,nps,nps_date,champion_name,champion_last_engaged",
  `,Acme Freight,United Kingdom,Logistics,EMEA,London,Freight forwarding,enterprise,Freight,live,120000,15000,${inDays(40)},,${daysAgo(700)},late,35,interrupted,customer_requested,3,${daysAgo(30)},Alex Champion,${daysAgo(200)}`,
  `,Acme Freight,,,,,,,Warehouse,live,30000,0,${inDays(200)},,${daysAgo(300)},current,0,,,,,,`,
  `,"Beta, Inc.",Germany,Retail,EMEA,Berlin,,mid_market,Freight,onboarding,40000,0,${inDays(300)},${daysAgo(20)},,current,0,auto,,,,,`,
  `CUS-0500,Gamma Supply,France,Retail,EMEA,Paris,,self_serve,Freight,live,9000,2000,${inDays(20)},,${daysAgo(900)},current,0,auto,,9,${daysAgo(15)},Gina Champion,${daysAgo(5)}`,
].join("\n");

const TICKETS_CSV = [
  "customer,date,type,severity,text",
  `CUS-0001,${daysAgo(10)},ticket,critical,Billing sync failed again and invoices are blocked`,
  `Acme Freight,${daysAgo(8)},email,high,"They asked about adding seats, and said ""soon"""`,
  `CUS-0500,${daysAgo(30)},call,low,"=HYPERLINK(""http://example.test"",""click"")"`,
  `"Beta, Inc.",${daysAgo(3)},ticket,medium,Go-live is blocked until their IT team finishes a review`,
  `CUS-0500,${daysAgo(2)},call,,Customer called about an invoice`,
  `CUS-0001,${daysAgo(1)},email,low,''=SUM(1) starts with an apostrophe`,
].join("\n");

const USAGE_CSV = [
  "customer,capability,metric_type,date,value",
  `CUS-0001,Shipment tracking,adoption,${daysAgo(120)},140`,
  `CUS-0001,Shipment tracking,adoption,${daysAgo(60)},100`,
  `CUS-0001,Shipment tracking,adoption,${daysAgo(5)},60`,
  `CUS-0001,Data API calls,consumption,${daysAgo(90)},10000`,
  `CUS-0001,Data API calls,consumption,${daysAgo(6)},16000`,
  `CUS-0500,Shipment tracking,adoption,${daysAgo(40)},50`,
  `CUS-0500,Shipment tracking,adoption,${daysAgo(4)},70`,
].join("\n");

const OUTCOMES_CSV = [
  "customer,date,type,notes",
  `CUS-0001,${daysAgo(400)},renewed,Renewed for another year`,
  `CUS-0500,${daysAgo(300)},expanded,Added seats`,
].join("\n");

const STAKEHOLDERS_CSV = [
  "customer,name,role,is_champion,last_engaged_date",
  `CUS-0001,Alex Champion,Champion,yes,${daysAgo(200)}`, // already created from the customers file
  `CUS-0001,Sam Finance,Finance lead,no,${daysAgo(50)}`,
  `Acme Freight,Priya Sponsor,Executive sponsor,no,`,
  `CUS-0500,Gina Champion,Champion,yes,${daysAgo(5)}`, // already created from the customers file
].join("\n");

const GOALS_CSV = [
  "customer,name,target_value,actual_value,unit",
  "CUS-0001,Cut manual tracking time,40,10,hours/month",
  "CUS-0500,Automate customs paperwork,80,60,% automated",
].join("\n");

const TRAINING_CSV = [
  "customer,course,attendees,date",
  `CUS-0001,Admin fundamentals,6,${daysAgo(40)}`,
  `CUS-0001,Advanced reporting,3,${daysAgo(10)}`,
  `CUS-0500,Admin fundamentals,2,${daysAgo(100)}`,
].join("\n");

const EVENTS_CSV = ["customer,event,date", `CUS-0001,Annual summit,${daysAgo(90)}`, `CUS-0500,Roadmap webinar,${daysAgo(20)}`].join("\n");

const SURVEYS_CSV = [
  "customer,type,score,date",
  `CUS-0001,nps,3,${daysAgo(30)}`, // the same response the customers file already created
  `CUS-0001,csat,9,${daysAgo(12)}`,
  `CUS-0500,ces,4,${daysAgo(6)}`,
  `CUS-0500,nps,9,${daysAgo(15)}`, // the same response the customers file already created
].join("\n");

async function counts(workspaceId: string) {
  const inC = { customer: { workspaceId } };
  return {
    customers: await prisma.customer.count({ where: { workspaceId } }),
    links: await prisma.customerProduct.count({ where: inC }),
    tickets: await prisma.interaction.count({ where: inC }),
    usage: await prisma.usageSnapshot.count({ where: inC }),
    outcomes: await prisma.outcomeEvent.count({ where: inC }),
    stakeholders: await prisma.stakeholder.count({ where: inC }),
    goals: await prisma.desiredOutcome.count({ where: inC }),
    training: await prisma.trainingCompletion.count({ where: inC }),
    events: await prisma.eventAttendance.count({ where: inC }),
    surveys: await prisma.surveyResponse.count({ where: inC }),
    products: await prisma.product.count({ where: { workspaceId } }),
    capabilities: await prisma.capability.count({ where: { product: { workspaceId } } }),
  };
}

(async () => {
  const demoBefore = await prisma.customer.count({ where: { workspace: { isDemoSeed: true } } });
  const created: string[] = [];
  const mk = async (name: string) => {
    const w = await prisma.workspace.create({ data: { name: `Agent F import check ${suffix} ${name}` } });
    created.push(w.id);
    return w;
  };
  const w1 = await mk("one");
  const w2 = await mk("two");
  const w3 = await mk("three");
  const userIds: string[] = [];
  delete process.env.SELF_HOSTED; // the hosted site's rules apply unless a step says otherwise

  try {
    // ---- 0. decoding an upload
    const utf8 = decodeUpload(Buffer.from("name\nZürich Ltd\n", "utf8"));
    assert(utf8.ok && utf8.text.includes("Zürich"), "A UTF-8 upload is decoded exactly, accents intact");
    const bom = decodeUpload(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("name\nA\n")]));
    assert(bom.ok && bom.text.startsWith("name"), "A UTF-8 byte-order mark is dropped");
    const latin = decodeUpload(Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68, 0x0a]));
    assert(!latin.ok && /UTF-8/.test(latin.message) && /Nothing was imported/.test(latin.message), "A Windows-1252 file (an Excel CSV) is refused with a way forward, not silently turned into Z?rich");
    const nul = decodeUpload(Buffer.from("name\nA\u0000B\n"));
    assert(!nul.ok && /null character/.test(nul.message), "A file containing a null byte is refused as not a plain CSV");

    // ---- 1. customers import
    let res = await importCsv(w1.id, "customers", CUSTOMERS_CSV);
    assert(res.ok && res.imported === 3, `Importing the customers file creates 3 customers (${res.message})`);
    assert(!/ignored/.test(res.message), "A file using only known columns gives no ignored-columns warning");
    let c = await counts(w1.id);
    assert(c.customers === 3 && c.links === 4 && c.products === 2, "A customer with two products becomes one customer with two product links; two products are created once each");
    const list = await prisma.customer.findMany({ where: { workspaceId: w1.id }, orderBy: { ref: "asc" }, include: { stakeholders: true, surveyResponses: true, products: true } });
    assert(list.map((x) => x.ref).join() === "CUS-0001,CUS-0002,CUS-0500", "References are assigned in order (CUS-0001, CUS-0002) and an explicit one (CUS-0500) is kept");
    const acme = list.find((x) => x.name === "Acme Freight")!;
    assert(acme.products.length === 2 && acme.stakeholders.length === 1 && acme.stakeholders[0].isChampion && acme.surveyResponses[0]?.score === 3, "The champion and the NPS score from the first row are attached to the customer");
    assert(acme.surveyResponses[0].occurredAt.toISOString().slice(0, 10) === daysAgo(30), "The NPS keeps the date given in nps_date instead of being dated today");
    assert(acme.renewalType === "interrupted" && acme.interruptedReason === "customer_requested" && acme.country === "United Kingdom", "Customer-level fields are saved from the first row");
    assert(acme.region === "EMEA" && acme.city === "London" && acme.subIndustry === "Freight forwarding", "Region, city and sub-industry are saved");
    const beta = list.find((x) => x.name === "Beta, Inc.")!;
    assert(beta.products[0].lifecycleStatus === "onboarding" && beta.products[0].expectedGoLiveDate !== null, "A name containing a comma survives, and an onboarding account keeps its expected go-live date");
    assert((await counts(w2.id)).customers === 0, "Another workspace is untouched by the import");

    // ---- 2. a bad file changes nothing; failures are plain messages
    const before = await counts(w1.id);
    res = await importCsv(w1.id, "customers", "name,tier\nGood One,enterprise\nBad One,platinum\nGood Two,enterprise\n");
    assert(!res.ok && res.errors.length === 1 && res.errors[0].row === 3, "A file with one bad row is refused and names the row");
    assert(JSON.stringify(await counts(w1.id)) === JSON.stringify(before), "Nothing at all was written from the refused file, not even the good rows");
    res = await importCsv(w1.id, "customers", CUSTOMERS_CSV);
    assert(!res.ok && JSON.stringify(await counts(w1.id)) === JSON.stringify(before), "Importing the same customers again is refused as duplicates and changes nothing");
    res = await importCsv(w1.id, "customers", "name\n  ACME   freight \n");
    assert(!res.ok && /already exists/.test(res.errors[0].message), "A customer that differs only by case and spacing is recognised as existing");
    res = await importCsv(w1.id, "customers", 'name\n"never closed\n');
    assert(!res.ok && /never closed/.test(res.errors[0].message), "A malformed file is refused with a plain message");
    res = await importCsv(w1.id, "customers", "");
    assert(!res.ok, "An empty file is refused");
    res = await importCsv(w1.id, "customers", "name,,tier\nA,,x\n");
    assert(!res.ok && /no name/.test(res.errors[0].message), "A file with an unnamed column is refused");
    res = await importCsv(w1.id, "customers", "name,tier,tier\nA,x,y\n");
    assert(!res.ok && /more than once/.test(res.errors[0].message), "A file with a repeated column name is refused");
    res = await importCsv(w1.id, "customers", "name\nA\u0000B\n");
    assert(!res.ok && /null character/.test(res.message), "A null byte inside the text is refused before it can reach the database");
    res = await importCsv(w1.id, "customers", Array.from({ length: 61 }, (_, i) => `c${i}`).join(",") + "\nx\n");
    assert(!res.ok && /more than 60 columns/.test(res.errors[0].message), "A file with more than 60 columns is refused");
    res = await importCsv("no-such-workspace", "customers", "name\nA\n");
    assert(!res.ok && /Nothing was imported/.test(res.message) && !/prisma|P20|constraint|foreign/i.test(res.message), "A database failure becomes a plain message, never an error page or database text");
    assert(JSON.stringify(await counts(w1.id)) === JSON.stringify(before), "None of those refusals changed the workspace");

    // real line numbers, ignored and tidied columns
    const w6 = await mk("six");
    res = await importCsv(w6.id, "customers", "name,tier\nGood,enterprise\n\nBad,platinum\n");
    assert(!res.ok && res.errors[0].row === 4, "The error names line 4 of the file, counting the blank line");
    res = await importCsv(w6.id, "customers", "Name,Contractual ARR,Owner\nIgnore Co,5000,Pat\n");
    assert(res.ok && /Read "contractual arr" as contractual_arr/.test(res.message) && /These columns were ignored: owner/.test(res.message), "A misspelt column is read as the column it means, and a truly unknown one is reported as ignored");
    const ignoreCo = await prisma.customerProduct.findFirstOrThrow({ where: { customer: { workspaceId: w6.id, name: "Ignore Co" } } });
    assert(Number(ignoreCo.contractualArr) === 5000, "The amount under 'Contractual ARR' was imported, not silently set to 0");
    res = await importCsv(w6.id, "customers", "name,contractual_arr\nEuro Co,\"48,00\"\n");
    assert(!res.ok && /thousands separators/.test(res.errors[0].message), "A European decimal comma is refused rather than read as 4800");
    await deleteWorkspaceAndData(w6.id);
    created.splice(created.indexOf(w6.id), 1);

    // ---- 3. more customers continue the numbering, clashes are refused
    res = await importCsv(w1.id, "customers", "name\nDelta Cargo\n");
    const delta = await prisma.customer.findFirstOrThrow({ where: { workspaceId: w1.id, name: "Delta Cargo" } });
    assert(res.ok && delta.ref === "CUS-0501", "Numbering continues after the highest existing reference (CUS-0501 after CUS-0500)");
    res = await importCsv(w1.id, "customers", "name,ref\nEpsilon,CUS-0001\n");
    assert(!res.ok, "A reference that already exists in the workspace is refused");

    // ---- 4. tickets, with duplicates skipped
    res = await importCsv(w1.id, "tickets", TICKETS_CSV);
    assert(res.ok && res.imported === 6, "Tickets are imported, matching customers by reference or by exact name");
    const spy = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w1.id }, text: { startsWith: "=HYPERLINK" } } });
    assert(spy !== null, "Text that looks like a spreadsheet formula is stored as plain text");
    const apostrophe = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w1.id }, text: { startsWith: "'=SUM(1)" } } });
    assert(apostrophe !== null, "Text that really starts with an apostrophe before a formula character keeps its apostrophe (one guard quote is removed)");
    const blankSeverity = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w1.id }, text: "Customer called about an invoice" } });
    assert(blankSeverity?.severity === null, "A blank severity is stored as not recorded, not as low");
    let beforeDup = await counts(w1.id);
    res = await importCsv(w1.id, "tickets", TICKETS_CSV);
    assert(res.ok && res.imported === 0 && /6 rows were duplicates/.test(res.message), `Importing the same tickets again adds nothing and says why (${res.message})`);
    assert((await counts(w1.id)).tickets === beforeDup.tickets, "The ticket count did not change");
    res = await importCsv(w1.id, "tickets", `customer,date,text\nCUS-0001,${daysAgo(10)},Billing sync failed again and invoices are blocked\nCUS-0001,${daysAgo(9)},A genuinely new ticket\n`);
    assert(res.ok && res.imported === 1 && /1 row was a duplicate/.test(res.message), "A file that mixes a duplicate and a new ticket imports only the new one and counts the duplicate");
    res = await importCsv(w1.id, "tickets", "customer,date,text\nNobody Here,2026-01-01,hi\n");
    assert(!res.ok && (await counts(w1.id)).tickets === 7, "A ticket for an unknown customer refuses the whole file");

    // ---- 5. usage, outcomes
    res = await importCsv(w1.id, "usage", USAGE_CSV);
    assert(res.ok && res.imported === 7, "Usage readings are imported");
    c = await counts(w1.id);
    assert(c.capabilities === 2 && c.usage === 7, "Each capability is created once, however many readings use it");
    res = await importCsv(w1.id, "usage", `customer,capability,metric_type,date,value\nCUS-0500,Shipment tracking,adoption,${daysAgo(2)},80\n`);
    c = await counts(w1.id);
    assert(res.ok && c.capabilities === 2 && c.usage === 8, "A later usage file adds readings but reuses the existing capability");
    beforeDup = await counts(w1.id);
    res = await importCsv(w1.id, "usage", USAGE_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).usage === beforeDup.usage, "Importing the same usage again adds nothing");
    res = await importCsv(w1.id, "outcomes", OUTCOMES_CSV);
    assert(res.ok && (await counts(w1.id)).outcomes === 2, "Outcome history is imported");
    res = await importCsv(w1.id, "outcomes", OUTCOMES_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).outcomes === 2, "Importing the same outcomes again adds nothing");
    res = await importCsv(w2.id, "tickets", TICKETS_CSV);
    assert(!res.ok && (await counts(w2.id)).tickets === 0, "A tickets file naming another workspace's customers is refused in an empty workspace");

    // ---- 6. usage is all or nothing, and knows about products and metric types
    const w5 = await mk("five");
    res = await importCsv(w5.id, "customers", "name,product\nAcme,Freight\nAcme,Warehouse\nTwo Co,Freight\n");
    assert(res.ok, "A fresh workspace for the usage rules gets two customers and two products");
    await prisma.customer.create({ data: { workspaceId: w5.id, ref: "CUS-0099", name: "No Product Ltd", tier: "mid_market" } });
    const w5Before = await counts(w5.id);
    res = await importCsv(w5.id, "usage", `customer,capability,date,value\nAcme,Brand New Cap,${daysAgo(3)},5\nNo Product Ltd,Other Cap,${daysAgo(3)},5\n`);
    assert(!res.ok && res.errors.length === 1 && res.errors[0].row === 3 && /no product/.test(res.errors[0].message), "A usage row for a customer with no product is refused and names its row");
    assert(JSON.stringify(await counts(w5.id)) === JSON.stringify(w5Before), "The refused usage file left nothing behind: not the capability from the good row, nor a reading");
    assert((await prisma.capability.count({ where: { name: "Brand New Cap", product: { workspaceId: w5.id } } })) === 0, "The capability from the good row was never committed");
    res = await importCsv(w5.id, "usage", `customer,product,capability,metric_type,date,value\nAcme,Warehouse,Pick rate,consumption,${daysAgo(5)},12\nAcme,Freight,Tracking,adoption,${daysAgo(5)},3\nAcme,,Plain,adoption,${daysAgo(5)},1\n`);
    assert(res.ok && res.imported === 3, "Usage can name its product, or leave it blank");
    const caps = await prisma.capability.findMany({ where: { product: { workspaceId: w5.id } }, include: { product: true } });
    const capProduct = (n: string) => caps.find((x) => x.name === n)?.product.name;
    assert(capProduct("Pick rate") === "Warehouse" && capProduct("Tracking") === "Freight" && capProduct("Plain") === "Freight", "Each capability belongs to the product named (the customer's first product when blank)");
    assert(caps.find((x) => x.name === "Pick rate")?.metricType === "consumption", "The stated metric type is stored");
    const w5Mid = await counts(w5.id);
    res = await importCsv(w5.id, "usage", `customer,product,capability,date,value\nAcme,Nope,Tracking,${daysAgo(4)},3\n`);
    assert(!res.ok && /not on a product called "Nope"/.test(res.errors[0].message), "A product the customer is not on is refused with the products it does have");
    res = await importCsv(w5.id, "usage", `customer,product,capability,metric_type,date,value\nAcme,Warehouse,Pick rate,adoption,${daysAgo(4)},12\n`);
    assert(!res.ok && /does not match the existing capability/.test(res.errors[0].message), "A metric type that contradicts an existing capability is refused instead of silently ignored");
    assert(JSON.stringify(await counts(w5.id)) === JSON.stringify(w5Mid), "Neither refusal changed anything");

    // ---- 6b. the hosted limits
    const capsFile = (from: number, to: number) => ["customer,capability,date,value", ...Array.from({ length: to - from }, (_, i) => `Acme,Cap ${from + i},${daysAgo(2)},1`)].join("\n");
    const capsBefore = (await counts(w5.id)).capabilities;
    res = await importCsv(w5.id, "usage", capsFile(0, 51));
    assert(!res.ok && /at most 50/.test(res.errors[0].message) && (await counts(w5.id)).capabilities === capsBefore, "On the hosted site a usage file creating 51 new capabilities is refused and creates none");
    res = await importCsv(w5.id, "usage", capsFile(0, 47));
    assert(res.ok && (await counts(w5.id)).capabilities === 50, "47 new capabilities (3 already exist) bring the workspace to exactly the hosted limit of 50");
    res = await importCsv(w5.id, "usage", capsFile(100, 101));
    assert(!res.ok && /at most 50/.test(res.errors[0].message) && (await counts(w5.id)).capabilities === 50, "A 51st capability in the workspace is refused");
    process.env.SELF_HOSTED = "true";
    res = await importCsv(w5.id, "usage", capsFile(200, 260));
    assert(res.ok && (await counts(w5.id)).capabilities === 110, "On a self-hosted copy the same workspace accepts 60 more capabilities");
    delete process.env.SELF_HOSTED;

    const bulk = (n: number, tag: string) => ["customer,date,type,severity,text", ...Array.from({ length: n }, (_, i) => `Acme,${daysAgo(1 + (i % 300))},ticket,low,${tag} ticket ${i}`)].join("\n");
    res = await importCsv(w5.id, "tickets", bulk(1_900, "first"));
    assert(res.ok && res.imported === 1_900, "1,900 tickets import on the hosted site (the limit is 2,000)");
    res = await importCsv(w5.id, "tickets", bulk(1_900, "first"));
    assert(res.ok && res.imported === 0 && /1900 rows were duplicates/.test(res.message), "Re-importing those 1,900 tickets is not refused by the cap: duplicates are skipped before the cap is checked");
    res = await importCsv(w5.id, "tickets", bulk(200, "second"));
    assert(!res.ok && /at most 2000/.test(res.errors[0].message) && (await counts(w5.id)).tickets === 1_900, "200 genuinely new tickets would pass 2,000 in total, so they are refused and nothing is written");
    res = await importCsv(w5.id, "tickets", bulk(100, "third"));
    assert(res.ok && res.imported === 100 && (await counts(w5.id)).tickets === 2_000, "100 new tickets bring the workspace to exactly 2,000");
    await deleteWorkspaceAndData(w5.id);
    created.splice(created.indexOf(w5.id), 1);

    // ---- 7. isolation, then two uploads at once
    res = await importCsv(w2.id, "customers", "name,ref\nAcme Freight,CUS-0001\n");
    assert(res.ok, "A second workspace can use the same customer names and references");
    const clash = await Promise.all([
      importCsv(w3.id, "customers", "name\nRace One\nRace Two\n"),
      importCsv(w3.id, "customers", "name\nRace One\nRace Two\n"),
    ]);
    assert(clash.filter((x) => x.ok).length === 1 && (await counts(w3.id)).customers === 2, "Two identical uploads at the same moment import once, never twice (the workspace is locked while one runs)");
    await deleteWorkspaceAndData(w3.id);
    created.splice(created.indexOf(w3.id), 1);

    // ---- 8. the five detail files: stakeholders, goals, training, events, surveys
    const healthBefore = await computeBaseline(acme.id);
    const driver = (r: Awaited<ReturnType<typeof computeBaseline>>, key: string) => r.drivers.find((d) => d.key === key)!;
    assert(driver(healthBefore, "desired_outcome_progress").score === null && driver(healthBefore, "training_consumption").score === null, "Before the detail files, Health has no data for goals or training (those signals are blind)");
    assert(driver(healthBefore, "engagement_silence").score === 20, "...and engagement silence reads Acme as silent on events");

    res = await importCsv(w1.id, "stakeholders", STAKEHOLDERS_CSV);
    assert(res.ok && res.imported === 2 && /2 rows were duplicates/.test(res.message), `Stakeholders import; the two champions already created from the customers file are skipped (${res.message})`);
    assert((await counts(w1.id)).stakeholders === 4, "Each person exists exactly once: Alex, Gina, Sam and Priya");
    const priya = await prisma.stakeholder.findFirstOrThrow({ where: { customer: { workspaceId: w1.id }, name: "Priya Sponsor" } });
    assert(priya.role === "Executive sponsor" && priya.isChampion === false && priya.lastEngagedAt === null, "A stakeholder's role, champion flag and blank engagement date are kept");
    res = await importCsv(w1.id, "stakeholders", STAKEHOLDERS_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).stakeholders === 4, "Importing the stakeholders again adds nobody");

    res = await importCsv(w1.id, "goals", GOALS_CSV);
    assert(res.ok && res.imported === 2, "Goals import");
    res = await importCsv(w1.id, "goals", GOALS_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).goals === 2, "Importing the goals again adds nothing");
    res = await importCsv(w1.id, "training", TRAINING_CSV);
    assert(res.ok && res.imported === 3, "Training sessions import");
    res = await importCsv(w1.id, "training", TRAINING_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).training === 3, "Importing the training again adds nothing");
    res = await importCsv(w1.id, "events", EVENTS_CSV);
    assert(res.ok && res.imported === 2, "Event attendances import");
    res = await importCsv(w1.id, "events", EVENTS_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).events === 2, "Importing the events again adds nothing");
    res = await importCsv(w1.id, "surveys", SURVEYS_CSV);
    assert(res.ok && res.imported === 2 && /2 rows were duplicates/.test(res.message), `Surveys import; the NPS scores already created from the customers file are skipped (${res.message})`);
    assert((await counts(w1.id)).surveys === 4, "Each survey response exists exactly once (the customers file's NPS and the surveys file's are the same response)");
    res = await importCsv(w1.id, "surveys", SURVEYS_CSV);
    assert(res.ok && res.imported === 0 && (await counts(w1.id)).surveys === 4, "Importing the surveys again adds nothing");

    for (const [kind, file] of [["stakeholders", STAKEHOLDERS_CSV], ["goals", GOALS_CSV], ["training", TRAINING_CSV], ["events", EVENTS_CSV], ["surveys", SURVEYS_CSV]] as const) {
      const other = await importCsv(w2.id, kind, file);
      assert(!other.ok && /not in this workspace|no customers/.test(other.errors[0].message), `A ${kind} file naming another workspace's customers is refused`);
    }
    res = await importCsv(w1.id, "goals", "customer,name,target_value\nCUS-0001,Bad goal,0\n");
    assert(!res.ok && /greater than zero/.test(res.errors[0].message), "A goal with a zero target is refused");
    res = await importCsv(w1.id, "surveys", "customer,type,score,date\nCUS-0001,nps,11,2026-01-01\n");
    assert(!res.ok && (await counts(w1.id)).surveys === 4, "A survey score of 11 refuses the file and writes nothing");

    const healthAfter = await computeBaseline(acme.id);
    assert(driver(healthAfter, "desired_outcome_progress").score === 25, "Health now reads Acme's goal (10 of 40 = 25 percent)");
    assert(driver(healthAfter, "training_consumption").score !== null, "Health now scores Acme's training");
    assert(driver(healthAfter, "champion_engagement").score !== null, "Health scores Acme's champion engagement");
    assert(driver(healthAfter, "engagement_silence").score === 80, "Health no longer reads Acme as silent now that its event attendance is known");
    const gamma = await prisma.customer.findFirstOrThrow({ where: { workspaceId: w1.id, name: "Gamma Supply" } });
    assert(driver(await computeBaseline(gamma.id), "desired_outcome_progress").score === 75, "...and reads Gamma's goal (60 of 80 = 75 percent)");

    // ---- 9. free Health scoring with no key, through the real resumable engine
    assert((await prisma.workspace.findUniqueOrThrow({ where: { id: w1.id } })).anthropicApiKeyEncrypted === null, "The test workspace has no AI key");
    let progress = await advanceRun({ workspaceId: w1.id, capability: "health", adapter: ADAPTERS.health, apiKey: null, startNew: true, budgetMs: 0 });
    assert(progress.status === "running" && progress.processed === 1, "A Health run with no key starts and makes progress one customer at a time");
    for (let i = 0; i < 12 && progress.status === "running"; i++) {
      progress = await advanceRun({ workspaceId: w1.id, capability: "health", adapter: ADAPTERS.health, apiKey: null, startNew: true, budgetMs: 0 });
    }
    assert(progress.status === "done" && progress.total === 4, "The run finishes and covered all 4 customers");
    const snaps = await prisma.healthScoreSnapshot.findMany({ where: { customer: { workspaceId: w1.id } }, include: { customer: true } });
    assert(snaps.length === 4 && snaps.every((s) => s.adjustmentDelta === 0 && s.adjustmentReason === null && s.compositeScore === s.baselineScore), "Every customer has a baseline-only score with no AI adjustment");
    assert(snaps.every((s) => /Baseline score \d+/.test(s.narrative ?? "") && /free baseline/.test(s.narrative ?? "")), "Each score comes with a plain explanation that says it is the free baseline");
    assert(snaps.every((s) => ["Thriving", "Stable", "Watch", "Critical"].includes(s.tierLabel ?? "")), "Each score has a valid band");
    assert((await prisma.healthScoreSnapshot.count({ where: { customer: { workspaceId: w2.id } } })) === 0, "Scoring one workspace creates nothing in another");

    // ---- 10. opportunities are free, scoped and repeatable
    const first = await generateOpportunitiesForWorkspace(w1.id);
    const afterFirst = await prisma.opportunity.count({ where: { customer: { workspaceId: w1.id } } });
    const second = await generateOpportunitiesForWorkspace(w1.id);
    const afterSecond = await prisma.opportunity.count({ where: { customer: { workspaceId: w1.id } } });
    assert(first.created > 0 && afterFirst === first.created, `Finding opportunities creates some from the imported data (${first.created})`);
    assert(second.created === 0 && afterSecond === afterFirst, "Running it again creates no duplicates");
    assert((await prisma.opportunity.count({ where: { customer: { workspaceId: w2.id } } })) === 0, "Opportunities are only created in the workspace asked");

    // ---- 11. export, scoped and safe
    const exp = await buildExport(w1.id, "customers");
    const lines = exp.trim().split("\r\n");
    assert(lines.length === 6 && lines[0].startsWith("ref,name,country,industry,region,city,sub_industry"), "The customers export has one row per customer and product, with the import columns first");
    assert(lines[0].includes("nps_date") && lines[0].includes("health_score") && lines[0].includes("health_narrative"), "It also carries the NPS date and the Health score, band and narrative");
    assert(!(await buildExport(w2.id, "tickets")).includes("Billing sync"), "An export contains only its own workspace's data");
    const ticketsOut = await buildExport(w1.id, "tickets");
    assert(ticketsOut.includes("'=HYPERLINK"), "A formula-like ticket is guarded in the export so a spreadsheet cannot run it");
    assert(ticketsOut.includes("''=SUM(1)"), "A ticket that really starts with an apostrophe before a formula character gets one extra guard quote");
    for (const kind of ["stakeholders", "goals", "training", "events", "surveys"] as const) {
      const out = (await buildExport(w1.id, kind)).trim().split("\r\n");
      assert(out.length > 1, `The ${kind} export is not empty (${out.length - 1} rows)`);
    }

    // ---- 12. round trip of every kind into a brand-new workspace
    const w4 = await mk("four");
    const order = ["customers", "tickets", "usage", "outcomes", "stakeholders", "goals", "training", "events", "surveys"] as const;
    const exports: Record<string, string> = {};
    for (const kind of order) exports[kind] = await buildExport(w1.id, kind);
    for (const kind of order) {
      const back = await importCsv(w4.id, kind, exports[kind]);
      assert(back.ok && !/ignored/.test(back.message), `The exported ${kind} file imports cleanly into a new workspace with no ignored-column warning (${back.message})`);
    }
    const a = await counts(w1.id);
    const b = await counts(w4.id);
    assert(JSON.stringify(a) === JSON.stringify(b), `The new workspace has exactly the same counts for every kind as the original (${JSON.stringify(b)})`);
    const flatCustomers = async (id: string) =>
      (await prisma.customer.findMany({ where: { workspaceId: id }, orderBy: { ref: "asc" }, include: { products: { include: { product: true }, orderBy: { contractualArr: "asc" } } } })).map((x) =>
        [x.ref, x.name, x.tier, x.country, x.region, x.city, x.subIndustry, x.industry, x.renewalType, x.interruptedReason, x.products.map((p) => `${p.product.name}:${p.lifecycleStatus}:${Number(p.contractualArr)}:${Number(p.consumptionArr)}:${p.paymentStatus}:${p.daysPastDue}:${p.renewalDate?.toISOString().slice(0, 10)}`).join("|")].join("~")
      );
    assert(JSON.stringify(await flatCustomers(w1.id)) === JSON.stringify(await flatCustomers(w4.id)), "Every customer matches field for field after the round trip: refs, tiers, region, city, sub-industry, products, amounts, dates, payment");
    const ticketsOf = async (id: string) => (await prisma.interaction.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: { text: "asc" } })).map((i) => `${i.customer.ref}|${i.occurredAt.toISOString().slice(0, 10)}|${i.type}|${i.severity}|${i.text}`);
    const t1 = await ticketsOf(w1.id);
    assert(JSON.stringify(t1) === JSON.stringify(await ticketsOf(w4.id)), "Every ticket matches exactly after the round trip: dates, types, text with quotes and commas, the formula-like one, the apostrophe one, and a blank severity staying blank");
    assert(t1.some((x) => x.endsWith("|null|Customer called about an invoice")) && t1.some((x) => x.includes("|'=SUM(1) starts with an apostrophe")), "(the blank severity and the leading apostrophe are really in the compared data)");
    const usageOf = async (id: string) => (await prisma.usageSnapshot.findMany({ where: { customer: { workspaceId: id } }, include: { capability: { include: { product: true } }, customer: true }, orderBy: [{ occurredAt: "asc" }, { value: "asc" }] })).map((u) => `${u.customer.ref}|${u.capability.product.name}|${u.capability.name}|${u.capability.metricType}|${u.occurredAt.toISOString().slice(0, 10)}|${Number(u.value)}`);
    assert(JSON.stringify(await usageOf(w1.id)) === JSON.stringify(await usageOf(w4.id)), "Every usage reading matches after the round trip, including which product each capability belongs to");
    const peopleOf = async (id: string) => (await prisma.stakeholder.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: { name: "asc" } })).map((s) => `${s.customer.ref}|${s.name}|${s.role}|${s.isChampion}|${s.lastEngagedAt?.toISOString().slice(0, 10)}`);
    assert(JSON.stringify(await peopleOf(w1.id)) === JSON.stringify(await peopleOf(w4.id)), "Every stakeholder matches after the round trip: role, champion flag, last engagement (champions are not doubled)");
    const goalsOf = async (id: string) => (await prisma.desiredOutcome.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: { name: "asc" } })).map((g) => `${g.customer.ref}|${g.name}|${Number(g.targetValue)}|${Number(g.actualValue)}|${g.unit}`);
    assert(JSON.stringify(await goalsOf(w1.id)) === JSON.stringify(await goalsOf(w4.id)), "Every goal matches after the round trip");
    const trainOf = async (id: string) => (await prisma.trainingCompletion.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: [{ occurredAt: "asc" }, { courseName: "asc" }] })).map((t) => `${t.customer.ref}|${t.courseName}|${t.attendeeCount}|${t.occurredAt.toISOString().slice(0, 10)}`);
    assert(JSON.stringify(await trainOf(w1.id)) === JSON.stringify(await trainOf(w4.id)), "Every training session matches after the round trip");
    const eventsOf = async (id: string) => (await prisma.eventAttendance.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: [{ occurredAt: "asc" }, { eventName: "asc" }] })).map((e) => `${e.customer.ref}|${e.eventName}|${e.occurredAt.toISOString().slice(0, 10)}`);
    assert(JSON.stringify(await eventsOf(w1.id)) === JSON.stringify(await eventsOf(w4.id)), "Every event attendance matches after the round trip");
    const surveysOf = async (id: string) => (await prisma.surveyResponse.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: [{ occurredAt: "asc" }, { type: "asc" }] })).map((s) => `${s.customer.ref}|${s.type}|${s.score}|${s.occurredAt.toISOString().slice(0, 10)}`);
    assert(JSON.stringify(await surveysOf(w1.id)) === JSON.stringify(await surveysOf(w4.id)), "Every survey response matches after the round trip, with its original date (the NPS is not re-dated to today)");
    const outcomesOf = async (id: string) => (await prisma.outcomeEvent.findMany({ where: { customer: { workspaceId: id } }, include: { customer: true }, orderBy: { occurredAt: "asc" } })).map((o) => `${o.customer.ref}|${o.type}|${o.occurredAt.toISOString().slice(0, 10)}|${o.notes}`);
    assert(JSON.stringify(await outcomesOf(w1.id)) === JSON.stringify(await outcomesOf(w4.id)), "Every outcome matches after the round trip");

    // ---- 13. toCsv and importCsv agree on awkward text
    const nasty = toCsv(["customer", "date", "text"], [["CUS-0001", new Date("2026-10-01T00:00:00Z"), "-starts with a dash, \"quoted\"\nand a new line"]]);
    res = await importCsv(w4.id, "tickets", nasty);
    const nastyRow = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w4.id }, text: { startsWith: "'-starts" } } });
    const plain = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w4.id }, text: { startsWith: "-starts" } } });
    assert(res.ok && nastyRow === null && plain !== null, "Text beginning with a dash round-trips without the guard quote sticking to it");

    // ---- 14. per-visit demo state
    const user = await prisma.user.create({ data: { workspaceId: w1.id, name: "T", email: `t-${suffix}@example.test`, passwordHash: "x", role: "csm" } });
    userIds.push(user.id);
    const tokenA = newSessionToken();
    const tokenB = newSessionToken();
    const sessA = await prisma.session.create({ data: { id: hashSessionToken(tokenA), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const sessB = await prisma.session.create({ data: { id: hashSessionToken(tokenB), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const cust = await prisma.customer.findFirstOrThrow({ where: { workspaceId: w1.id } });
    const action = await prisma.agentAction.create({ data: { workspaceId: w1.id, customerId: cust.id, area: "renewal", actionType: "save_play", headline: "h", reasoning: "r" } });
    const dismissed = await prisma.agentAction.create({ data: { workspaceId: w1.id, customerId: cust.id, area: "renewal", actionType: "save_play", headline: "h2", reasoning: "r", status: "dismissed" } });
    const otherCust = await prisma.customer.findFirstOrThrow({ where: { workspaceId: w2.id } });
    const foreign = await prisma.agentAction.create({ data: { workspaceId: w2.id, customerId: otherCust.id, area: "renewal", actionType: "save_play", headline: "h3", reasoning: "r" } });

    assert(await hideActionForVisit(sessA.id, w1.id, action.id), "A visitor can hide a recommendation for their own visit");
    assert((await hiddenIdsForSession(sessA.id)).includes(action.id), "It shows as hidden for that visitor");
    assert((await hiddenIdsForSession(sessB.id)).length === 0, "Another visitor still sees it");
    const row = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    assert(row.status === "proposed" && row.snoozeUntil === null && row.reviewedAt === null, "The shared recommendation itself is not changed at all");
    assert(await hideActionForVisit(sessA.id, w1.id, action.id), "Hiding the same recommendation twice is harmless");
    assert((await hiddenIdsForSession(sessA.id)).length === 1, "...and it is only recorded once");
    assert(!(await hideActionForVisit(sessA.id, w1.id, foreign.id)), "A recommendation from another workspace cannot be hidden by guessing its id");
    assert(!(await hideActionForVisit(sessA.id, w1.id, dismissed.id)), "A recommendation that is not open cannot be hidden");
    assert(!(await hideActionForVisit("no-such-session", w1.id, action.id)), "A session that does not exist cannot hide anything");
    await prisma.session.update({ where: { id: sessB.id }, data: { demoHiddenActionIds: Array.from({ length: MAX_HIDDEN_PER_VISIT }, (_, i) => `x${i}`) } });
    assert(!(await hideActionForVisit(sessB.id, w1.id, action.id)), "A visit is capped at the maximum number of hidden recommendations");
    await prisma.session.delete({ where: { id: sessA.id } });
    assert((await hiddenIdsForSession(sessA.id)).length === 0, "When the visit ends the hidden list is gone with the session, and the demo is back to normal");

    // ---- 15. delete removes the workspace and everything in it, and only that
    const ids4 = (await prisma.customer.findMany({ where: { workspaceId: w4.id }, select: { id: true } })).map((x) => x.id);
    await deleteWorkspaceAndData(w4.id);
    created.splice(created.indexOf(w4.id), 1);
    const inIds = { customerId: { in: ids4 } };
    const left = await Promise.all([
      prisma.workspace.count({ where: { id: w4.id } }),
      prisma.customer.count({ where: { id: { in: ids4 } } }),
      prisma.customerProduct.count({ where: inIds }),
      prisma.interaction.count({ where: inIds }),
      prisma.usageSnapshot.count({ where: inIds }),
      prisma.outcomeEvent.count({ where: inIds }),
      prisma.stakeholder.count({ where: inIds }),
      prisma.surveyResponse.count({ where: inIds }),
      prisma.desiredOutcome.count({ where: inIds }),
      prisma.trainingCompletion.count({ where: inIds }),
      prisma.eventAttendance.count({ where: inIds }),
      prisma.product.count({ where: { workspaceId: w4.id } }),
    ]);
    assert(left.every((n) => n === 0), "Deleting a workspace removes the workspace and every row that belonged to it, including goals, training, events and surveys");
    assert((await counts(w1.id)).customers === 4 && (await counts(w2.id)).customers === 1, "Other workspaces are untouched by the delete");
    assert((await prisma.customer.count({ where: { workspace: { isDemoSeed: true } } })) === demoBefore, "The demo workspace's data is exactly as it was before the test");
  } finally {
    if (savedSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = savedSelfHosted;
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.agentAction.deleteMany({ where: { workspaceId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const id of created) await deleteWorkspaceAndData(id).catch((e) => console.error("cleanup", e));
  }

  console.log("\nAll import, export, isolation, round-trip, delete and per-visit checks passed.");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
