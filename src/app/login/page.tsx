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
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      <div className="hidden md:flex flex-col justify-between bg-[#0C447C] text-white p-12 lg:p-16">
        <Logo height="1.5em" className="text-white" />
        <div>
          <p className="text-2xl font-medium leading-snug max-w-md">
            No AI reads every account right. It gets you close enough, fast enough, to act.
          </p>
          <p className="mt-6 text-sm text-blue-100/80 tracking-wide uppercase">
            Health &middot; Onboarding &middot; Adoption &middot; Expansion &middot; Renewal
          </p>
        </div>
        <p className="text-xs text-blue-100/60">Conceptual portfolio piece - no real customer data, ever.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center md:hidden">
            <Logo height="1.3em" className="text-[#0C447C]" />
          </div>

          <h1 className="text-xl font-medium text-zinc-900 mb-1">Log in</h1>
          <p className="text-xs text-zinc-500 mb-5 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            Demo login: <code className="text-zinc-700">priya.chandra@meridian-ops.example</code> /{" "}
            <code className="text-zinc-700">demo-password-123</code> - see README.md.
          </p>

          {error && (
            <p className="mb-4 text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2">
              {ERROR_MESSAGES[error] ?? "Something went wrong - try again."}
            </p>
          )}

          <form action={login} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Email</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Password</label>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm font-medium px-3 py-2"
            >
              Log in
            </button>
          </form>

          <p className="mt-4 text-xs text-zinc-500 text-center">
            No account?{" "}
            <Link href="/signup" className="text-[#378ADD] hover:underline">
              Sign up
            </Link>{" "}
            - creates a real, isolated new workspace.
          </p>
        </div>
      </div>
    </div>
  );
}
