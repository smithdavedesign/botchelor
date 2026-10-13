/**
 * Everything the show sells (M3, M4). Pure data, so client components can render the shop.
 *
 * Three kinds exist, and none touches the game: a premium house character to date, a cosmetic
 * frame around your name on league boards, or an episode pack (more dates for your characters).
 * Points, odds and rank are never for sale (there is no balance to sell: points are derived from
 * predictions, see lib/rules.ts).
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

const packDescription = (episodes: number) =>
  `${episodes} more dates for your characters, on top of the ${FREE_EPISODES_PER_SEASON} free ones every week. ` +
  "Used after the free ones, they never expire. Adds episodes, never points.";

// M4. Names avoid anything that reads like currency or points (tests/routes.test.ts checks).
const PACKS: readonly CatalogItem[] = [
  {
    sku: "pack_10",
    kind: "episode_pack",
    name: "Episode pack: 10 dates",
    description: packDescription(10),
    price_cents: 500,
    episodes: 10,
  },
  {
    sku: "pack_25",
    kind: "episode_pack",
    name: "Episode pack: 25 dates",
    description: packDescription(25),
    price_cents: 1000,
    episodes: 25,
  },
];

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
  ...PACKS,
];

export const SKUS = CATALOG.map((i) => i.sku) as [string, ...string[]];

export function catalogItem(sku: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.sku === sku);
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** CSS class for a worn frame (app/globals.css). */
export const frameClass = (sku: string) => `frame frame-${sku.replace(/^frame_/, "")}`;
