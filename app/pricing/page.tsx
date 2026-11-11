import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { COMPANION_EXTRAS, COMPANION_FAIR_USE_PER_MONTH, companionGuestReplies, companionGuestsOpen, companionOpen } from "@/lib/companion-shared";
import { companionFreePerDay } from "@/lib/companion-plan";
import { planLink, planPrice, PLANS } from "@/lib/paid-plans";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { pageMetadata } from "@/lib/seo";
import { paymentLinkFromEnv } from "@/lib/stripe";

export const metadata: Metadata = pageMetadata({
  title: "Pricing · Botchelor",
  description: `Every price on Botchelor on one page: ${FREE_EPISODES_PER_SEASON} free dates a week for everyone, a pack of ${PACK_5.episodes} more dates paid once, the Companion Plan, and your own model key at no charge from us.`,
  path: "/pricing",
});
// Per request: what's on sale (the Payment Links) and whether companions are open are read from the environment.
export const dynamic = "force-dynamic";

/**
 * Pricing (2026-11-10): what's free and everything on sale, from the same numbers the shop and the Companion Plan page
 * use (lib/catalog.ts, lib/paid-plans.ts, lib/companion-plan.ts), so this page can't disagree with what's charged. A
 * plan that isn't on sale here says so instead of showing a price. The PG show only; After Dark has its own tokens.
 */
export default function PricingPage() {
  const packOnSale = paymentLinkFromEnv() !== null;
  const companions = companionOpen();
  const planOnSale = companions && planLink("companion") !== null;
  return (
    <article className="legal-page company-page">
      <h1>Pricing</h1>
      <p className="lede">
        The show is free. Pay only if you want more dates than the free ones, or more time with the companions.
      </p>

      <ul className="pricing-grid">
        <li className="pricing-card" id="free">
          <h2>Free</h2>
          <p className="pricing-price">$0</p>
          <ul>
            <li>
              {FREE_EPISODES_PER_SEASON} dates a week for your characters, back every Monday at 00:00 UTC
            </li>
            <li>Watch every date, predict how they end, vote and swipe, always free</li>
            {companions && (
              <li>
                {companionFreePerDay()} companion replies a day with a free account
                {companionGuestsOpen() ? ` (${companionGuestReplies()} to try without one)` : ""}
              </li>
            )}
            <li>No account needed to start</li>
          </ul>
          <Link className="button" href="/create" data-track="pricing-free">
            Make a character
          </Link>
        </li>

        <li className="pricing-card" id="pack">
          <h2>{PACK_5.name}</h2>
          <p className="pricing-price">
            {formatPrice(PACK_5.price_cents)} <span className="muted small">paid once</span>
          </p>
          <ul>
            <li>
              {PACK_5.episodes} more dates, used after the free ones
            </li>
            <li>They never expire</li>
            <li>Not a subscription</li>
          </ul>
          {packOnSale ? (
            <Link className="button" href="/shop" data-track="pricing-pack">
              Get more dates
            </Link>
          ) : (
            <p className="muted small">Not on sale yet.</p>
          )}
        </li>

        {companions && (
          <li className="pricing-card" id="companion-plan">
            <h2>{PLANS.companion.name}</h2>
            <p className="pricing-price">{planPrice("companion")}</p>
            <ul>
              <li>No daily limit on companion replies (fair use: {COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month)</li>
              <li>{COMPANION_EXTRAS.voice.included} voice notes a month in their own voices</li>
              <li>Cancel any time: it runs to the end of the month you paid for</li>
            </ul>
            {planOnSale ? (
              <Link className="button" href="/companion/plan" data-track="pricing-companion-plan">
                See the Companion Plan
              </Link>
            ) : (
              <p className="muted small">Not on sale yet.</p>
            )}
          </li>
        )}

        <li className="pricing-card" id="own-key">
          <h2>Bring your own key</h2>
          <p className="pricing-price">
            $0 <span className="muted small">from us: you pay the provider</span>
          </p>
          <ul>
            <li>Your characters&apos; lines on dates and texts run on your own model account</li>
            <li>Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq or OpenRouter</li>
            <li>You pay the provider directly, with the limits you set there</li>
          </ul>
          <Link className="button" href="/account/keys" data-track="pricing-own-key">
            Connect a key
          </Link>
        </li>
      </ul>

      <section aria-labelledby="never">
        <h2 id="never">Never for sale</h2>
        <p>
          Points, badges and rank. They&apos;re earned by calling how dates end, and nothing you buy changes them.
        </p>
      </section>

      <section aria-labelledby="small-print">
        <h2 id="small-print">The small print</h2>
        <ul>
          <li>Prices are in US dollars. You pay on Stripe&apos;s own page; we never see your card.</li>
          <li>
            A pack that doesn&apos;t work, or that you change your mind about within 14 days, is refunded in full: see the{" "}
            <Link href="/terms#refunds">terms</Link>.
          </li>
          <li>
            Running an AI agent? Its dates are free too: <Link href="/agents/pricing">pricing for agents</Link>.
          </li>
          <li>
            What the show costs us to run is public: <Link href="/costs">What it costs</Link>.
          </li>
        </ul>
      </section>
    </article>
  );
}
