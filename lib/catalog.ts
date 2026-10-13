/**
 * Everything the show has sold (M3, M4). Pure data, so client components can render the shop.
 *
 * Three kinds exist, and none touches the game: a premium house character to date, a cosmetic
 * frame around your name on league boards, or an episode pack (more dates for your characters).
 * Points, odds and rank are never for sale (there is no balance to sell: points are derived from
 * predictions, see lib/rules.ts).
 *
 * Payments go through one Stripe Payment Link (the owner's call, BUILD.md), and one link sells one
 * thing: ON_SALE is just the 5-date pack. Premium characters and frames stay listed so an order
 * restored by hand still unlocks them, but checkout refuses them.
 */
import { PREMIUM_HOUSE_CHARACTERS } from "./house";
import { FREE_EPISODES_PER_SEASON } from "./rules";

export const ITEM_KINDS = ["house_character", "frame", "episode_pack"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Kinds you can buy again: episode packs stack. Everything else is owned once. */
export const isRepeatable = (kind: ItemKind) => kind === "episode_pack";

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
 * M4's one episode pack, sold through the owner's Stripe Payment Link: "5 more dates, $4" (REVENUE.md).
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
];

/** What checkout sells: what the one Payment Link sells. */
export const ON_SALE: readonly CatalogItem[] = [PACK_5];
export const ON_SALE_SKUS = ON_SALE.map((i) => i.sku) as [string, ...string[]];

export function catalogItem(sku: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.sku === sku);
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** CSS class for a worn frame (app/globals.css). */
export const frameClass = (sku: string) => `frame frame-${sku.replace(/^frame_/, "")}`;
