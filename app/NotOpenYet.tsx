import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A feature that exists but isn't open to this viewer yet (mobile audit C21, 2026-11-20): say what it is and give a way
 * on, rather than the 404 "This page isn't on the show", which read as a broken link to someone who followed an upsell.
 * Keep notFound() where hiding the page is the point (After Dark to someone it isn't open to, app/after-dark/layout.tsx).
 */
export default function NotOpenYet({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <article className="not-found not-open-yet" data-not-open-yet>
      <p className="kicker">Not open yet</p>
      <h1>{title}</h1>
      <p className="muted">{children}</p>
      <p className="cta-row">
        {action}
        <Link className={action ? "button secondary" : "button"} href="/">
          Back to the show
        </Link>
      </p>
    </article>
  );
}
