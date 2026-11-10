import type { Metadata } from "next";
import Link from "next/link";
import { mailto } from "@/lib/company";
import { contactEmail } from "@/lib/legal-entity";
import { pageMetadata } from "@/lib/seo";
import { FeedbackLink } from "../FeedbackDock";

export const metadata: Metadata = pageMetadata({
  title: "Accessibility · Botchelor",
  description:
    "What Botchelor does so everyone can use the show: contrast checked in light and dark, keyboard focus, high-contrast and reduced-motion support, the gaps we know about, and how to tell us when something gets in your way.",
  path: "/accessibility",
});
// Per request, so a CONTACT_EMAIL set after the build shows.
export const dynamic = "force-dynamic";

/**
 * The accessibility statement (2026-11-10). What it says the show does is in docs/brand.md and the stylesheets (the
 * contrast table, prefers-contrast, forced-colors, prefers-reduced-motion, the skip link); the gaps are the ones we know
 * of. Change it when either changes.
 */
export default function AccessibilityPage() {
  const email = contactEmail();
  const a11yMail = mailto("Accessibility");
  return (
    <article className="legal-page company-page">
      <h1>Accessibility</h1>
      <p className="lede">
        Botchelor should work for everyone who wants to watch it or play it. We aim for WCAG 2.2 at level AA, and we fix
        what falls short.
      </p>

      <section aria-labelledby="what-we-do">
        <h2 id="what-we-do">What the show does</h2>
        <ul>
          <li>
            Every colour of text clears 4.5:1 against what it sits on, and every control edge and focus ring 3:1, in light
            and dark. We check them with a script, not by eye.
          </li>
          <li>It follows your device: light or dark, more contrast, Windows High Contrast, and reduced motion.</li>
          <li>Every page opens with a &ldquo;Skip to content&rdquo; link, and keyboard focus is always visible.</li>
          <li>Type sizes grow with your screen and your browser&apos;s zoom, and never drop below 12px on a phone.</li>
          <li>We test the main pages in real browsers, at phone and desktop sizes.</li>
        </ul>
      </section>

      <section aria-labelledby="gaps">
        <h2 id="gaps">What we know isn&apos;t there yet</h2>
        <ul>
          <li>Video clips have no captions yet.</li>
          <li>
            The theater plays a date line by line on a timer. Pause it any time, or read the whole date as text on its
            episode page.
          </li>
        </ul>
      </section>

      <section aria-labelledby="tell-us">
        <h2 id="tell-us">Something in your way?</h2>
        <p>
          {email && a11yMail ? (
            <>
              Email <a href={a11yMail}>{email}</a> with &ldquo;Accessibility&rdquo; in the subject, or{" "}
            </>
          ) : (
            "Tell us: "
          )}
          <FeedbackLink /> from any page. Say what you were trying to do and what you use (a screen reader, zoom, a
          keyboard): it helps us fix the right thing. Other ways to reach us are on <Link href="/contact">Contact</Link>.
        </p>
      </section>
    </article>
  );
}
