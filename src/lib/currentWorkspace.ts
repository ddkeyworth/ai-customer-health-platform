// Every page must scope its queries to a single workspace - never fetch
// "all customers" / "all opportunities" etc. across every workspace in
// the database. That's the fix this file exists for: a review found most
// pages had no workspaceId filter at all, which is invisible with a
// single seeded workspace but would silently blend multiple tenants'
// data together the moment a second one existed.
//
// Honest limitation: there's no auth/session system yet (see README.md
// Stage 2), so there's no way to know "which workspace does the current
// visitor belong to" - this picks the first workspace deterministically,
// which prevents cross-tenant data BLENDING (the worse failure mode) but
// does not yet correctly serve "the right workspace for this specific
// user." That requires real auth, still Stage 2's job. Every call site
// using this function should eventually be re-pointed at a session-derived
// workspace ID instead.

import { prisma } from "@/lib/prisma";

export async function getCurrentWorkspace() {
  return prisma.workspace.findFirstOrThrow();
}
