// Works out the visitor's address from request headers, without trusting a
// header the visitor can write themselves. Pure (no Next.js, no environment
// reads), so every case is covered by prisma/test-rate-limit.ts.
//
// Why this matters: the sign-up, login and password-reset limits are keyed on
// the visitor's address. If a visitor can choose the address the server sees,
// they can start a fresh allowance on every request and the limits do nothing.
//
//  - On Vercel the platform sets x-vercel-forwarded-for itself (and overwrites
//    any value the visitor sent), so that header is the visitor's real address.
//    x-forwarded-for's first entry, then x-real-ip, are fallbacks there.
//  - Anywhere else (nginx, Docker on a raw port, Cloudflare in front, a laptop)
//    the first x-forwarded-for entry is whatever the visitor typed. Only the
//    entries the visitor's own proxies appended can be trusted, which are the
//    ones counted from the RIGHT. TRUSTED_PROXY_HOPS says how many proxies you
//    run in front of the app: the address is the entry that many from the right
//    (default 1: the last entry, written by your nearest proxy). 0 means "no
//    proxy I trust": ignore the header entirely, so every visitor shares one
//    bucket. That is stricter, never looser.
//  - If there is no usable header, the answer is "unknown", also one shared
//    bucket.
export interface AddressInput {
  onVercel: boolean;
  vercelForwardedFor: string | null;
  forwardedFor: string | null;
  realIp: string | null;
  trustedProxyHops: number;
}

export const UNKNOWN_ADDRESS = "unknown";
const DEFAULT_HOPS = 1;
const MAX_HOPS = 10;

// TRUSTED_PROXY_HOPS as written in the environment. Missing or malformed means
// the default; a number is clamped to 0..10.
export function parseTrustedProxyHops(value: string | undefined): number {
  if (value === undefined || !/^\d{1,2}$/.test(value.trim())) return DEFAULT_HOPS;
  return Math.min(MAX_HOPS, Number(value.trim()));
}

// One header entry to a clean address, or null if it is not a plausible one.
// Accepts IPv4 and IPv6 (including ::ffff:1.2.3.4), drops a trailing port and
// the brackets around an IPv6 address, lower-cases hex digits. Anything else
// (words, markup, very long strings) is refused rather than used as a key.
export function normaliseAddress(entry: string): string | null {
  let v = entry.trim();
  if (!v || v.length > 64) return null;
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/.exec(v);
  if (bracketed) v = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (v.length > 45 || !/^[0-9a-fA-F:.]+$/.test(v)) return null;
  return isIpv4(v) || isIpv6(v) ? v.toLowerCase() : null;
}

function isIpv4(v: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v) && v.split(".").every((o) => Number(o) <= 255);
}

// Full form (eight groups) or compressed with one "::", optionally ending in a
// dotted IPv4 address (::ffff:203.0.113.7). "a:b" and "1::2::3" are refused.
function isIpv6(v: string): boolean {
  if (!v.includes(":")) return false;
  const doubles = (v.match(/::/g) ?? []).length;
  if (doubles > 1 || /:::/.test(v)) return false;
  let tail = v;
  const last = v.slice(v.lastIndexOf(":") + 1);
  if (last.includes(".")) {
    if (!isIpv4(last)) return false;
    tail = v.slice(0, v.lastIndexOf(":") + 1) + "0:0"; // the IPv4 tail is two groups
  }
  const groups = tail.split(":");
  const filled = groups.filter((g) => g !== "");
  if (!filled.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return doubles === 1 ? filled.length <= 7 : groups.length === 8;
}

function entries(header: string | null): string[] {
  return (header ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

export function parseClientAddress(input: AddressInput): string {
  if (input.onVercel) {
    for (const header of [input.vercelForwardedFor, input.forwardedFor]) {
      const first = entries(header)[0];
      const address = first ? normaliseAddress(first) : null;
      if (address) return address;
    }
    return (input.realIp && normaliseAddress(input.realIp)) || UNKNOWN_ADDRESS;
  }

  const hops = Math.max(0, Math.floor(input.trustedProxyHops));
  if (hops === 0) return UNKNOWN_ADDRESS;
  const list = entries(input.forwardedFor);
  const index = list.length - hops;
  // Fewer entries than proxies we expect means the header was not written by
  // the chain we trust, so it cannot be used.
  if (index < 0) return UNKNOWN_ADDRESS;
  return normaliseAddress(list[index]) ?? UNKNOWN_ADDRESS;
}
