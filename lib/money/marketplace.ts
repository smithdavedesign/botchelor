/**
 * The creator marketplace (Agent World phase 6, behind MONEY_MARKETPLACE, off until the owner says): a creator lists
 * one of their public characters as a template for $3 or $5, and a buyer gets their own copy of the sheet to rename,
 * change and send on dates. The original stays the creator's: its dates, its record and its face are not copied.
 *
 * How a sale goes, with no change to the Stripe webhook:
 *  1. buyTemplate makes a pending order (lib/payments.ts) and a market_purchases row saying which listing it is for;
 *  2. the signed webhook marks the order paid, as for any purchase;
 *  3. the buyer claims it (claimTemplate) with a name of their own: a paid, unclaimed purchase becomes a private
 *     character owned by the buyer, made from the sheet as it is at that moment. A claim happens once.
 *
 * Rules:
 *  - only a public, listed character of your own, not a house one, one live listing a character; a blurb of up to
 *    BLURB_MAX characters (PG filter, no links);
 *  - not your own listing; a delisted listing can't be bought, but a paid purchase can still be claimed;
 *  - the copy: name, age, bio, traits, want, dealbreaker, look, appearance, pronouns, voice, colour and extras. Not its
 *    soul, secrets, tags, photos or history. It starts private and closed to dates until the buyer opens it;
 *  - the creator's share is a decision still open (docs/money-decisions.md): salesOf reports gross sales only.
 */
import { randomUUID } from "node:crypto";
import { catalogItem, MARKET_ITEMS } from "../catalog";
import type { Db } from "../db";
import { nameCheck } from "../name-check";
import { createPendingOrder } from "../payments";
import { withPortraits } from "../portrait-sql";
import { listedCharacterSql } from "../public-cast";
import { CHARACTER_REJECTION_MESSAGES, checkShowText } from "../safety";
import { paymentLinkFromEnv, paymentLinkUrl } from "../stripe";
import { moneyOn } from "./switches";

type Env = Record<string, string | undefined>;
type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });
const OFF = fail("not_found", "Not found.");

export const BLURB_MAX = 280;
export const MARKET_SKUS = MARKET_ITEMS.map((i) => i.sku);
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;

type CharRow = { id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string };
const charOf = async (db: Db, id: string): Promise<CharRow | null> =>
  (
    await db.query<CharRow>(`select id, name, owner_id, is_house, visibility from characters c where c.id::text = $1 and ${listedCharacterSql("c")}`, [id])
  ).rows[0] ?? null;

