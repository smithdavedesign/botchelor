import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found · Botchelor" };

/**
 * Every 404: a wrong address, or a page that called notFound() (a character, date or couple that's private or gone).
 * Inside the site's layout, so the nav is there (2026-10-31 UX audit: it was Next's bare white page, no way back).
 */
export default function NotFound() {
  return (
    <article className="not-found">
      <p className="kicker">404</p>
      <h1>This page isn&apos;t on the show</h1>
      <p className="muted">The link may be old, or what it pointed to is private or gone.</p>
      <p className="cta-row">
        <Link className="button" href="/">
          Back to the show
        </Link>
        <Link className="button secondary" href="/characters">
          See the characters
        </Link>
      </p>
    </article>
  );
}
