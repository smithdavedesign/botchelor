/**
 * Season formats as data (docs/ideas.md "An island season" + "Bringing viewers back" idea 8; David 2026-11-02): a
 * season is a month (lib/season-window.ts), and the FORMAT it runs in is a config, not a rewrite. A format names the
 * venues the house's own dates deal from, the weekly twist calendar (which show formats and producer events the house
 * dates lean toward each week, lib/formats.ts + lib/rules.ts), whether the season ends in one recoupling night or a
 * weekly one, what the viewers vote on before it, and how the season announces itself.
 *
 *  - "classic" is the show exactly as it was before formats existed: the whole venue library (venues: null means
 *    pickVenueFrom falls through to pickVenueAvoiding, byte for byte), plus the weekly twist calendar (idea 8) and a
 *    recoupling night on the season's last night (idea 9). A season with no stored row (lib/season-format-store.ts)
 *    is classic.
 *  - "island" is the villa month (docs/ideas.md F): a villa-flavoured venue pool, a recoupling night at the end of
 *    every week, and the final vote picks the newcomer who joins next season. It is selectable per season from
 *    /admin/season, never scheduled by default. Its public label lives HERE, not in page code: the doc flags
 *    "Bot Island" as too close to ITV's Love Island, so the name is one line to change when David picks it.
 *  - A twist is a thumb on existing scales, never a new pipeline: it only steers the lobby's own house dates
 *    (lib/watch.ts refreshLobby) toward a show format, a producer event, or a newcomer in the pairing. Booked dates,
 *    agents' dates and the engine are untouched.
 *
 * Pure and client-safe: constants and date math only, no server imports, no model call ($0 — every line of copy is a
 * template).
 */
import type { FormatId } from "./formats";
import type { ProducerId } from "./rules";
import { seasonWindow } from "./season-window";
import type { VenueId } from "./venues";

export const SEASON_FORMAT_SLUGS = ["classic", "island", "last_standing", "sight_unseen", "meet_the_folks", "ex_files"] as const;
export type SeasonFormatSlug = (typeof SEASON_FORMAT_SLUGS)[number];

export type TwistWeek = {
  /** 1-based week of the season. The last entry also covers any later days (a 31-day month's short week 5). */
  week: number;
  /** The twist's name, as television bills it. */
  label: string;
  /** The producer-voice tease, shown on /watch and in Since you were here. A template: no model call. */
  tease: string;
  /** The show format (lib/formats.ts) the lobby's house dates run this week, or null: dealt as ever. */
  format: FormatId | null;
  /** The producer event those dates lean toward, or null: dealt from the seed as ever. */
  producer: ProducerId | null;
  /** "newcomer": one side of each lobby date this week is a cast member who joined this season. */
  pairing: "newcomer" | null;
};

export type RecouplingRule = {
  /** When a recoupling night runs: on the season's last night, or at the end of every season week. */
  nights: "last_night" | "weekly";
  /** What the season's FINAL vote asks: the couple in trouble, or (island) the newcomer who joins next season. */
  finalVote: "couple_in_trouble" | "newcomer";
};

export type SeasonFormatDef = {
  slug: SeasonFormatSlug;
  /** The ballot's name for it (the next-season vote, lib/season-vote.ts): a show title, our own words. */
  title: string;
  /** One line on the ballot: what a month of it is, in words the format really does (venues, twists, recouplings). */
  pitch: string;
  /** The ballot card's emoji. */
  emoji: string;
  /** The public label ("a classic season of Botchelor"). The island's name is David's call: change it here only. */
  label: string;
  /** The week-1 announcement, producer voice. */
  announce: string;
  /** The venues the house's own dates deal from; null = the whole library (classic, exactly as before). */
  venues: readonly VenueId[] | null;
  twists: readonly TwistWeek[];
  recoupling: RecouplingRule;
};

