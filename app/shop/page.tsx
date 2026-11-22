import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import SetHero from "@/app/SetHero";
import Icon from "@/app/Icon";
import PackVenues from "@/app/PackVenues";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { googleConfigured, sessionsSignable } from "@/lib/auth";
import { CATALOG, formatPrice, frameClass, onSale, PACK_15, PACK_5, PACKS, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { pageMetadata } from "@/lib/seo";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { companionOpen } from "@/lib/companion-shared";
import { newsletterOpen } from "@/lib/newsletter";
import { planLink, planPrice, PLANS } from "@/lib/paid-plans";
import BuyButton from "./BuyButton";
import PlusInterest from "./PlusInterest";
import SignInToBuy from "./SignInToBuy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "Shop · Botchelor",
  description: `Top up when your free dates run out: "${PACK_5.name}" for ${formatPrice(PACK_5.price_cents)}, or "${PACK_15.name}" for ${formatPrice(PACK_15.price_cents)}, paid once on Stripe's own page. Everyone gets ${FREE_EPISODES_PER_SEASON} free dates a week, and nothing you buy changes points or rank.`,
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
 * The shop as offer tiles (the design lift, 2026-11-13): your balance as a meter card, then the packs in a grid with
 * their price as the headline, and the small print folded under them. Every behaviour from before stays: Buy or Sign in
 * to buy, the price label from Stripe's env, the thanks after checkout, "purchases open soon" while no link is set, the
 * After Dark tokens note, and the owned notes.
 *
 * 2026-11-14: one tile per pack on sale (lib/catalog.ts onSale: each pack has its own Payment Link, and a pack with no link
 * isn't shown; pack_5 is always shown, its Buy off until its link is set), and "Best value" on the 15-pack.
 *
 * 2026-11-21, one obvious upgrade (the product review counted seven ways to pay, and nobody had clicked Buy in a
 * month): the shop sells one thing, more dates, with one loud button. The bigger pack comes first and its Buy is the
 * loud one, as on the out-of-dates wall (app/OutOfDates.tsx); the other pack's is outlined. The Companion Plan, which
 * sells on its own page, is a line under the tiles instead of a tile, and the "Botchelor Plus" interest test
 * (lib/plus-interest.ts: a plan that doesn't exist yet, with one button that only counts) is its small version there.
 */
export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const { checkout } = await searchParams;
  const viewer = authFromCookieStore(await cookies());
  const viewerId = viewer?.userId ?? null;
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const env = process.env;
  const open = paymentLinkFromEnv(env) !== null;
  // The pack the page leads with: the bigger one when it's on sale. It comes first and its button is the loud one.
  const packs = onSale(env);
  const lead = packs.find((i) => i.sku === PACK_15.sku) ?? packs[0];
  const tiles = lead ? [lead, ...packs.filter((i) => i !== lead)] : packs;
  const ownedOffSale = CATALOG.filter((i) => !PACKS.includes(i) && owned.includes(i.sku));
  // Buying needs an account (app/api/checkout): an anonymous player's tokens would live in one browser's cookie.
  const signInToBuy = open && sessionsSignable() && !viewer?.authenticated;
  // One word for one thing (2026-10-31 UX audit: the nav said "dates left", this page "tokens", the pack "Episode pack"):
  // the show counts dates. After Dark's host counts tokens (#1005), so there it says tokens.
  const unit = afterDarkOnly() ? "token" : "date";
  const units = `${unit}s`;
  // The Companion Plan sells on its own page (app/companion/plan): its line here, so the shop names everything on sale
  // (2026-11-07 audit, item 20: on a phone the shop never mentioned it). Only while companions are open and the plan has
  // its link; never on After Dark's host, which has its own tokens.
  const planLine = unit === "date" && companionOpen() && planLink("companion") !== null;
  const plan = priceParts(planPrice("companion"));
  // The meter shows this week's free ones; topped-up ones are said in the line (they never run out on a day).
  const freePct = dates.free_per_season > 0 ? Math.round((Math.min(dates.free_left, dates.free_per_season) / dates.free_per_season) * 100) : 0;

  return (
    <article className="money-page shop-page">
      {/* The product first (UX audit 2026-10-23: ~430px of explanation sat above the only thing to buy); the small print
          follows it. On the show, the heading stands on the booth set (the visual pop audit, 2026-11-20); After Dark's
          host keeps its own plain header. */}
      {unit === "date" ? (
        <SetHero
          set="booth"
          kicker="The shop"
          title="More dates"
          lede={
            <>
              Top up when your free {units} run out. <strong>Each one sends a character on one date.</strong>
            </>
          }
        />
      ) : (
        <header>
          <p className="kicker">The shop</p>
          <h1>Tokens</h1>
          <p className="lede">
            Top up when your free {units} run out. <strong>Each one sends a character on one date.</strong>
          </p>
        </header>
      )}

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
      {checkout === "success" && (
        <p className="notice">
          Thanks! Your {units} are added as soon as Stripe confirms the payment, usually within a few seconds. Refresh if
          they aren&apos;t here yet.
        </p>
      )}
      {!open && <p className="notice">Purchases open soon. Everything else on Botchelor is free.</p>}

      <ul className="money-tiles">
        {tiles.map((item) => {
          const itemOpen = paymentLinkFromEnv(env, item.sku) !== null;
          return (
            <li key={item.sku} className="card money-tile shop-item" data-shop-sku={item.sku}>
              {/* On the show, a pack's places, one per date it buys (app/PackVenues.tsx); After Dark's tokens stay plain. */}
              {unit === "date" && item.kind === "episode_pack" && <PackVenues dates={item.episodes} />}
              <Price amount={formatPrice(item.price_cents)} per="once" />
              <strong className="money-tile-name">{item.name}</strong>
              {/* A pack's name already says what it is ("5 more dates"); the bigger pack gets its one word. */}
              {item.kind !== "episode_pack" && <span className="badge">{KIND_LABELS[item.kind]}</span>}
              {item.sku === PACK_15.sku && <span className="badge">Best value</span>}
              <p className="money-tile-what muted">{item.description}</p>
              {owned.includes(item.sku) && <p className="notice">{OWNED_NOTES[item.kind]}</p>}
              <div className="money-tile-act">
                {signInToBuy ? (
                  <SignInToBuy sku={item.sku} label={`Buy ${item.name} · ${formatPrice(item.price_cents)}`} google={googleConfigured()} quiet={item !== lead} />
                ) : (
                  <BuyButton
                    sku={item.sku}
                    label={priceLabelFromEnv(env, `Buy ${item.name} for ${formatPrice(item.price_cents)}`, item.sku)}
                    disabled={!itemOpen}
                    place="shop"
                    quiet={item !== lead}
                  />
                )}
              </div>
            </li>
          );
        })}
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
      {/* What else there is, said once and quietly: neither is the page's button. */}
      {planLine && (
        <p className="shop-also muted" data-shop-plan="companion">
          Talk with any companion as much as you like:{" "}
          <Link href="/companion/plan" data-track="shop-companion-plan">
            the {PLANS.companion.name}
          </Link>
          , {plan.amount}
          {plan.per && ` ${plan.per}`}. Cancel any time.
        </p>
      )}
      {unit === "date" && (
        // Not for sale: a $0 demand test for a plan (docs/ideas.md's parked table). It says so.
        <div className="shop-also shop-plus" data-shop-plus>
          <PlusInterest place="shop" newsletter={newsletterOpen()} compact />
        </div>
      )}
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
