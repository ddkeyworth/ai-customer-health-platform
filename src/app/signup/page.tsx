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
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo height="1.3em" />
        </div>
        <h1 className="text-lg font-medium text-zinc-900 mb-1">Sign up</h1>
        <p className="text-xs text-zinc-400 mb-5">
          Creates a brand-new, empty, fully isolated workspace - not a login to the seeded demo data. See the demo
          login on the <Link href="/login" className="underline">log in</Link> page for that.
        </p>

        {error && (
          <p className="mb-4 text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2">
            {ERROR_MESSAGES[error] ?? "Something went wrong - try again."}
          </p>
        )}

        <form action={signup} className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Your name</label>
            <input name="name" required maxLength={80} className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Workspace name</label>
            <input
              name="workspaceName"
              required
              maxLength={80}
              placeholder="Your company name"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
          </div>
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
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-zinc-400">At least 8 characters.</p>
          </div>
          <button type="submit" className="w-full rounded-lg bg-zinc-900 text-white text-sm px-3 py-2">
            Create workspace
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-400 text-center">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
