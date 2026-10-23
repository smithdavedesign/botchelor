import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { googleConfigured, sessionsSignable } from "@/lib/auth";
import { CATALOG, formatPrice, frameClass, ON_SALE, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import BuyButton from "./BuyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tokens · Botchelor" };

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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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

  return (
    <>
      <h1>Tokens</h1>
      {/* The product first (UX audit 2026-10-23: ~430px of explanation sat above the only thing to buy); the small print
          follows it. */}
      <p>
        Top up your tokens when the free ones run out. <strong>One token sends a character on one date.</strong>
      </p>
      <p className="muted token-balance">
        You have <strong>{dates.left}</strong> {dates.left === 1 ? "token" : "tokens"} left: {dates.free_left} of{" "}
        {dates.free_per_season} free this week
        {dates.pack_left > 0 && `, plus ${dates.pack_left} topped up`}. Free tokens come back Monday 00:00 UTC.
      </p>
      {checkout === "success" && (
        <p className="notice">
          Thanks! Your tokens are added as soon as Stripe confirms the payment, usually within a few seconds. Refresh if
          they aren&apos;t here yet.
        </p>
      )}
      {!open && <p className="notice">Purchases open soon. Everything else on Botchelor is free.</p>}

      <ul className="list">
        {ON_SALE.map((item) => (
          <li key={item.sku} className="card shop-item">
            <div className="shop-item-head">
              <strong>{item.name}</strong>
              <span className="shop-item-price">{formatPrice(item.price_cents)}</span>
            </div>
            <span className="badge">{KIND_LABELS[item.kind]}</span>
            <p>{item.description}</p>
            {owned.includes(item.sku) && <p className="notice">{OWNED_NOTES[item.kind]}</p>}
            {signInToBuy ? (
              <SignInToBuy google={googleConfigured()} />
            ) : (
              <BuyButton
                sku={item.sku}
                label={priceLabelFromEnv(process.env, `Buy ${item.name} for ${formatPrice(item.price_cents)}`)}
                disabled={!open}
              />
            )}
          </li>
        ))}
        {ownedOffSale.map((item) => (
          <li key={item.sku} className="card">
            <strong className={item.kind === "frame" ? frameClass(item.sku) : undefined}>{item.name}</strong>{" "}
            <span className="badge">{KIND_LABELS[item.kind]}</span>
            <p className="notice">{OWNED_NOTES[item.kind]}</p>
          </li>
        ))}
      </ul>

      <p>
        <strong>Nothing here changes points, picks, badges or rank, and points can&apos;t be bought.</strong>
      </p>
      <p className="muted">
        Topped-up tokens also make a 4-second intro clip for a character of yours: one token each, plus about $0.20 on
        your own Google key (Veo). A clip Google can&apos;t make gives the token back.
      </p>
      <p className="muted">
        You pay on Stripe&apos;s own page (a Stripe Payment Link); we never see your card. Purchases belong to your
        account, so your tokens follow you to any device you sign in on. Keep your Stripe receipt. Refunds within 14
        days, see the <Link href="/terms">terms</Link>.
      </p>
    </>
  );
}

/**
 * In place of Buy for a visitor who isn't signed in. Signing up keeps everything they already have (the account
 * adopts their anonymous id), and both ways back land on the shop again.
 */
function SignInToBuy({ google }: { google: boolean }) {
  return (
    <>
      <p className="shop-signin-note">
        Sign in to buy, so your tokens follow you to any device. Your characters and dates come with you.
      </p>
      {google ? (
        <>
          <a className="button-google" href="/api/auth/google/start?next=%2Fshop">
            Continue with Google
          </a>
          <p className="muted small or-divider">
            or <Link href="/account?next=%2Fshop">use a handle</Link>
          </p>
        </>
      ) : (
        <Link className="button" href="/account?next=%2Fshop">
          Sign in or create an account
        </Link>
      )}
    </>
  );
}
