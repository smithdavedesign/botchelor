import type { Metadata } from "next";
import { CONTACT_HEADING, Contact, LAST_UPDATED, OnThisPage, PolicyLinks, PRIVACY_CHANGES, PRIVACY_HEADINGS, PrivacySections } from "../legal/sections";

export const metadata: Metadata = { title: "Privacy · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** What Botchelor stores, why, who processes it, and your rights. */
export default function PrivacyPage() {
  return (
    <article className="legal-page">
      <h1>Privacy</h1>
      <p className="muted">
        {LAST_UPDATED} {PRIVACY_CHANGES}
      </p>
      <OnThisPage headings={[...PRIVACY_HEADINGS, CONTACT_HEADING]} />
      <PrivacySections />
      <Contact />
      <PolicyLinks current="/privacy" />
    </article>
  );
}
