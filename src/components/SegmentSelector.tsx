"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function SegmentSelector({ segments }: { segments: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("segment") ?? "";

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("segment", value);
    else params.delete("segment");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  if (segments.length === 0) return null;

  return (
    <select
      value={active}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600"
    >
      <option value="">All accounts</option>
      {segments.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
