// The rate-limit rules for login, password reset and export, in one place so
// the order of the checks and the keys can be tested (prisma/test-rate-limit.ts)
// instead of living inside Server Actions.
//
// Two principles, each from an independent security review:
//
//  1. The visitor's ADDRESS is checked first. A flood of requests from one
//     address stops there and never reaches the per-email checks, so it cannot
//     add rows to the rate_limit_buckets table. (Expired rows are purged by the
//     daily cron.)
//
//  2. The per-email limit is keyed on email AND address. Keyed on email alone,
//     every visitor shares one allowance for a given email: anyone could lock a
//     real user out, and on the shared public demo login, whose email is printed
//     on the login page, ten visitors in fifteen minutes would lock EVERYONE
//     out. A separate, much higher per-email ceiling still stops guessing spread
//     over many addresses. The public demo account gets the address limit only.
import { prisma } from "@/lib/prisma";
import { withinRateLimit } from "@/lib/rateLimit";
import { demoLockEnabled } from "@/lib/demoGuard";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface AttemptLimits {
  perAddress: number;
  perEmailAndAddress: number;
  perEmailCeiling: number;
  windowMs: number;
}
export const LOGIN_LIMITS: AttemptLimits = { perAddress: 40, perEmailAndAddress: 10, perEmailCeiling: 100, windowMs: 15 * MINUTE };
export const RESET_LIMITS: AttemptLimits = { perAddress: 20, perEmailAndAddress: 5, perEmailCeiling: 30, windowMs: HOUR };

export interface ExportLimits {
  perSession: number;
  perWorkspace: number;
  windowMs: number;
}
export const EXPORT_LIMITS: ExportLimits = { perSession: 30, perWorkspace: 300, windowMs: HOUR };

// A true/false, or a function that works it out. Passing a function means the
// lookup only happens after the address check has passed.
type Lazy = boolean | (() => Promise<boolean>);
const resolve = (value: Lazy) => (typeof value === "function" ? value() : Promise.resolve(value));

// Is this email the public demo account (its login is printed on the login
// page, so a per-email lockout on it would only hurt visitors)? Only true while
// the demo lock is on; on a self-hosted copy the demo account gets normal limits.
export async function isPublicDemoEmail(email: string): Promise<boolean> {
  if (!demoLockEnabled()) return false;
  const user = await prisma.user.findUnique({ where: { email }, select: { workspace: { select: { isDemoSeed: true } } } });
  return user?.workspace.isDemoSeed === true;
}

async function allowAttempt(
  prefix: "login" | "reset",
  args: { email: string; ip: string; isPublicDemo: Lazy },
  limits: AttemptLimits
): Promise<boolean> {
  if (!(await withinRateLimit(`${prefix}-ip:${args.ip}`, limits.perAddress, limits.windowMs))) return false;
  if (await resolve(args.isPublicDemo)) return true;
  if (!(await withinRateLimit(`${prefix}:${args.email}:${args.ip}`, limits.perEmailAndAddress, limits.windowMs))) return false;
  return withinRateLimit(`${prefix}-all:${args.email}`, limits.perEmailCeiling, limits.windowMs);
}

export const allowLoginAttempt = (args: { email: string; ip: string; isPublicDemo: Lazy }, limits = LOGIN_LIMITS) =>
  allowAttempt("login", args, limits);

export const allowResetAttempt = (args: { email: string; ip: string; isPublicDemo: Lazy }, limits = RESET_LIMITS) =>
  allowAttempt("reset", args, limits);

// Exports: each visit (session) has its own allowance, so on the shared demo one
// visitor cannot use up everyone's downloads. The much higher per-workspace
// figure is a backstop against many sessions of one workspace.
export async function allowExport(sessionId: string | null, workspaceId: string, limits = EXPORT_LIMITS): Promise<boolean> {
  if (sessionId && !(await withinRateLimit(`export-session:${sessionId}`, limits.perSession, limits.windowMs))) return false;
  return withinRateLimit(`export:${workspaceId}`, limits.perWorkspace, limits.windowMs);
}
