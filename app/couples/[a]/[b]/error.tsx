"use client";

import Link from "next/link";

/**
 * When a couple page can't load at all: its two characters or their record didn't read (the database pool busy, #1948).
 * A way to try again inside the site's layout, rather than Next's bare error page. The parts the page can do without
 * leave themselves out instead (page.tsx orElse).
 */
export default function CoupleError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <article className="not-found">
      <p className="kicker">Not just now</p>
      <h1>This couple didn&apos;t load</h1>
      <p className="muted">Something on our side was busy. Trying again usually works.</p>
      <p className="cta-row">
        <button type="button" className="button" onClick={() => retry()}>
          Try again
        </button>
        <Link className="button secondary" href="/">
          Back to the show
        </Link>
      </p>
    </article>
  );
}
