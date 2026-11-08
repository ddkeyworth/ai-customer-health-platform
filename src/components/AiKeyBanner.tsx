import Link from "next/link";

// Shown on every page that displays AI output, for a workspace that has no
// Anthropic key yet. The AI only ever runs on the workspace's own key, so
// this is where a new user finds out they need one. Not shown on the shared
// demo, whose AI is locked (see src/lib/demoGuard.ts).
export default function AiKeyBanner({ workspace }: { workspace: { isDemoSeed: boolean; anthropicApiKeyLast4: string | null } }) {
  if (workspace.isDemoSeed || workspace.anthropicApiKeyLast4) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#378ADD]/30 bg-[#378ADD]/5 px-3 py-2">
      <p className="text-sm text-zinc-700">Health scores work now without a key (free baseline). Add your own Anthropic API key to turn on the AI reads and recommendations. It never uses anyone else&apos;s key.</p>
      <Link href="/settings" className="rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm px-3 py-1.5">
        Add your key
      </Link>
    </div>
  );
}
