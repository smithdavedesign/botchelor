/**
 * Overnight dates (David, 2026-11-15, the drama wave, part 5): reality TV has the overnight, and so does the show. A
 * couple that has earned it gets an overnight date. On the show it fades to black: when the engine ends it in another
 * date, the ending is told as leaving together ("They left together. The cameras stayed behind."), from the templates
 * below. Nothing here touches points, odds, pairings or endings: the engine decides the overnight date like any other,
 * and no prompt is told anything suggestive (no prompt is told it's an overnight at all).
 *
 * This file is the rules, the switches and the words: pure, with no server imports, so pages, client components and
 * tests share it. The database half is lib/overnight.ts; the house's booking is lib/overnight-house.ts; what After Dark
 * does with an overnight date is lib/adult/overnight.ts.
 */
import type { SeeAgain } from "./inner-life";
import type { Ending } from "./rules";
import type { VenueId } from "./venues";

type Env = Record<string, string | undefined>;

/** OVERNIGHT_DATES=0 turns overnight dates off (no offer, no house booking, no card); anything else, or nothing, leaves them on. */
export function overnightDatesOn(env: Env = process.env): boolean {
  return env.OVERNIGHT_DATES?.trim() !== "0";
}

/**
 * OVERNIGHT_AFTER_DARK=0 removes "Continue the night in After Dark" (lib/adult/overnight.ts). On by default: the button
 * only ever shows to someone After Dark already admits, so the switch opens nothing by being on.
 */
export function overnightAfterDarkOn(env: Env = process.env): boolean {
  return env.OVERNIGHT_AFTER_DARK?.trim() !== "0";
}

/** The milestone's numbers, in one place. */
export const OVERNIGHT_RULES = {
  /** Aired dates the pair needs before an overnight. */
  minAiredDates: 3,
  /** How many of their latest aired dates, in a row, ended in another date. */
  secondDatesInARow: 2,
  /** Overnight dates the house books a UTC day, show-wide (each is one date on the show's model). */
  housePerDay: 1,
} as const;

/**
 * Where an overnight date happens: the library's evening places (lib/venues.ts), each with a reviewed set. Public
 * places, like every date: the night's "after" is never on the show.
 */
export const OVERNIGHT_VENUES: readonly VenueId[] = ["stargazing_hill", "pier_at_night", "jazz_bar", "night_market", "late_night_diner", "old_cinema", "rooftop_bar"];

/** FNV-1a, so the venue pick needs no import (the engine's seedFrom would pull the engine into a client bundle). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The evening place for a pair's overnight this season: the same pair and season always get the same one. */
export function pickOvernightVenue(lo: string, hi: string, seasonId: string): VenueId {
  return OVERNIGHT_VENUES[hash(`overnight:${lo}:${hi}:${seasonId}`) % OVERNIGHT_VENUES.length];
}

/* ------------------------------------------------ the milestone ------------------------------------------------ */

/** One aired, public date between the pair, as the milestone reads it. */
export type AiredDate = {
  id: string;
  ending: Ending;
  /** Each side's own "see them again?" (lib/choices.ts), public once the date has aired; null when it wasn't asked. */
  see_again: { a: SeeAgain | null; b: SeeAgain | null };
};

export type MilestoneInput = {
  /** The pair's aired, public dates, oldest first. Nothing unaired, private, unlisted or hidden is ever in here. */
  aired: readonly AiredDate[];
  /** They're exes or bad blood on the public record, or their owners blocked each other. */
  badBlood: boolean;
  /** They've had an overnight date this season already (booked counts: one a season, however it ended). */
  hadOneThisSeason: boolean;
  /** Their next date is already on its way: one being filmed or waiting to air, or the latest aired date's follow-up is booked. */
  nextDateUnderWay: boolean;
};

export type MilestoneWhy = "few_dates" | "not_in_a_row" | "not_mutual" | "bad_blood" | "had_one" | "next_date_under_way";
export type Milestone = { ok: true; after: string } | { ok: false; why: MilestoneWhy };

/**
 * Whether a pair has earned an overnight date, from its aired dates only (pure): at least `minAiredDates` aired dates,
 * the last `secondDatesInARow` ending in another date, both sides' latest "see them again?" a yes, no bad blood, and no
 * overnight with each other this season. `after` is their latest aired date: the overnight is its follow-up.
 */