/** The villa pool: open-air, beachy, golden-hour places from the existing library (lib/venues.ts). */
const VILLA_VENUES: readonly VenueId[] = [
  "rooftop_bar",
  "night_beach",
  "surf_lesson",
  "botanic_park",
  "stargazing_hill",
  "pier_at_night",
  "swan_pedalo",
  "rainy_campsite",
  "night_market",
  "safari",
];

export const SEASON_FORMATS: readonly SeasonFormatDef[] = [
  {
    slug: "classic",
    title: "Classic Botchelor",
    pitch: "Blind dates all over the city, a newcomers' week, the ex returns, and one recoupling night to close it.",
    emoji: "🌹",
    label: "a classic season of Botchelor",
    announce: "This month: a classic season of Botchelor. New faces, blind dates, and the audience calling every ending.",
    venues: null,
    twists: [
      { week: 1, label: "Premiere week", tease: "A new season opens: fresh faces, first dates, no safety net.", format: null, producer: null, pairing: null },
      {
        week: 2,
        label: "The newcomers' week",
        tease: "The newcomers take center stage: every house date this week seats one of them.",
        format: null,
        producer: null,
        pairing: "newcomer",
      },
      {
        week: 3,
        label: "The ex returns",
        tease: "Someone's past keeps walking in: it's The Ex Returns week on every house date.",
        format: "ex_returns",
        producer: null,
        pairing: null,
      },
      {
        week: 4,
        label: "Finale week",
        tease: "Finale week: quiet confessions on every table, and the Recoupling closes the season.",
        format: null,
        producer: "a_quiet_confession",
        pairing: null,
      },
    ],
    recoupling: { nights: "last_night", finalVote: "couple_in_trouble" },
  },
  {
    slug: "island",
    title: "The Villa",
    pitch: "A month in the sun: beaches, rooftops and campsites, and a recoupling at the end of every week.",
    emoji: "🏝️",
    // The public name is deliberately generic until David picks one (docs/ideas.md F: "Bot Island" is too close to
    // ITV's Love Island). Change this label and the announce line; nothing else keys on them.
    label: "an island season",
    announce: "This month: the villa. Couples pair up under the sun, the audience votes, and every week ends with a recoupling.",
    venues: VILLA_VENUES,
    twists: [
      { week: 1, label: "Welcome to the villa", tease: "The villa opens: the cast pairs up, and nothing is settled.", format: null, producer: null, pairing: null },
      {
        week: 2,
        label: "First recoupling",
        tease: "The first recoupling is coming: hard questions on every date before couples hold on or switch.",
        format: null,
        producer: "a_hard_question",
        pairing: null,
      },
      {
        week: 3,
        label: "The ex returns to the villa",
        tease: "An old flame checks into the villa: exes shadow every date this week.",
        format: "ex_returns",
        producer: null,
        pairing: null,
      },
      {
        week: 4,
        label: "Final recoupling",
        tease: "The final recoupling: confessions on every table, and the audience decides who joins the villa next.",
        format: null,
        producer: "a_quiet_confession",
        pairing: null,
      },
    ],
    recoupling: { nights: "weekly", finalVote: "newcomer" },
  },
  {
    // Reality-survival, with a bot twist: out in the wild, plans collapse, the cast takes dares, and every week ends with
    // the audience naming the couple in trouble. A title of our own (no network's show name), like the island's.
    slug: "last_standing",
    title: "Last Bot Standing",
    pitch: "Out in the wild: campsites, safaris and cliffs, plans that fall apart, dares, and the audience puts a couple on the block every week.",
    emoji: "🔥",
    label: "a Last Bot Standing season",
    announce: "This month: Last Bot Standing. Out in the wild, the plans fall apart, and every week ends with the audience calling a couple out.",
    venues: ["rainy_campsite", "safari", "skydive", "surf_lesson", "climbing_wall", "trail_ride", "paintball", "hot_air_balloon", "stargazing_hill", "night_beach"],
    twists: [
      { week: 1, label: "Into the wild", tease: "The cast heads out into the wild: no reservations, no backup plan.", format: null, producer: "the_plan_changes", pairing: null },
      { week: 2, label: "Dare week", tease: "Dare week: every house date this week turns on a dare.", format: null, producer: "a_dare", pairing: null },
      { week: 3, label: "The storm", tease: "Something goes wrong on every date this week, and they have to get through it together.", format: null, producer: "a_small_crisis", pairing: null },
      { week: 4, label: "The last campfire", tease: "The last campfire: confessions on every date, and the final recoupling closes the season.", format: null, producer: "a_quiet_confession", pairing: null },
    ],
    recoupling: { nights: "weekly", finalVote: "couple_in_trouble" },
  },
  {
    // Blind-dating, with a bot twist: they meet as voices first (speed rounds and dark rooms), the faces come later.
    slug: "sight_unseen",
    title: "Sight Unseen",
    pitch: "Speed rounds in the dark: quick-fire first dates, hard questions before looks, and a newcomers' week.",
    emoji: "🕶️",
    label: "a Sight Unseen season",
    announce: "This month: Sight Unseen. Quick-fire first dates in dim rooms, the hard questions first, and the looks last.",
    venues: ["old_cinema", "jazz_bar", "late_bookshop", "museum_night", "silent_disco", "stargazing_hill", "late_night_diner", "escape_room", "murder_mystery", "haunted_house"],
    twists: [
      { week: 1, label: "Lights down", tease: "Lights down: speed rounds on every house date, three minutes to make it count.", format: "speed_date", producer: null, pairing: null },
      { week: 2, label: "Ask me anything", tease: "No small talk this week: every house date opens on a hard question.", format: null, producer: "a_hard_question", pairing: null },
      { week: 3, label: "New voices", tease: "New voices in the dark: every house date this week seats a newcomer.", format: "speed_date", producer: null, pairing: "newcomer" },
      { week: 4, label: "The reveal", tease: "The reveal: confessions on every table, and the recoupling closes the season.", format: null, producer: "a_quiet_confession", pairing: null },
    ],
    recoupling: { nights: "last_night", finalVote: "couple_in_trouble" },
  },
  {
    // Meet-the-family, with a bot twist: the cast's invented families get a seat at the table.
    slug: "meet_the_folks",
    title: "Meet the Folks",
    pitch: "Families at the table: chaperoned dinners, cooking classes and a face from someone's past.",
    emoji: "🍽️",
    label: "a Meet the Folks season",
    announce: "This month: Meet the Folks. Someone's family is always at the table, and everyone is on their best behaviour. For now.",
    venues: ["tasting_menu", "cooking_class", "flat_pack", "corner_cafe", "bowling_alley", "ballroom_lesson", "pottery_class", "botanic_park", "late_night_diner", "comedy_club"],
    twists: [
      { week: 1, label: "Best behaviour", tease: "Best behaviour: a parent tags along on every house date this week.", format: "meet_the_parents", pairing: null, producer: null },
      { week: 2, label: "The awkward dinner", tease: "The awkward dinner: long silences on every date this week.", format: null, producer: "an_awkward_silence", pairing: null },
      { week: 3, label: "Family secrets", tease: "Family secrets: the parents are back, and someone's past walks in with them.", format: "meet_the_parents", producer: "a_face_from_the_past", pairing: null },
      { week: 4, label: "Sunday lunch", tease: "Sunday lunch: confessions over dessert, and the recoupling closes the season.", format: null, producer: "a_quiet_confession", pairing: null },
    ],
    recoupling: { nights: "last_night", finalVote: "couple_in_trouble" },
  },
  {
    // Exes-on-holiday, with a bot twist: every week someone's past checks in.
    slug: "ex_files",
    title: "The Ex Files",
    pitch: "Every week an ex checks in: beaches and dive bars, old flames on every date, and a recoupling each week.",
    emoji: "💔",
    label: "an Ex Files season",
    announce: "This month: The Ex Files. Every week someone's past checks in, and every week ends with a recoupling.",
    venues: ["night_beach", "dive_bar", "karaoke_booth", "nightclub", "pier_at_night", "rooftop_bar", "night_market", "retro_arcade", "jazz_bar", "late_night_diner"],
    twists: [
      { week: 1, label: "Check-in", tease: "Check-in week: the first ex arrives, and nobody saw it coming.", format: "ex_returns", producer: null, pairing: null },
      { week: 2, label: "Old flames", tease: "Old flames: faces from the past turn up on every house date.", format: null, producer: "a_face_from_the_past", pairing: null },
      { week: 3, label: "Unfinished business", tease: "Unfinished business: the exes are back, and they have questions.", format: "ex_returns", producer: "a_hard_question", pairing: null },
      { week: 4, label: "Closure", tease: "Closure: confessions on every date, and the final recoupling closes the season.", format: null, producer: "a_quiet_confession", pairing: null },
    ],
    recoupling: { nights: "weekly", finalVote: "couple_in_trouble" },
  },
] as const;

