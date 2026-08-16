"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The internal dashboard chrome (Sidebar/TopBar) doesn't belong on the public
// marketing page - this switches shells by route rather than restructuring
// every existing page into a Next.js route group, which would be a much
// bigger change for the same outcome. Sidebar/TopBar are Server Components,
// passed in as children/props from the (server) root layout - a Client
// Component can render them as-is without needing to "convert" them.
export default function AppShell({
  sidebar,
  topbar,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isMarketing = pathname?.startsWith("/marketing");

  if (isMarketing) return <div className="w-full">{children}</div>;

  return (
    <>
      {sidebar}
      <div className="flex flex-1 flex-col min-w-0">
        {topbar}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </>
  );
}
