import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logout } from "@/app/logout/actions";
import SegmentSelector from "./SegmentSelector";

export default async function TopBar() {
  // getSessionUser() returns null rather than redirecting - this component
  // renders unconditionally from the root layout even on /login, /signup,
  // and /marketing (Server Components resolve eagerly regardless of what
  // AppShell chooses to display), so it must handle "not logged in"
  // gracefully rather than throwing or redirecting itself.
  const user = await getSessionUser();
  if (!user) return null;

  const workspace = user.workspace;
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const segments = await prisma.segment.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        <svg viewBox="-9 -38 18 76" width="14" height="14" aria-hidden>
          <polygon points="0,-38 9,0 0,38 -9,0" fill="#378ADD" />
        </svg>
        <span className="text-sm font-medium text-zinc-700">{workspace.name} workspace</span>
        <Suspense fallback={null}>
          <SegmentSelector segments={segments} />
        </Suspense>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>{today}</span>
        <span>{workspace.language === "en-GB" ? "EN-UK" : workspace.language}</span>
        <span className="text-zinc-700">{user.name}</span>
        <div className="h-6 w-6 rounded-full bg-[#0C447C]/10 text-[10px] font-medium text-[#0C447C] flex items-center justify-center">
          {initials || "U"}
        </div>
        <form action={logout}>
          <button type="submit" className="text-zinc-400 hover:text-zinc-700">
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
