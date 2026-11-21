import { venueBackdrop } from "@/lib/portraits";

/**
 * The places a date pack's picture shows (pass 2 of the 2026-11-20 visual pop audit): five for the 5-pack, fifteen for
 * the 15-pack, one per date it buys, all different. Each is a small cut of the venue's reviewed backdrop
 * (public/cast/venue-thumb-<id>.webp, about 5 KB, made by scripts/venue-thumbs.mjs), so twenty of them weigh less than
 * two full backdrops. PG venues only; the show's own sets.
 */
export const PACK_VENUES: Readonly<Record<5 | 15, readonly string[]>> = {
  5: ["rooftop_bar", "night_market", "karaoke_booth", "botanic_park", "jazz_bar"],
  15: [
    "hot_air_balloon",
    "ice_rink",
    "old_cinema",
    "night_beach",
    "pottery_class",
    "retro_arcade",
    "stargazing_hill",
    "late_night_diner",
    "swan_pedalo",
    "museum_night",
    "silent_disco",
    "cooking_class",
    "pier_at_night",
    "bowling_alley",
    "late_bookshop",
  ],
};

/** A venue's small cut, or null for a venue with no backdrop (it's never shown then). */
export function venueThumb(id: string): string | null {
  return venueBackdrop(id) ? `/cast/venue-thumb-${id}.webp` : null;
}

/** The pictures for a pack of this many dates: its own list, or none for a size without one. */
export function packVenues(dates: number): { id: string; src: string }[] {
  const ids = dates === 5 || dates === 15 ? PACK_VENUES[dates] : [];
  return ids.flatMap((id) => {
    const src = venueThumb(id);
    return src ? [{ id, src }] : [];
  });
}
