/**
 * The Sunday premiere's clock and switches (lib/sunday-premiere.ts, docs/sunday-premiere.md): when it starts, the
 * pilot's Sunday, and the time in words for everyone. Pure and client-safe, with no imports: the ceremony's hour
 * (lib/ceremony.ts ceremonyHourUtc) reads it, and so can any page.
 */

type Env = Record<string, string | undefined>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** SUNDAY_PREMIERE: on unless it is "0". Off, nothing of the premiere runs and the ceremony keeps its own hour (20). */
export const sundayPremiereOn = (env: Env = process.env): boolean => env.SUNDAY_PREMIERE?.trim() !== "0";

/** PREMIERE_PILOT: the "Meet the lead" pilot on the Sunday before a lead season, on unless "0" (and only with the premiere on). */
export const premierePilotOn = (env: Env = process.env): boolean => sundayPremiereOn(env) && env.PREMIERE_PILOT?.trim() !== "0";

/** The premiere's hour (UTC) unless PREMIERE_HOUR_UTC says otherwise: 6 pm US Eastern, 3 pm Pacific in winter. */
export const PREMIERE_HOUR_DEFAULT = 23;

/**
 * The hour (UTC) a Sunday's premiere starts. 1 to 23 only: the job's pass the hour before builds it, and that pass has
 * to be on the Sunday too, so every "Sunday" in the code holds. Anything else reads as the default.
 */
export function premiereHourUtc(env: Env = process.env): number {
  const raw = env.PREMIERE_HOUR_UTC?.trim();
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 23 ? n : PREMIERE_HOUR_DEFAULT;
}

/** When a Sunday's premiere starts (`sunday` is YYYY-MM-DD, UTC). */
export const premiereAt = (sunday: string, env: Env = process.env): Date => new Date(Date.parse(`${sunday}T00:00:00Z`) + premiereHourUtc(env) * HOUR_MS);

/** The pilot's Sunday: the last Sunday before a season starts (the day before its 1st, or earlier). */
export function pilotSundayFor(seasonStart: Date | string): string {
  const start = typeof seasonStart === "string" ? Date.parse(`${seasonStart}T00:00:00Z`) : seasonStart.getTime();
  const eve = new Date(start - DAY_MS);
  return new Date(eve.getTime() - eve.getUTCDay() * DAY_MS).toISOString().slice(0, 10);
}

/** "6 pm" or "6:30 pm" in a US time zone, with the weekday when that is another day than the UTC one ("Sat 8 pm"). */
function zoneTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", weekday: "short", hour12: true }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const minute = part("minute");
  const time = `${part("hour")}${minute && minute !== "00" ? `:${minute}` : ""} ${part("dayPeriod").toLowerCase()}`;
  const utcDay = at.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return part("weekday") === utcDay ? time : `${part("weekday")} ${time}`;
}

/**
 * The premiere's time for everyone: "23:00 UTC (6 pm ET, 3 pm PT)". With `day`, the date first: "Sunday 29 November,
 * 23:00 UTC (6 pm ET, 3 pm PT)". US Eastern and Pacific follow their own summer time.
 */
export function premiereTimeWords(at: Date | string, opts: { day?: boolean } = {}): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const utc = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  const us = `${zoneTime(d, "America/New_York")} ET, ${zoneTime(d, "America/Los_Angeles")} PT`;
  const day = opts.day ? `${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}, ` : "";
  return `${day}${utc} (${us})`;
}

export type PremiereKind = "pilot" | "weekly";
export type PremiereFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };

/**
 * The next Sunday premiere (lib/sunday-premiere.ts nextPremiere), as a page shows it. Before the job's pass the hour
 * before builds it, `suitor`, `room_path` and `episode_id` are null and `state` is "scheduled"; once built they are set
 * and `state` is "built" until it starts, then "live" until the room's last phase. Then the next one takes its place.
 */
export type NextPremiere = {
  /** The Sunday it airs (YYYY-MM-DD, UTC). */
  sunday: string;
  /** When it starts, ISO: PREMIERE_HOUR_UTC on that Sunday. */
  at: string;
  /** "23:00 UTC (6 pm ET, 3 pm PT)". */
  time_words: string;
  /** "pilot": "Meet the lead", the Sunday before a lead season, no ceremony; "weekly": the lead's last-chance date. */
  kind: PremiereKind;
  /** The season it belongs to (the pilot's is the coming one). */
  season_id: string;
  lead: PremiereFace;
  /** Who the lead dates, once the pass the hour before has chosen (and built) it; null until then. */
  suitor: PremiereFace | null;
  /** The room (/watch/<id>) once built; null until then. */
  room_path: string | null;
  episode_id: string | null;
  /** When the roses are handed out after it (a weekly premiere: the ceremony's pass); null for the pilot. */
  roses_at: string | null;
  /** The season's last Sunday: the finale's premiere, before the final rose. */
  finale: boolean;
  state: "scheduled" | "built" | "live";
};
