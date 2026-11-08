import Link from "next/link";
import Logo from "@/components/Logo";
import { resetPassword } from "./actions";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Fill in every field.",
  mismatch: "The two new passwords do not match.",
  weak: "The new password must be between 8 and 128 characters.",
  invalid: "That email and recovery key do not match an account. Check them and try again.",
  rate_limited: "Too many attempts - wait a while and try again.",
};

const INPUT =
  "w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#378ADD] focus:border-transparent";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo height="1.3em" className="text-[#0C447C]" />
        </div>
        <h1 className="text-xl font-medium text-zinc-900 mb-1">Reset your password</h1>
        <p className="text-xs text-zinc-500 mb-5 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
          Bearing sends no email, so a forgotten password is reset with the recovery key that was shown when you signed
          up (or that you generated later under Settings, Security). If you have no recovery key, the person who runs
          your copy of Bearing can reset it for you, and the shared demo account cannot be reset at all.
        </p>

        {error && (
          <p role="alert" className="mb-4 text-xs text-red-800 bg-red-50 rounded-lg px-3 py-2">
            {ERROR_MESSAGES[error] ?? "Something went wrong - try again."}
          </p>
        )}

        <form action={resetPassword} className="space-y-3">
          <div>
            <label htmlFor="fp-email" className="block text-xs font-medium text-zinc-600 mb-1">Email</label>
            <input id="fp-email" type="email" name="email" required autoComplete="email" maxLength={254} className={INPUT} />
          </div>
          <div>
            <label htmlFor="fp-key" className="block text-xs font-medium text-zinc-600 mb-1">Recovery key</label>
            <input
              id="fp-key"
              name="key"
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              className={`${INPUT} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="fp-password" className="block text-xs font-medium text-zinc-600 mb-1">New password</label>
            <input id="fp-password" type="password" name="password" required minLength={8} maxLength={128} autoComplete="new-password" className={INPUT} />
            <p className="mt-1 text-[11px] text-zinc-500">8 to 128 characters.</p>
          </div>
          <div>
            <label htmlFor="fp-confirm" className="block text-xs font-medium text-zinc-600 mb-1">Confirm new password</label>
            <input id="fp-confirm" type="password" name="confirm" required minLength={8} maxLength={128} autoComplete="new-password" className={INPUT} />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm font-medium px-3 py-2"
          >
            Reset password
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-500 text-center">
          <Link href="/login" className="text-[#378ADD] hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
