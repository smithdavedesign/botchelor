import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LAST_UPDATED, PrivacySections } from "../legal/sections";

export const metadata: Metadata = { title: "Privacy · Botchelor" };
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

/** What Botchelor stores and who processes it. */
export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy</h1>
      <p className="muted">{LAST_UPDATED}</p>
      <PrivacySections />
      <Contact />
      <p>
        See also the <Link href="/terms">terms and refund policy</Link>. <Link href="/">Back to the show</Link>
      </p>
    </article>
  );
}
