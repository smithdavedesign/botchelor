"use client";

import Link from "next/link";

type Props = {
  /** What didn't load: "This page didn't load". */
  title: string;
  /** Next's retry (an error boundary's prop): fetches the page afresh and renders it again. */
  retry: () => void;
  /** Where the way back goes: the show, or After Dark's own home. */
  home?: { href: string; label: string };
};

/**
 * What a page shows when it fails to render (each error.tsx): a way to try again and a way back, laid out like the 404
 * (app/not-found.tsx) and inside the site's layout, so the nav stays. Never the error's message: in production Next
 * strips it, and in development it can carry what a visitor shouldn't see.
 */
export default function PageError({ title, retry, home = { href: "/", label: "Back to the show" } }: Props) {
  return (
    <article className="not-found">
      <p className="kicker">Something went wrong</p>
      <h1>{title}</h1>
      <p className="muted">It&apos;s on our side, not anything you did. Trying again usually works.</p>
      <p className="cta-row">
        <button type="button" className="button" onClick={() => retry()}>
          Try again
        </button>
        <Link className="button secondary" href={home.href}>
          {home.label}
        </Link>
      </p>
    </article>
  );
}
