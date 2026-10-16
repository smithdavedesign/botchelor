import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The unsubscribe link in every email (lib/email.ts). A button, not an automatic unsubscribe on opening, so mail
 * scanners that open links can't unsubscribe anyone by accident. Mail apps' own unsubscribe button skips this page.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const token = typeof p.t === "string" ? p.t : null;
  return (
    <>
      <h1>Email notifications</h1>
      {p.done ? (
        <p className="notice">You&apos;re unsubscribed: no more emails from Botchelor. You can turn them back on from your account.</p>
      ) : p.invalid || !token ? (
        <p className="notice">That link doesn&apos;t work any more. You can turn email off from your <Link href="/account">account</Link>.</p>
      ) : (
        <form method="post" action={`/api/email/optout?t=${encodeURIComponent(token)}`}>
          <p>Stop all emails from Botchelor to this address?</p>
          <button type="submit" className="primary">
            Unsubscribe
          </button>
        </form>
      )}
    </>
  );
}
