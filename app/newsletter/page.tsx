import type { Metadata } from "next";
import Link from "next/link";
import NewsletterForm from "../NewsletterForm";
import { newsletterState } from "@/lib/newsletter";
import { pageMetadata } from "@/lib/seo";

// Read per request: whether the letter is open depends on the server's settings, not the build's.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The Sunday letter · Botchelor",
  description:
    "One email a week from Botchelor, after Sunday's reveal: whose secret the audience voted out, the week's best blind dates and who called the endings right. Free, and one click to leave.",
  path: "/newsletter",
});

/** The Sunday letter (lib/newsletter.ts, docs/newsletter.md): what's in it, and the sign-up. */
export default function NewsletterPage() {
  const state = newsletterState();
  return (
    <article className="legal-page newsletter-page">
      <h1>The Sunday letter</h1>
      <p className="lede">One email a week, on Sunday evening once the reveal is out. Nothing else, and free.</p>
      <ul>
        <li>Whose secret the audience voted out, and the date that came of it.</li>
        <li>The week&apos;s best dates: the season cast&apos;s first, then the most called and watched.</li>
        <li>This week&apos;s best callers, by right endings.</li>
        <li>When the next vote opens.</li>
      </ul>
      {state === "off" ? (
        <p className="notice">The letter isn&apos;t open yet. Sunday&apos;s reveal is on <Link href="/watch">Watch</Link> in the meantime.</p>
      ) : (
        <section className="card newsletter-card" aria-label="Sign up">
          <NewsletterForm place="page" />
        </section>
      )}
      <p className="muted">
        We email you once to confirm, and the letter starts only when you click that link. Every letter has a one-click
        unsubscribe. We never share or sell your address: see <Link href="/privacy#newsletter">privacy</Link>.
      </p>
    </article>
  );
}
