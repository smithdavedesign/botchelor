import type { Metadata } from "next";
import Link from "next/link";
import PackVenues from "@/app/PackVenues";
import PlanFace from "@/app/PlanFace";
import SetHero from "@/app/SetHero";
import { formatPrice, onSale, PACK_5 } from "@/lib/catalog";
import { COMPANION_EXTRAS, COMPANION_FAIR_USE_PER_MONTH, companionGuestReplies, companionGuestsOpen, companionOpen, extraTerms } from "@/lib/companion-shared";
import { liveCallsOn } from "@/lib/companion-live";
import { liveFaceMode } from "@/lib/live-face";
import { companionFreePerDay } from "@/lib/companion-plan";
import { planLink, planPrice, PLANS } from "@/lib/paid-plans";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { pageMetadata } from "@/lib/seo";
import { paymentLinkFromEnv } from "@/lib/stripe";
import { STORY_TOKENS, stylesAudience } from "@/lib/writing-style";

export const metadata: Metadata = pageMetadata({
  title: `Botchelor pricing: ${FREE_EPISODES_PER_SEASON} free AI dates a week, packs from ${formatPrice(PACK_5.price_cents)}`,
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
  // Live calls (P6) and, with LIVE_FACE_PROVIDER `<renderer>:plan`, the plan's moving face on them (lib/live-face).
  const live = companions && liveCallsOn(process.env, { admin: false, guest: false });
  const facePlan = live && liveFaceMode() === "plan";
  // Narrated writing, stories and the longer memory (lib/writing-style.ts): said only while they're open to members.
  const depth = companions && stylesAudience() === "members";
  // The Companion Plan's points, for its card on the days it is the page's upgrade.
  const planPoints = (
    <>
      <li>No daily limit on companion replies (fair use: {COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month)</li>
      {/* Depth comes with the plan, never by the line (lib/writing-style.ts): Narrated, stories, the longer memory. */}
      {depth && (
        <>
          <li>Narrated writing: your dates and scenes told as prose, like a novel</li>
          <li>A longer memory: your companions keep twice as much of your conversation in mind</li>
          <li>Stories of your dates included</li>
        </>
      )}
      <li>{COMPANION_EXTRAS.voice.included} voice notes a month in their own voices</li>
      {live && (
        <li>
          {extraTerms("minute").included} live call minutes a month{facePlan ? ", with their face moving as they talk" : ""}
        </li>
      )}
      <li>Cancel any time: it runs to the end of the month you paid for</li>
    </>
  );
  // One obvious upgrade (2026-11-21; the product review counted seven ways to pay, and nobody had clicked Buy in a
  // month). The page is two cards: what's free, and the one thing most people would pay for, more dates, with the one
  // loud button (design review 2026-11-16, D-05). Everything else on sale is a line under them. /shop sells the dates
  // and is the page people open (24 views to this page's 1 in the month before), so the upgrade here is the shop's.
  // While no pack is on sale and the Companion Plan is, the plan is the upgrade and the packs are the line.
  const packs = onSale();
  const upgrade: "pack" | "companion-plan" = packOnSale || !planOnSale ? "pack" : "companion-plan";
  const cta = (id: string) => (upgrade === id ? "button" : "button secondary");
  const card = (id: string) => `${upgrade === id ? "pricing-card pricing-card--featured" : "pricing-card"} rise-in`;
  return (
    <article className="legal-page company-page">
      <SetHero
        set="booth"
        kicker="Plans and packs"
        title="Pricing"
        lede={<>The show is free. Pay only if you want more dates than the free ones{companions ? ", or more time with the companions" : ""}.</>}
      />

      <ul className="pricing-grid">
        <li className={card("free")} id="free">
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
          <Link className={cta("free")} href="/create" data-track="pricing-free">
            Make a character
          </Link>
        </li>

        {upgrade === "pack" ? (
          // More dates, as one card: every pack on sale (lib/catalog.ts onSale: the 5-pack always, the 15-pack once its
          // link is set) is a line in it, and the one button goes to the shop, where they're bought.
          <li className={card("pack")} id="pack">
            {/* One place for each date the first pack buys (app/PackVenues.tsx). */}
            <PackVenues dates={PACK_5.episodes} />
            <h2>More dates</h2>
            <p className="pricing-price">
              from {formatPrice(packs[0]?.price_cents ?? PACK_5.price_cents)} <span className="muted small">paid once</span>
            </p>
            <ul>
              {packs.map((pack) => (
                <li key={pack.sku} id={pack.sku === PACK_5.sku ? undefined : pack.sku} data-pricing-pack={pack.sku}>
                  {pack.episodes} more dates for {formatPrice(pack.price_cents)}
                </li>
              ))}
              <li>Used after the free ones, and they never expire</li>
              {depth && (
                <li>
                  One also buys a date of yours told as a story ({STORY_TOKENS} bought date; included with the {PLANS.companion.name})
                </li>
              )}
              <li>Not a subscription</li>
            </ul>
            {packOnSale ? (
              <Link className={cta("pack")} href="/shop" data-track="pricing-pack">
                Get more dates
              </Link>
            ) : (
              <p className="muted small">Not on sale yet.</p>
            )}
          </li>
        ) : (
          <li className={`${card("companion-plan")} has-plan-face`} id="companion-plan">
            <PlanFace />
            <h2>{PLANS.companion.name}</h2>
            <p className="pricing-price">{planPrice("companion")}</p>
            <ul>{planPoints}</ul>
            <Link className={cta("companion-plan")} href="/companion/plan" data-track="pricing-companion-plan">
              See the Companion Plan
            </Link>
          </li>
        )}
      </ul>

      {/* Everything else with a price, said once each and quietly: none of it is the page's button. */}
      <section aria-labelledby="also">
        <h2 id="also">Other options</h2>
        <ul className="pricing-also">
          {companions && upgrade === "pack" && (
            <li id="companion-plan">
              <strong>{PLANS.companion.name}</strong>, {planPrice("companion")}: no daily limit on companion replies (fair use:{" "}
              {COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month), {COMPANION_EXTRAS.voice.included} voice notes a month in their own voices
              {live ? `, ${extraTerms("minute").included} live call minutes a month${facePlan ? " with their face moving as they talk" : ""}` : ""}
              {depth ? ", narrated writing, a longer memory and stories of your dates" : ""}. Cancel any time.{" "}
              {planOnSale ? (
                <Link href="/companion/plan" data-track="pricing-companion-plan">
                  See the Companion Plan
                </Link>
              ) : (
                <span className="muted">Not on sale yet.</span>
              )}
            </li>
          )}
          {upgrade !== "pack" && (
            <li id="pack">
              <strong>More dates</strong>: {packs.map((pack) => `${pack.episodes} for ${formatPrice(pack.price_cents)}`).join(", or ")}, paid once. Not on sale yet.
            </li>
          )}
          <li id="own-key">
            <strong>Bring your own key</strong>, $0 from us: your characters&apos; lines on dates and texts run on your own model account (Google Gemini,
            OpenAI, Anthropic Claude, DeepSeek, Groq or OpenRouter), and you pay the provider directly, with the limits you set there. A 4-second
            intro clip of your character is the one extra that needs both: one bought date, plus about $0.20 to Google on your own key (Veo).{" "}
            <Link href="/account/keys" data-track="pricing-own-key">
              Connect a key
            </Link>
          </li>
        </ul>
      </section>

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
