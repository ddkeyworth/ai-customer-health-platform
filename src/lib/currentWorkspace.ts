// Every page must scope its queries to a single workspace - never fetch
// "all customers" / "all opportunities" etc. across every workspace in
// the database. That's the fix this file originally existed for: a review
// found most pages had no workspaceId filter at all, which was invisible
// with a single seeded workspace but would silently blend multiple
// tenants' data together the moment a second one existed.
//
// Now backed by real auth: resolves the workspace from the logged-in
// user's session, not "the first workspace in the database" - the fix
// this file's own comment used to say was still needed. Redirects to
// /login if there's no valid session, so every caller gets a real
// workspace or the request never reaches the page body at all.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function getCurrentWorkspace() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return prisma.workspace.findUniqueOrThrow({ where: { id: user.workspaceId } });
}
