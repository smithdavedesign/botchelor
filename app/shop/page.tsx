import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { episodeAllowance } from "@/lib/allowance";
import { CATALOG, formatPrice, frameClass, isRepeatable, type ItemKind } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { getPayments } from "@/lib/stripe";
import BuyButton from "./BuyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop · Botchelor" };

const KIND_LABELS: Record<ItemKind, string> = {
  house_character: "Premium house character",
  frame: "Profile frame",
  episode_pack: "Episode pack",
};

const KIND_NOTES: Record<ItemKind, string | null> = {
  house_character:
    "Episodes are public and creators are anonymous, but only buyers can date a premium character. While few people own one, a date with them hints that it's yours.",
  frame: null,
  episode_pack: null,
};

/** House characters and frames are owned once; episode packs stay on sale, since their dates add up. */
const OWNED_NOTES: Record<ItemKind, string> = {
  house_character: "Owned. Pick them when you send your character on a date.",
  frame: "Owned. Your latest frame shows around your name on league boards.",
  episode_pack: "Bought before. Buy again whenever you like; the dates add up.",
};

/** Episode packs first: they're what a creator who runs out of dates is looking for. */
const KIND_ORDER: ItemKind[] = ["episode_pack", "house_character", "frame"];
const ITEMS = [...CATALOG].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const { checkout } = await searchParams;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const packLeft = db && viewerId ? (await episodeAllowance(db, viewerId)).pack_left : 0;
  const open = getPayments() !== null;

  return (
    <>
      <h1>Shop</h1>
      <p>
        Episode packs for more dates, premium house characters for your OC to date, and frames for your name on league
        boards. <strong>Nothing here changes points, picks, badges or rank, and points can&apos;t be bought.</strong>
      </p>
      <p className="muted">
        Every creator gets {FREE_EPISODES_PER_SEASON} free dates a week. Packs are only for wanting more.
        {packLeft > 0 && ` You have ${packLeft} pack ${packLeft === 1 ? "date" : "dates"} left.`}
      </p>
      {checkout === "success" && (
        <p className="notice">
          Thanks! Your item appears here as soon as Stripe confirms the payment, usually within a few seconds. Refresh
          if it isn&apos;t here yet.
        </p>
      )}
      {checkout === "cancelled" && <p className="muted">Checkout cancelled. Nothing was charged.</p>}
      {!open && <p className="notice">Purchases open soon. Everything else on Botchelor is free.</p>}

      <ul className="list">
        {ITEMS.map((item) => (
          <li key={item.sku} className="card">
            <strong className={item.kind === "frame" ? frameClass(item.sku) : undefined}>
              {item.name}
            </strong>
            <span className="badge">{KIND_LABELS[item.kind]}</span> <span className="price">{formatPrice(item.price_cents)}</span>
            <p>{item.description}</p>
            {KIND_NOTES[item.kind] && <p className="muted">{KIND_NOTES[item.kind]}</p>}
            {owned.includes(item.sku) && <p className="notice">{OWNED_NOTES[item.kind]}</p>}
            {(isRepeatable(item.kind) || !owned.includes(item.sku)) && (
              <BuyButton sku={item.sku} price={formatPrice(item.price_cents)} disabled={!open} />
            )}
          </li>
        ))}
      </ul>

      <p className="muted">
        Payments are handled by Stripe; we never see your card. Botchelor has no accounts yet, so purchases belong to
        this browser: keep your Stripe receipt, and we can move an item to a new browser. Refunds within 14 days, see the{" "}
        <Link href="/legal">terms</Link>.
      </p>
    </>
  );
}
