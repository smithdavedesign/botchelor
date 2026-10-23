import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_HEADING, Contact, LAST_UPDATED, OnThisPage, PRIVACY_CHANGES, PRIVACY_HEADINGS, PrivacySections } from "../legal/sections";

export const metadata: Metadata = { title: "Privacy · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** What Botchelor stores and who processes it. */
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
      <p>
        See also the <Link href="/terms">terms and refund policy</Link>. <Link href="/">Back to the show</Link>
      </p>
    </article>
  );
}
