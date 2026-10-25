/**
 * How explicit a stored picture or clip is, as one strict tag on the asset itself (David, 2026-10-25: "we need strict
 * tags on assets that are nsfw"). Every `character_assets` and `adult_images` row carries one, and the serve gate
 * (lib/asset-gate.ts) decides from it alone who gets the bytes:
 *
 * - `pg`: anyone, as the show's portraits always were.
 * - `suggestive` (swimwear away from a beach, revealing clothes): signed-in people only, never a bot, never cached
 *   publicly.
 * - `nsfw` (nudity, sex): only someone After Dark is open to. Everyone else gets at most a server-blurred teaser
 *   (lib/teaser-image.ts), never the original bytes.
 *
 * Fail closed: anything that isn't one of the three reads as `nsfw`, and a new row defaults to it in the schema. A
 * rating is the stricter of what the picture was asked for and what the check saw; it only comes down through a fresh
 * check that passed, never through a choice or an owner's edit.
 *
 * Pure: no database. Pages, routes and the Studio share it.
 */

export const CONTENT_RATINGS = ["pg", "suggestive", "nsfw"] as const;
export type ContentRating = (typeof CONTENT_RATINGS)[number];

const RANK: Record<ContentRating, number> = { pg: 0, suggestive: 1, nsfw: 2 };

/** A stored or sent value as a rating: anything unknown (null, a typo, an old value) is `nsfw`. */
export const ratingOf = (v: unknown): ContentRating => (CONTENT_RATINGS as readonly unknown[]).includes(v) ? (v as ContentRating) : "nsfw";

/** The stricter of two ratings. */
export const stricter = (a: ContentRating, b: ContentRating): ContentRating => (RANK[a] >= RANK[b] ? a : b);

/**
 * A Studio level (lib/adult/studio-catalog.ts LEVELS: 0 dressed, 1 suggestive, 2 nude, 3 explicit) as a rating. A
 * level that isn't one of those is `nsfw`.
 */
export function ratingForLevel(level: unknown): ContentRating {
  if (level === 0) return "pg";
  if (level === 1) return "suggestive";
  return "nsfw";
}

/**
 * A new asset's rating: the stricter of what it was asked for (`intended`) and what the check measured. No measurement
 * (the check didn't run or couldn't say) is `nsfw`: a picture is only ever as tame as a check has seen it to be.
 */
export const rateAsset = (intended: ContentRating, measured: ContentRating | null | undefined): ContentRating =>
  stricter(intended, measured ?? "nsfw");

/** Who may be sent an asset's original bytes. */
export type Audience = "everyone" | "signed_in" | "after_dark";
export const audienceFor = (r: ContentRating): Audience => (r === "pg" ? "everyone" : r === "suggestive" ? "signed_in" : "after_dark");

/** Whether a stored rating may be replaced by `next`: going up always may; coming down only on a check that just passed. */
export const mayRerate = (current: ContentRating, next: ContentRating, freshCheck: boolean): boolean => RANK[next] >= RANK[current] || freshCheck;