export const DEFAULT_SEASON_FORMAT: SeasonFormatSlug = "classic";

/** The format for a slug, falling back to classic for an unknown or legacy value. */
export const seasonFormat = (slug: string | null | undefined): SeasonFormatDef =>
  SEASON_FORMATS.find((f) => f.slug === slug) ?? SEASON_FORMATS[0];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 1-based day of the season `now` falls in. */
export function seasonDayOf(now: Date): number {
  return Math.floor((now.getTime() - seasonWindow(now).start.getTime()) / DAY_MS) + 1;
}

/** The 1-based twist week `now` falls in: day 1–7 is week 1, and the calendar's last week covers any later days. */
export function twistWeekNumber(def: SeasonFormatDef, now: Date): number {
  return Math.min(Math.ceil(seasonDayOf(now) / 7), def.twists.length);
}

/** This week's twist (the calendar clamps: a 31-day month's short week 5 is still finale week). */
export function twistOf(def: SeasonFormatDef, now: Date): TwistWeek {
  return def.twists[twistWeekNumber(def, now) - 1];
}

/** When the current twist week started (UTC): Since you were here shows the tease to whoever last visited before it. */
export function twistWeekStart(def: SeasonFormatDef, now: Date): Date {
  return new Date(seasonWindow(now).start.getTime() + (twistWeekNumber(def, now) - 1) * 7 * DAY_MS);
}

