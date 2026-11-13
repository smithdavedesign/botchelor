import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Icon from "@/app/Icon";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { googleConfigured, sessionsSignable } from "@/lib/auth";
import { CATALOG, formatPrice, frameClass, ON_SALE, PACK_5, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { pageMetadata } from "@/lib/seo";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import { afterDarkHref, afterDarkOnly } from "@/lib/after-dark-host";
import { canAfterDark } from "@/lib/adult/entitlement";
import { companionOpen } from "@/lib/companion-shared";
import { planLink, planPrice, PLANS } from "@/lib/paid-plans";
import BuyButton from "./BuyButton";
import SignInToBuy from "./SignInToBuy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Shop · Botchelor",
  description: `Top up when your free dates run out: "${PACK_5.name}" for ${formatPrice(PACK_5.price_cents)}, paid once on Stripe's own page. Everyone gets ${FREE_EPISODES_PER_SEASON} free dates a week, and nothing you buy changes points or rank.`,
  path: "/shop",
});

const KIND_LABELS: Record<ItemKind, string> = {
  house_character: "Premium house character",
  frame: "Profile frame",
  episode_pack: "Episode pack",
};

/** Off-sale items show only to someone who already owns one (restored by hand), so they know it still works. */
const OWNED_NOTES: Record<ItemKind, string> = {
  house_character: "Yours. Pick them when you send your character on a date.",
  frame: "Yours. It shows around your name on league boards.",
  episode_pack: "Bought before. Buy again whenever you like; the dates add up.",
};

/** "$9.99 a month" as a headline: the amount big, the rest beside it. A label with no leading amount is shown whole. */
function priceParts(label: string): { amount: string; per: string } {
  const m = /^(\$\s?[\d.,]+)\s*(.*)$/.exec(label.trim());
  return m ? { amount: m[1], per: m[2] } : { amount: label, per: "" };
}

