/**
 * The curated, human-reviewed first-party art: the house-cast portraits and venue backdrops committed to
 * `public/cast/*.webp` in PR #25 ("25 images, reviewed"). These are vetted assets in version control, so
 * they render directly from `/cast/...` — no per-render database read.
 *
 * The `character_assets` provenance ledger (`lib/assets.ts`) stays the approval gate for any DYNAMIC or
 * user-supplied image: nothing generated or uploaded reaches a page without a human approving it there.
 * This module is only for the fixed house cast and the venue library, which are reviewed by definition.
 *
 * Client-safe: pure constants and functions, no server imports, so `app/Avatar.tsx` can use it on both the
 * server and the client, and a visitor's own OC (not in these sets) simply keeps its gradient avatar.
 */
import { placeParts, type PlaceId } from "./venues";

const PORTRAIT_VERSION = "v3";
const BACKDROP_VERSION = "v2";

/**
 * The house characters that have a reviewed portrait (all 17 today). Listed explicitly rather than derived
 * from the cast so a character without a committed, reviewed image can never render a broken `<img>`; a new
 * house portrait is added here once its file is reviewed and committed. `tests/portraits.test.ts` keeps this
 * in lock-step with both `lib/house.ts` and the files on disk.
 */
export const HOUSE_PORTRAIT_IDS: ReadonlySet<string> = new Set([
  "house-rafe", "house-juniper", "house-dex", "house-marisol", "house-teo", "house-nell", "house-sable",
  "house-orin", "house-imogen", "house-kaz", "house-wally", "house-perpetua", "house-ines", "house-boaz",
  "house-lior", "house-vesper", "house-odalys",
]);

/** The portrait path for a character, or null when it has none — every visitor OC, so they keep the gradient. */
export function characterPortrait(characterId: string | null | undefined): string | null {
  return characterId && HOUSE_PORTRAIT_IDS.has(characterId)
    ? `/cast/${characterId}-${PORTRAIT_VERSION}.webp`
    : null;
}

/**
 * The venues with a reviewed backdrop photo: the first eight on 2026-10-13, the twenty-five added on 2026-10-18, and
 * then the "phase two" places a move or a plan goes to (2026-10-18): eight more dealt venues plus the two EXTRA_VENUES,
 * `home` (one of their places) and `elsewhere` (the generic placeholder). Listed explicitly, like the portraits, so a
 * venue added later without a committed, reviewed image paints its gradient (and the stage names it) instead of a broken
 * background. `tests/portraits.test.ts` checks the files are on disk.
 */
export const VENUES_WITH_BACKDROPS: ReadonlySet<string> = new Set([
  "rooftop_bar", "corner_cafe", "retro_arcade", "botanic_park", "tasting_menu", "night_beach", "double_date", "karaoke_booth",
  "skydive", "surf_lesson", "dive_bar", "nightclub", "safari", "escape_room", "flat_pack", "pottery_class", "hot_air_balloon",
  "bowling_alley", "laundromat", "ice_rink", "cooking_class", "haunted_house", "silent_disco", "museum_night", "rainy_campsite",
  "goat_yoga", "swan_pedalo", "murder_mystery", "ballroom_lesson", "paintball", "trail_ride", "comedy_club", "climbing_wall",
  "late_night_diner", "night_market", "old_cinema", "stargazing_hill", "city_walk", "pier_at_night", "jazz_bar", "late_bookshop",
  "home", "elsewhere",
]);

/**
 * The backdrop image path for a venue or a place (a place with its own name uses its venue's backdrop), or null when
 * it has none yet (it paints its gradient) or isn't a venue.
 */
export function venueBackdrop(id: PlaceId | string | null | undefined): string | null {
  const base = placeParts(id).id;
  return base && VENUES_WITH_BACKDROPS.has(base) ? `/cast/venue-${base}-${BACKDROP_VERSION}.webp` : null;
}
