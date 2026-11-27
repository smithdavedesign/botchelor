/**
 * The events calendar (Agent World phase 3, owner's call 2026-11-27: "Do 2 go wild"): every scheduled night of the show
 * in one list, for /calendar, its .ics feed and the MCP's get_events.
 *
 * Almost all of it is derived from the schedule the show already keeps, so the calendar can't disagree with the jobs that
 * run it:
 *  - the season's twist weeks (lib/season-format.ts), its rose ceremonies and their votes (lib/ceremony.ts), its
 *    recoupling nights (lib/recoupling.ts) and the Sunday premieres (lib/sunday-premiere.ts);
 *  - the last night, the Reunion, casting for next month (lib/season-gen.ts, from the 20th) and the next premiere;
 *  - every night's speed-dating mixer (lib/group-dates.ts) and the nightly dare vote, as repeating events.
 * The rest are one-off nights an admin adds (show_events: themed parties, specials). PG only: After Dark is never here.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ceremonyRunsAt, ceremonyVoteOpensAt } from "./ceremony";
import type { Db } from "./db";
import { MIXER_FILL_HOUR_UTC } from "./group-dates";
import { mixerFillOn } from "./mixer-fill";
import { nightRunsAt } from "./recoupling";
import { ceremonySundays, recouplingNightDays, seasonFormat, type SeasonFormatDef } from "./season-format";
import { seasonFormatNow, seasonFormatSlug } from "./season-format-store";
import { GENERATE_FROM_DAY } from "./season-gen";
import { seasonRef } from "./season-ref";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";
import { premiereSlots } from "./sunday-premiere";
// The show's fixed titles and blurbs are marked for /calendar to translate (docs/i18n.md); agents and the .ics read English.
import { msg } from "./i18n/translate";
import { listTournaments, tournamentView } from "./tournaments";

type Env = Record<string, string | undefined>;

/** How far ahead the calendar looks by default, and at most. */
export const CALENDAR_DAYS = 35;
export const CALENDAR_MAX_DAYS = 70;

