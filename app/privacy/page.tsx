import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_HEADING, Contact, OnThisPage, PolicyLinks, PRIVACY_CHANGES, PRIVACY_HEADINGS, PrivacySections, TERMS_PRIVACY_UPDATED } from "../legal/sections";

export const metadata: Metadata = pageMetadata({
  title: "Privacy · Botchelor",
  description:
    "What Botchelor stores and why, the cookies it sets, the three counts sent to our own dashboard (a visit, a first date, a Buy click), who processes your data, how long we keep it, and your rights.",
  path: "/privacy",
});
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** What Botchelor stores, why, who processes it, and your rights. */
export default function PrivacyPage() {
  return (
    <article className="legal-page">
      <h1>Privacy</h1>
      <p className="muted">
        {TERMS_PRIVACY_UPDATED} {PRIVACY_CHANGES}
      </p>
      <OnThisPage headings={[...PRIVACY_HEADINGS, CONTACT_HEADING]} />
      <PrivacySections />
      <Contact />
      <PolicyLinks current="/privacy" />
    </article>
  );
}