/** Lists one of your characters as a template. */
export async function listTemplate(
  db: Db,
  sellerUser: string,
  input: { character_id: string; sku: string; blurb?: unknown },
  env: Env = process.env,
): Promise<{ ok: true; id: string } | Fail> {
  if (!moneyOn("marketplace", env)) return OFF;
  const item = catalogItem(input.sku);
  if (!item || item.kind !== "template") return fail("sku", "Pick a $3 or $5 price.");
  const blurb = typeof input.blurb === "string" ? input.blurb.replace(/\s+/g, " ").trim() : "";
  if (blurb.length > BLURB_MAX) return fail("blurb", `Keep the blurb to ${BLURB_MAX} characters.`);
  if (LINKISH.test(blurb)) return fail("link", "No links in a listing.");
  if (blurb) {
    const check = checkShowText({ blurb });
    if (!check.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[check.reason] ?? "That isn't something the show can put on a page.");
  }
  const c = await charOf(db, input.character_id);
  if (!c || c.owner_id !== sellerUser || c.is_house) return fail("not_your_character", "List one of your own characters.");
  if (c.visibility !== "public") return fail("private", `${c.name} is private. Make them public to list them.`);
  const live = await db.query(`select 1 from market_listings where character_id = $1 and delisted_at is null`, [c.id]);
  if (live.rows.length) return fail("already_listed", `${c.name} is already listed.`);
  const id = `ml_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await db.query(`insert into market_listings (id, character_id, seller_user, sku, blurb) values ($1, $2, $3, $4, $5)`, [id, c.id, sellerUser, item.sku, blurb]);
  return { ok: true, id };
}

export async function delistTemplate(db: Db, sellerUser: string, listingId: string): Promise<{ ok: true } | Fail> {
  const { rows } = await db.query(`update market_listings set delisted_at = now() where id = $1 and seller_user = $2 and delisted_at is null returning id`, [listingId, sellerUser]);
  return rows.length ? { ok: true } : fail("not_found", "No such listing of yours.");
}

export type Listing = {
  id: string;
  price_cents: number;
  sku: string;
  blurb: string;
  sales: number;
  character: { id: string; name: string; hue: number | null; portrait: string | null; bio: string };
  yours?: boolean;
};

/** Live listings of public, listed characters, best sellers first. Off, there are none. */
export async function marketListings(db: Db, viewerId: string | null, env: Env = process.env, limit = 60): Promise<Listing[]> {
  if (!moneyOn("marketplace", env)) return [];
  const { rows } = await db.query<{ id: string; sku: string; blurb: string; seller_user: string; sales: number; character_id: string; name: string; hue: number | null; bio: string }>(
    `select l.id, l.sku, l.blurb, l.seller_user, l.character_id, c.name, c.avatar_hue as hue, c.bio,
            (select count(*)::int from market_purchases p join orders o on o.id = p.order_id where p.listing_id = l.id and o.status = 'paid') as sales
       from market_listings l join characters c on c.id = l.character_id
      where l.delisted_at is null and c.visibility = 'public' and ${listedCharacterSql("c")}
      order by sales desc, l.created_at desc limit $1`,
    [limit],
  );
  const faced = await withPortraits(db, rows.map((r) => ({ ...r, id: r.character_id, listing: r.id })));
  return faced.map((r) => ({
    id: r.listing,
    sku: r.sku,
    price_cents: catalogItem(r.sku)?.price_cents ?? 0,
    blurb: r.blurb,
    sales: r.sales,
    character: { id: r.character_id, name: r.name, hue: r.hue, portrait: r.portrait, bio: r.bio },
    ...(viewerId && r.seller_user === viewerId ? { yours: true } : {}),
  }));
}

/** Starts buying a template: a pending order for the listing's price and the Payment Link to pay it. */
export async function buyTemplate(db: Db, buyerUser: string, listingId: string, env: Env = process.env): Promise<{ ok: true; url: string; order_id: string } | Fail> {
  if (!moneyOn("marketplace", env)) return OFF;
  const l = (
    await db.query<{ id: string; sku: string; seller_user: string; name: string }>(
      `select l.id, l.sku, l.seller_user, c.name from market_listings l join characters c on c.id = l.character_id
        where l.id = $1 and l.delisted_at is null and c.visibility = 'public' and ${listedCharacterSql("c")}`,
      [listingId],
    )
  ).rows[0];
  if (!l) return fail("no_listing", "That listing isn't on sale.");
  if (l.seller_user === buyerUser) return fail("own", "That's your own listing.");
  const item = catalogItem(l.sku);
  if (!item) return fail("no_listing", "That listing isn't on sale.");
  const link = paymentLinkFromEnv(env, item.sku);
  if (!link) return fail("unavailable", "The marketplace isn't open yet. Nothing was charged.");
  const orderId = await createPendingOrder(db, buyerUser, item);
  await db.query(`insert into market_purchases (order_id, listing_id, buyer_user, seller_user) values ($1, $2, $3, $4)`, [orderId, l.id, buyerUser, l.seller_user]);
  return { ok: true, url: paymentLinkUrl(link, orderId), order_id: orderId };
}

export type Purchase = { order_id: string; status: "pending" | "paid" | "refunded"; claimed: boolean; copy_id: string | null; template: { id: string; name: string } };

/** A buyer's purchases: what's paid and waiting to be claimed, and what they've already made from. */
export async function purchasesOf(db: Db, buyerUser: string): Promise<Purchase[]> {
  const { rows } = await db.query<{ order_id: string; status: Purchase["status"]; claimed_at: Date | null; copy_id: string | null; character_id: string; name: string }>(
    `select p.order_id, o.status, p.claimed_at, p.copy_id, c.id as character_id, c.name
       from market_purchases p join orders o on o.id = p.order_id join market_listings l on l.id = p.listing_id join characters c on c.id = l.character_id
      where p.buyer_user = $1 and o.status <> 'pending' order by p.created_at desc`,
    [buyerUser],
  );
  return rows.map((r) => ({ order_id: r.order_id, status: r.status, claimed: r.claimed_at !== null, copy_id: r.copy_id, template: { id: r.character_id, name: r.name } }));
}

/**
 * Turns a paid purchase into the buyer's own private character, named by them. Once a purchase: the claim is taken
 * first (one UPDATE … WHERE claimed_at IS NULL), so two claims racing make one copy.
 */
export async function claimTemplate(db: Db, buyerUser: string, orderId: string, input: { name: unknown }): Promise<{ ok: true; character_id: string } | Fail> {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 60) return fail("name", "Give your copy a name (up to 60 characters).");
  const nameOk = checkShowText({ name });
  if (!nameOk.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[nameOk.reason] ?? "Pick another name.");
  const p = (
    await db.query<{ status: string; claimed_at: Date | null; character_id: string }>(
      `select o.status, p.claimed_at, l.character_id from market_purchases p join orders o on o.id = p.order_id join market_listings l on l.id = p.listing_id
        where p.order_id = $1 and p.buyer_user = $2`,
      [orderId, buyerUser],
    )
  ).rows[0];
  if (!p) return fail("not_found", "No such purchase of yours.");
  if (p.status !== "paid") return fail("not_paid", p.status === "refunded" ? "That purchase was refunded." : "That purchase hasn't been paid yet.");
  if (p.claimed_at) return fail("claimed", "You've already made your copy from this one.");
  const { twin } = await nameCheck(db, name);
  if (twin) return fail("name_taken", `There's already a ${twin.name} on the show. Pick another name.`);
  const taken = await db.query(`update market_purchases set claimed_at = now() where order_id = $1 and claimed_at is null returning order_id`, [orderId]);
  if (!taken.rows.length) return fail("claimed", "You've already made your copy from this one.");
  const id = randomUUID();
  try {
    const made = await db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, look, appearance, pronouns, voice, avatar_hue, extras,
                               visibility, open_to_dates, partner_style)
       select $1, $2, false, $3, age, bio, traits, want, dealbreaker, look, appearance, pronouns, voice, avatar_hue, extras, 'private', false, 'open'
         from characters where id = $4
       returning id`,
      [id, buyerUser, name, p.character_id],
    );
    if (!made.rows.length) throw new Error("template gone");
  } catch (e) {
    await db.query(`update market_purchases set claimed_at = null where order_id = $1`, [orderId]);
    if (e instanceof Error && e.message === "template gone") return fail("gone", "That template is no longer on the show. The purchase can be refunded.");
    throw e;
  }
  await db.query(`update market_purchases set copy_id = $2 where order_id = $1`, [orderId, id]);
  return { ok: true, character_id: id };
}

/** A seller's gross sales (paid, not refunded), per listing and in all. Their share is not decided yet. */
export async function salesOf(db: Db, sellerUser: string): Promise<{ gross_cents: number; sales: number }> {
  const { rows } = await db.query<{ gross: number; n: number }>(
    `select coalesce(sum(o.amount_cents), 0)::int as gross, count(*)::int as n from market_purchases p join orders o on o.id = p.order_id
      where p.seller_user = $1 and o.status = 'paid'`,
    [sellerUser],
  );
  return { gross_cents: rows[0]!.gross, sales: rows[0]!.n };
}
