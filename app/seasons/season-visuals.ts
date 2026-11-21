/**
 * What the season pages draw that the frozen finale (lib/season-recap.ts) doesn't store: which venue's photo stands behind
 * a rewatch row or the finale's hero, and how long the running season has left. Pure: no database, no model.
 *
 * A finale stores each date's place as the short phrase its lines use ("a basement jazz bar", "Chud's place"), not the
 * venue's id, and the stored shape is frozen (RECAP_VERSION). The phrase is a pure function of the id (placeOf), so the
 * id is found again by computing every venue's phrase once; a place of their own ("Chud's place") has no set and no photo.
 */
import type { NextPremiere } from "@/lib/premiere-clock";
import { seasonArc, type SeasonFormatDef } from "@/lib/season-format";
import { placeOf, type RecapEpisode, type SeasonRecapData } from "@/lib/season-recap";
import { DATE_VENUES, EXTRA_VENUES, venueIdFor } from "@/lib/venues";

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

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The month clock on the seasons index, by the same count as the season's arc under the header (lib/season-format.ts
 * seasonArc, app/SeasonBanner.tsx): the days to the finale, or after a lead format's final rose, to the season's end.
 * It counted nights to the month's end its own way, tonight included, so "11 nights left in the month" sat under the
 * strip's "10 days to the finale" (visual audit 2026-11-20). `def`: the running season's format, as the strip gets it.
 */
export function daysLeftLabel(now: Date, def: SeasonFormatDef | null = null): string {
  const { left, to } = seasonArc(now, def);
  if (to === "end") return left === 0 ? "Last night of the season" : `${days(left)} left in the season`;
  return left === 0 ? "The finale is tonight" : `${days(left)} to the finale`;
}

/**
 * The next Sunday premiere's name, as its clock on a season's hero shows it (app/seasons/PremiereCountdown.tsx): "The
 * pilot, Meet the lead", "Sunday's premiere" or "The finale's premiere", with who the lead dates once it's built.
 */
export function premiereLabel(p: Pick<NextPremiere, "kind" | "finale" | "lead" | "suitor">): string {
  const name = p.kind === "pilot" ? "The pilot, Meet the lead" : p.finale ? "The finale's premiere" : "Sunday's premiere";
  const first = (n: string) => n.split(" ")[0];
  return p.suitor ? `${name}: ${first(p.lead.name)} and ${first(p.suitor.name)}` : name;
}
