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

export const SEASON_FORMAT_SLUGS = ["classic", "island"] as const;
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
