import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_ROUTES, mailto, socialLinks } from "@/lib/company";
import { contactEmail, OPERATOR_FULL, REPORT_RESPONSE } from "@/lib/legal-entity";
import { pageMetadata } from "@/lib/seo";
import { FeedbackLink } from "../FeedbackDock";
import SocialLinks from "../SocialLinks";

export const metadata: Metadata = pageMetadata({
  title: "Contact · Botchelor",
  description:
    "How to reach the people behind Botchelor: the support address, where reports, refunds, privacy requests, press and security questions go, and the show's accounts on X, Bluesky and Discord.",
  path: "/contact",
});
// Per request, so a CONTACT_EMAIL or DISCORD_INVITE_URL set after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/**
 * Contact (2026-11-10, lib/company.ts): one support inbox, and for each kind of question the page that answers it
 * faster than an email would. No postal address yet: there's no business address (lib/legal-entity.ts).
 */
export default function ContactPage() {
  const email = contactEmail();
  return (
    <article className="legal-page company-page">
      <h1>Contact</h1>
      <p className="lede">
        One inbox, read by the person who makes Botchelor. Write about anything: a problem, a question, an idea.
      </p>
      {email ? (
        <p>
          <a className="contact-email" href={`mailto:${email}`} data-track="contact-email">
            {email}
          </a>
        </p>
      ) : (
        <p>Our email address is on its way. Until then, the feedback button at the foot of every page reaches us.</p>
      )}
      <p className="muted">
        We aim to act on reports within {REPORT_RESPONSE.standard}, and within {REPORT_RESPONSE.urgent} for anything that
        may involve a minor, a real person or an intimate image of you. A person reads every one.
      </p>
      <p className="muted">
        Or skip the email: <FeedbackLink /> from any page.
      </p>

      <section aria-labelledby="where">
        <h2 id="where">Where to go</h2>
        <ul className="contact-routes">
          {CONTACT_ROUTES.map((r) => {
            const mail = r.subject ? mailto(r.subject) : null;
            return (
              <li key={r.id} id={r.id}>
                <strong>{r.what}</strong>
                <span>
                  {r.href ? <Link href={r.href}>{r.how}</Link> : r.how}
                  {mail && (
                    <>
                      {" "}
                      <a href={mail} className="muted">
                        Email us about it
                      </a>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="follow">
        <h2 id="follow">Follow the show</h2>
        <p>New dates, Sunday&apos;s reveal and the board, where you already are.</p>
        <SocialLinks links={socialLinks()} labels area="contact" />
      </section>

      <section aria-labelledby="who">
        <h2 id="who">Who you&apos;re writing to</h2>
        <p>
          Botchelor is run by {OPERATOR_FULL}. How it&apos;s made is on <Link href="/about">How it&apos;s built</Link>,
          and what it costs to run is on <Link href="/costs">What it costs</Link>.
        </p>
      </section>
    </article>
  );
}
