/**
 * Everything the show has sold (M3, M4). Pure data, so client components can render the shop.
 *
 * Three kinds exist, and none touches the game: a premium house character to date, a cosmetic
 * frame around your name on league boards, or an episode pack (more dates for your characters).
 * Points, odds and rank are never for sale (there is no balance to sell: points are derived from
 * predictions, see lib/rules.ts).
 *
 * Payments go through Stripe Payment Links (the owner's call, BUILD.md), and one link sells one thing: the
 * PACKS each have their own link env (lib/stripe.ts paymentLinkFromEnv), and onSale(env) is the packs whose
 * link is set. Premium characters and frames stay listed so an order restored by hand still unlocks them,
 * but checkout refuses them.
 */
import { PREMIUM_HOUSE_CHARACTERS } from "./house";
import { FREE_EPISODES_PER_SEASON } from "./rules";
import { paymentLinkFromEnv } from "./stripe";

export const ITEM_KINDS = ["house_character", "frame", "episode_pack", "tip", "template"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Kinds you can buy again: episode packs stack. Everything else is owned once. */
export const isRepeatable = (kind: ItemKind) => kind === "episode_pack" || kind === "tip" || kind === "template";

/** One currency for now; the orders table only accepts this one. */
export const CURRENCY = "usd";

export type CatalogItem = {
  sku: string;
  kind: ItemKind;
  name: string;
  description: string;
  price_cents: number;
  /** house_character items: the characters row it unlocks. */
  character_id?: string;
  /** episode_pack items: how many dates it adds (on top of the free ones each season). */
  episodes?: number;
};

const FRAMES: readonly CatalogItem[] = [
  {
    sku: "frame_rose",
    kind: "frame",
    name: "Rose frame",
    description: "A rose-pink frame around your name on every league board. Cosmetic only.",
    price_cents: 200,
  },
  {
    sku: "frame_gold",
    kind: "frame",
    name: "Gold frame",
    description: "A gold frame around your name on every league board. Cosmetic only.",
    price_cents: 200,
  },
];

/**
 * M4's episode pack, sold through the owner's Stripe Payment Link: "5 more dates, $4" (REVENUE.md).
 * The price is set on the link in Stripe; price_cents is the list price, and the least a payment must
 * be for the webhook to grant it. If the link is ever changed to another size or price, change this.
 * The name avoids anything that reads like currency or points (tests/routes.test.ts checks).
 */
export const PACK_5: CatalogItem = {
  sku: "pack_5",
  kind: "episode_pack",
  name: "5 more dates",
  description:
    `5 more dates for your characters, on top of the ${FREE_EPISODES_PER_SEASON} free ones every week. ` +
    "Used after the free ones, they never expire. Adds episodes, never points.",
  price_cents: 400,
  episodes: 5,
};

/**
 * The bigger pack (2026-11-14, the money-at-the-wall item): 15 dates for $10, about 67¢ a date against the small
 * pack's 80¢, for whoever hits the free-dates wall and wants the week settled. It sells through its own Payment
 * Link (STRIPE_LINK_PACK_15) and is on sale only once that link is set.
 */
export const PACK_15: CatalogItem = {
  sku: "pack_15",
  kind: "episode_pack",
  name: "15 more dates",
  description:
    `15 more dates for your characters, on top of the ${FREE_EPISODES_PER_SEASON} free ones every week. ` +
    "Used after the free ones, they never expire. Adds episodes, never points.",
  price_cents: 1000,
  episodes: 15,
};

/**
 * Money features (lib/money/*, 2026-11-27), off until the owner switches them on: a tip to a character's creator, and a
 * creator's character sheet sold as a template. They are catalog items so the webhook prices and grants them like any
 * order, and neither is in the shop. Each needs its own Payment Link (STRIPE_LINK_<SKU>) before it can be bought.
 */
export const TIP_ITEMS: readonly CatalogItem[] = [2, 3, 5].map((d) => ({
  sku: `tip_${d}`,
  kind: "tip" as const,
  name: `A $${d} tip`,
  description: `A $${d} tip to a character's creator.`,
  price_cents: d * 100,
}));
export const MARKET_ITEMS: readonly CatalogItem[] = [3, 5].map((d) => ({
  sku: `market_${d}`,
  kind: "template" as const,
  name: `A $${d} character template`,
  description: `Your own copy of a creator's character sheet, for $${d}.`,
  price_cents: d * 100,
}));

export const CATALOG: readonly CatalogItem[] = [
  ...PREMIUM_HOUSE_CHARACTERS.map(
    (c): CatalogItem => ({
      sku: c.sku,
      kind: "house_character",
      name: c.name,
      description: `A premium house character to send your OC on a date with. ${c.bio}`,
      price_cents: c.price_cents,
      character_id: c.id,
    }),
  ),
  ...FRAMES,
  PACK_5,
  PACK_15,
  ...TIP_ITEMS,
  ...MARKET_ITEMS,
];

/** What the Payment Links can sell: the packs, the small one first. Checkout accepts these and no other SKU. */
export const PACKS: readonly CatalogItem[] = [PACK_5, PACK_15];
export const PACK_SKUS = PACKS.map((i) => i.sku) as [string, ...string[]];

/**
 * What's on sale right now: the packs whose Payment Link is set, in PACKS order (pack_5 first). pack_5 is always
 * listed, as the shop has always shown its tile (its Buy button is off while its link is unset, under "purchases open
 * soon"); any other pack with no link is simply not shown, so a missing link hides a tile instead of 503ing.
 */
export function onSale(env: Record<string, string | undefined> = process.env): CatalogItem[] {
  return PACKS.filter((i) => i === PACK_5 || paymentLinkFromEnv(env, i.sku) !== null);
}

export function catalogItem(sku: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.sku === sku);
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** CSS class for a worn frame (app/globals.css). */
export const frameClass = (sku: string) => `frame frame-${sku.replace(/^frame_/, "")}`;
