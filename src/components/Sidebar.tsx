"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Logo from "./Logo";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/health", label: "Health" },
  { href: "/briefing", label: "Briefing" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/adoption", label: "Adoption" },
  { href: "/expansion", label: "Expansion" },
  { href: "/renewal", label: "Renewal" },
  { href: "/segments", label: "Segments" },
];

const FOOTER_ITEMS = [
  { href: "/calibration", label: "Calibration" },
  { href: "/data", label: "Data" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function navLinkClass(active: boolean) {
  return `rounded-lg px-2.5 py-2 text-sm transition-colors ${
    active ? "bg-[#0C447C]/8 text-[#0C447C] font-medium" : "text-zinc-600 hover:bg-zinc-100"
  }`;
}

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const segment = searchParams.get("segment");
  const suffix = segment ? `?segment=${segment}` : "";

  return (
    <div className="w-full md:w-52 md:shrink-0 bg-white border-b md:border-b-0 md:border-r border-zinc-200 p-3 flex flex-col">
      <div className="px-2 pb-3 md:pb-5 pt-1 text-lg text-[#0C447C]">
        <Logo height="1.5em" />
      </div>
      <nav className="flex flex-row md:flex-col gap-0.5 overflow-x-auto md:overflow-visible whitespace-nowrap">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            className={navLinkClass(isActive(pathname ?? "", item.href))}
          >
            {item.label}
          </Link>
        ))}
        <div className="my-2 h-px bg-zinc-200 hidden md:block" />
        {FOOTER_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={navLinkClass(isActive(pathname ?? "", item.href))}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
