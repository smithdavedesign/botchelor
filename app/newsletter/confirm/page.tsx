import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm the Sunday letter · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The link in the Sunday letter's confirmation email (lib/newsletter.ts). A button, not a confirmation on opening, so mail
 * scanners that open links can't sign anyone up. Not behind the 18+ gate (middleware.ts): the sign-up already asked.
 */
export default async function ConfirmNewsletterPage({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const token = typeof p.t === "string" ? p.t : null;
  return (
    <article className="legal-page newsletter-page">
      <h1>The Sunday letter</h1>
      {p.done ? (
        <p className="notice">
          You&apos;re on the list. The next letter comes on Sunday evening, after the reveal. Every one has a one-click
          unsubscribe at the bottom.
        </p>
      ) : p.invalid || !token ? (
        <p className="notice">
          That link doesn&apos;t work any more: they last a week. You can <Link href="/newsletter">sign up again</Link>.
        </p>
      ) : (
        <form method="post" action={`/api/newsletter/confirm?t=${encodeURIComponent(token)}`}>
          <p>Start the Sunday letter at this address? One email a week, after Sunday&apos;s reveal.</p>
          <button type="submit" className="primary">
            Yes, send me the letter
          </button>
        </form>
      )}
    </article>
  );
}
