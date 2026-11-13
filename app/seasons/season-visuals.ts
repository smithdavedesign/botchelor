/**
 * What the season pages draw that the frozen finale (lib/season-recap.ts) doesn't store: which venue's photo stands behind
 * a rewatch row or the finale's hero, and how long the running season has left. Pure: no database, no model.
 *
 * A finale stores each date's place as the short phrase its lines use ("a basement jazz bar", "Chud's place"), not the
 * venue's id, and the stored shape is frozen (RECAP_VERSION). The phrase is a pure function of the id (placeOf), so the
 * id is found again by computing every venue's phrase once; a place of their own ("Chud's place") has no set and no photo.
 */
import { placeOf, type RecapEpisode, type SeasonRecapData } from "@/lib/season-recap";
import { seasonWindow } from "@/lib/season-window";
import { DATE_VENUES, EXTRA_VENUES, venueIdFor } from "@/lib/venues";

const DAY_MS = 24 * 60 * 60 * 1000;

let byPhrase: Map<string, string> | null = null;
function phrases(): Map<string, string> {
  if (!byPhrase) {
    byPhrase = new Map();
    for (const v of [...DATE_VENUES, ...EXTRA_VENUES]) {
      const phrase = placeOf(v.id);
      if (phrase && !byPhrase.has(phrase.toLowerCase())) byPhrase.set(phrase.toLowerCase(), v.id);
    }
  }
  return byPhrase;
}

/** The venue a recap's place names ("a basement jazz bar" → jazz_bar; a venue's own name or id too), or null. */
export function venueIdForPlace(place: string | null | undefined): string | null {
  if (!place) return null;
  return phrases().get(place.trim().toLowerCase()) ?? venueIdFor(place);
}

const samePair = (e: RecapEpisode, pair: { a: { id: string }; b: { id: string } }) =>
  (e.a.id === pair.a.id && e.b.id === pair.b.id) || (e.a.id === pair.b.id && e.b.id === pair.a.id);

/**
 * The venue behind the finale's hero: the golden couple's date among the ones to rewatch (their best, by calls), else the
 * season's most-called date, else null (the title card's gradient stands alone).
 */
export function heroVenue(d: Pick<SeasonRecapData, "golden" | "rewatch">): string | null {
  const theirs = d.golden ? d.rewatch.filter((e) => samePair(e, d.golden!)) : [];
  for (const e of [...theirs, ...d.rewatch]) {
    const id = venueIdForPlace(e.place);
    if (id) return id;
  }
  return null;
}

/** Whole days until the running season closes: 1 on its last day. */
export function daysLeft(now: Date): number {
  return Math.max(1, Math.ceil((seasonWindow(now).end.getTime() - now.getTime()) / DAY_MS));
}

/** The month clock on the seasons index, in the show's voice. */
export function daysLeftLabel(now: Date): string {
  const n = daysLeft(now);
  if (n === 1) return "Last night of the season";
  return `${n} nights left in the month`;
}
