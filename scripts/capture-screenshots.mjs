// One-off/reusable screenshot capture for README imagery, against the real
// live production deployment (bearing360.vercel.app) - not localhost, so
// the images match what an actual visitor sees.
import puppeteer from "puppeteer";
import path from "path";

const OUT_DIR = path.resolve("docs/screenshots");
const BASE = "https://bearing360.vercel.app";

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "login-screenshot.png") });

  await page.type('input[name="email"]', "priya.chandra@meridian-ops.example");
  await page.type('input[name="password"]', "demo-password-123");
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('button[type="submit"]')]);
  await wait(1500);
  await page.screenshot({ path: path.join(OUT_DIR, "home-screenshot.png") });

  await page.goto(`${BASE}/health`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "health-screenshot.png") });

  const link = await page.$("table tbody tr:first-child a");
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), link.click()]);
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "customer-detail-screenshot.png") });

  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "competitor-config-screenshot.png"), fullPage: true });

  await page.goto(`${BASE}/onboarding`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "onboarding-screenshot.png") });

  await page.goto(`${BASE}/adoption`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "adoption-screenshot.png") });

  await page.goto(`${BASE}/expansion`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "expansion-screenshot.png") });

  await page.goto(`${BASE}/renewal`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "renewal-screenshot.png") });

  await page.goto(`${BASE}/briefing`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "briefing-screenshot.png") });

  await page.goto(`${BASE}/calibration`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "calibration-screenshot.png") });

  await page.goto(`${BASE}/segments`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "segments-screenshot.png") });

  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "signup-screenshot.png") });

  await page.goto(`${BASE}/marketing`, { waitUntil: "domcontentloaded" });
  await wait(1000);
  await page.screenshot({ path: path.join(OUT_DIR, "marketing-screenshot.png"), fullPage: true });

  await browser.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