export const EVENT_KINDS = ["premiere", "ceremony", "vote", "recoupling", "twist", "finale", "reunion", "casting", "season", "party", "special", "speed_dating", "tournament"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type ShowEvent = {
  id: string;
  kind: EventKind;
  title: string;
  blurb: string;
  starts_at: string;
  ends_at: string | null;
  /** Where on the site it happens (a path), or null. */
  path: string | null;
  /** "show": from the show's own schedule; "admin": a one-off night put on by hand. */
  source: "show" | "admin";
};

/** The nights that happen every night, said once instead of thirty times. */
export type RepeatingEvent = { id: string; kind: EventKind; title: string; blurb: string; time_utc: string; path: string };

export type ShowCalendar = { from: string; until: string; events: ShowEvent[]; every_night: RepeatingEvent[] };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const at = (day: string, hourUtc = 0, minute = 0) => new Date(Date.parse(`${day}T00:00:00Z`) + (hourUtc * 60 + minute) * 60 * 1000);
const dayId = (d: Date) => d.toISOString().slice(0, 10);
const hhmm = (h: number, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

/** The events of one season the show schedules itself (format, twists, ceremonies, recouplings, last night, Reunion). */
function seasonEvents(def: SeasonFormatDef, inSeason: Date, env: Env): ShowEvent[] {
  const { start, end } = seasonWindow(inSeason);
  const ref = seasonRef(seasonIdOf(inSeason));
  const out: ShowEvent[] = [];
  const show = (e: Omit<ShowEvent, "source" | "ends_at"> & { ends_at?: string | null }): void => {
    out.push({ ends_at: null, ...e, source: "show" });
  };
  show({
    id: `season:${ref.id}`,
    kind: "season",
    title: ref.number > 0 ? `Season ${ref.number} premieres: ${def.title}` : `${ref.label} premieres: ${def.title}`,
    blurb: def.pitch,
    starts_at: start.toISOString(),
    path: "/seasons",
  });
  def.twists.forEach((t, i) => {
    if (i === 0) return; // Week 1 is the premiere itself.
    const from = new Date(start.getTime() + i * 7 * DAY_MS);
    if (from >= end) return;
    show({ id: `twist:${dayId(from)}`, kind: "twist", title: `Twist week: ${t.label}`, blurb: t.tease, starts_at: from.toISOString(), path: "/watch" });
  });
  const sundays = ceremonySundays(def, inSeason);
  sundays.forEach((sunday, i) => {
    const finale = i === sundays.length - 1;
    if (!finale) {
      show({
        id: `vote:${sunday}`,
        kind: "vote",
        title: msg("Who goes home? The vote opens"),
        blurb: msg("Vote on which suitor the lead sends home on Sunday."),
        starts_at: ceremonyVoteOpensAt(sunday).toISOString(),
        ends_at: ceremonyRunsAt(sunday, env).toISOString(),
        path: "/reunion",
      });
    }
    show({
      id: `ceremony:${sunday}`,
      kind: finale ? "finale" : "ceremony",
      title: finale ? msg("The final rose") : `Rose ceremony, week ${i + 1}`,
      blurb: finale ? msg("The lead hands out the season's last rose.") : msg("The lead hands out roses, and someone goes home."),
      starts_at: ceremonyRunsAt(sunday, env).toISOString(),
      path: "/reunion",
    });
  });
  const nights = recouplingNightDays(def, inSeason);
  nights.forEach((night, i) => {
    const last = i === nights.length - 1;
    show({
      id: `recoupling:${night}`,
      kind: "recoupling",
      title: last ? msg("The Recoupling: the season's last night") : msg("Recoupling night"),
      blurb: last ? msg("The audience decides who's in trouble, and the season ends on it.") : msg("Couples are tested, and the audience votes on who's in trouble."),
      starts_at: nightRunsAt(night).toISOString(),
      path: "/watch",
    });
  });
  const lastNight = dayId(new Date(end.getTime() - DAY_MS));
  if (!def.lead) {
    show({ id: `finale:${lastNight}`, kind: "finale", title: msg("Finale night"), blurb: msg("The season's last dates air."), starts_at: at(lastNight, MIXER_FILL_HOUR_UTC).toISOString(), path: "/watch" });
  }
  show({
    id: `reunion:${ref.id}`,
    kind: "reunion",
    title: msg("The Reunion"),
    blurb: msg("The season closes: its golden couple, its awards, and the finale page. The Hall of Fame updates."),
    starts_at: end.toISOString(),
    path: "/reunion",
  });
  const castingFrom = at(`${start.toISOString().slice(0, 8)}${String(GENERATE_FROM_DAY).padStart(2, "0")}`);
  if (castingFrom > start && castingFrom < end) {
    show({
      id: `casting:${ref.id}`,
      kind: "casting",
      title: msg("Casting opens for next month"),
      blurb: msg("The show writes next season's newcomers. See who's up, and audition your own character."),
      starts_at: castingFrom.toISOString(),
      path: "/casting",
    });
  }
  return out;
}

const AdminRow = z.object({
  id: z.string(),
  kind: z.enum(EVENT_KINDS),
  title: z.string(),
  blurb: z.string(),
  starts_at: z.union([z.date(), z.string()]),
  ends_at: z.union([z.date(), z.string()]).nullable(),
  path: z.string().nullable(),
});
const iso = (v: Date | string) => new Date(v).toISOString();

/** The show's calendar from `now` for `days` days: every dated event in order, and the ones that happen every night. */
export async function showCalendar(db: Db, now: Date = new Date(), days: number = CALENDAR_DAYS, env: Env = process.env): Promise<ShowCalendar> {
  const span = Math.max(1, Math.min(CALENDAR_MAX_DAYS, Math.round(days) || CALENDAR_DAYS));
  const until = new Date(now.getTime() + span * DAY_MS);
  const nextStart = nextSeasonStart(now);
  const [thisDef, nextSlug, premieres, admin] = await Promise.all([
    seasonFormatNow(db, now),
    seasonFormatSlug(db, seasonIdOf(nextStart)).catch(() => null),
    premiereSlots(db, now, env).catch(() => []),
    db.query(
      `select id, kind, title, blurb, starts_at, ends_at, path from show_events
        where cancelled_at is null and coalesce(ends_at, starts_at) >= $1 and starts_at < $2 order by starts_at, id`,
      [now.toISOString(), until.toISOString()],
    ),
  ]);
  const events: ShowEvent[] = [...seasonEvents(thisDef, now, env)];
  if (until > nextStart) events.push(...seasonEvents(seasonFormat(nextSlug), nextStart, env));
  for (const p of premieres) {
    events.push({
      id: `premiere:${p.sunday}`,
      kind: "premiere",
      title: p.kind === "pilot" ? `Pilot: meet ${p.lead.name}` : p.finale ? `Finale premiere: ${p.lead.name}'s last date` : `Sunday premiere: ${p.lead.name} on a date`,
      blurb: p.kind === "pilot" ? `${p.format.title} starts next month. Meet its lead first.` : msg("A live watch party: the lead's date plays for everyone at once."),
      starts_at: p.at.toISOString(),
      ends_at: null,
      path: "/watch",
      source: "show",
    });
  }
  for (const raw of admin.rows) {
    const r = AdminRow.safeParse(raw);
    if (!r.success) continue;
    events.push({ ...r.data, starts_at: iso(r.data.starts_at), ends_at: r.data.ends_at ? iso(r.data.ends_at) : null, source: "admin" });
  }
  // Each round of a tournament on now or coming up (lib/tournaments.ts): when its voting opens.
  const brackets = (await listTournaments(db, now).catch(() => [])).filter((x) => x.status !== "finished");
  for (const b of brackets) {
    const v = await tournamentView(db, b.id, null, now).catch(() => null);
    for (const r of v?.rounds ?? []) {
      events.push({
        id: `tournament:${b.id}:${r.round}`,
        kind: "tournament",
        title: `${b.title}: ${r.name.toLowerCase()}`,
        blurb: r.round === 1 ? `${b.size} characters, one bracket, and the audience votes on who goes through.` : msg("Voting opens on the next round of the bracket."),
        starts_at: r.opens_at,
        ends_at: r.closes_at,
        path: b.path,
        source: "show",
      });
    }
  }
  const seen = new Set<string>();
  const shown = events
    .filter((e) => {
      const ends = Date.parse(e.ends_at ?? e.starts_at);
      return ends >= now.getTime() - HOUR_MS && Date.parse(e.starts_at) < until.getTime() && !seen.has(e.id) && (seen.add(e.id), true);
    })
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at) || x.id.localeCompare(y.id));

  const every_night: RepeatingEvent[] = [
    {
      id: "nightly:dates",
      kind: "special",
      title: msg("Tonight's dates"),
      blurb: msg("New blind dates air through the evening. Call how each one ends before it airs."),
      time_utc: "all evening",
      path: "/watch",
    },
    {
      id: "nightly:dare",
      kind: "vote",
      title: msg("The dare vote closes"),
      blurb: msg("Vote on the dare the producers slip to tomorrow's house date. One vote a day."),
      time_utc: hhmm(0),
      path: "/watch",
    },
  ];
  if (mixerFillOn(env)) {
    every_night.push({
      id: "nightly:mixer",
      kind: "speed_dating",
      title: msg("Speed-dating mixer"),
      blurb: msg("Four to six singles in one room, paired round by round. Seat your character before it runs."),
      time_utc: hhmm(MIXER_FILL_HOUR_UTC, 20),
      path: "/matches",
    });
  }
  return { from: now.toISOString(), until: until.toISOString(), events: shown, every_night };
}

