// Assert-based regression check for the real withinRateLimit() from
// src/lib/rateLimit.ts - the actual Postgres-backed implementation, not a
// fallback or a copy, since it's backed by the same database everywhere
// (local dev and production alike). Cleans up the rows it creates
// afterward so it doesn't leave test keys sitting in the real table.
import { PrismaClient } from "@prisma/client";
import { withinRateLimit } from "../src/lib/rateLimit";
import { parseClientAddress, parseTrustedProxyHops, type AddressInput } from "../src/lib/clientAddress";
import { allowExport, allowLoginAttempt, allowResetAttempt, isPublicDemoEmail } from "../src/lib/authLimits";

const prisma = new PrismaClient();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`OK: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const testKeyPrefix = `test-rate-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const key = `${testKeyPrefix}-main`;

  try {
    for (let i = 1; i <= 3; i++) {
      assert(await withinRateLimit(key, 3, 60_000), `Call ${i} of 3 within the limit is allowed`);
    }
    assert(!(await withinRateLimit(key, 3, 60_000)), "The 4th call, over the limit, is correctly blocked");
    assert(!(await withinRateLimit(key, 3, 60_000)), "A further call while still blocked stays blocked, not reset by the check itself");

    const otherKey = `${testKeyPrefix}-other`;
    assert(await withinRateLimit(otherKey, 3, 60_000), "A different key has its own independent count, unaffected by the first key being exhausted");

    // 500ms, not 50ms - each call is a real network round-trip to Postgres,
    // and a tight window is fragile against real latency variance (a CI
    // runner in a different region than the database can add tens of
    // milliseconds on its own) - this isn't testing precise timing, just
    // that a short window eventually expires, so generous margin costs
    // nothing.
    const shortWindowKey = `${testKeyPrefix}-short-window`;
    assert(await withinRateLimit(shortWindowKey, 1, 500), "First call against a 1-request, 500ms window is allowed");
    assert(!(await withinRateLimit(shortWindowKey, 1, 500)), "A second immediate call against that same short window is blocked");
    await sleep(600);
    assert(await withinRateLimit(shortWindowKey, 1, 500), "After the window elapses, the same key is allowed again - it doesn't stay blocked forever");

    const concurrentKey = `${testKeyPrefix}-concurrent`;
    const results = await Promise.all(Array.from({ length: 5 }, () => withinRateLimit(concurrentKey, 3, 60_000)));
    const allowedCount = results.filter(Boolean).length;
    assert(
      allowedCount === 3,
      `Exactly 3 of 5 truly concurrent calls against a limit of 3 are allowed (got ${allowedCount}) - the atomic upsert prevents a race from over-counting`
    );

    // ============ the visitor's address, from request headers (pure) ============
    const addr = (o: Partial<AddressInput>) =>
      parseClientAddress({ onVercel: false, vercelForwardedFor: null, forwardedFor: null, realIp: null, trustedProxyHops: 1, ...o });
    assert(addr({ onVercel: true, vercelForwardedFor: "203.0.113.7" }) === "203.0.113.7", "On Vercel the address comes from x-vercel-forwarded-for");
    assert(addr({ onVercel: true, vercelForwardedFor: "203.0.113.7, 10.0.0.1" }) === "203.0.113.7", "On Vercel the first entry of that header is used");
    assert(addr({ onVercel: true, vercelForwardedFor: "203.0.113.7", forwardedFor: "6.6.6.6" }) === "203.0.113.7", "On Vercel a spoofed x-forwarded-for is ignored while Vercel's own header is present");
    assert(addr({ onVercel: true, forwardedFor: "203.0.113.9, 10.0.0.1" }) === "203.0.113.9", "On Vercel without its own header the first x-forwarded-for entry is used");
    assert(addr({ onVercel: true, realIp: "203.0.113.10" }) === "203.0.113.10", "On Vercel x-real-ip is the last fallback");
    assert(addr({ onVercel: true, vercelForwardedFor: "<script>", forwardedFor: "also bad" }) === "unknown", "On Vercel junk in every header gives unknown, never a junk bucket key");
    assert(addr({ onVercel: true }) === "unknown", "On Vercel with no header the answer is unknown");
    assert(addr({ forwardedFor: "6.6.6.6, 203.0.113.7" }) === "203.0.113.7", "Off Vercel with one trusted proxy, a spoofed first entry is ignored and the entry the proxy added is used");
    assert(addr({ forwardedFor: "203.0.113.7" }) === "203.0.113.7", "A single entry is used");
    assert(addr({ forwardedFor: "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7" }) === "203.0.113.7", "A visitor adding many fake entries cannot move the answer");
    assert(addr({ forwardedFor: "6.6.6.6, 203.0.113.7, 10.0.0.1", trustedProxyHops: 2 }) === "203.0.113.7", "With two trusted proxies the second entry from the right is used");
    assert(addr({ forwardedFor: "6.6.6.6, 203.0.113.7", trustedProxyHops: 2 }) === "6.6.6.6", "With two trusted proxies and two entries, the leftmost is the one our chain wrote");
    assert(addr({ forwardedFor: "203.0.113.7", trustedProxyHops: 2 }) === "unknown", "Fewer entries than trusted proxies means the header did not come from our chain: unknown");
    assert(addr({ forwardedFor: "6.6.6.6, 203.0.113.7", trustedProxyHops: 0 }) === "unknown", "Zero trusted proxies ignores the header entirely");
    assert(addr({}) === "unknown" && addr({ forwardedFor: "" }) === "unknown" && addr({ forwardedFor: " , ," }) === "unknown", "A missing or empty header gives unknown");
    assert(addr({ realIp: "203.0.113.7" }) === "unknown", "Off Vercel x-real-ip is not trusted, because a visitor can write it");
    assert(addr({ forwardedFor: "  203.0.113.7  " }) === "203.0.113.7", "Whitespace around an address is ignored");
    assert(addr({ forwardedFor: "2001:db8::1" }) === "2001:db8::1", "An IPv6 address is accepted");
    assert(addr({ forwardedFor: "2001:DB8::A" }) === "2001:db8::a", "IPv6 is lower-cased so one address is always one bucket");
    assert(addr({ forwardedFor: "[2001:db8::1]:443" }) === "2001:db8::1", "A bracketed IPv6 address with a port is cleaned");
    assert(addr({ forwardedFor: "203.0.113.7:51234" }) === "203.0.113.7", "An IPv4 address with a port is cleaned");
    assert(addr({ forwardedFor: "::ffff:203.0.113.7" }) === "::ffff:203.0.113.7", "An IPv4-mapped IPv6 address is accepted");
    assert(addr({ forwardedFor: "2001:0db8:0000:0000:0000:ff00:0042:8329" }) === "2001:0db8:0000:0000:0000:ff00:0042:8329", "A full eight-group IPv6 address is accepted");
    for (const junk of ["<script>alert(1)</script>", "x".repeat(300), "999.1.1.1", "1.2.3", "1.2.3.4.5", "1::2::3", ":::", "a:b", "deadbeef", "203.0.113.7;DROP TABLE", "' OR 1=1"]) {
      assert(addr({ forwardedFor: junk }) === "unknown", `The junk entry ${JSON.stringify(junk.slice(0, 24))} gives unknown, never a bucket key`);
    }
    assert(parseTrustedProxyHops(undefined) === 1 && parseTrustedProxyHops("") === 1 && parseTrustedProxyHops("abc") === 1 && parseTrustedProxyHops("-1") === 1 && parseTrustedProxyHops("1.5") === 1, "TRUSTED_PROXY_HOPS missing or malformed means the default of 1");
    assert(parseTrustedProxyHops("0") === 0 && parseTrustedProxyHops("2") === 2 && parseTrustedProxyHops(" 3 ") === 3 && parseTrustedProxyHops("99") === 10 && parseTrustedProxyHops("100") === 1, "TRUSTED_PROXY_HOPS reads whole numbers and caps them at 10");

    // ============ login limits: order, per email AND address, the public demo ============
    const run = testKeyPrefix;
    const ipOf = (n: number | string) => `${run}-ip${n}`;
    const emailOf = (n: number | string) => `${run}-user${n}@example.test`;
    const small = { perAddress: 5, perEmailAndAddress: 3, perEmailCeiling: 6, windowMs: 60_000 };
    const login = (email: string, ip: string, demo: boolean | (() => Promise<boolean>) = false) => allowLoginAttempt({ email, ip, isPublicDemo: demo }, small);
    const bucketExists = async (key: string) => (await prisma.rateLimitBucket.count({ where: { key } })) > 0;

    for (let i = 1; i <= 3; i++) assert(await login(emailOf("a"), ipOf("a")), `Login attempt ${i} of 3 for one email from one address is allowed`);
    assert(!(await login(emailOf("a"), ipOf("a"))), "The 4th attempt for that email from that address is refused");
    assert(await login(emailOf("a"), ipOf("b")), "The same email from a DIFFERENT address is still allowed: one visitor's failures no longer lock everyone else out");

    for (let i = 1; i <= 6; i++) assert(await login(emailOf("spread"), ipOf(`s${i}`)), `Spread-out guess ${i} of 6 at one email from a fresh address is allowed`);
    assert(!(await login(emailOf("spread"), ipOf("s7"))), "The 7th guess at one email, even from yet another address, hits the per-email ceiling");

    // the public demo account: the address limit only
    for (let n = 1; n <= 20; n++) {
      if (!(await login(emailOf("demo"), ipOf(`d${n}`), true))) throw new Error(`FAILED: demo visitor ${n} from their own address was refused`);
    }
    console.log("OK: Twenty different visitors can all log in to the public demo account: no shared lockout");
    for (let i = 1; i <= 5; i++) assert(await login(emailOf("demo"), ipOf("dd"), true), `Demo login ${i} of 5 from one address is allowed`);
    assert(!(await login(emailOf("demo"), ipOf("dd"), true)), "The public demo account is still limited per address, so one address cannot hammer it");

    // address first: a blocked address never reaches the email buckets
    for (let i = 1; i <= 5; i++) assert(await login(emailOf(`flood${i}`), ipOf("flood")), `Flood attempt ${i} (a different random email each time) is allowed under the address limit`);
    let touched = 0;
    for (let i = 6; i <= 12; i++) {
      const allowed = await login(emailOf(`flood${i}`), ipOf("flood"), async () => {
        touched++;
        return false;
      });
      assert(!allowed, `Flood attempt ${i} from the blocked address is refused`);
    }
    assert(touched === 0, "A blocked address never even triggers the demo-account lookup");
    let leaked = 0;
    for (let i = 6; i <= 12; i++) {
      if ((await bucketExists(`login:${emailOf(`flood${i}`)}:${ipOf("flood")}`)) || (await bucketExists(`login-all:${emailOf(`flood${i}`)}`))) leaked++;
    }
    assert(leaked === 0, "No per-email rows were written for any attempt from the blocked address, so a flood of random emails cannot grow the table");
    assert(await bucketExists(`login:${emailOf("flood1")}:${ipOf("flood")}`), "...while the attempts made before the block did record their per-email rows (sanity check)");

    let lookups = 0;
    assert(await login(emailOf("lazy"), ipOf("lazy"), async () => (lookups++, false)), "The demo-account lookup is a function that runs only once the address check passes");
    assert(lookups === 1, "...and it ran exactly once");

    // ============ password reset: same shape, its own keys and limits ============
    const resetSmall = { perAddress: 4, perEmailAndAddress: 2, perEmailCeiling: 3, windowMs: 60_000 };
    const reset = (email: string, ip: string, demo: boolean = false) => allowResetAttempt({ email, ip, isPublicDemo: demo }, resetSmall);
    assert(await reset(emailOf("r"), ipOf("r")) && await reset(emailOf("r"), ipOf("r")), "Two reset attempts for one email from one address are allowed");
    assert(!(await reset(emailOf("r"), ipOf("r"))), "The 3rd reset attempt for that email from that address is refused");
    assert(await reset(emailOf("r"), ipOf("r2")), "The same email from a different address is allowed");
    assert(!(await reset(emailOf("r"), ipOf("r3"))), "...until the per-email ceiling across all addresses is reached");
    for (let i = 1; i <= 4; i++) assert(await reset(emailOf(`rf${i}`), ipOf("rf")), `Reset flood attempt ${i} under the address limit is allowed`);
    assert(!(await reset(emailOf("rf5"), ipOf("rf"))), "The 5th reset attempt from one address is refused");
    assert(!(await bucketExists(`reset:${emailOf("rf5")}:${ipOf("rf")}`)) && !(await bucketExists(`reset-all:${emailOf("rf5")}`)), "A blocked reset address writes no per-email rows");
    assert(await bucketExists(`reset-ip:${ipOf("rf")}`) && !(await bucketExists(`login-ip:${ipOf("rf")}`)), "Reset and login use separate buckets");

    // ============ exports: each visit has its own allowance ============
    const exportLimits = { perSession: 3, perWorkspace: 5, windowMs: 60_000 };
    const ws = `${run}-ws`;
    for (let i = 1; i <= 3; i++) assert(await allowExport(`${run}-sessA`, ws, exportLimits), `Export ${i} of 3 in one visit is allowed`);
    assert(!(await allowExport(`${run}-sessA`, ws, exportLimits)), "The 4th export in that visit is refused");
    assert(await allowExport(`${run}-sessB`, ws, exportLimits), "A different visit to the same workspace (another demo visitor) still has its own allowance");
    assert(await allowExport(`${run}-sessB`, ws, exportLimits), "...for its second export as well");
    assert(!(await allowExport(`${run}-sessB`, ws, exportLimits)), "The workspace backstop stops many visits adding up to more than it allows");
    assert(await allowExport(null, `${run}-ws2`, exportLimits), "With no session id the workspace allowance alone applies");

    // ============ is this email the public demo account? (reads the real demo user, writes nothing) ============
    const demoUser = await prisma.user.findFirst({ where: { workspace: { isDemoSeed: true } }, select: { email: true } });
    const savedSelfHosted = process.env.SELF_HOSTED;
    delete process.env.SELF_HOSTED;
    assert(demoUser !== null && (await isPublicDemoEmail(demoUser.email)), "The demo account's email is recognised as the public demo account");
    assert(!(await isPublicDemoEmail(emailOf("nobody"))), "An unknown email is not the demo account");
    process.env.SELF_HOSTED = "true";
    assert(demoUser !== null && !(await isPublicDemoEmail(demoUser.email)), "On a self-hosted copy the demo account gets ordinary limits");
    if (savedSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = savedSelfHosted;

    console.log("\nAll rate-limit checks passed.");
  } finally {
    // Every key this test creates contains its own unique run id, so this only
    // ever removes this run's rows, never another test's or a real visitor's.
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: testKeyPrefix } } });
  }
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
