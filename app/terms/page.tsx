import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_HEADING, Contact, LAST_UPDATED, OnThisPage, TERMS_HEADINGS, TermsSections } from "../legal/sections";

export const metadata: Metadata = { title: "Terms · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** Terms of use and sale, with the refund policy. */
export default function TermsPage() {
  return (
    <article className="legal-page">
      <h1>Terms</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <OnThisPage headings={[...TERMS_HEADINGS, CONTACT_HEADING]} />
      <TermsSections />
      <Contact />
      <p>
        See also the <Link href="/privacy">privacy notice</Link>. <Link href="/">Back to the show</Link>
      </p>
    </article>
  );
}