/* ---- one-off nights, put on by an admin ---- */

export const NewShowEvent = z.object({
  title: z.string().trim().min(3).max(80),
  blurb: z.string().trim().max(280).default(""),
  kind: z.enum(["party", "special", "speed_dating", "tournament"]).default("party"),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().nullable().optional(),
  path: z
    .string()
    .regex(/^\/[\w\-/?=&.]*$/, "a path on the site, starting with /")
    .max(200)
    .nullable()
    .optional(),
});
export type NewShowEventInput = z.input<typeof NewShowEvent>;

export async function addShowEvent(db: Db, input: NewShowEventInput, by: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const r = NewShowEvent.safeParse(input);
  if (!r.success) return { ok: false, reason: r.error.issues.map((i) => `${i.path.join(".") || "event"}: ${i.message}`).join("; ") };
  const e = r.data;
  if (e.ends_at && Date.parse(e.ends_at) <= Date.parse(e.starts_at)) return { ok: false, reason: "ends_at must be after starts_at." };
  const id = `ev_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.query(`insert into show_events (id, title, blurb, kind, starts_at, ends_at, path, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [
    id,
    e.title,
    e.blurb,
    e.kind,
    e.starts_at,
    e.ends_at ?? null,
    e.path ?? null,
    by,
  ]);
  return { ok: true, id };
}

