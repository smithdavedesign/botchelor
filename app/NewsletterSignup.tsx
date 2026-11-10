import Link from "next/link";
import { newsletterOpen } from "@/lib/newsletter";
import NewsletterForm from "./NewsletterForm";
import NotOnNewsletterPages from "./NotOnNewsletterPages";

/**
 * The Sunday letter in the site footer (lib/newsletter.ts, docs/newsletter.md), only where it's open: email is set up
 * and this is the show's own host (app/layout.tsx leaves it out on After Dark's), and not on the letter's own pages
 * (app/NotOnNewsletterPages.tsx). No database: it's on every page.
 */
export default function NewsletterSignup() {
  if (!newsletterOpen()) return null;
  return (
    <NotOnNewsletterPages>
      <section className="footer-newsletter" aria-label="The Sunday letter">
        <p className="footer-newsletter-lede">
          <strong>The Sunday letter.</strong> One email a week, after Sunday&apos;s reveal: whose secret came out, and the
          week&apos;s best dates. <Link href="/newsletter">What&apos;s in it</Link>
        </p>
        <NewsletterForm place="footer" />
      </section>
    </NotOnNewsletterPages>
  );
}
