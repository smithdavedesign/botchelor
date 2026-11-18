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
import { artStyleOf, type ArtStyle } from "./art-style";
import { placeParts, type PlaceId } from "./venues";

/**
 * v5 (PRD styles-and-storylines phase 3): the house look, every house character redrawn in 2.5D from their own portrait
 * (look A of the pilot, drawn free on the Workers AI Worker, David's pick). Before it, v3 for most and v4 for three.
 */
const PORTRAIT_VERSION = "v5";
const BACKDROP_VERSION = "v2";

/**
 * Each house character's portrait before the house look, which After Dark still draws them from (lib/adult/media.ts
 * showPortrait): After Dark only draws photographs, so a 2.5D face never becomes its starting point (phase 8's gates).
 * v3 for most; v4 for the three redrawn in photoreal on 2026-11-08 (2026-11-07 audit, item 15) through the admin
 * redraw: Venice in safe mode from their house look, Hive-checked PG, kept in the asset ledger, then committed here.
 */
const BEFORE_HOUSE_LOOK: Readonly<Record<string, string>> = { "house-nell": "v4", "house-juniper": "v4", "house-sable": "v4" };

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
  return characterId && HOUSE_PORTRAIT_IDS.has(characterId) ? `/cast/${characterId}-${PORTRAIT_VERSION}.webp` : null;
}

/**
 * How the show draws a character, where only the row is at hand: the house look (2.5D) for the fixed house cast, whose
 * committed file is their house-look portrait, else their own style. showStyleSql (lib/art-style.ts) is the same in SQL,
 * read from the face itself, so it also covers a newcomer's ledger portrait.
 */
export const showStyleOf = (c: { id: string; extras?: { looks?: { style?: string } | null } | null }): ArtStyle =>
  HOUSE_PORTRAIT_IDS.has(c.id) ? "semi_real" : artStyleOf(c);

/** The face After Dark starts a house character's pictures from: their portrait before the house look, or null. */
export function afterDarkPortrait(characterId: string | null | undefined): string | null {
  return characterId && HOUSE_PORTRAIT_IDS.has(characterId) ? `/cast/${characterId}-${BEFORE_HOUSE_LOOK[characterId] ?? "v3"}.webp` : null;
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
  // The themed nights (2026-11-17), drawn free on Workers AI with the backdrop-v3 prompt (scripts/prompts.mjs).
  "gothic_manor", "countryside_picnic", "space_lounge", "cavern_lounge",
]);

/** The venues whose backdrop is a later version than BACKDROP_VERSION, and its version. */
const BACKDROP_VERSIONS: Readonly<Record<string, string>> = { gothic_manor: "v3", countryside_picnic: "v3", space_lounge: "v3", cavern_lounge: "v3" };

/**
 * The backdrop image path for a venue or a place (a place with its own name uses its venue's backdrop), or null when
 * it has none yet (it paints its gradient) or isn't a venue.
 */
export function venueBackdrop(id: PlaceId | string | null | undefined): string | null {
  const base = placeParts(id).id;
  return base && VENUES_WITH_BACKDROPS.has(base) ? `/cast/venue-${base}-${BACKDROP_VERSIONS[base] ?? BACKDROP_VERSION}.webp` : null;
}
