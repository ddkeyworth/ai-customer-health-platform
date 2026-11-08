import Link from "next/link";
import Logo from "@/components/Logo";
import { signup } from "./actions";
import { isSelfHosted, signupMode } from "@/lib/deployment";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Fill in every field.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Password must be between 8 and 128 characters.",
  email_taken: "An account with that email already exists.",
  rate_limited: "Too many attempts - wait a while and try again.",
  signup_closed: "Signup is closed on this site.",
  server_misconfigured: "This site is not set up correctly (its encryption key is missing or invalid), so signup is unavailable. Tell the person who runs it.",
  site_full: "This demonstration site is full. Run your own copy to use Bearing (see the README on GitHub).",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const { error, deleted } = await searchParams;
  // The same rule the sign-up action enforces on the server (src/lib/deployment.ts).
  const mode = signupMode();
  const closed = mode === "closed" || (mode === "first_account_only" && (await prisma.user.count()) > 0);
  const firstAccount = mode === "first_account_only" && !closed;

  const headline = closed
    ? isSelfHosted()
      ? "Signup is closed on this copy."
      : "This is a demo. Nothing you do here is saved."
    : firstAccount
      ? "Create the first account."
      : "Create a workspace.";

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      <div className="hidden md:flex flex-col justify-between bg-[#0C447C] text-white p-12 lg:p-16">
        <Logo height="3em" className="text-white" />
        <p className="text-2xl font-medium leading-snug max-w-md">{headline}</p>
        {!isSelfHosted() ? <p className="text-xs text-blue-100/60">Demonstration site. Sample data only.</p> : <span />}
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center md:hidden">
            <Logo height="2em" className="text-[#0C447C]" />
          </div>

          <h1 className="text-xl font-medium text-zinc-900 mb-1">Sign up</h1>
          {deleted && (
            <p className="mb-3 text-xs text-green-800 bg-green-50 rounded-lg px-3 py-2">Your workspace and all its data were deleted.</p>
          )}
          {closed && (
            <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
              {isSelfHosted() ? (
                <p>Signup is closed on this copy. Ask the person who runs it for an account.</p>
              ) : (
                <>
                  <p>
                    This is a demonstration site and nothing is saved here. To use Bearing with your own data, run your
                    own copy on your own hosting and database:{" "}
                    <a
                      href="https://github.com/ddkeyworth/ai-customer-health-platform"
                      className="text-[#378ADD] hover:underline"
                    >
                      github.com/ddkeyworth/ai-customer-health-platform
                    </a>
                    .
                  </p>
                  <p className="mt-2">
                    To look around, use the demo login on the <Link href="/login" className="text-[#378ADD] hover:underline">log in</Link> page.
                  </p>
                </>
              )}
            </div>
          )}
          {firstAccount && (
            <p className="text-xs text-zinc-700 mb-3 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
              This is the first account on this copy, so it becomes the admin. Signup then closes by default (set
              ALLOW_SIGNUP=true to keep it open).
            </p>
          )}
          {!closed && !isSelfHosted() && (
            <p className="text-xs text-amber-900 mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This is a public demonstration site. Use sample or anonymised data only. To use Bearing with your own real
              data, run your own copy on your own hosting (see the README on GitHub).
            </p>
          )}
          {!closed && (
            <>
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
                  <label htmlFor="f-name-1" className="block text-xs font-medium text-zinc-600 mb-1">Your name</label>
                  <input id="f-name-1"
                    name="name"
                    required
                    maxLength={80}
                    className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="f-workspaceName-1" className="block text-xs font-medium text-zinc-600 mb-1">Workspace name</label>
                  <input id="f-workspaceName-1"
                    name="workspaceName"
                    required
                    maxLength={80}
                    placeholder="Your company name"
                    className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="f-email-1" className="block text-xs font-medium text-zinc-600 mb-1">Email</label>
                  <input id="f-email-1"
                    type="email"
                    name="email"
                    required
                    autoComplete="email"
                    className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="f-password-1" className="block text-xs font-medium text-zinc-600 mb-1">Password</label>
                  <input id="f-password-1"
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
            </>
          )}

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
