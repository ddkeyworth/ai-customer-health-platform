import { prisma } from "@/lib/prisma";

export default async function TopBar() {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const workspace = await prisma.workspace.findFirst();

  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-zinc-300" aria-hidden />
        <span className="text-sm text-zinc-600">
          {workspace ? `${workspace.name} workspace` : "No workspace seeded yet"}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span>{today}</span>
        <span>{workspace?.language === "en-GB" || !workspace ? "EN-UK" : workspace.language}</span>
        <div className="h-6 w-6 rounded-full bg-blue-50 text-[10px] font-medium text-blue-800 flex items-center justify-center">
          DK
        </div>
      </div>
    </div>
  );
}