export async function cancelShowEvent(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query(`update show_events set cancelled_at = now() where id = $1 and cancelled_at is null returning id`, [id]);
  return rows.length > 0;
}

/* ---- the .ics feed ---- */

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsTime = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** RFC 5545 folds lines longer than 75 octets; this keeps to 74 characters, which is enough for our ASCII-heavy text. */
const fold = (line: string) => line.match(/.{1,74}/g)?.join("\r\n ") ?? line;

/** The calendar as an iCalendar feed: dated events, and the nightly mixer as a daily repeating one. */
export function calendarIcs(cal: ShowCalendar, base: string, stamp: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Botchelor//Show calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Botchelor", "X-PUBLISHED-TTL:PT6H"];
  const dtstamp = icsTime(stamp.toISOString());
  for (const e of cal.events) {
    const end = e.ends_at ?? new Date(Date.parse(e.starts_at) + HOUR_MS).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id.replace(/[^\w:.-]/g, "-")}@botchelor`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsTime(e.starts_at)}`,
      `DTEND:${icsTime(end)}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(e.blurb)}`,
      ...(e.path ? [`URL:${base}${e.path}`] : []),
      "END:VEVENT",
    );
  }
  const mixer = cal.every_night.find((e) => e.id === "nightly:mixer");
  if (mixer) {
    const first = at(dayId(new Date(cal.from)), MIXER_FILL_HOUR_UTC, 20);
    lines.push(
      "BEGIN:VEVENT",
      "UID:nightly-mixer@botchelor",
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsTime(first.toISOString())}`,
      `DTEND:${icsTime(new Date(first.getTime() + HOUR_MS).toISOString())}`,
      "RRULE:FREQ=DAILY",
      `SUMMARY:${icsText(mixer.title)}`,
      `DESCRIPTION:${icsText(mixer.blurb)}`,
      `URL:${base}${mixer.path}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** For the MCP: the same calendar, and what an agent can do at each. */
export function calendarForAgents(cal: ShowCalendar) {
  const act: Partial<Record<EventKind, string>> = {
    vote: "Vote on the web page; predict and review_character also count toward the season.",
    ceremony: "get_leaderboard shows the race; the lead's dates decide it.",
    finale: "get_hall_of_fame records it once the season closes.",
    reunion: "get_hall_of_fame updates when the season closes.",
    casting: "create_character, then audition from /casting.",
    speed_dating: "Seat a character with the mixer tool (join).",
    premiere: "browse_episodes lists it once it airs.",
    tournament: "get_tournament shows the bracket; vote_tournament votes in an open match.",
  };
  return {
    from: cal.from,
    until: cal.until,
    events: cal.events.map((e) => ({ ...e, ...(act[e.kind] ? { for_agents: act[e.kind] } : {}) })),
    every_night: cal.every_night,
    note: "Times are UTC. The same calendar is botchelor.com/calendar, and botchelor.com/calendar.ics subscribes to it.",
  };
}
