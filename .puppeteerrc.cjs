// Puppeteer is a devDependency for scripts/capture-screenshots.mjs only
// (regenerating README imagery) - nothing in the deployed app or CI drives
// a browser. skipDownload here means neither Vercel's build nor CI's
// `npm ci` ever attempts Puppeteer's ~170MB Chromium download - a real risk
// to deployment/CI reliability that isn't worth carrying for a manual,
// occasional dev script. Run `npx puppeteer browsers install chrome` once
// locally before using `npm run screenshots`.
module.exports = {
  skipDownload: true,
};
