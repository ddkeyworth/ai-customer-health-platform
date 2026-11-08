// Database checks for the real-use journey: import four kinds of file into a
// workspace, prove a bad file changes nothing, prove workspaces cannot see each
// other, score every imported customer with no AI key, export it all, load the
// export into a brand-new workspace and compare, then delete a workspace
// completely. Also covers the per-visit state used on the shared demo.
//
// Creates throwaway workspaces and removes every row it made. It never calls
// the AI and never touches the demo workspace.
import { PrismaClient } from "@prisma/client";
import { importCsv } from "../src/lib/import/importData";
import { buildExport, toCsv } from "../src/lib/import/exportData";
import { advanceRun } from "../src/lib/capabilityBatches";
import { ADAPTERS } from "../src/lib/capabilityWork";
import { generateOpportunitiesForWorkspace } from "../src/lib/expansion/generateOpportunities";
import { deleteWorkspaceAndData } from "../src/lib/deleteWorkspace";
import { MAX_HIDDEN_PER_VISIT, hiddenIdsForSession, hideActionForVisit } from "../src/lib/demoVisit";
import { hashSessionToken, newSessionToken } from "../src/lib/sessionToken";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const CUSTOMERS_CSV = [
  "ref,name,country,industry,tier,product,lifecycle_status,contractual_arr,consumption_arr,renewal_date,expected_go_live_date,go_live_date,payment_status,days_past_due,renewal_type,interrupted_reason,nps,champion_name,champion_last_engaged",
  `,Acme Freight,United Kingdom,Logistics,enterprise,Freight,live,120000,15000,${inDays(40)},,${daysAgo(700)},late,35,interrupted,customer_requested,3,Alex Champion,${daysAgo(200)}`,
  `,Acme Freight,,,,Warehouse,live,30000,0,${inDays(200)},,${daysAgo(300)},current,0,,,,,`,
  `,"Beta, Inc.",Germany,Retail,mid_market,Freight,onboarding,40000,0,${inDays(300)},${daysAgo(20)},,current,0,auto,,,,`,
  `CUS-0500,Gamma Supply,France,Retail,self_serve,Freight,live,9000,2000,${inDays(20)},,${daysAgo(900)},current,0,auto,,9,Gina Champion,${daysAgo(5)}`,
].join("\n");

const TICKETS_CSV = [
  "customer,date,type,severity,text",
  `CUS-0001,${daysAgo(10)},ticket,critical,Billing sync failed again and invoices are blocked`,
  `Acme Freight,${daysAgo(8)},email,high,"They asked about adding seats, and said ""soon"""`,
  `CUS-0500,${daysAgo(30)},call,low,=HYPERLINK("http://example.test","click")`,
  `"Beta, Inc.",${daysAgo(3)},ticket,medium,Go-live is blocked until their IT team finishes a review`,
].join("\n");

const USAGE_CSV = [
  "customer,capability,metric_type,date,value",
  `CUS-0001,Shipment tracking,adoption,${daysAgo(120)},140`,
  `CUS-0001,Shipment tracking,adoption,${daysAgo(60)},100`,
  `CUS-0001,Shipment tracking,adoption,${daysAgo(5)},60`,
  `CUS-0001,Data API calls,consumption,${daysAgo(90)},10000`,
  `CUS-0001,Data API calls,consumption,${daysAgo(5)},16000`,
  `CUS-0500,Shipment tracking,adoption,${daysAgo(40)},50`,
  `CUS-0500,Shipment tracking,adoption,${daysAgo(4)},70`,
].join("\n");

const OUTCOMES_CSV = [
  "customer,date,type,notes",
  `CUS-0001,${daysAgo(400)},renewed,Renewed for another year`,
  `CUS-0500,${daysAgo(300)},expanded,Added seats`,
].join("\n");

async function counts(workspaceId: string) {
  const inC = { customer: { workspaceId } };
  return {
    customers: await prisma.customer.count({ where: { workspaceId } }),
    links: await prisma.customerProduct.count({ where: inC }),
    tickets: await prisma.interaction.count({ where: inC }),
    usage: await prisma.usageSnapshot.count({ where: inC }),
    outcomes: await prisma.outcomeEvent.count({ where: inC }),
    products: await prisma.product.count({ where: { workspaceId } }),
    capabilities: await prisma.capability.count({ where: { product: { workspaceId } } }),
  };
}

