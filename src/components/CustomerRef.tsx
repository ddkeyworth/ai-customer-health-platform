// The short, human-readable customer ID (e.g. CUS-0042) shown next to a
// customer's name wherever it appears. inline-block keeps the parent link's
// hover underline off it.
export default function CustomerRef({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="ml-2 inline-block font-mono text-[11px] font-normal text-zinc-400 no-underline">{value}</span>;
}
