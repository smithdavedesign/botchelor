import Link from "next/link";
import { newsletterOpen, newsletterState } from "@/lib/newsletter";
import NewsletterForm from "./NewsletterForm";
import NotOnNewsletterPages from "./NotOnNewsletterPages";

/**
 * The Sunday letter in the site footer (lib/newsletter.ts, docs/newsletter.md), only where it's open: email is set up
 * and this is the show's own host (app/layout.tsx leaves it out on After Dark's), and not on the letter's own pages
 * (app/NotOnNewsletterPages.tsx). No database: it's on every page. Until the first letter can go out (it waits for
 * NEWSLETTER_POSTAL_ADDRESS, lib/newsletter.ts), it says so instead of promising a weekly email (2026-11-22 audit).
 * Its link isn't prefetched, as none in the footer are (app/layout.tsx).
 */
export default function NewsletterSignup() {
  if (!newsletterOpen()) return null;
  const started = newsletterState() === "on";
  return (
    <NotOnNewsletterPages>
      <section className="footer-newsletter" aria-label="The Sunday letter">
        <p className="footer-newsletter-lede">
          {started ? (
            <>
              <strong>The Sunday letter.</strong> One email a week, after Sunday&apos;s reveal: whose secret came out, and the
              week&apos;s best dates.
            </>
          ) : (
            <>
              <strong>The Sunday letter.</strong> It hasn&apos;t started yet: sign up to get an email when it does, with whose
              secret came out and the week&apos;s best dates.
            </>
          )}{" "}
          <Link href="/newsletter" prefetch={false}>What&apos;s in it</Link>
        </p>
        <NewsletterForm place="footer" />
      </section>
    </NotOnNewsletterPages>
  );
}
