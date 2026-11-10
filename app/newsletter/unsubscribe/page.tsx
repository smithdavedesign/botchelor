import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe from the Sunday letter · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The unsubscribe link in every Sunday letter (lib/newsletter.ts). A button, not an unsubscribe on opening, so mail
 * scanners can't unsubscribe anyone by accident; mail apps' own unsubscribe button skips this page (RFC 8058). Not behind
 * the 18+ gate (middleware.ts): leaving must never take a hurdle.
 */
export default async function LeaveNewsletterPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const token = typeof p.t === "string" ? p.t : null;
  return (
    <article className="legal-page newsletter-page">
      <h1>The Sunday letter</h1>
      {p.done ? (
        <p className="notice">You&apos;re unsubscribed: no more letters to this address. You can sign up again any time.</p>
      ) : p.invalid || !token ? (
        <p className="notice">
          That link doesn&apos;t work. Use the unsubscribe link at the bottom of any letter, or{" "}
          <Link href="/privacy#contact">write to us</Link> and we&apos;ll take you off.
        </p>
      ) : (
        <form method="post" action={`/api/newsletter/optout?t=${encodeURIComponent(token)}`}>
          <p>Stop the Sunday letter to this address?</p>
          <button type="submit" className="primary">
            Unsubscribe
          </button>
        </form>
      )}
    </article>
  );
}