(async () => {
  const demoBefore = await prisma.customer.count({ where: { workspace: { isDemoSeed: true } } });
  const mk = (name: string) => prisma.workspace.create({ data: { name } });
  const w1 = await mk("Test Import 1 - safe to delete");
  const w2 = await mk("Test Import 2 - safe to delete");
  const w3 = await mk("Test Import 3 - safe to delete");
  const created = [w1.id, w2.id, w3.id];
  const userIds: string[] = [];

  try {
    // ---- 1. customers import
    let res = await importCsv(w1.id, "customers", CUSTOMERS_CSV);
    assert(res.ok && res.imported === 3, `Importing the customers file creates 3 customers (${res.message})`);
    let c = await counts(w1.id);
    assert(c.customers === 3 && c.links === 4 && c.products === 2, "A customer with two products becomes one customer with two product links; two products are created once each");
    const list = await prisma.customer.findMany({ where: { workspaceId: w1.id }, orderBy: { ref: "asc" }, include: { stakeholders: true, surveyResponses: true, products: true } });
    assert(list.map((x) => x.ref).join() === "CUS-0001,CUS-0002,CUS-0500", "References are assigned in order (CUS-0001, CUS-0002) and an explicit one (CUS-0500) is kept");
    const acme = list.find((x) => x.name === "Acme Freight")!;
    assert(acme.products.length === 2 && acme.stakeholders.length === 1 && acme.stakeholders[0].isChampion && acme.surveyResponses[0]?.score === 3, "The champion and the NPS score from the first row are attached to the customer");
    assert(acme.renewalType === "interrupted" && acme.interruptedReason === "customer_requested" && acme.country === "United Kingdom", "Customer-level fields are saved from the first row");
    const beta = list.find((x) => x.name === "Beta, Inc.")!;
    assert(beta.products[0].lifecycleStatus === "onboarding" && beta.products[0].expectedGoLiveDate !== null, "A name containing a comma survives, and an onboarding account keeps its expected go-live date");
    assert((await counts(w2.id)).customers === 0, "Another workspace is untouched by the import");

    // ---- 2. a bad file changes nothing
    const before = await counts(w1.id);
    res = await importCsv(w1.id, "customers", "name,tier\nGood One,enterprise\nBad One,platinum\nGood Two,enterprise\n");
    assert(!res.ok && res.errors.length === 1 && res.errors[0].row === 3, "A file with one bad row is refused and names the row");
    assert(JSON.stringify(await counts(w1.id)) === JSON.stringify(before), "Nothing at all was written from the refused file, not even the good rows");
    res = await importCsv(w1.id, "customers", CUSTOMERS_CSV);
    assert(!res.ok && JSON.stringify(await counts(w1.id)) === JSON.stringify(before), "Importing the same customers again is refused as duplicates and changes nothing");
    res = await importCsv(w1.id, "customers", 'name\n"never closed\n');
    assert(!res.ok && /never closed/.test(res.errors[0].message), "A malformed file is refused with a plain message");
    res = await importCsv(w1.id, "customers", "");
    assert(!res.ok, "An empty file is refused");

    // ---- 3. more customers continue the numbering, clashes are refused
    res = await importCsv(w1.id, "customers", "name\nDelta Cargo\n");
    const delta = await prisma.customer.findFirstOrThrow({ where: { workspaceId: w1.id, name: "Delta Cargo" } });
    assert(res.ok && delta.ref === "CUS-0501", "Numbering continues after the highest existing reference (CUS-0501 after CUS-0500)");
    res = await importCsv(w1.id, "customers", "name,ref\nEpsilon,CUS-0001\n");
    assert(!res.ok, "A reference that already exists in the workspace is refused");

    // ---- 4. tickets, usage, outcomes
    res = await importCsv(w1.id, "tickets", TICKETS_CSV);
    assert(res.ok && res.imported === 4, "Tickets are imported, matching customers by reference or by exact name");
    const spy = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w1.id }, text: { startsWith: "=HYPERLINK" } } });
    assert(spy !== null, "Text that looks like a spreadsheet formula is stored as plain text");
    res = await importCsv(w1.id, "tickets", "customer,date,text\nNobody Here,2026-01-01,hi\n");
    assert(!res.ok && (await counts(w1.id)).tickets === 4, "A ticket for an unknown customer refuses the whole file");
    res = await importCsv(w1.id, "usage", USAGE_CSV);
    assert(res.ok && res.imported === 7, "Usage readings are imported");
    c = await counts(w1.id);
    assert(c.capabilities === 2 && c.usage === 7, "Each capability is created once, however many readings use it");
    res = await importCsv(w1.id, "usage", `customer,capability,metric_type,date,value\nCUS-0500,Shipment tracking,adoption,${daysAgo(2)},80\n`);
    c = await counts(w1.id);
    assert(res.ok && c.capabilities === 2 && c.usage === 8, "A later usage file adds readings but reuses the existing capability");
    res = await importCsv(w1.id, "outcomes", OUTCOMES_CSV);
    assert(res.ok && (await counts(w1.id)).outcomes === 2, "Outcome history is imported");
    res = await importCsv(w2.id, "tickets", TICKETS_CSV);
    assert(!res.ok && (await counts(w2.id)).tickets === 0, "A tickets file naming another workspace's customers is refused in an empty workspace");

    // ---- 5. isolation, then two uploads at once
    res = await importCsv(w2.id, "customers", "name,ref\nAcme Freight,CUS-0001\n");
    assert(res.ok, "A second workspace can use the same customer names and references");
    const clash = await Promise.all([
      importCsv(w3.id, "customers", "name\nRace One\nRace Two\n"),
      importCsv(w3.id, "customers", "name\nRace One\nRace Two\n"),
    ]);
    assert(clash.filter((x) => x.ok).length === 1 && (await counts(w3.id)).customers === 2, "Two identical uploads at the same moment import once, never twice (the workspace is locked while one runs)");
    await deleteWorkspaceAndData(w3.id);
    created.splice(created.indexOf(w3.id), 1);

    // ---- 6. free Health scoring with no key, through the real resumable engine
    assert((await prisma.workspace.findUniqueOrThrow({ where: { id: w1.id } })).anthropicApiKeyEncrypted === null, "The test workspace has no AI key");
    let progress = await advanceRun({ workspaceId: w1.id, capability: "health", adapter: ADAPTERS.health, apiKey: null, startNew: true, budgetMs: 0 });
    assert(progress.status === "running" && progress.processed === 1, "A Health run with no key starts and makes progress one customer at a time");
    for (let i = 0; i < 10 && progress.status === "running"; i++) {
      progress = await advanceRun({ workspaceId: w1.id, capability: "health", adapter: ADAPTERS.health, apiKey: null, startNew: true, budgetMs: 0 });
    }
    assert(progress.status === "done" && progress.total === 4, "The run finishes and covered all 4 customers");
    const snaps = await prisma.healthScoreSnapshot.findMany({ where: { customer: { workspaceId: w1.id } }, include: { customer: true } });
    assert(snaps.length === 4 && snaps.every((s) => s.adjustmentDelta === 0 && s.adjustmentReason === null && s.compositeScore === s.baselineScore), "Every customer has a baseline-only score with no AI adjustment");
    assert(snaps.every((s) => /Baseline score \d+/.test(s.narrative ?? "") && /free baseline/.test(s.narrative ?? "")), "Each score comes with a plain explanation that says it is the free baseline");
    assert(snaps.every((s) => ["Thriving", "Stable", "Watch", "Critical"].includes(s.tierLabel ?? "")), "Each score has a valid band");
    const acmeSnap = snaps.find((s) => s.customer.name === "Acme Freight")!;
    assert(/Payment|Commercial|Usage|Champion/i.test(acmeSnap.narrative ?? ""), "The explanation names the weakest signals (late payment, falling usage, silent champion)");
    assert(await prisma.healthScoreSnapshot.count({ where: { customer: { workspaceId: w2.id } } }) === 0, "Scoring one workspace creates nothing in another");

    // ---- 7. opportunities are free, scoped and repeatable
    const first = await generateOpportunitiesForWorkspace(w1.id);
    const afterFirst = await prisma.opportunity.count({ where: { customer: { workspaceId: w1.id } } });
    const second = await generateOpportunitiesForWorkspace(w1.id);
    const afterSecond = await prisma.opportunity.count({ where: { customer: { workspaceId: w1.id } } });
    assert(first.created > 0 && afterFirst === first.created, `Finding opportunities creates some from the imported data (${first.created})`);
    assert(second.created === 0 && afterSecond === afterFirst, "Running it again creates no duplicates");
    assert((await prisma.opportunity.count({ where: { customer: { workspaceId: w2.id } } })) === 0, "Opportunities are only created in the workspace asked");

    // ---- 8. export, scoped and safe
    const exp = await buildExport(w1.id, "customers");
    const lines = exp.trim().split("\r\n");
    assert(lines.length === 6 && lines[0].startsWith("ref,name,country"), "The customers export has one row per customer and product, with the import columns first");
    assert(lines[0].includes("health_score") && lines[0].includes("health_narrative"), "It also includes the Health score, band and narrative");
    assert(!exp.includes("Race One") && !(await buildExport(w2.id, "tickets")).includes("Billing sync"), "An export contains only its own workspace's data");
    const ticketsOut = await buildExport(w1.id, "tickets");
    assert(ticketsOut.includes("'=HYPERLINK"), "A formula-like ticket is guarded in the export so a spreadsheet cannot run it");

    // ---- 9. round trip into a brand-new workspace
    const w4 = await mk("Test Import 4 - safe to delete");
    created.push(w4.id);
    for (const [kind, text] of [
      ["customers", exp],
      ["tickets", ticketsOut],
      ["usage", await buildExport(w1.id, "usage")],
      ["outcomes", await buildExport(w1.id, "outcomes")],
    ] as const) {
      const back = await importCsv(w4.id, kind, text);
      assert(back.ok, `The exported ${kind} file imports cleanly into a new workspace (${back.message})`);
    }
    const a = await counts(w1.id);
    const b = await counts(w4.id);
    assert(JSON.stringify(a) === JSON.stringify(b), `The new workspace has exactly the same counts as the original (${JSON.stringify(b)})`);
    const flat = async (id: string) =>
      (await prisma.customer.findMany({ where: { workspaceId: id }, orderBy: { ref: "asc" }, include: { products: { include: { product: true }, orderBy: { contractualArr: "asc" } }, stakeholders: true } }))
        .map((x) => [x.ref, x.name, x.tier, x.country, x.renewalType, x.interruptedReason, x.stakeholders.map((s) => s.name).join("|"), x.products.map((p) => `${p.product.name}:${p.lifecycleStatus}:${Number(p.contractualArr)}:${Number(p.consumptionArr)}:${p.paymentStatus}:${p.daysPastDue}:${p.renewalDate?.toISOString().slice(0, 10)}`).join("|")].join("~"));
    assert(JSON.stringify(await flat(w1.id)) === JSON.stringify(await flat(w4.id)), "Every customer matches field for field after the round trip: refs, tiers, products, amounts, dates, payment, champion");
    const textsOf = async (id: string) => (await prisma.interaction.findMany({ where: { customer: { workspaceId: id } }, orderBy: { text: "asc" } })).map((i) => i.text);
    assert(JSON.stringify(await textsOf(w1.id)) === JSON.stringify(await textsOf(w4.id)), "Every ticket text matches exactly after the round trip, including the formula-like one, the quotes and the commas");
    const usageOf = async (id: string) => (await prisma.usageSnapshot.findMany({ where: { customer: { workspaceId: id } }, include: { capability: true, customer: true }, orderBy: [{ occurredAt: "asc" }, { value: "asc" }] })).map((u) => `${u.customer.ref}|${u.capability.name}|${u.capability.metricType}|${u.occurredAt.toISOString().slice(0, 10)}|${Number(u.value)}`);
    assert(JSON.stringify(await usageOf(w1.id)) === JSON.stringify(await usageOf(w4.id)), "Every usage reading matches after the round trip");

    // ---- 10. toCsv/importCsv agree on awkward text
    const nasty = toCsv(["customer", "date", "text"], [["CUS-0001", new Date("2026-10-01T00:00:00Z"), "-starts with a dash, \"quoted\"\nand a new line"]]);
    res = await importCsv(w4.id, "tickets", nasty);
    const nastyRow = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w4.id }, text: { startsWith: "'-starts" } } });
    const plain = await prisma.interaction.findFirst({ where: { customer: { workspaceId: w4.id }, text: { startsWith: "-starts" } } });
    assert(res.ok && nastyRow === null && plain !== null, "Text beginning with a dash round-trips without the guard quote sticking to it");

    // ---- 11. per-visit demo state
    const user = await prisma.user.create({ data: { workspaceId: w1.id, name: "T", email: `t-${Date.now()}@example.test`, passwordHash: "x", role: "csm" } });
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

    // ---- 12. delete removes the workspace and everything in it, and only that
    const ids4 = (await prisma.customer.findMany({ where: { workspaceId: w4.id }, select: { id: true } })).map((x) => x.id);
    await deleteWorkspaceAndData(w4.id);
    created.splice(created.indexOf(w4.id), 1);
    const left = await Promise.all([
      prisma.workspace.count({ where: { id: w4.id } }),
      prisma.customer.count({ where: { id: { in: ids4 } } }),
      prisma.customerProduct.count({ where: { customerId: { in: ids4 } } }),
      prisma.interaction.count({ where: { customerId: { in: ids4 } } }),
      prisma.usageSnapshot.count({ where: { customerId: { in: ids4 } } }),
      prisma.outcomeEvent.count({ where: { customerId: { in: ids4 } } }),
      prisma.stakeholder.count({ where: { customerId: { in: ids4 } } }),
      prisma.surveyResponse.count({ where: { customerId: { in: ids4 } } }),
      prisma.product.count({ where: { workspaceId: w4.id } }),
    ]);
    assert(left.every((n) => n === 0), "Deleting a workspace removes the workspace and every row that belonged to it");
    assert((await counts(w1.id)).customers === 4 && (await counts(w2.id)).customers === 1, "Other workspaces are untouched by the delete");
    assert((await prisma.customer.count({ where: { workspace: { isDemoSeed: true } } })) === demoBefore, "The demo workspace's data is exactly as it was before the test");
  } finally {
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
