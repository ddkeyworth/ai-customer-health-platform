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
// Start the server with ALLOW_SIGNUP=true TRUSTED_PROXY_HOPS=1 (and NOT SELF_HOSTED, so the
// demo stays locked). To also prove signup is closed by default, start a second server on
// another port WITHOUT ALLOW_SIGNUP and pass it as CLOSED_BASE_URL.
// Usage (the test creates and deletes its own workspace, and never changes the
// shared demo's data):
//   npm run build && npx next start -p 3100     (in one terminal)
//   BASE_URL=http://localhost:3100 npm run e2e   (in another)
// It does not call the AI and costs nothing.
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const CLOSED = process.env.CLOSED_BASE_URL || ""; // a server started without ALLOW_SIGNUP
const prisma = new PrismaClient();
const DEMO_EMAIL = "priya.chandra@meridian-ops.example";
const DEMO_PASSWORD = "demo-password-123";
const stamp = Date.now();
const EMAIL = `journey-${stamp}@example.test`;
const PASSWORD = "Journey-test-password-1";
const PASSWORD2 = "Journey-test-password-2";
const PASSWORD3 = "Journey-test-password-3";
const KEY_PATTERN = /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){4}$/;
let currentPassword = PASSWORD;
const WORKSPACE = `Journey Co ${stamp}`;

