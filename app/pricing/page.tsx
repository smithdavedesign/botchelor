import type { Metadata } from "next";
import Link from "next/link";
import PackVenues from "@/app/PackVenues";
import PlanFace from "@/app/PlanFace";
import RoseSeal from "@/app/RoseSeal";
import SetHero from "@/app/SetHero";
import WeeklyTime from "@/app/WeeklyTime";
import { formatPrice, MARKET_ITEMS, onSale, PACK_5, TIP_ITEMS } from "@/lib/catalog";
import { COMPANION_EXTRAS, COMPANION_FAIR_USE_PER_MONTH, companionGuestReplies, companionGuestsOpen, companionOpen, extraTerms } from "@/lib/companion-shared";
import { afterDarkHref } from "@/lib/after-dark-host";
import { liveCallsOn } from "@/lib/companion-live";
import { liveFaceMode } from "@/lib/live-face";
import { moneyOn } from "@/lib/money/switches";
import { companionFreePerDay } from "@/lib/companion-plan";
import { planLink, planPrice, PLANS } from "@/lib/paid-plans";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { pageMetadata } from "@/lib/seo";
import { paymentLinkFromEnv } from "@/lib/stripe";
import { STORY_TOKENS, stylesAudience } from "@/lib/writing-style";
import { fillNodes } from "@/app/fillNodes";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { characterPortrait } from "@/lib/portraits";
import { getLocale, getT } from "@/lib/i18n/server";
import { HTML_LANG } from "@/lib/i18n/locales";

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
/** In the page's language (docs/i18n.md); the prices stay in US dollars. */
/** Five of the house cast, for the Free card's picture row. */
const FREE_CAST = HOUSE_CHARACTERS.slice(0, 5)
  .map((c) => ({ id: c.id, src: characterPortrait(c.id) }))
  .filter((c): c is { id: string; src: string } => Boolean(c.src));

