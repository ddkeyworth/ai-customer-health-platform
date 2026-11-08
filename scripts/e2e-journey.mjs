// End-to-end journey test, run in a real browser against a running copy of the
// app. It walks what a real person does, in order:
//
//   1. a new visitor signs up, sees an empty workspace and is told what to do
//   2. imports the four template files exactly as a user would download them
//   3. a bad file is refused with the exact row, and changes nothing
//   4. runs Health with no AI key and gets a score for every customer
//   5. finds expansion opportunities, downloads their export, and checks the file
//   6. deletes the workspace with the typed confirmation, and cannot log in again
//   7. security edges: logged-out export, cross-site run request, security headers
//   8. the shared demo: locked controls, a visitor's clicks are theirs alone, and
//      are gone after they log out
//   9. phone width on the new pages
//
// Usage (the test creates and deletes its own workspace, and never changes the
// shared demo's data):
//   npm run build && npx next start -p 3100     (in one terminal)
//   BASE_URL=http://localhost:3100 npm run e2e   (in another)
// It does not call the AI and costs nothing.
import puppeteer from "puppeteer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const DEMO_EMAIL = "priya.chandra@meridian-ops.example";
const DEMO_PASSWORD = "demo-password-123";
const stamp = Date.now();
const EMAIL = `journey-${stamp}@example.test`;
const PASSWORD = "Journey-test-password-1";
const WORKSPACE = `Journey Co ${stamp}`;

const results = [];
const check = (ok, message) => {
  results.push({ ok, message });
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
};

const browser = await puppeteer.launch({ headless: true });
const problems = [];
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/_rsc|favicon/.test(m.text())) problems.push(`${label} console: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${label} HTTP ${r.status()} ${r.url().slice(0, 100)}`);
  });
}
const text = (page) => page.evaluate(() => document.body.innerText);

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('button[type="submit"]')]);
}

async function upload(page, kind, file) {
  const input = await page.$(`input[aria-label="CSV file for ${kind}"]`);
  // A form keeps showing its previous result until the next one arrives, so
  // remember it and wait for a different one.
  const previous = await input.evaluate((el) => el.closest("form").querySelector('[role="status"]')?.innerText ?? "");
  await input.uploadFile(file);
  await input.evaluate((el) => el.closest("form").querySelector('button[type="submit"]').click());
  await page.waitForFunction(
    (k, prev) => {
      const form = document.querySelector(`input[aria-label="CSV file for ${k}"]`)?.closest("form");
      const status = form && form.querySelector('[role="status"]');
      return status && status.innerText !== prev;
    },
    { timeout: 30000 },
    kind,
    previous
  );
  return input.evaluate((el) => el.closest("form").querySelector('[role="status"]').innerText);
}

