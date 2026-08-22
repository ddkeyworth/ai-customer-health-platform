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
    <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 rounded bg-zinc-300" aria-hidden />
        <span className="text-sm text-zinc-600">{workspace.name} workspace</span>
        <SegmentSelector segments={segments} />
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span>{today}</span>
        <span>{workspace.language === "en-GB" ? "EN-UK" : workspace.language}</span>
        <span className="text-zinc-600">{user.name}</span>
        <div className="h-6 w-6 rounded-full bg-blue-50 text-[10px] font-medium text-blue-800 flex items-center justify-center">
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