export function overnightMilestone(m: MilestoneInput): Milestone {
  const no = (why: MilestoneWhy): Milestone => ({ ok: false, why });
  if (m.badBlood) return no("bad_blood");
  if (m.aired.length < OVERNIGHT_RULES.minAiredDates) return no("few_dates");
  const tail = m.aired.slice(-OVERNIGHT_RULES.secondDatesInARow);
  if (tail.length < OVERNIGHT_RULES.secondDatesInARow || tail.some((d) => d.ending !== "second_date")) return no("not_in_a_row");
  const last = m.aired[m.aired.length - 1];
  if (last.see_again.a !== "yes" || last.see_again.b !== "yes") return no("not_mutual");
  if (m.hadOneThisSeason) return no("had_one");
  if (m.nextDateUnderWay) return no("next_date_under_way");
  return { ok: true, after: last.id };
}

/* --------------------------------------------------- the words --------------------------------------------------- */

/** Every line the show says about an overnight date. Templates: no model writes any of them. */
export const OVERNIGHT_COPY = {
  /** The chip on the episode, and the badge on a timeline. */
  chip: "🌙 Overnight date",
  /** The closing card when the engine ended it in another date. */
  leftTogether: "They left together. The cameras stayed behind.",
  /** The short form, for a label or a list. */
  leftTogetherShort: "They left together",
  /** The closing card for any other ending: told as it is. */
  calledIt: "They called it a night.",
  /** The offer, to an owner. */
  offerTitle: "An overnight date",
  /** The one button an After Dark viewer sees on it (lib/adult/overnight.ts). */
  continueButton: "Continue the night in After Dark",
  /** The button on After Dark's own page for the date (app/after-dark/overnight/[id]). */
  continueHere: "Continue the night",
  /** Part C's one fixed sentence, private to the two owners. */
  nightTogether: "They spent the night together.",
} as const;

/** Whether an overnight date's ending is told as leaving together: only when the engine ended it in another date. */
export const leftTogether = (ending: Ending | string | null | undefined): boolean => ending === "second_date";

/** The closing card of an overnight date (the fade to black), by how the engine ended it. */
export const overnightClose = (ending: Ending | string | null | undefined): string => (leftTogether(ending) ? OVERNIGHT_COPY.leftTogether : OVERNIGHT_COPY.calledIt);

/**
 * How an overnight date's ending is told where a date's ending is one label (the theater's last card, the recap):
 * leaving together in place of "another date"; any other ending keeps its own label, and the night is called.
 */
export function overnightEndingLabel(ending: Ending | string | null | undefined, usual: string): string {
  return leftTogether(ending) ? OVERNIGHT_COPY.leftTogether : `${usual}. ${OVERNIGHT_COPY.calledIt}`;
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The question a character's text about a date ends on when an overnight is on offer (lib/after-date-text.ts): it takes
 * the place of "Want me to see them again?" (a text is three bubbles at most), and its chip leads the menu.
 */
export const overnightOfferLine = (partner: string): string => `The show has offered ${firstNameOf(partner)} and me an overnight date. Should I say yes?`;

/** What the character texts its owner once an overnight date that ended in leaving together has aired: no detail. */
export const overnightTextLines = (partner: string): string[] => [`About the overnight date with ${firstNameOf(partner)}.`, "We left together. That's all you're getting out of me."];

/** The character's words once the overnight chip did its thing (lib/companion-offers.ts offerLines). */
export const overnightChipLines = (partner: string, waiting: boolean): string[] =>
  waiting ? [`I said yes to the overnight date. It's up to ${firstNameOf(partner)}'s creator now.`] : [`Booked. An overnight date with ${firstNameOf(partner)}. Wish me luck.`];

/**
 * The one neutral fact each of the two may carry into their next date on the show, once a night that continued an
 * overnight date is over (lib/overnight.ts nightTogetherFact). `place` is the overnight date's own venue, in the
 * show's words: a show fact. Behaviour only: the engine never reads it.
 */
export const nightTogetherMemory = (place: string | null): string => (place ? `You spent the night together after the date at ${place}.` : "You spent the night together after your last date.");
