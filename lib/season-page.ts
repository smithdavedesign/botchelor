/**
 * The season page while a lead season is on (docs/season-page.md; brief E, 2026-11-16): /seasons/<slug> for The
 * Botchelor's month, the month before it (preseason) and while it runs, watch-first. Someone who arrives from a December
 * clip (/december) sees what the month is, three of the lead's dates that play in the theater, the lead, the suitors and
 * when things happen. A closed season keeps its finale (lib/season-recap.ts) and every other format the Reunion, exactly
 * as before. $0: rows and templates, no model call; one read for the format, then one Promise.all.
 *
 * Only what has aired publicly between public characters is shown, and no ending: the starters are picked to mix
 * endings, but a card never says which (the Watch and RSS rule: the ending is the episode's to tell).
 */
import { castingBoard, type AuditionCard } from "./auditions";
import { ceremonyRunsAt, ceremonyVoteOpensAt } from "./ceremony";
import type { Db } from "./db";
import { STANDOUT_SCORE_SQL } from "./game";
import { shortName } from "./names";
import { portraitPathSql } from "./portrait-sql";
import { premiereAt, sundayPremiereOn, type NextPremiere } from "./premiere-clock";
import { DELETED_OWNER, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { seasonMonth } from "./season-cast";
import { sentenceCase } from "./sentence-case";
import { ceremonySundays, formatContrast, seasonArc, seasonFormat, suitorPlaces, type SeasonArc, type SeasonFormatDef } from "./season-format";
import { seasonFormatSlug } from "./season-format-store";
import { isMonthlySeason, seasonRef, type SeasonRef } from "./season-ref";
import { nextSeasonStart, seasonIdOf, seasonWindow } from "./season-window";
import { featurableSql, storyPassedSql } from "./story-check-gate";
import { nextPremiere } from "./sunday-premiere";

type Env = Record<string, string | undefined>;

/** The show's premise, as agreed for December (brief E): the page's heading and its description's first words. */
export const SEASON_PREMISE = "Your characters. Their dates. Nobody knows how it ends.";
/** Starters the page shows at most, and pins an admin may set (/admin/season). */
export const STARTERS = 3;
/** Candidate dates read for the starters: enough to find one a partner, and a mix of endings, across a lead's record. */
const POOL = 60;

/** SEASON_PAGE_LIVE (on unless "0"): off, an unclosed season's page is as before (the Reunion's while it runs, else not found). */
export function seasonPageLiveOn(env: Env = process.env): boolean {
  return env.SEASON_PAGE_LIVE?.trim() !== "0";
}

export type SeasonPagePhase = "preseason" | "season";

/** A season's page at `now`: running ("season"), the next one ("preseason"), or null (closed, or further ahead). */
export function seasonPagePhase(seasonId: string, now: Date = new Date()): SeasonPagePhase | null {
  const { start, end } = seasonWindow(new Date(`${seasonId}T00:00:00Z`));
  if (now.getTime() >= end.getTime()) return null;
  if (now.getTime() >= start.getTime()) return "season";
  return seasonIdOf(nextSeasonStart(now)) === seasonId ? "preseason" : null;
}

/**
 * The phase and lead format a season's page runs live in, or null: it is this season or the next, and its format has a
 * lead (lib/season-format.ts, The Botchelor). One read (the season's format, the row or else the ballot, as /casting
 * reads it). The switch is the caller's: off, the page still needs to know it is a lead season (app/seasons/[slug]).
 */
export async function liveSeasonFormat(db: Db, seasonId: string, now: Date = new Date()): Promise<{ phase: SeasonPagePhase; def: SeasonFormatDef } | null> {
  const phase = seasonPagePhase(seasonId, now);
  if (!phase) return null;
  const def = seasonFormat(await seasonFormatSlug(db, seasonId));
  return def.lead ? { phase, def } : null;
}

/** The lead seasons' pages to index now (the sitemap): this season's and the next's, when either runs a lead format. */
export async function liveSeasonPaths(db: Db, now: Date = new Date(), env: Env = process.env): Promise<SeasonRef[]> {
  if (!seasonPageLiveOn(env)) return [];
  const ids = [seasonIdOf(now), seasonIdOf(nextSeasonStart(now))].filter(isMonthlySeason);
  const live = await Promise.all(ids.map(async (id) => ((await liveSeasonFormat(db, id, now)) ? seasonRef(id) : null)));
  return live.filter((s): s is SeasonRef => s !== null);
}

/** The title and description a live season page carries (its finale's are the recap's). */
export function seasonLiveMeta(season: SeasonRef, def: SeasonFormatDef, phase: SeasonPagePhase): { title: string; description: string } {
  const starts = new Date(`${season.id}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return {
    title: `Season ${season.number}, ${season.label}: ${def.title} · Botchelor`,
    description: `${SEASON_PREMISE} ${def.pitch} ${phase === "preseason" ? `It starts ${starts}, and casting is open now.` : "On now: three dates to start with, the suitors, and when the roses are handed out."}`,
  };
}

/** The stored cast's lead while the season runs, else the admin's pick for it (season_leads, /admin/season). $1: the season. */
const LEAD_ID = `coalesce(
      (select s.character_id from season_casts s where s.season_id = $1 and s.source = 'lead' order by s.slot limit 1),
      (select l.character_id from season_leads l where l.season_id = $1))`;

export type SeasonLead = { id: string; name: string; short: string; bio: string; wants: string | null; hue: number | null; portrait: string | null; house: boolean };

/** A bio's first sentence, or the whole bio when it's short: the lead's one line. */
export function bioLine(bio: string, max = 180): string {
  const text = bio.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const first = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

/** Words a want may open with that read lower-case after "Wants:" ("Someone who asks…"); a name keeps its capital. */
const COMMON_OPENERS = new Set(["someone", "somebody", "anyone", "a", "an", "the", "to", "one", "more", "being", "people", "company", "time", "something"]);
/** "Wants: someone who asks a follow-up question", from the character's want. */
export function wantsLine(want: string): string {
  const text = want.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  const first = text.split(" ")[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return COMMON_OPENERS.has(first) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

async function seasonLead(db: Db, seasonId: string): Promise<SeasonLead | null> {
  const { rows } = await db.query<{ id: string; name: string; bio: string; want: string | null; hue: number | null; portrait: string | null; house: boolean }>(
    `select c.id, c.name, c.bio, c.want, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house
       from characters c
      where c.id = ${LEAD_ID} and c.visibility = 'public' and c.owner_id is distinct from $2`,
    [seasonId, DELETED_OWNER],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, short: shortName(r.name) || r.name, bio: bioLine(r.bio), wants: r.want?.trim() ? wantsLine(r.want) : null, hue: r.hue, portrait: r.portrait, house: r.house };
}

export type StarterFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
export type Starter = {
  id: string;
  /** The episode's own title once one was written at air time (lib/episode-title.ts), else null. */
  title: string | null;
  /** Its setting: the card's one line. */
  line: string;
  venue: string | null;
  a: StarterFace;
  b: StarterFace;
  /** For picking only, never shown: the lead's partner (one date each), the ending (a mix), and how it qualified. */
  partner: string;
  ending: Ending;
  pinned: boolean;
  passed: boolean;
};

type StarterRow = {
  id: string;
  title: string | null;
  setting: string;
  venue: string | null;
  ending: Ending;
  partner: string;
  pin: number | null;
  passed: boolean;
} & Record<`${"a" | "b"}_${"id" | "name" | "portrait"}`, string> &
  Record<`${"a" | "b"}_hue`, number | null> &
  Record<`${"a" | "b"}_house`, boolean>;

const face = (x: "a" | "b") => `${x}.id as ${x}_id, ${x}.name as ${x}_name, ${x}.avatar_hue as ${x}_hue, ${portraitPathSql(x)} as ${x}_portrait, ${x}.is_house as ${x}_house`;

/**
 * The lead's dates that may start the page, best first. Each is aired, public and ready, between two public characters,
 * not hidden after reports, not one that carried an After Dark memory, and featurable by the story check
 * (lib/story-check-gate.ts: never one it found contradicting, nor one whose finale it repaired). Order: the admin's pins
 * (season_starters), in theirs; then, once the season runs, its own dates; then the dates the check has passed (an
 * unchecked date still qualifies, so the box isn't empty while the backfill runs); then the show's standout score
 * (lib/game.ts STANDOUT_SCORE_SQL, the home page's list: chemistry at the end, a second date, the pair's review stars).
 * `ids` narrows it to those dates (a pin's check when it's saved).
 */
export async function starterPool(db: Db, seasonId: string, opts: { ids?: readonly string[]; limit?: number } = {}): Promise<Starter[]> {
  const params: unknown[] = [seasonId, `${seasonId}T00:00:00Z`, DELETED_OWNER, REPORT_HIDE_THRESHOLD, opts.limit ?? POOL];
  if (opts.ids) params.push([...opts.ids]);
  const { rows } = await db.query<StarterRow>(
    `with lead as (select ${LEAD_ID} as id),
          pins as (
            select p.episode_id, p.pin::int as pin
              from season_starters ss cross join lateral jsonb_array_elements_text(ss.episode_ids) with ordinality as p(episode_id, pin)
             where ss.season_id = $1)
     select e.id, e.title, e.setting, e.setup ->> 'venue' as venue, e.ending,
            case when e.character_a = lead.id then e.character_b else e.character_a end as partner,
            pins.pin, ${storyPassedSql("e")} as passed, ${face("a")}, ${face("b")}
       from lead
       join episodes e on lead.id in (e.character_a, e.character_b)
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
       left join pins on pins.episode_id = e.id
      where e.status = 'ready' and e.visibility = 'public' and e.revealed_at is not null
        and a.visibility = 'public' and b.visibility = 'public'
        and a.owner_id is distinct from $3 and b.owner_id is distinct from $3
        and not coalesce((e.setup ->> 'after_dark')::boolean, false)
        and (select count(*) from reports r where r.episode_id = e.id) < $4
        and ${featurableSql("e")}${opts.ids ? "\n        and e.id = any($6::text[])" : ""}
      order by pins.pin nulls last, (e.revealed_at >= $2::timestamptz) desc, ${storyPassedSql("e")} desc, ${STANDOUT_SCORE_SQL} desc, e.revealed_at desc, e.id
      limit $5`,
    params,
  );
  const faceOf = (r: StarterRow, x: "a" | "b"): StarterFace => ({ id: r[`${x}_id`], name: r[`${x}_name`], hue: r[`${x}_hue`], portrait: r[`${x}_portrait`] ?? null, house: Boolean(r[`${x}_house`]) });
  return rows.map((r) => ({
    id: r.id,
    title: sentenceCase(r.title?.trim() || null, [r.a_name, r.b_name], r.setting),
    line: r.setting,
    venue: r.venue ?? null,
    a: faceOf(r, "a"),
    b: faceOf(r, "b"),
    partner: r.partner,
    ending: r.ending,
    pinned: r.pin !== null && r.pin !== undefined,
    passed: Boolean(r.passed),
  }));
}

/**
 * The starters from the pool, in its order: the admin's pins as they are; then one date a partner (no partner twice,
 * pins included), each time the best one whose ending the box doesn't have yet (a second date, a disaster, friends)
 * while the record has one, else the best left.
 */
export function pickStarters<T extends Pick<Starter, "id" | "partner" | "ending" | "pinned">>(pool: readonly T[], n: number = STARTERS): T[] {
  const out: T[] = [];
  for (const c of pool) if (c.pinned && out.length < n && !out.some((o) => o.id === c.id)) out.push(c);
  const partners = new Set(out.map((c) => c.partner));
  const endings = new Set(out.map((c) => c.ending));
  while (out.length < n) {
    const open = pool.filter((c) => !c.pinned && !partners.has(c.partner));
    const next = open.find((c) => !endings.has(c.ending)) ?? open[0];
    if (!next) break;
    out.push(next);
    partners.add(next.partner);
    endings.add(next.ending);
  }
  return out;
}

export type SuitorState = "in" | "out" | "left" | "final_rose" | "runner_up";
export type SuitorCard = {
  id: string;
  name: string;
  hue: number | null;
  portrait: string | null;
  house: boolean;
  state: SuitorState;
  /** The Sunday they went home (a ceremony's held_on, YYYY-MM-DD), and by whose rose: the audience's vote or the lead's dates. */
  went_home_on: string | null;
  by: "vote" | "lead" | null;
};

/**
 * The season's suitors from the stored cast (as lib/ceremony.ts houseOf reads it: the database, not the loaded copy), in
 * billing order, each with how it stands: still in, went home at which Sunday's ceremony and by whose rose, left (an
 * owner's withdrawal), or the finale's final rose and runner-up (suitor_badges). A character that went private since is
 * left out.
 */
async function seasonSuitors(db: Db, seasonId: string): Promise<SuitorCard[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    hue: number | null;
    portrait: string | null;
    house: boolean;
    withdrawn: boolean;
    badge: string | null;
    went_home_on: string | null;
    went_home_by: "vote" | "lead" | null;
  }>(
    `select s.character_id as id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house,
            s.withdrawn_at is not null as withdrawn, b.badge, h.held_on as went_home_on,
            case when h.eliminated_by_vote = s.character_id then 'vote' when h.eliminated_by_lead = s.character_id then 'lead' end as went_home_by
       from season_casts s
       join characters c on c.id = s.character_id
       left join suitor_badges b on b.season_id = s.season_id and b.character_id = s.character_id and b.badge <> 'peoples_rose'
       left join lateral (
         select h.held_on, h.eliminated_by_vote, h.eliminated_by_lead from ceremonies h
          where h.season_id = s.season_id and h.held_at is not null and s.character_id in (h.eliminated_by_vote, h.eliminated_by_lead)
          order by h.held_on limit 1) h on true
      where s.season_id = $1 and s.source = 'suitor' and c.visibility = 'public' and c.owner_id is distinct from $2
      order by s.slot`,
    [seasonId, DELETED_OWNER],
  );
  return rows.map((r) => {
    const state: SuitorState = r.badge === "final_rose" ? "final_rose" : r.badge === "runner_up" ? "runner_up" : r.went_home_on ? "out" : r.withdrawn ? "left" : "in";
    return { id: r.id, name: r.name, hue: r.hue, portrait: r.portrait, house: r.house, state, went_home_on: state === "out" ? r.went_home_on : null, by: state === "out" ? r.went_home_by : null };
  });
}

export type ScheduleLine = {
  key: "start" | "pilot" | "dates" | "vote" | "premiere" | "ceremony" | "finale";
  /** When: words ("Every day"), or a moment the viewer's own clock shows (app/When.tsx, lib/when.ts). */
  when: { words: string } | { iso: string; style: "day-time" | "weekly" };
  what: string;
};

/**
 * When things happen, from what the code does, never a schedule of our own:
 *  - preseason, the season's start: casting closes and the shortlisted applicants with the most votes become the suitors
 *    (lib/season-cast.ts pickLeadCast, on the 1st);
 *  - every day, the lobby's house dates and the day's situation pair the lead with the suitor whose turn it is
 *    (lib/season-cast.ts suitorInTurn, lib/watch.ts lobbyDeal), so every suitor dates the lead before Sunday;
 *  - the vote on who goes home, open from VOTE_OPEN_DAYS before each ceremony Sunday but the finale's
 *    (lib/ceremony.ts ceremonyVoteOpensAt);
 *  - the rose ceremony on those Sundays (lib/season-format.ts ceremonySundays) at the ceremony's hour (ceremonyRunsAt:
 *    CEREMONY_HOUR_UTC, the job's :20 pass);
 *  - the finale, the last of them: the lead's final rose, by the season's record.
 *  - the Sunday premiere (lib/sunday-premiere.ts): on each of those Sundays at PREMIERE_HOUR_UTC (premiereAt), before
 *    the roses; preseason, the pilot ("Meet the lead") when `next` (nextPremiere) is this season's pilot, so a pilot
 *    the job won't air (back-to-back lead seasons, PREMIERE_PILOT=0, no lead picked) is never promised.
 */
export function seasonSchedule(
  def: SeasonFormatDef,
  seasonId: string,
  phase: SeasonPagePhase,
  lead: string | null,
  now: Date = new Date(),
  env: Env = process.env,
  next: NextPremiere | null = null,
): ScheduleLine[] {
  if (!def.lead) return [];
  const start = new Date(`${seasonId}T00:00:00Z`);
  const sundays = ceremonySundays(def, start);
  const finale = sundays[sundays.length - 1] ?? null;
  const today = now.toISOString().slice(0, 10);
  // The weekly lines take their weekday and time from the next ceremony that has a vote (every Sunday is at the same
  // hour; the finale has no vote): none left, and only the finale's line remains.
  const weekly = sundays.find((d) => d >= today && d !== finale) ?? null;
  const who = lead ?? "The lead";
  const whose = lead ? `${lead}'s` : "the lead's";
  const out: ScheduleLine[] = [];
  if (next?.kind === "pilot" && next.season_id === seasonId) {
    out.push({ key: "pilot", when: { iso: next.at, style: "day-time" }, what: `The pilot, Meet the lead: ${who} goes on a first date, live for everyone at once. No ceremony.` });
  }
  if (phase === "preseason") {
    out.push({ key: "start", when: { iso: start.toISOString(), style: "day-time" }, what: "Casting closes and the season starts: the shortlisted applicants with the most votes become the suitors." });
  }
  if (finale && today <= finale) {
    out.push({ key: "dates", when: { words: "Every day" }, what: `${who} dates the suitors in turn, so each one gets a date before Sunday.` });
    if (weekly) {
      out.push({ key: "vote", when: { iso: ceremonyVoteOpensAt(weekly).toISOString(), style: "weekly" }, what: "The vote on who goes home opens: one vote each, and you can change it until the ceremony." });
    }
    const premiereSunday = sundays.find((d) => d >= today) ?? null;
    if (premiereSunday && sundayPremiereOn(env)) {
      out.push({ key: "premiere", when: { iso: premiereAt(premiereSunday, env).toISOString(), style: "weekly" }, what: `The Sunday premiere: ${whose} last date before the roses, live for everyone at once.` });
    }
    if (weekly) {
      out.push({ key: "ceremony", when: { iso: ceremonyRunsAt(weekly, env).toISOString(), style: "weekly" }, what: `The rose ceremony: one suitor goes home by your vote and one by how ${whose} dates went, until two are left.` });
    }
  }
  if (finale) {
    out.push({
      key: "finale",
      when: { iso: ceremonyRunsAt(finale, env).toISOString(), style: "day-time" },
      what: today <= finale ? `The finale: ${who} gives the final rose, by how the season's dates went.` : `The finale: ${who} gave the final rose.`,
    });
  }
  return out;
}

export type SeasonCasting = {
  /** The suitors' places (five on The Botchelor). */
  places: number;
  /** The top of the board, most votes first, as /casting shows them; null when it couldn't be read. */
  auditions: AuditionCard[] | null;
  /** How many have applied in all. */
  total: number;
};

export type SeasonLiveData = {
  season: SeasonRef;
  /** "December". */
  month: string;
  /** When the season starts (ISO): its first night, 00:00 UTC on the 1st. */
  starts_at: string;
  phase: SeasonPagePhase;
  def: SeasonFormatDef;
  /** In season: the night and the days to the finale (the arc's maths). */
  arc: SeasonArc | null;
  lead: SeasonLead | null;
  starters: Starter[];
  /** Preseason: casting for the suitors' places. */
  casting: SeasonCasting | null;
  /** In season: the suitors and how each stands. */
  suitors: SuitorCard[] | null;
  schedule: ScheduleLine[];
  contrast: string | null;
  /** The next Sunday premiere when it is this season's (the pilot in preseason, then each Sunday's), else null. */
  premiere: NextPremiere | null;
};

/**
 * Everything the live page shows, in one Promise.all after the format (the page's second round trip): the lead, the
 * starters' pool, and the suitors (preseason: the casting board for this season, lib/auditions.ts; in season: the
 * stored cast). A part that fails to load is left out, never the page.
 */
export async function loadSeasonLive(db: Db, seasonId: string, phase: SeasonPagePhase, def: SeasonFormatDef, now: Date = new Date(), env: Env = process.env): Promise<SeasonLiveData> {
  const [lead, pool, board, suitors, next] = await Promise.all([
    seasonLead(db, seasonId).catch(() => null),
    starterPool(db, seasonId).catch(() => [] as Starter[]),
    phase === "preseason" ? castingBoard(db, null, now).catch(() => null) : null,
    phase === "season" ? seasonSuitors(db, seasonId).catch(() => [] as SuitorCard[]) : null,
    nextPremiere(db, now, env).catch(() => null),
  ]);
  const premiere = next && next.season_id === seasonId ? next : null;
  const places = suitorPlaces(def);
  const month = seasonMonth(seasonId);
  const auditions = board && board.season_id === seasonId ? board.auditions : null;
  return {
    season: seasonRef(seasonId),
    month,
    starts_at: new Date(`${seasonId}T00:00:00Z`).toISOString(),
    phase,
    def,
    arc: phase === "season" ? seasonArc(now, def) : null,
    lead,
    starters: pickStarters(pool),
    casting: phase === "preseason" ? { places, auditions: auditions ? auditions.slice(0, places) : null, total: auditions?.length ?? 0 } : null,
    suitors,
    schedule: seasonSchedule(def, seasonId, phase, lead?.short ?? null, now, env, premiere),
    contrast: formatContrast(def, month),
    premiere,
  };
}

// ---------------- the admin's pins (/admin/season, app/api/admin/season-starters) ----------------

/** The season whose page takes pins now: this one when it runs a lead format, else the next when it will. */
export async function pinnableSeason(db: Db, now: Date = new Date()): Promise<{ id: string; phase: SeasonPagePhase; def: SeasonFormatDef } | null> {
  for (const id of [seasonIdOf(now), seasonIdOf(nextSeasonStart(now))]) {
    const live = await liveSeasonFormat(db, id, now);
    if (live) return { id, ...live };
  }
  return null;
}

/** A season's pinned starters as stored, in order. */
export async function seasonPins(db: Db, seasonId: string): Promise<string[]> {
  const row = (await db.query<{ episode_ids: unknown }>(`select episode_ids from season_starters where season_id = $1`, [seasonId])).rows[0];
  return Array.isArray(row?.episode_ids) ? row.episode_ids.filter((x): x is string => typeof x === "string") : [];
}

/** An episode's id from what an admin pasted: the id itself, or a link to it (/episodes/<id>, with any query). */
export function episodeIdFrom(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /\/episodes\/([^/?#\s]+)/.exec(s);
  const id = m ? decodeURIComponent(m[1]) : s;
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

export type PinResult = { ok: true; pins: string[] } | { ok: false; status: number; error: string; message: string; failing?: string[] };

/**
 * Pins up to STARTERS of the lead's dates for a season's page, in order (none clears them). Each must pass the automatic
 * picks' checks now (starterPool), and the page checks again whenever it shows one: a pin hidden or found contradicting
 * later simply drops out.
 */
export async function setSeasonPins(db: Db, seasonId: string, inputs: readonly string[], now: Date = new Date()): Promise<PinResult> {
  if (!(await liveSeasonFormat(db, seasonId, now))) {
    return { ok: false, status: 400, error: "not_a_lead_season", message: "Pins are for this season's page or the next one's, while it runs a lead format." };
  }
  const ids: string[] = [];
  for (const raw of inputs) {
    if (!raw.trim()) continue;
    const id = episodeIdFrom(raw);
    if (!id) return { ok: false, status: 400, error: "not_an_episode", message: `"${raw.trim().slice(0, 80)}" isn't an episode id or link.` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > STARTERS) return { ok: false, status: 400, error: "too_many", message: `Up to ${STARTERS} pins.` };
  if (!ids.length) {
    await db.query(`delete from season_starters where season_id = $1`, [seasonId]);
    return { ok: true, pins: [] };
  }
  const passing = new Set((await starterPool(db, seasonId, { ids })).map((s) => s.id));
  const failing = ids.filter((id) => !passing.has(id));
  if (failing.length) {
    return {
      ok: false,
      status: 400,
      error: "not_a_starter",
      message: "A pin must be one of the lead's aired public dates with a public partner, not hidden after reports, and not one the story check found contradicting.",
      failing,
    };
  }
  await db.query(
    `insert into season_starters (season_id, episode_ids, updated_at) values ($1, $2::jsonb, now())
     on conflict (season_id) do update set episode_ids = excluded.episode_ids, updated_at = now()`,
    [seasonId, JSON.stringify(ids)],
  );
  return { ok: true, pins: ids };
}

export type StartersAdmin = {
  switched_on: boolean;
  season: { id: string; label: string; path: string; phase: SeasonPagePhase } | null;
  lead: { id: string; name: string } | null;
  /** The stored pins, each with whether it passes the checks now (only those show). */
  pins: { id: string; shows: boolean }[];
  /** What the page's box shows now, in order. */
  showing: { id: string; names: string; title: string | null; pinned: boolean }[];
};

/** The admin fold's view: which season takes pins, its lead, the pins and what the box shows now. */
export async function startersAdminView(db: Db, now: Date = new Date()): Promise<StartersAdmin> {
  const target = await pinnableSeason(db, now);
  if (!target) return { switched_on: seasonPageLiveOn(), season: null, lead: null, pins: [], showing: [] };
  const [lead, pins, pool] = await Promise.all([seasonLead(db, target.id), seasonPins(db, target.id), starterPool(db, target.id)]);
  const passing = new Set(pool.filter((s) => s.pinned).map((s) => s.id));
  const s = seasonRef(target.id);
  return {
    switched_on: seasonPageLiveOn(),
    season: { id: s.id, label: s.label, path: s.path, phase: target.phase },
    lead: lead ? { id: lead.id, name: lead.name } : null,
    pins: pins.map((id) => ({ id, shows: passing.has(id) })),
    showing: pickStarters(pool).map((p) => ({ id: p.id, names: `${p.a.name} × ${p.b.name}`, title: p.title, pinned: p.pinned })),
  };
}