export type ThisWeekCard = {
  /** The season announcement, on week 1 only ("This month: …"). */
  announce: string | null;
  label: string;
  tease: string;
};

/** The "This week on Botchelor" card, $0 from templates. */
export function thisWeekOn(def: SeasonFormatDef, now: Date): ThisWeekCard {
  const twist = twistOf(def, now);
  return { announce: twistWeekNumber(def, now) === 1 ? def.announce : null, label: twist.label, tease: twist.tease };
}

/** A UTC day as YYYY-MM-DD. */
const dayId = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The UTC days of the season that end with a recoupling night (idea 9): the last night for a classic season, the end
 * of every season week for an island one (any weekly night falling within 2 days of the finale folds into it).
 */
export function recouplingNightDays(def: SeasonFormatDef, now: Date): string[] {
  const { start, end } = seasonWindow(now);
  const last = new Date(end.getTime() - DAY_MS);
  if (def.recoupling.nights === "last_night") return [dayId(last)];
  const out: string[] = [];
  for (let d = new Date(start.getTime() + 6 * DAY_MS); d < last; d = new Date(d.getTime() + 7 * DAY_MS)) {
    if (last.getTime() - d.getTime() > 2 * DAY_MS) out.push(dayId(d));
  }
  out.push(dayId(last));
  return out;
}

/** The next recoupling night's UTC day (today's counts until the day ends), or null when the season has none left. */
export function nextRecouplingDay(def: SeasonFormatDef, now: Date): string | null {
  const today = dayId(now);
  return recouplingNightDays(def, now).find((d) => d >= today) ?? null;
}

/** Whether a night's day is the season's last (it asks the format's final vote; earlier island nights ask the couple one). */
export function isFinalNight(def: SeasonFormatDef, nightDay: string, now: Date): boolean {
  const days = recouplingNightDays(def, now);
  return days[days.length - 1] === nightDay;
}
