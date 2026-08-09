import Link from "next/link";
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

export default function Sidebar() {
  return (
    <div className="w-48 shrink-0 bg-zinc-50 border-r border-zinc-200 p-3">
      <div className="px-2 pb-4 text-lg text-zinc-900">
        <Logo height="1em" />
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-2.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            {item.label}
          </Link>
        ))}
        <div className="my-2 h-px bg-zinc-200" />
        <Link
          href="/settings"
          className="rounded-lg px-2.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
        >
          Settings
        </Link>
      </nav>
    </div>
  );
}
