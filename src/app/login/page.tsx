import Link from "next/link";
import Logo from "@/components/Logo";
import { login } from "./actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Enter both an email and a password.",
  invalid: "Invalid email or password.",
  rate_limited: "Too many attempts - wait a few minutes and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo height="1.3em" />
        </div>
        <h1 className="text-lg font-medium text-zinc-900 mb-1">Log in</h1>
        <p className="text-xs text-zinc-400 mb-5">
          Demo login: <code>priya.chandra@meridian-ops.example</code> / <code>demo-password-123</code> - see README.md.
        </p>

        {error && (
          <p className="mb-4 text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2">
            {ERROR_MESSAGES[error] ?? "Something went wrong - try again."}
          </p>
        )}

        <form action={login} className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Email</label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Password</label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
          <button type="submit" className="w-full rounded-lg bg-zinc-900 text-white text-sm px-3 py-2">
            Log in
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-400 text-center">
          No account? <Link href="/signup" className="underline">Sign up</Link> - creates a real, isolated new
          workspace.
        </p>
      </div>
    </div>
  );
}
