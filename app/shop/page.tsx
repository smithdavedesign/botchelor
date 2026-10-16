import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { CATALOG, formatPrice, frameClass, ON_SALE, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
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
  const viewerId = userIdFromCookieStore(await cookies());
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const open = paymentLinkFromEnv() !== null;
  const ownedOffSale = CATALOG.filter((i) => !ON_SALE.includes(i) && owned.includes(i.sku));

  return (
    <>
      <h1>Tokens</h1>
      <p>
        Top up your tokens when the free ones run out. <strong>One token sends a character on one date.</strong>{" "}
        <strong>Nothing here changes points, picks, badges or rank, and points can&apos;t be bought.</strong>
      </p>
      <p className="muted">
        Topped-up tokens also make a 4-second intro clip for a character of yours: one token each, plus about $0.20 on
        your own Google key (Veo). A clip Google can&apos;t make gives the token back.
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
          <li key={item.sku} className="card">
            <strong>{item.name}</strong> <span className="badge">{KIND_LABELS[item.kind]}</span>
            <p>{item.description}</p>
            {owned.includes(item.sku) && <p className="notice">{OWNED_NOTES[item.kind]}</p>}
            <BuyButton
              sku={item.sku}
              label={priceLabelFromEnv(process.env, `Buy ${item.name} for ${formatPrice(item.price_cents)}`)}
              disabled={!open}
            />
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

      <p className="muted">
        You pay on Stripe&apos;s own page (a Stripe Payment Link); we never see your card. Botchelor has no accounts
        yet, so purchases belong to this browser: keep your Stripe receipt, and we can move your tokens to a new
        browser. Refunds within 14 days, see the <Link href="/terms">terms</Link>.
      </p>
    </>
  );
}
