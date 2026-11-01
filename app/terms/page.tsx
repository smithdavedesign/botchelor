import type { Metadata } from "next";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { pageMetadata } from "@/lib/seo";
import { CONTACT_HEADING, Contact, OnThisPage, PolicyLinks, TERMS_HEADINGS, TERMS_PRIVACY_UPDATED, TermsSections } from "../legal/sections";

export const metadata: Metadata = pageMetadata({
  title: "Terms · Botchelor",
  description: `Botchelor's terms of use and sale: adults only, fictional adult characters, free points that can't be bought, "${PACK_5.name}" for ${formatPrice(PACK_5.price_cents)} once with a refund within 14 days, and no warranties.`,
  path: "/terms",
});
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** Terms of use and sale, with the refund and cancellation policy. */
export default function TermsPage() {
  return (
    <article className="legal-page">
      <h1>Terms</h1>
      <p className="muted">{TERMS_PRIVACY_UPDATED}</p>
      <OnThisPage headings={[...TERMS_HEADINGS, CONTACT_HEADING]} />
      <TermsSections />
      <Contact />
      <PolicyLinks current="/terms" />
    </article>
  );
}
