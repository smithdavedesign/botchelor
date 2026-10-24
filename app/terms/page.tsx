import type { Metadata } from "next";
import { CONTACT_HEADING, Contact, LAST_UPDATED, OnThisPage, PolicyLinks, TERMS_HEADINGS, TermsSections } from "../legal/sections";

export const metadata: Metadata = { title: "Terms · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** Terms of use and sale, with the refund and cancellation policy. */
export default function TermsPage() {
  return (
    <article className="legal-page">
      <h1>Terms</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <OnThisPage headings={[...TERMS_HEADINGS, CONTACT_HEADING]} />
      <TermsSections />
      <Contact />
      <PolicyLinks current="/terms" />
    </article>
  );
}
