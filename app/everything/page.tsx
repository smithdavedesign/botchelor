import { showIdeasOn } from "@/lib/show-ideas-switch";
import type { Metadata } from "next";
import Link from "next/link";
import { ALTERNATIVES, alternativePath } from "@/lib/alternatives";
import { STATUS_PAGE_URL } from "@/lib/company";
import { companionOpen } from "@/lib/companion-shared";
import { pageMetadata } from "@/lib/seo";
import { stepInOpen } from "@/lib/step-in";
import { FeedbackLink } from "../FeedbackDock";

export const metadata: Metadata = pageMetadata({
  title: "Everything on Botchelor",
  description:
    "Every page on Botchelor in one place: the show's corners, the free tools, how it's built and what it costs, the FAQ and press kit, and every policy, from the terms and privacy to the 2257 statement and cancelling.",
  path: "/everything",
});
// Per request, so the Companions and step-in links follow COMPANION_OPEN and STEP_IN_OPEN without a redeploy.
export const dynamic = "force-dynamic";

/**
 * Everything on Botchelor (the 2026-11-14 design audit: "the chrome outweighs the content"). The footer had ~33 links in
 * four groups on every page; it keeps one row of what people click and links here for the rest. The groups are the
 * footer's old ones, under the same headings, and "About this show" is the footer's old fold, word for word.
 */
export default function EverythingPage() {
  return (
    <article className="legal-page company-page everything-page">
      <h1>Everything on Botchelor</h1>
      <p className="lede">Every page that isn&apos;t in the header, in one place.</p>

      <div className="everything-groups">
        <section aria-labelledby="the-show">
          <h2 id="the-show">The show</h2>
          <ul>
            {showIdeasOn() && <li><Link href="/shows">Shows, and what could come next</Link></li>}
            <li><Link href="/graph">The Constellation</Link></li>
            <li><Link href="/reviews">Reviews</Link></li>
            {companionOpen() && <li><Link href="/companion">Companions</Link></li>}
            {stepInOpen() && <li><Link href="/step-in" data-track="step-in" data-track-from="everything">Step into a date</Link></li>}
            <li><Link href="/prompts">Prompts library</Link></li>
            <li><Link href="/shop">More dates</Link></li>
            <li><Link href="/pricing">Pricing</Link></li>
          </ul>
        </section>

        <section aria-labelledby="tools">
          <h2 id="tools">Tools</h2>
          <ul>
            <li><Link href="/tools/oc-chemistry-test">OC chemistry test</Link></li>
            <li><Link href="/tools/ship-name-generator">Ship name generator</Link></li>
            <li><Link href="/tools/oc-name-generator">OC name generator</Link></li>
            <li><Link href="/tools/oc-questions">Questions to ask your OC</Link></li>
            <li><Link href="/agents">For AI agents</Link></li>
          </ul>
        </section>

        {/* The switching pages had no link anywhere on the site, so Google found them only through the sitemap and left
            them "Discovered - currently not indexed" (Search Console, 2026-11-15). */}
        <section aria-labelledby="switching">
          <h2 id="switching">Coming from another app</h2>
          <ul>
            <li><Link href="/import">Bring your character</Link></li>
            {ALTERNATIVES.map((a) => (
              <li key={a.slug}><Link href={alternativePath(a.slug)}>{a.name} alternative</Link></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="company">
          <h2 id="company">Company</h2>
          <ul>
            <li><Link href="/about">How it&apos;s built</Link></li>
            <li><Link href="/costs">What it costs</Link></li>
            <li><Link href="/marketing">Marketing, in the open</Link></li>
            <li><Link href="/faq">FAQ</Link></li>
            <li><Link href="/press">Press kit</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><Link href="/security">Security</Link></li>
            <li><a href={STATUS_PAGE_URL} rel="noopener">Status</a></li>
            <li><Link href="/accessibility">Accessibility</Link></li>
          </ul>
        </section>

        <section aria-labelledby="help-and-legal">
          <h2 id="help-and-legal">Help and legal</h2>
          <ul>
            <li><Link href="/report">Report a problem</Link></li>
            <li>
              <FeedbackLink />
            </li>
            <li><Link href="/content-policy">Content policy</Link></li>
            <li><Link href="/terms">Terms and refunds</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/legal">Terms and privacy, one page</Link></li>
            <li><Link href="/2257">2257 statement</Link></li>
            <li><Link href="/cancel">Cancel a subscription</Link></li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="about-this-show">
        <h2 id="about-this-show">About this show</h2>
        <p>
          Episodes are written by an AI model from the character sheets. Every character is a fictional adult.
          Creators stay anonymous unless they agree to reveal themselves. Every episode has a report button.
        </p>
        <p>
          Points and badges are free. They can&apos;t be bought, cashed out or transferred, and there are no prizes.
          Nothing you buy changes points, badges or rank.
        </p>
      </section>
    </article>
  );
}
