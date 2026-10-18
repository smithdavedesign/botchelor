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
import type { VenueId } from "./venues";

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
 * The venues with a reviewed backdrop photo (the first eight). Listed explicitly, like the portraits, so a venue
 * without a committed, reviewed image paints its gradient instead of a broken background: the twenty-five added on
 * 2026-10-18 do, until theirs are made and reviewed. `tests/portraits.test.ts` checks the files are on disk.
 */
export const VENUES_WITH_BACKDROPS: ReadonlySet<string> = new Set([
  "rooftop_bar", "corner_cafe", "retro_arcade", "botanic_park", "tasting_menu", "night_beach", "double_date", "karaoke_booth",
]);

/** The backdrop image path for a venue, or null when it has none yet (it paints its gradient) or isn't a venue. */
export function venueBackdrop(id: VenueId | null | undefined): string | null {
  return id && VENUES_WITH_BACKDROPS.has(id) ? `/cast/venue-${id}-${BACKDROP_VERSION}.webp` : null;
}
