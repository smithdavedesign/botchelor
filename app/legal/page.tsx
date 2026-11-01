import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_HEADING, Contact, OnThisPageGrouped, PolicyLinks, PRIVACY_CHANGES, PRIVACY_HEADINGS, PrivacySections, TERMS_HEADINGS, TERMS_PRIVACY_UPDATED, TermsSections } from "./sections";

export const metadata: Metadata = pageMetadata({
  title: "Terms, purchases and privacy · Botchelor",
  description: "Botchelor's terms of use and sale and its privacy notice on one page: who it's for, what you can buy and the refund policy, what we store and why, and your rights.",
  path: "/legal",
});
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** The terms and the privacy notice on one page (the M3 address); each also has its own page. */
export default function LegalPage() {
  return (
    <article className="legal-page">
      <h1>Terms, purchases and privacy</h1>
      <p className="muted">
        {TERMS_PRIVACY_UPDATED} {PRIVACY_CHANGES} Also as separate pages: <Link href="/terms">terms</Link> and <Link href="/privacy">privacy</Link>.
      </p>
      <OnThisPageGrouped
        groups={[
          { title: "Terms and purchases", headings: TERMS_HEADINGS },
          { title: "Privacy", headings: PRIVACY_HEADINGS },
        ]}
        rest={[CONTACT_HEADING]}
      />
      <TermsSections />
      <PrivacySections />
      <Contact />
      <PolicyLinks />
    </article>
  );
}
