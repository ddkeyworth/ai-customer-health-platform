import Link from "next/link";
import Logo from "@/components/Logo";
import { signup } from "./actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Fill in every field.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Password must be at least 8 characters.",
  email_taken: "An account with that email already exists.",
  rate_limited: "Too many attempts - wait a while and try again.",
};

export default async function SignupPage({
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
            A brand-new, empty, fully isolated workspace - your own data, your own Anthropic key, nothing shared.
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

          <h1 className="text-xl font-medium text-zinc-900 mb-1">Sign up</h1>
          <p className="text-xs text-zinc-500 mb-5 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            Creates a brand-new, empty, fully isolated workspace - not a login to the seeded demo data. See the demo
            login on the <Link href="/login" className="text-[#378ADD] hover:underline">log in</Link> page for that.
          </p>

          {error && (
            <p className="mb-4 text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2">
              {ERROR_MESSAGES[error] ?? "Something went wrong - try again."}
            </p>
          )}

          <form action={signup} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Your name</label>
              <input
                name="name"
                required
                maxLength={80}
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Workspace name</label>
              <input
                name="workspaceName"
                required
                maxLength={80}
                placeholder="Your company name"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
            </div>
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
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
              />
              <p className="mt-1 text-[11px] text-zinc-500">At least 8 characters.</p>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm font-medium px-3 py-2"
            >
              Create workspace
            </button>
          </form>

          <p className="mt-4 text-xs text-zinc-500 text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-[#378ADD] hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
