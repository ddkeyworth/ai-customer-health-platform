import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { readRecoveryKeyCookie } from "@/lib/recoveryKeyCookie";
import { acknowledgeRecoveryKey } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your recovery key", robots: { index: false, follow: false } };

// Shows a newly issued recovery key. It is read from a short-lived encrypted
// cookie, so there is nothing to show once the person has confirmed they saved
// it (or after five minutes), and then this page just goes to the home page
// (or the login page, after a reset, when nobody is signed in).
export default async function RecoveryKeyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const key = await readRecoveryKeyCookie();
  // No key to show (already confirmed, or it expired): not an error, just move on.
  if (!key) redirect(from === "reset" ? "/login?reset=1" : "/");

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Logo height="1.3em" className="text-[#0C447C]" />
        </div>
        <h1 className="text-xl font-medium text-zinc-900 mb-2">Save your recovery key</h1>
        <p className="text-sm text-zinc-600 mb-4">
          If you ever forget your password, this key is the only way back into your account, because Bearing sends no
          email. Copy it into a password manager or write it down somewhere safe, <strong>now</strong>. It will not be
          shown again, and only a scrambled copy is kept on the server.
        </p>
        <p
          className="mb-4 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-center font-mono text-lg tracking-wider text-zinc-900 select-all"
          aria-label="Your recovery key"
        >
          {key}
        </p>
        <p className="text-xs text-zinc-500 mb-5">
          Anyone who has this key and your email address can set a new password on your account, so keep it private.
          You can replace it at any time under Settings, Security, and the old one stops working.
        </p>
        <form action={acknowledgeRecoveryKey}>
          <input type="hidden" name="from" value={from ?? ""} />
          <button
            type="submit"
            className="w-full rounded-lg bg-[#0C447C] hover:bg-[#0a3a69] transition-colors text-white text-sm font-medium px-3 py-2"
          >
            I have saved it, continue
          </button>
        </form>
      </div>
    </div>
  );
}
