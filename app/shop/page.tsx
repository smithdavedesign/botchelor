import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { CATALOG, formatPrice, frameClass, ON_SALE, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import BuyButton from "./BuyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop · Botchelor" };

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
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const open = paymentLinkFromEnv() !== null;
  const ownedOffSale = CATALOG.filter((i) => !ON_SALE.includes(i) && owned.includes(i.sku));

  return (
    <>
      <h1>Shop</h1>
      <p>
        More dates for your characters, when the free ones aren&apos;t enough.{" "}
        <strong>Nothing here changes points, picks, badges or rank, and points can&apos;t be bought.</strong>
      </p>
      <p className="muted">
        You have {dates.free_left} of {dates.free_per_season} free dates left this week
        {dates.pack_left > 0 && `, plus ${dates.pack_left} pack ${dates.pack_left === 1 ? "date" : "dates"}`}. Free
        dates come back Monday 00:00 UTC.
      </p>
      {checkout === "success" && (
        <p className="notice">
          Thanks! Your dates are added as soon as Stripe confirms the payment, usually within a few seconds. Refresh if
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
        yet, so purchases belong to this browser: keep your Stripe receipt, and we can move your dates to a new
        browser. Refunds within 14 days, see the <Link href="/terms">terms</Link>.
      </p>
    </>
  );
}
