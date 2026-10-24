import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_HEADING, Contact, LAST_UPDATED, OnThisPage, PolicyLinks, PRIVACY_CHANGES, PRIVACY_HEADINGS, PrivacySections, TERMS_HEADINGS, TermsSections } from "./sections";

export const metadata: Metadata = { title: "Terms, purchases and privacy · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** The terms and the privacy notice on one page (the M3 address); each also has its own page. */
export default function LegalPage() {
  return (
    <article className="legal-page">
      <h1>Terms, purchases and privacy</h1>
      <p className="muted">
        {LAST_UPDATED} {PRIVACY_CHANGES} Also as separate pages: <Link href="/terms">terms</Link> and <Link href="/privacy">privacy</Link>.
      </p>
      <OnThisPage headings={[...TERMS_HEADINGS, ...PRIVACY_HEADINGS, CONTACT_HEADING]} />
      <TermsSections />
      <PrivacySections />
      <Contact />
      <PolicyLinks />
    </article>
  );
}
