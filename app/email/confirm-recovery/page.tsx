import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your recovery email · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The link in a recovery email's confirmation (lib/account-recovery.ts). A button, not a confirmation on opening, so a
 * mail scanner that opens links confirms nothing. Not behind the 18+ gate (middleware.ts lets /email/ through).
 */
export default async function ConfirmRecoveryPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const token = typeof p.t === "string" ? p.t : null;
  return (
    <article className="legal-page">
      <h1>Your recovery email</h1>
      {p.done ? (
        <p className="notice" role="status">
          Done. If you ever forget your password, use Forgot your password? under Sign in, and the link comes here.
        </p>
      ) : p.taken ? (
        <p className="notice">
          That address is on another Botchelor account, so it can&apos;t be this one&apos;s too. Add a different one on your{" "}
          <Link href="/account#password">account page</Link>.
        </p>
      ) : p.invalid || !token ? (
        <p className="notice">
          That link doesn&apos;t work any more: they last two days. Add the address again on your <Link href="/account#password">account page</Link>.
        </p>
      ) : (
        <form method="post" action={`/api/auth/recovery/confirm?t=${encodeURIComponent(token)}`}>
          <p>Use this address to reset your Botchelor password, if you ever forget it?</p>
          <button type="submit" className="primary">
            Yes, use this address
          </button>
        </form>
      )}
    </article>
  );
}