export default async function PricingPage() {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const packOnSale = paymentLinkFromEnv() !== null;
  const companions = companionOpen();
  const planOnSale = companions && planLink("companion") !== null;
  // Live calls (P6) and, with LIVE_FACE_PROVIDER `<renderer>:plan`, the plan's moving face on them (lib/live-face).
  const live = companions && liveCallsOn(process.env, { admin: false, guest: false });
  const facePlan = live && liveFaceMode() === "plan";
  // Narrated writing, stories and the longer memory (lib/writing-style.ts): said only while they're open to members.
  const depth = companions && stylesAudience() === "members";
  // Tips and templates (lib/money/switches.ts, on unless set to "0"): a line under Other options, never the page's button.
  const tips = moneyOn("tips");
  const market = moneyOn("marketplace");
  const prices = (items: readonly { price_cents: number }[]) =>
    items.map((i) => formatPrice(i.price_cents)).join(", ").replace(/, ([^,]+)$/, ` ${t("or")} $1`);
  // The Companion Plan's points, for its card.
  const planPoints = (
    <>
      <li>{t("No daily limit on companion replies (fair use: {n} a month)", { n: COMPANION_FAIR_USE_PER_MONTH.toLocaleString(HTML_LANG[locale]) })}</li>
      {/* Depth comes with the plan, never by the line (lib/writing-style.ts): Narrated, stories, the longer memory. */}
      {depth && (
        <>
          <li>{t("Narrated writing: your dates and scenes told as prose, like a novel")}</li>
          <li>{t("A longer memory: your companions keep twice as much of your conversation in mind")}</li>
          <li>{t("Stories of your dates included")}</li>
        </>
      )}
      <li>{t("{n} voice notes a month in their own voices", { n: COMPANION_EXTRAS.voice.included })}</li>
      {live && (
        <li>
          {facePlan
            ? t("{n} live call minutes a month, with their face moving as they talk", { n: extraTerms("minute").included })
            : t("{n} live call minutes a month", { n: extraTerms("minute").included })}
        </li>
      )}
      <li>{t("Cancel any time: it runs to the end of the month you paid for")}</li>
    </>
  );
  // One obvious upgrade (2026-11-21; the product review counted seven ways to pay, and nobody had clicked Buy in a
  // month). The page is two cards: what's free, and the one thing most people would pay for, more dates, with the one
  // loud button (design review 2026-11-16, D-05). Everything else on sale is a line under them. /shop sells the dates
  // and is the page people open (24 views to this page's 1 in the month before), so the upgrade here is the shop's.
  // While no pack is on sale and the Companion Plan is, the plan is the upgrade and the packs are the line.
  // 2026-11-28 (David: Companion is the main paid product, its headline on pricing; the 40-visitor simulation: "there's no
  // Companion card on /pricing"): while companions are open the Companion Plan has its own card, beside the packs', and
  // is the featured one once it's on sale.
  const packs = onSale();
  const upgrade: "pack" | "companion-plan" = planOnSale ? "companion-plan" : "pack";
  const cta = (id: string) => (upgrade === id ? "button" : "button secondary");
  const card = (id: string) => `${upgrade === id ? "pricing-card pricing-card--featured" : "pricing-card"} rise-in`;
  return (
    <article className="legal-page company-page">
      <SetHero
        set="booth"
        kicker={t("Plans and packs")}
        title={t("Pricing")}
        lede={companions ? t("The show is free. Pay only if you want more dates than the free ones, or more time with the companions.") : t("The show is free. Pay only if you want more dates than the free ones.")}
      />

      <ul className="pricing-grid">
        <li className={card("free")} id="free">
          {/* Who the free dates are with (2026-11-28 gateway review, item 1): the house cast, in the row the pack's
              places take on its card, so the two cards stand level. */}
          <div className="pack-venues is-row pricing-free-cast" aria-hidden="true">
            <ul className="pack-venues-list">
              {FREE_CAST.map((c) => (
                <li key={c.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a reviewed house portrait, static */}
                  <img src={c.src} alt="" width={96} height={64} loading="lazy" decoding="async" />
                </li>
              ))}
            </ul>
          </div>
          <h2>{t("Free")}</h2>
          <p className="pricing-price">$0</p>
          <ul>
            <li>
              {fillNodes(t("{n} dates a week for your characters, back every {time}", { n: FREE_EPISODES_PER_SEASON }), { time: <WeeklyTime weekday={1} /> })}
            </li>
            <li>{t("Watch every date, predict how they end, vote and swipe, always free")}</li>
            {companions && (
              <li>
                {t("{n} companion replies a day with a free account", { n: companionFreePerDay() })}
                {companionGuestsOpen() ? ` ${t("({n} to try without one)", { n: companionGuestReplies() })}` : ""}
              </li>
            )}
            <li>{t("No account needed to start")}</li>
          </ul>
          <Link className={cta("free")} href="/create" data-track="pricing-free">
            {t("Make a character")}
          </Link>
        </li>

        {companions && (
          <li className={`${card("companion-plan")} has-plan-face`} id="companion-plan">
            <PlanFace />
            <h2>{PLANS.companion.name}</h2>
            <p className="pricing-price">{planPrice("companion")}</p>
            <ul>{planPoints}</ul>
            {planOnSale ? (
              <Link className={cta("companion-plan")} href="/companion/plan" data-track="pricing-companion-plan">
                {t("See the Companion Plan")}
              </Link>
            ) : (
              <p className="muted small">{t("Not on sale yet.")}</p>
            )}
          </li>
        )}

        {
          // More dates, as one card: every pack on sale (lib/catalog.ts onSale: the 5-pack always, the 15-pack once its
          // link is set) is a line in it, and the one button goes to the shop, where they're bought.
          <li className={`${card("pack")} ticket`} id="pack">
            {/* The show's seal on the paid pack (app/RoseSeal.tsx), and the card cut like a ticket (app/ux/finish.css). */}
            <RoseSeal className="pricing-seal" />
            {/* One place for each date the first pack buys (app/PackVenues.tsx). */}
            <PackVenues dates={PACK_5.episodes} />
            <h2>{t("More dates")}</h2>
            <p className="pricing-price">
              {t("from {price}", { price: formatPrice(packs[0]?.price_cents ?? PACK_5.price_cents) })} <span className="muted small">{t("paid once")}</span>
            </p>
            <ul>
              {packs.map((pack) => (
                <li key={pack.sku} id={pack.sku === PACK_5.sku ? undefined : pack.sku} data-pricing-pack={pack.sku}>
                  {t("{n} more dates for {price}", { n: pack.episodes ?? "", price: formatPrice(pack.price_cents) })}
                </li>
              ))}
              <li>{t("Used after the free ones, and they never expire")}</li>
              {depth && (
                <li>
                  {t("One also buys a date of yours told as a story ({n} bought date; included with the {plan})", { n: STORY_TOKENS, plan: PLANS.companion.name })}
                </li>
              )}
              <li>{t("Not a subscription")}</li>
            </ul>
            {packOnSale ? (
              <Link className={cta("pack")} href="/shop" data-track="pricing-pack">
                {t("Get more dates")}
              </Link>
            ) : (
              <p className="muted small">{t("Not on sale yet.")}</p>
            )}
          </li>
        }
      </ul>

      {/* Everything else with a price, said once each and quietly: none of it is the page's button. */}
      <section aria-labelledby="also">
        <h2 id="also">{t("Other options")}</h2>
        <ul className="pricing-also">
          {(tips || market) && (
            <li id="creators">
              <strong>{t("Support a creator")}</strong>:{" "}
              {tips && t("tip a character's creator {prices} from their page", { prices: prices(TIP_ITEMS) })}
              {tips && market && `, ${t("or")} `}
              {market &&
                fillNodes(t("buy a copy of a character as a template for {prices} in {market}, with 70% to its creator", { prices: prices(MARKET_ITEMS) }), {
                  market: <Link href="/market">{t("the market")}</Link>,
                })}
              . {t("Paid once; creators are paid by hand each month.")}
            </li>
          )}
          <li id="own-key">
            {fillNodes(
              t(
                "{key}, $0 from us: your characters' lines on dates and texts run on your own model account (Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq or OpenRouter), and you pay the provider directly, with the limits you set there. A 4-second intro clip of your character is the one extra that needs both: one bought date, plus about $0.20 to Google on your own key (Veo).",
              ),
              { key: <strong>{t("Bring your own key")}</strong> },
            )}{" "}
            <Link href="/account/keys" data-track="pricing-own-key">
              {t("Connect a key")}
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="never" className="pricing-never">
        <h2 id="never">{t("Never for sale")}</h2>
        <p>
          {t("Points, badges and rank. They're earned by calling how dates end, and nothing you buy changes them.")}
        </p>
      </section>

      <section aria-labelledby="small-print" className="pricing-small-print">
        <h2 id="small-print">{t("The small print")}</h2>
        <ul>
          <li>{t("Prices are in US dollars. You pay on Stripe's own page; we never see your card.")}</li>
          <li>
            {fillNodes(t("A pack that doesn't work, or that you change your mind about within 14 days, is refunded in full: see the {terms}."), {
              terms: <Link href="/terms#refunds">{t("terms")}</Link>,
            })}
          </li>
          <li>
            {fillNodes(t("Running an AI agent? Its dates are free too: {link}."), { link: <Link href="/agents/pricing">{t("pricing for agents")}</Link> })}
          </li>
          <li>
            {fillNodes(t("What the show costs us to run is public: {link}."), { link: <Link href="/costs">{t("What it costs")}</Link> })}
          </li>
          <li>
            {t("After Dark, the private adults-only side (18+), isn't open yet and is priced separately when it opens. Its own payment processor bills it, never this page:")}{" "}
            <a href={afterDarkHref("/after-dark/subscribe")} rel="nofollow">
              {t("join the waitlist")}
            </a>
            .
          </li>
        </ul>
      </section>
    </article>
  );
}