// Each browser page presents its own made-up address (from the documentation
// range reserved for examples) in x-forwarded-for. The app limits signups and
// logins per address, and on a local run every page would otherwise share one
// address, and one counter, with anything else tested on the same database
// (including another run of this script), so the cap would trip at random.
let nextIp = Math.floor(Math.random() * 200) + 1;
const spoofIp = (page) => page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${(nextIp++ % 250) + 1}` });

const results = [];
const check = (ok, message) => {
  results.push({ ok, message });
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
};

// Waits use a fixed polling interval, not the default animation-frame polling, because
// puppeteer pages that are not the front tab never fire animation frames.
// PUPPETEER_EXECUTABLE_PATH (read by puppeteer itself, and passed explicitly here)
// lets you use a Chrome that is already installed instead of downloading one.
// The demo login is limited to 10 attempts per 15 minutes, and this journey logs in as the demo
// a few times per run, so clear just that login's counters (and the made-up addresses') first.
await prisma.rateLimitBucket.deleteMany({
  where: { OR: [{ key: { in: [`login:${DEMO_EMAIL}`, `reset:${DEMO_EMAIL}`] } }, { key: { startsWith: "login-ip:198.51.100." } }, { key: { startsWith: "signup-ip:198.51.100." } }, { key: { startsWith: "reset-ip:198.51.100." } }] },
});

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined });
const problems = [];
function watch(page, label) {
  page.on("console", (m) => {
    // Some antivirus products inject a script that calls their own servers from every page; those
    // blocked requests are noise from this machine, not from the app.
    const from = `${m.location()?.url ?? ""} ${m.text()}`;
    if (/kaspersky/i.test(from)) return;
    if (/Content Security Policy|Refused to|hydrat/i.test(m.text())) problems.push(`${label} ${m.type()}: ${m.text().slice(0, 200)}`);
    // The journey deliberately sends bad requests to /api/ routes (an unknown export, a request that is
    // not JSON, a logged-out download) and opens two pages that do not exist (the 404 checks) to prove
    // they are refused cleanly; the browser logs each refusal as an error. A 5xx is still caught by the response handler below.
    else if (/Failed to load resource/.test(m.text()) && /\/api\/|no-such-page/.test(m.location()?.url ?? "")) return;
    else if (m.type() === "error" && !/_rsc|favicon/i.test(from)) problems.push(`${label} console: ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${label} HTTP ${r.status()} ${r.url().slice(0, 100)}`);
  });
}
const text = (page) => page.evaluate(() => document.body.innerText);

// Click something that runs a Server Action, then wait for that action's own
// response. Not waitForNetworkIdle: some antivirus software injects a script
// into every page that calls home every half second, so the page never goes
// idle and the wait times out even though the app finished in milliseconds.
async function clickAndWait(page, handle) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { polling: 250, timeout: 30000 }),
    handle.click(),
  ]);
  await new Promise((r) => setTimeout(r, 600)); // let the refreshed page render
  return response.status();
}

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
    { polling: 250, timeout: 30000 },
    kind,
    previous
  );
  return input.evaluate((el) => el.closest("form").querySelector('[role="status"]').innerText);
}

try {
  // ---------- 1. sign up, empty workspace ----------
  const page = await browser.newPage();
  await spoofIp(page);
  watch(page, "journey");
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle2" });
  check(!!(await page.$('input[name="email"]')) && /demonstration|demo site|own copy/i.test(await text(page)), "The signup form is available (ALLOW_SIGNUP=true) and tells a visitor this is a demo site");

  // ---------- 0. signup is closed by default on a server started without ALLOW_SIGNUP ----------
  if (!CLOSED) {
    console.log("SKIP  closed-signup check (set CLOSED_BASE_URL to a server started without ALLOW_SIGNUP)");
  } else {
    const closedPage = await browser.newPage();
    await spoofIp(closedPage);
    await closedPage.goto(`${CLOSED}/signup`, { waitUntil: "networkidle2" });
    const closedText = await text(closedPage);
    check(/nothing is saved here|closed/i.test(closedText) && !(await closedPage.$('input[name="email"]')) && !(await closedPage.$("form")), "Signup shows a closed message and no form on a server where it was not opened");
    await closedPage.close();

    // Replay the signup form's own hidden fields (the action id) as a direct POST, the way a script
    // would, to the closed server. It must create nothing. The same request on the open server is a
    // positive control: it proves the replay works, so "nothing happened" on the closed one means something.
    const hidden = await page.$$eval('form input[type="hidden"]', (els) => els.map((e) => [e.name, e.value]));
    const probeEmail = `journey-closed-${stamp}@example.test`;
    const replay = async (base) => {
      const form = new FormData();
      for (const [k, v] of hidden) form.append(k, v);
      form.append("name", "Closed Probe");
      form.append("workspaceName", `Journey Co closed probe ${stamp}`);
      form.append("email", probeEmail);
      form.append("password", "Journey-test-password-1");
      return fetch(`${base}/signup`, { method: "POST", body: form, redirect: "manual", headers: { "x-forwarded-for": "198.51.100.200" } });
    };
    check(hidden.length > 0, `The signup form carries its action id for a direct POST (${hidden.length} hidden fields)`);
    const before = await prisma.workspace.count();
    await replay(CLOSED);
    const userAfterClosed = await prisma.user.findUnique({ where: { email: probeEmail } });
    check((await prisma.workspace.count()) === before && userAfterClosed === null, "A direct POST of the signup action to the closed server creates no workspace and no user");
    await replay(BASE);
    const created = await prisma.user.findUnique({ where: { email: probeEmail } });
    check(!!created, "Positive control: the same replayed POST does create an account on the server where signup is open");
    if (created) {
      await prisma.session.deleteMany({ where: { userId: created.id } });
      await prisma.user.delete({ where: { id: created.id } });
      await prisma.workspace.delete({ where: { id: created.workspaceId } });
    }
  }
  await page.type('input[name="name"]', "Journey Tester");
  await page.type('input[name="workspaceName"]', WORKSPACE);
  await page.type('input[name="email"]', EMAIL);
  await page.type('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click('button[type="submit"]')]);
  check(new URL(page.url()).pathname === "/recovery-key", "Signing up shows the one-time recovery key page");
  const signupKey = (await page.$eval('[aria-label="Your recovery key"]', (el) => el.innerText)).trim();
  check(KEY_PATTERN.test(signupKey), `The recovery key is 5 groups of 5 characters (${signupKey.slice(0, 5)}-...)`);
  check(/will not be\s+shown again/.test(await text(page)), "The page says the key is shown only once");
  await Promise.all([page.waitForFunction(() => location.pathname === "/", { polling: 250, timeout: 30000 }), page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /I have saved it/.test(b.innerText)).click())]);
  check(new URL(page.url()).pathname === "/", "After saving the key the person lands on the home page, signed in");
  await page.goto(`${BASE}/recovery-key`, { waitUntil: "networkidle2" });
  check(new URL(page.url()).pathname === "/", "The key is never shown a second time (the page just goes home)");
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
  const NEW_KINDS = ["stakeholders", "goals", "training", "events", "surveys"];
  check((await page.$$('input[type="file"]')).length === 4 + NEW_KINDS.length, `The Data page offers ${4 + NEW_KINDS.length} import cards (customers first, then eight more kinds)`);
  for (const kind of NEW_KINDS) {
    msg = await upload(page, kind, path.join(templates, `${kind}.csv`));
    check(/Imported \d+/.test(msg) && !/Nothing was imported/.test(msg), `The ${kind} template imports (${msg.split("\n")[0]})`);
  }

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
  await page.waitForFunction(() => document.body.innerText.includes("Finished."), { polling: 250, timeout: 60000 });
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
  await clickAndWait(page, findButton);
  check(!/error|went wrong/i.test((await text(page)).slice(0, 400)), "Finding opportunities completes without an error");
  const dl = await page.evaluate(async () => {
    const out = {};
    for (const kind of ["customers", "tickets", "usage", "outcomes", "stakeholders", "goals", "training", "events", "surveys", "recommendations", "nonsense"]) {
      const r = await fetch(`/api/export/${kind}`);
      // Read the raw bytes: fetch().text() silently strips a leading byte-order mark,
      // which would hide whether the file really starts with one (Excel needs it).
      const bytes = r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
      out[kind] = { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, body: new TextDecoder().decode(bytes).slice(0, 3000) };
    }
    return out;
  });
  check(Object.entries(dl).filter(([k]) => k !== "nonsense").every(([, v]) => v.status === 200 && /text\/csv/.test(v.type) && /attachment; filename="bearing-/.test(v.disp)), "Every export (customers, tickets, usage, outcomes, stakeholders, goals, training, events, surveys, recommendations) downloads as a CSV attachment");
  check(["stakeholders", "goals", "training", "events", "surveys"].every((k) => dl[k].bom && /^customer,/.test(dl[k].body) && /Example Customer/.test(dl[k].body)), "The five newer exports start with the import columns and contain the imported rows");
  check(dl.nonsense.status === 404, "An unknown export name is a 404");
  check(dl.customers.bom, "The customers export starts with a byte-order mark so Excel reads the characters correctly");
  check(/^ref,name,country/.test(dl.customers.body) && /Example Customer One/.test(dl.customers.body), "The customers export starts with the import columns and contains the imported customers");

  // ---------- 7a. security edges ----------
  const edges = await page.evaluate(async (base) => {
    const outsider = await fetch(`${base}/api/capability-run`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ capability: "renewal", start: true }) });
    const noJson = await fetch("/api/capability-run", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    const noKey = await fetch("/api/capability-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: "renewal", start: true }) });
    return { outsider: outsider.status, noJson: noJson.status, noKey: noKey.status, noKeyBody: (await noKey.json()).error };
  }, BASE);
  check(edges.noJson === 415, "The run route refuses a request that is not JSON");
  check(edges.noKey === 400 && /no Anthropic API key/.test(edges.noKeyBody), "An AI step with no key is refused with a clear message");

  // ---------- 5a. a Settings form works ----------
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  const rival = `Probe Rival ${stamp}`;
  const [rivalName] = await page.$$("xpath/.//form[.//input[@name='riskWeight']]//input[@name='name']");
  await rivalName.type(rival);
  const [addRival] = await page.$$("xpath/.//form[.//input[@name='riskWeight']]//button[normalize-space()='Add']");
  await clickAndWait(page, addRival);
  check((await text(page)).includes(rival), "A Settings form (add competitor) saves and the page updates");

  // ---------- 5b. forgot password, recovery key, change password ----------
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  t = await text(page);
  check(t.includes("Change password") && t.includes("Make a new recovery key") && /A recovery key was set on/.test(t), "Settings, Security shows change password and make a new recovery key for a normal account");

  const reset = await browser.newPage();
  watch(reset, "reset");
  await spoofIp(reset);
  await reset.setViewport({ width: 1280, height: 900 });
  await reset.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  check(!!(await reset.$("xpath/.//a[contains(., 'Forgot password?')]")), "The log in page has a Forgot password? link");
  const [forgotLink] = await reset.$$("xpath/.//a[contains(., 'Forgot password?')]");
  await Promise.all([reset.waitForFunction(() => location.pathname === "/forgot-password", { polling: 250, timeout: 30000 }), forgotLink.click()]);
  check(new URL(reset.url()).pathname === "/forgot-password", "The Forgot password? link opens the reset page");

  async function submitReset(email, key, password) {
    await reset.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle2" });
    await reset.type("#fp-email", email);
    await reset.type("#fp-key", key);
    await reset.type("#fp-password", password);
    await reset.type("#fp-confirm", password);
    await Promise.all([reset.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }), reset.click('button[type="submit"]')]);
  }
  const GENERIC = "That email and recovery key do not match an account";
  await submitReset(EMAIL, "AAAAA-AAAAA-AAAAA-AAAAA-AAAAA", PASSWORD2);
  check((await text(reset)).includes(GENERIC), "A wrong recovery key gets the generic message");
  await submitReset(`nobody-${stamp}@example.test`, signupKey, PASSWORD2);
  check((await text(reset)).includes(GENERIC), "An email that does not exist gets the very same message, so accounts cannot be discovered");
  await submitReset(DEMO_EMAIL, signupKey, PASSWORD2);
  check((await text(reset)).includes(GENERIC), "The shared demo account cannot be reset");

  await submitReset(EMAIL, signupKey, PASSWORD2);
  check(new URL(reset.url()).pathname === "/recovery-key", "A correct key and email reset the password and show a new recovery key");
  const newKey = (await reset.$eval('[aria-label="Your recovery key"]', (el) => el.innerText)).trim();
  check(KEY_PATTERN.test(newKey) && newKey !== signupKey, "The new recovery key is different from the old one");
  await Promise.all([reset.waitForFunction(() => location.pathname !== "/recovery-key", { polling: 250, timeout: 30000 }), reset.evaluate(() => [...document.querySelectorAll("button")].find((b) => /I have saved it/.test(b.innerText)).click())]);

  await submitReset(EMAIL, signupKey, PASSWORD3);
  check((await text(reset)).includes(GENERIC), "The old recovery key stops working once a new one is issued");

  await login(reset, EMAIL, PASSWORD);
  check(new URL(reset.url()).pathname === "/login" && /invalid/i.test(await text(reset)), "The old password no longer logs in");
  await login(reset, EMAIL, PASSWORD2);
  check(new URL(reset.url()).pathname === "/", "The new password logs in");
  currentPassword = PASSWORD2;

  await reset.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  const securityForm = async (selectorPrefix, fields, buttonText) => {
    for (const [id, value] of Object.entries(fields)) {
      await reset.$eval(id, (el) => (el.value = ""));
      await reset.type(id, value);
    }
    await Promise.all([reset.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }), reset.evaluate((label) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === label).click(), buttonText)]);
  };
  await securityForm("", { "#sec-current": "wrong-current-password", "#sec-next": PASSWORD3, "#sec-confirm": PASSWORD3 }, "Change password");
  check(/security=/.test(reset.url()) && !/password_changed/.test(reset.url()), "Changing the password with the wrong current password is refused");
  await reset.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  await securityForm("", { "#sec-current": PASSWORD2, "#sec-next": PASSWORD3, "#sec-confirm": "something else entirely" }, "Change password");
  check(/mismatch/.test(reset.url()), "Two different new passwords are refused");
  await reset.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  await securityForm("", { "#sec-current": PASSWORD2, "#sec-next": PASSWORD3, "#sec-confirm": PASSWORD3 }, "Change password");
  check(/password_changed/.test(reset.url()), "Changing the password with the right current password works");
  currentPassword = PASSWORD3;
  await reset.goto(`${BASE}/settings`, { waitUntil: "networkidle2" });
  await securityForm("", { "#sec-key-current": PASSWORD3 }, "Make a new recovery key");
  check(new URL(reset.url()).pathname === "/recovery-key" && KEY_PATTERN.test((await reset.$eval('[aria-label="Your recovery key"]', (el) => el.innerText)).trim()), "Make a new recovery key shows a fresh key once");
  await Promise.all([reset.waitForFunction(() => location.pathname !== "/recovery-key", { polling: 250, timeout: 30000 }), reset.evaluate(() => [...document.querySelectorAll("button")].find((b) => /I have saved it/.test(b.innerText)).click())]);
  await reset.close();

  // the original page's session ended when the password was reset, so sign in again with the newest password
  await login(page, EMAIL, currentPassword);
  check(new URL(page.url()).pathname === "/", "Signed in again with the newest password to finish the journey");

  // ---------- 6. delete the workspace ----------
  await page.goto(`${BASE}/data`, { waitUntil: "networkidle2" });
  await page.type("#confirm-delete", "wrong name");
  await page.click('form button[type="submit"].bg-red-700');
  await page.waitForFunction(() => document.body.innerText.includes("Type the workspace name exactly"), { polling: 250, timeout: 20000 });
  check(true, "Deleting with the wrong name is refused and explains what to type");
  await page.$eval("#confirm-delete", (el) => (el.value = ""));
  await page.type("#confirm-delete", WORKSPACE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }), page.click('form button[type="submit"].bg-red-700')]);
  check(page.url().includes("/signup?deleted=1") && (await text(page)).includes("were deleted"), "Deleting with the right name removes the workspace and says so");
  await page.goto(`${BASE}/health`, { waitUntil: "networkidle2" });
  check(new URL(page.url()).pathname === "/login", "After deleting, the old session no longer works");
  await login(page, EMAIL, currentPassword);
  check(page.url().includes("error=invalid") || (await text(page)).toLowerCase().includes("invalid"), "After deleting, the login no longer exists");

  // ---------- 7b. logged-out and headers ----------
  const anon = await browser.newPage();
  await spoofIp(anon);
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

  // ---------- 7c. content security policy, headers, nonces ----------
  const edge = await browser.newPage();
  watch(edge, "edge");
  await spoofIp(edge);
  const probe = async (path) => {
    const r = await fetch(`${BASE}${path}`, { redirect: "manual", headers: { "x-forwarded-for": "198.51.100.210" } });
    return { status: r.status, header: r.headers.get("content-security-policy") ?? "", hsts: r.headers.get("strict-transport-security"), html: r.status === 200 ? await r.text() : "" };
  };
  const nonceOf = (h) => /'nonce-([^']+)'/.exec(h)?.[1];
  const scriptSrc = (h) => /script-src([^;]*)/.exec(h)?.[1] ?? "";
  for (const path of ["/login", "/marketing", "/signup", "/forgot-password", "/recovery-key", "/health"]) {
    const a = await probe(path);
    const b2 = await probe(path);
    const n = nonceOf(a.header);
    check(!!n && /'strict-dynamic'/.test(a.header), `${path} (HTTP ${a.status}) sends a nonce-based, strict-dynamic policy`);
    check(!/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc(a.header)), `${path} allows no unsafe-inline or unsafe-eval scripts`);
    check(!!a.hsts, `${path} sends Strict-Transport-Security`);
    check(!!n && n !== nonceOf(b2.header), `${path} uses a different nonce on every request`);
    if (a.html) {
      const tags = a.html.match(/<script\b[^>]*>/g) ?? [];
      check(tags.length > 0 && tags.every((t) => t.includes(`nonce="${n}"`)), `Every script tag on ${path} carries the header's nonce (${tags.length} scripts)`);
    }
  }
  const nf2 = await edge.goto(`${BASE}/marketing/no-such-page-${stamp}`, { waitUntil: "networkidle2" });
  check(nf2.status() === 404, "A public unknown page is a clean 404");
  await edge.close();

  // ---------- 8. the shared demo ----------
  const demoA = await browser.newPage();
  await spoofIp(demoA);
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
  check(/Switched off on the shared demo: its password and recovery key are public/.test(await text(demoA)), "The demo's Security section is switched off");
  check(!(await demoA.$("#sec-current")) && !(await demoA.$("#sec-key-current")), "The demo has no change-password or recovery-key form to use");
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  const countCards = (p) => p.$$eval("button", (bs) => bs.filter((b) => b.innerText.trim() === "Dismiss").length);
  const before = await countCards(demoA);
  check(before >= 1, `The demo's Onboarding shows ${before} recommendations`);
  const [dismiss] = await demoA.$$("xpath/.//button[normalize-space()='Dismiss']");
  await clickAndWait(demoA, dismiss);
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoA)) === before - 1, "Dismissing hides it for this visitor");

  const demoB = await browser.newPage();
  await spoofIp(demoB);
  watch(demoB, "demoB");
  await login(demoB, DEMO_EMAIL, DEMO_PASSWORD);
  await demoB.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoB)) === before, "A different visitor still sees every recommendation: one visitor's click never changes the demo for anyone else");

  await demoA.bringToFront();
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  const afterDismiss = await countCards(demoA);
  const [acceptBtn] = await demoA.$$("xpath/.//button[normalize-space()='Accept']");
  await clickAndWait(demoA, acceptBtn);
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoA)) === afterDismiss - 1, "Accept hides the recommendation for this visitor");
  const [snoozeBtn] = await demoA.$$("xpath/.//button[normalize-space()='7d']");
  await clickAndWait(demoA, snoozeBtn);
  await demoA.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2" });
  check((await countCards(demoA)) === afterDismiss - 2, "Snooze 7 days hides the recommendation for this visitor");

  await demoA.goto(`${BASE}/health`, { waitUntil: "networkidle2" });
  const rowsBefore = await demoA.$$eval("table tbody tr", (r) => r.length);
  const [moreLink] = await demoA.$$("xpath/.//a[starts-with(normalize-space(), 'Show ') and contains(., 'more')]");
  check(rowsBefore === 25 && !!moreLink, `Health shows the first 25 customers and a Show more link (${rowsBefore} rows)`);
  await Promise.all([demoA.waitForFunction(() => location.search.includes("show="), { polling: 250, timeout: 30000 }), moreLink.click()]);
  await demoA.waitForFunction(() => document.querySelectorAll("table tbody tr").length > 25, { polling: 250, timeout: 30000 });
  check((await demoA.$$eval("table tbody tr", (r) => r.length)) === 50, "Show more adds the next 25 rows");

  const missing = await demoA.goto(`${BASE}/no-such-page-${stamp}`, { waitUntil: "networkidle2" });
  check(missing.status() === 404, "An unknown page inside the app is a clean 404");

  const appPages = await demoA.evaluate(async () => {
    const out = {};
    for (const p of ["/", "/health", "/settings", "/data", "/expansion"]) {
      const r = await fetch(p);
      out[p] = { csp: r.headers.get("content-security-policy") ?? "", html: await r.text() };
    }
    return out;
  });
  for (const [path, v] of Object.entries(appPages)) {
    const n = nonceOf(v.csp);
    const tags = v.html.match(/<script\b[^>]*>/g) ?? [];
    check(!!n && tags.length > 0 && tags.every((t) => t.includes(`nonce="${n}"`)), `Every script tag on the signed-in ${path} carries the header's nonce (${tags.length} scripts)`);
  }

  await demoA.bringToFront(); // a background tab does not run animation-frame timers
  const [logoutButton] = await demoA.$$("xpath/.//button[normalize-space()='Log out']");
  // Logging out is an in-page redirect, so wait for the address to change.
  await Promise.all([demoA.waitForFunction(() => location.pathname === "/login", { polling: 250, timeout: 30000 }), logoutButton.click()]);
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
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