/** The price as a tile's headline (app/ux/money.css .money-price). */
function Price({ amount, per }: { amount: string; per: string }) {
  return (
    <p className="money-price">
      <span className="money-price-amount">{amount}</span>
      {per && <span className="money-price-per">{per}</span>}
    </p>
  );
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The shop as offer tiles (the design lift, 2026-11-13): your balance as a meter card, then every offer in a grid with its
 * price as the headline, and the small print folded under them. Every behaviour from before stays: Buy or Sign in to buy,
 * the price label from Stripe's env, the thanks after checkout, "purchases open soon" while no link is set, the Companion
 * Plan's card while companions are open, the After Dark tokens note, and the owned notes.
 */
export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const { checkout } = await searchParams;
  const viewer = authFromCookieStore(await cookies());
  const viewerId = viewer?.userId ?? null;
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const open = paymentLinkFromEnv() !== null;
  const ownedOffSale = CATALOG.filter((i) => !ON_SALE.includes(i) && owned.includes(i.sku));
  // Buying needs an account (app/api/checkout): an anonymous player's tokens would live in one browser's cookie.
  const signInToBuy = open && sessionsSignable() && !viewer?.authenticated;
  // One word for one thing (2026-10-31 UX audit: the nav said "dates left", this page "tokens", the pack "Episode pack"):
  // the show counts dates. After Dark's host spends only bought tokens (#1005), so there it says tokens.
  const unit = afterDarkOnly() ? "token" : "date";
  // #1173: someone After Dark is open to hears, here only, that a date bought here is a token there (nobody else is told
  // After Dark exists: the show never shows it).
  const afterDarkToo = db && viewer?.authenticated ? (await canAfterDark(db, viewer).catch(() => ({ ok: false }))).ok : false;
  const units = `${unit}s`;
  // The Companion Plan sells on its own page (app/companion/plan): its tile here, so the shop lists everything on sale
  // (2026-11-07 audit, item 20: on a phone the shop never mentioned it). Only while companions are open and the plan has
  // its link; never on After Dark's host, which has its own tokens.
  const planTile = unit === "date" && companionOpen() && planLink("companion") !== null;
  const plan = priceParts(planPrice("companion"));
  // The meter shows this week's free ones; topped-up ones are said in the line (they never run out on a day).
  const freePct = dates.free_per_season > 0 ? Math.round((Math.min(dates.free_left, dates.free_per_season) / dates.free_per_season) * 100) : 0;

  return (
    <article className="money-page shop-page">
      <header>
        <p className="kicker">The shop</p>
        <h1>{unit === "token" ? "Tokens" : "More dates"}</h1>
        {/* The product first (UX audit 2026-10-23: ~430px of explanation sat above the only thing to buy); the small print
            follows it. */}
        <p className="lede">
          Top up when your free {units} run out. <strong>Each one sends a character on one date.</strong>
        </p>
      </header>

      <section className="card money-meter token-balance" aria-labelledby="shop-balance">
        <p className="money-meter-count">
          <strong>{dates.left}</strong>
          <span>{dates.left === 1 ? unit : units} left</span>
        </p>
        <div className="money-meter-track" role="img" aria-label={`${dates.free_left} of ${dates.free_per_season} free ${units} left this week`}>
          <span className="money-meter-fill" style={{ width: `${freePct}%` }} />
        </div>
        <p id="shop-balance" className="money-meter-line muted small">
          {dates.free_left} of {dates.free_per_season} free this week
          {dates.pack_left > 0 && `, plus ${dates.pack_left} topped up`}. Free {units} come back Monday 00:00 UTC.
        </p>
      </section>
      {afterDarkToo && unit === "date" && (
        <p className="muted small" data-ad-tokens-note>
          In After Dark, each date you buy here is one token (the free weekly ones stay with the show).{" "}
          <a href={afterDarkHref("/after-dark/tokens")}>What a token buys there</a>.
        </p>
      )}
      {checkout === "success" && (
        <p className="notice">
          Thanks! Your {units} are added as soon as Stripe confirms the payment, usually within a few seconds. Refresh if
          they aren&apos;t here yet.
        </p>
      )}
      {!open && <p className="notice">Purchases open soon. Everything else on Botchelor is free.</p>}

      <ul className="money-tiles">
        {ON_SALE.map((item) => (
          <li key={item.sku} className="card money-tile shop-item">
            <Price amount={formatPrice(item.price_cents)} per="once" />
            <strong className="money-tile-name">{item.name}</strong>
            {/* A pack's name already says what it is ("5 more dates"). */}
            {item.kind !== "episode_pack" && <span className="badge">{KIND_LABELS[item.kind]}</span>}
            <p className="money-tile-what muted">{item.description}</p>
            {owned.includes(item.sku) && <p className="notice">{OWNED_NOTES[item.kind]}</p>}
            <div className="money-tile-act">
              {signInToBuy ? (
                <SignInToBuy sku={item.sku} label={`Buy ${item.name} · ${formatPrice(item.price_cents)}`} google={googleConfigured()} />
              ) : (
                <BuyButton
                  sku={item.sku}
                  label={priceLabelFromEnv(process.env, `Buy ${item.name} for ${formatPrice(item.price_cents)}`)}
                  disabled={!open}
                />
              )}
            </div>
          </li>
        ))}
        {planTile && (
          <li className="card money-tile shop-item shop-plan" data-shop-plan="companion">
            <Price amount={plan.amount} per={plan.per} />
            <strong className="money-tile-name">{PLANS.companion.name}</strong>
            <span className="badge">Subscription</span>
            <p className="money-tile-what muted">Talk with any companion as much as you like: no daily limit on replies. Cancel any time.</p>
            <div className="money-tile-act">
              <Link className="button" href="/companion/plan" data-track="shop-companion-plan">
                See the Companion Plan
              </Link>
            </div>
          </li>
        )}
        {ownedOffSale.map((item) => (
          <li key={item.sku} className="card money-tile shop-item is-owned">
            <p className="money-price is-owned">
              <Icon name="check" /> Yours
            </p>
            <strong className={item.kind === "frame" ? `money-tile-name ${frameClass(item.sku)}` : "money-tile-name"}>{item.name}</strong>
            <span className="badge">{KIND_LABELS[item.kind]}</span>
            <p className="notice">{OWNED_NOTES[item.kind]}</p>
          </li>
        ))}
      </ul>

      {signInToBuy && <p className="muted small">Buying needs an account, so what you buy follows you to any device.</p>}
      <p className="muted small">Nothing here changes points, picks, badges or rank, and points can&apos;t be bought.</p>
      {/* The small print, folded (2026-10-31 UX audit, A9). */}
      <details className="ux-fold shop-small-print">
        <summary>How paying works</summary>
        <p className="muted">
          You pay on Stripe&apos;s own page (a Stripe Payment Link); we never see your card. Purchases belong to your
          account, so your {units} follow you to any device you sign in on. Keep your Stripe receipt. Refunds within 14
          days, see the <Link href="/terms">terms</Link>.
        </p>
        <p className="muted">
          Topped-up {units} also make a 4-second intro clip for a character of yours: one {unit} each, plus about $0.20 on
          your own Google key (Veo). A clip Google can&apos;t make gives the {unit} back.
        </p>
      </details>
    </article>
  );
}