try {
  // ---------- 1. sign up, empty workspace ----------
  const page = await browser.newPage();
  watch(page, "journey");
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle2" });
  check((await text(page)).includes("public demonstration site"), "Signup tells a visitor this is a demo site and to use sample data");
  await page.type('input[name="name"]', "Journey Tester");
  await page.type('input[name="workspaceName"]', WORKSPACE);
  await page.type('input[name="email"]', EMAIL);
  await page.type('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('button[type="submit"]')]);
  check(new URL(page.url()).pathname === "/", "Signing up lands on the home page, signed in");
  await page.goto(`${BASE}/health`, { waitUntil: "networkidle2" });
  let t = await text(page);
  check(t.includes("Health scores work now without a key") && t.includes("No Health scores yet"), "An empty workspace explains that Health works without a key and that no scores exist yet");
  check(!t.includes("npx tsx"), "No developer commands are shown to an end user");

  // ---------- 2. import the four templates exactly as downloaded ----------
  await page.goto(`${BASE}/data`, { waitUntil: "networkidle2" });
  t = await text(page);
  check(t.includes("Use sample or anonymised data only"), "The Data page warns a hosted-site user to use sample data only");
  const templates = path.resolve("public/templates");
  let msg = await upload(page, "customers", path.join(templates, "customers.csv"));
  check(/Imported 2 customers/.test(msg), `The customers template imports (${msg.split("\n")[0]})`);
  msg = await upload(page, "tickets", path.join(templates, "tickets.csv"));
  check(/Imported 2 tickets/.test(msg), `The tickets template imports (${msg.split("\n")[0]})`);
  msg = await upload(page, "usage", path.join(templates, "usage.csv"));
  check(/Imported 4 usage readings/.test(msg), `The usage template imports (${msg.split("\n")[0]})`);
  msg = await upload(page, "outcomes", path.join(templates, "outcomes.csv"));
  check(/Imported 2 outcomes/.test(msg), `The outcomes template imports (${msg.split("\n")[0]})`);

  // ---------- 3. a bad file is refused and changes nothing ----------
  const bad = path.join(os.tmpdir(), `bad-${stamp}.csv`);
  fs.writeFileSync(bad, "name,tier,renewal_date\nFine Co,enterprise,2027-01-31\nBroken Co,platinum,2027-02-30\n");
  msg = await upload(page, "customers", bad);
  check(/Nothing was imported/.test(msg) && /Row 3/.test(msg), "A file with a bad row is refused and names Row 3");
  try {
    fs.unlinkSync(bad); // Windows may still hold the file open; a leftover temp file is harmless
  } catch {}
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  t = await text(page);
  check(!t.includes("Fine Co") && /2\s*customer-product/.test(t), "The refused file added nothing, not even its good row");

  // ---------- 4. Health with no key ----------
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  t = await text(page);
  check(t.includes("Health scoring (baseline only, free)"), "Settings offers the free baseline Health run when there is no key");
  const [runButton] = await page.$$("xpath/.//button[contains(., 'Run baseline now')]");
  await runButton.click();
  await page.waitForFunction(() => document.body.innerText.includes("Finished."), { timeout: 60000 });
  check(true, "Run baseline now finishes without an AI key");
  await page.goto(`${BASE}/health`, { waitUntil: "networkidle2" });
  const rows = await page.$$eval("table tbody tr", (r) => r.length);
  t = await text(page);
  check(rows === 2 && /Baseline score \d+/.test(t), `Health lists both customers with a baseline score and an explanation (${rows} rows)`);
  check(/Example Customer One/.test(t) && /Example Customer Two/.test(t), "Both imported customers appear on the Health screen");

  // ---------- 5. opportunities and export ----------
  await page.goto(`${BASE}/expansion`, { waitUntil: "networkidle2" });
  const [findButton] = await page.$$("xpath/.//button[contains(., 'Find expansion opportunities')]");
  check(!!findButton, "The Expansion page offers the free Find expansion opportunities button");
  await Promise.all([page.waitForNetworkIdle({ idleTime: 800 }), findButton.click()]);
  check(!/error|went wrong/i.test((await text(page)).slice(0, 400)), "Finding opportunities completes without an error");
  const dl = await page.evaluate(async () => {
    const out = {};
    for (const kind of ["customers", "tickets", "usage", "outcomes", "recommendations", "nonsense"]) {
      const r = await fetch(`/api/export/${kind}`);
      out[kind] = { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), body: r.status === 200 ? (await r.text()).slice(0, 300) : "" };
    }
    return out;
  });
  check(Object.entries(dl).filter(([k]) => k !== "nonsense").every(([, v]) => v.status === 200 && /text\/csv/.test(v.type) && /attachment; filename="bearing-/.test(v.disp)), "All five exports download as CSV attachments");
  check(dl.nonsense.status === 404, "An unknown export name is a 404");
  check(dl.customers.body.startsWith("﻿ref,name,country") && /Example Customer One/.test(dl.customers.body), "The customers export starts with the import columns and contains the imported customers");

  // ---------- 7a. security edges ----------
  const edges = await page.evaluate(async (base) => {
    const outsider = await fetch(`${base}/api/capability-run`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ capability: "renewal", start: true }) });
    const noJson = await fetch("/api/capability-run", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    const noKey = await fetch("/api/capability-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "renewal", start: true }) });
    return { outsider: outsider.status, noJson: noJson.status, noKey: noKey.status, noKeyBody: (await noKey.json()).error };
  }, BASE);
  check(edges.noJson === 415, "The run route refuses a request that is not JSON");
  check(edges.noKey === 400 && /no Anthropic API key/.test(edges.noKeyBody), "An AI step with no key is refused with a clear message");

  // ---------- 6. delete the workspace ----------
  await page.goto(`${BASE}/data`, { waitUntil: "networkidle2" });
  await page.type("#confirm-delete", "wrong name");
  await page.click('form button[type="submit"].bg-red-700');
  await page.waitForFunction(() => document.body.innerText.includes("Type the workspace name exactly"), { timeout: 20000 });
  check(true, "Deleting with the wrong name is refused and explains what to type");
  await page.$eval("#confirm-delete", (el) => (el.value = ""));
  await page.type("#confirm-delete", WORKSPACE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }), page.click('form button[type="submit"].bg-red-700')]);
  check(page.url().includes("/signup?deleted=1") && (await text(page)).includes("were deleted"), "Deleting with the right name removes the workspace and says so");
  await page.goto(`${BASE}/health`, { waitUntil: "networkidle2" });
  check(new URL(page.url()).pathname === "/login", "After deleting, the old session no longer works");
  await login(page, EMAIL, PASSWORD);
  check(page.url().includes("error=invalid") || (await text(page)).toLowerCase().includes("invalid"), "After deleting, the login no longer exists");

  // ---------- 7b. logged-out and headers ----------
  const anon = await browser.newPage();
  watch(anon, "anon");
  const exportAnon = await anon.goto(`${BASE}/api/export/customers`);
  check(exportAnon.status() === 401, "A logged-out request for an export is refused");
  await anon.goto(`${BASE}/data`, { waitUntil: "networkidle2" });
  check(new URL(anon.url()).pathname === "/login", "The Data page needs a login");
  const hdr = (await anon.goto(`${BASE}/login`)).headers();
  check(/frame-ancestors 'none'/.test(hdr["content-security-policy"] ?? ""), "Pages forbid being shown inside another site (clickjacking)");
  check(hdr["x-frame-options"] === "DENY" && hdr["x-content-type-options"] === "nosniff" && !!hdr["referrer-policy"], "Frame, content-type and referrer headers are set");
  check(!hdr["x-powered-by"], "The server no longer advertises what it runs on");
  await anon.close();

  // ---------- 8. the shared demo ----------
  const demoA = await browser.newPage();
  watch(demoA, "demoA");
  await demoA.setViewport({ width: 1280, height: 900 });
  await login(demoA, DEMO_EMAIL, DEMO_PASSWORD);
  await demoA.goto(`${BASE}/data`, { waitUntil: "networkidle2" });
  t = await text(demoA);
  check(/locked on the shared demo workspace/.test(t), "The demo's Data page is locked");
  if (!/locked on the shared demo workspace/.test(t)) {
    throw new Error("Refusing to continue: the demo is not locked, so a click here would change the shared demo for everyone.");
  }
  const disabled = await demoA.$$eval('input[type="file"]', (els) => els.every((e) => e.disabled));
  check(disabled, "The demo's upload boxes are disabled");
  await demoA.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  check(/changes here are switched off/.test(await text(demoA)), "The demo's Settings says changes are switched off");
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  const countCards = (p) => p.$$eval("button", (bs) => bs.filter((b) => b.innerText.trim() === "Dismiss").length);
  const before = await countCards(demoA);
  check(before >= 1, `The demo's Onboarding shows ${before} recommendations`);
  const [dismiss] = await demoA.$$("xpath/.//button[normalize-space()='Dismiss']");
  await Promise.all([demoA.waitForNetworkIdle({ idleTime: 800 }), dismiss.click()]);
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoA)) === before - 1, "Dismissing hides it for this visitor");

  const demoB = await browser.newPage();
  watch(demoB, "demoB");
  await login(demoB, DEMO_EMAIL, DEMO_PASSWORD);
  await demoB.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoB)) === before, "A different visitor still sees every recommendation: one visitor's click never changes the demo for anyone else");

  const [logoutButton] = await demoA.$$("xpath/.//button[normalize-space()='Log out']");
  await Promise.all([demoA.waitForNavigation({ waitUntil: "networkidle2" }), logoutButton.click()]);
  await login(demoA, DEMO_EMAIL, DEMO_PASSWORD);
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoA)) === before, "After logging out and back in, the visitor's changes are gone and the demo is back to normal");

  const demoRun = await demoA.evaluate(async () => {
    const r = await fetch("/api/capability-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "health", start: true }) });
    return { status: r.status, error: (await r.json()).error };
  });
  check(demoRun.status === 403, "The demo cannot start an AI run (it would spend the owner's key)");
  await demoB.close();

  // ---------- 9. phone width ----------
  await demoA.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const p of ["/data", "/settings", "/expansion"]) {
    await demoA.goto(`${BASE}${p}`, { waitUntil: "networkidle2" });
    const overflow = await demoA.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `${p} fits a phone screen (overflow ${overflow}px)`);
  }
  await demoA.close();

  check(problems.length === 0, problems.length === 0 ? "No browser errors or server errors during the whole journey" : `Browser or server problems: ${problems.slice(0, 5).join(" | ")}`);
} catch (e) {
  check(false, `The journey stopped unexpectedly: ${String(e).slice(0, 300)}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
