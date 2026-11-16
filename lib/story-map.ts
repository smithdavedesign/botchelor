/**
 * This week's story map (2026-11-15; docs/relationship-graph.md "The story map"). The Constellation drew everyone who
 * ever dated, and nobody read it (three visitors in thirty days, none scrolled). The show now has a story each day: a
 * house scene, confrontations and challenges, a producer whose public lines say who is after whom. The map draws THAT,
 * for this season's cast and the last seven days: who is on a date, who agreed to another, who is together, who are
 * rivals, who had it out, who talked about whom.
 *
 * WHAT IT MAY READ: the public record only, and never more than another public page already says.
 *  - dates coming up: rooms the watch lobby lists (/watch), of public dates between public characters;
 *  - where a pair stands: the relationship graph's PUBLIC layer (relationships.public_*: aired public dates only), the
 *    same stage badge the Constellation's ledger shows;
 *  - rivals, feuds, two stories: the producer's public lines (story_beats.previously, shown on /watch and GET
 *    /api/story), by their KIND and names only. Never `why`, `evidence` or `wants`, and never the order of `who` where
 *    it could tell who is right;
 *  - had it out, won a date, talked about: the scenes on /house, exactly the lines and results that page shows
 *    (listHouseScenes has already dropped reported and removed lines, private speakers and dates that left the air).
 * It never reads character_opinions, character_heard, character_wants or character_knows_said, a line's words, whether
 * a claim is true, a date that has not aired, or anything of a private, unlisted or deleted character: a tie with one
 * end that is not public is left out whole (not masked: a story about someone hidden is not told).
 *
 * Nothing here is read by the engine: the map is presentation. STORY_MAP=0 turns it off without a deploy of code.
 *
 * `shapeStoryMap` is the pure half (rows in, map out; the privacy rules are checked again there, on the rows);
 * `storyMap` is the one read; `cachedStoryMap` keeps a build for everyone, the way lib/graph-cache.ts keeps the
 * Constellation, under the same tag, so whatever takes someone off the public sky takes them off the map at once.
 */
import { unstable_cache } from "next/cache";
import { castingLead, leadBilling } from "./casting";
import { getDb, type Db } from "./db";
import { GRAPH_STALE_SECONDS, GRAPH_TAG, GRAPH_TTL_SECONDS } from "./graph-cache";
import { houseScenesOn, listHouseScenes, scenePath, type Outcome } from "./house-scenes";
import { shortName } from "./names";
import { portraitPathSql } from "./portrait-sql";
import { producerOn } from "./producer";
import { isStage, shownStage, stageWords, TOGETHER_STAGES } from "./relationship-stages";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { leadAndSuitors, showCastIds } from "./season-cast";
import { seasonIdOf } from "./season-window";
import { watchClock } from "./watch";

type Env = Record<string, string | undefined>;

/** STORY_MAP: on unless it is "0". Off: /house and /graph are as they were, and nothing here is read. */
export const storyMapOn = (env: Env = process.env): boolean => env.STORY_MAP?.trim() !== "0";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "This week": how far back a tie counts. */
export const STORY_DAYS = 7;
/** An open room nobody has started is "coming up" this long; an older one is furniture, not news. */
export const OPEN_ROOM_DAYS = 2;
/** The most ties a map keeps (the newest and strongest first). */
export const TIES_MAX = 60;
/** The most people the drawing shows: the cast, then whoever the strongest ties bring. */
export const MAP_PEOPLE_MAX = 10;
export const CIRCLE_MAX = 6;
const DELETED_OWNER = "deleted";

/**
 * What a tie is. `date_now` and `date_next`: a public booking. `rivals`, `feuding`, `stories`: the producer's public
 * line, or (feuding) a public confrontation. `cleared`: they had it out and it ended well. `broke_up`: a couple who
 * were going steady or more split this week (or divorced). `together`: a couple, in the shown stage's own words
 * (dating, keeping it casual, going steady, official, moved in together, engaged, married, back together).
 * `bad_blood`: a public date this week left a pair with history on bad terms (the shown stage, lib/relationship-stages.ts:
 * a single date that didn't click is no tie at all); it ranks under the house's own stories.
 */
export const TIE_KINDS = ["date_now", "rivals", "feuding", "date_next", "cleared", "broke_up", "together", "second_date", "bad_blood", "stories", "talked"] as const;
export type TieKind = (typeof TIE_KINDS)[number];
/** One word or two for the key under the map. */
export const TIE_KIND_LABELS: Record<TieKind, string> = {
  date_now: "On a date now",
  rivals: "Rivals",
  feuding: "Feuding",
  date_next: "Date coming up",
  cleared: "Cleared the air",
  broke_up: "Broke up",
  together: "Together",
  second_date: "Second date agreed",
  bad_blood: "Bad blood",
  stories: "Two stories",
  talked: "Talked about",
};
const rank = (k: TieKind): number => TIE_KINDS.indexOf(k);

export type StoryPerson = {
  id: string;
  /** The first name, as the house says it. */
  name: string;
  full_name: string;
  hue: number | null;
  portrait: string | null;
  house: boolean;
  /** On this season's cast. */
  cast: boolean;
  lead: boolean;
};

export type StoryTie = {
  /** Stable for a week: the kind and the two (and who it is over). */
  id: string;
  kind: TieKind;
  a: string;
  b: string;
  /** Who it is over, when that is someone else (rivals, two stories). */
  about: string | null;
  /** A few words for the line on the map: "rivals for Juniper". */
  label: string;
  /** The same as a sentence, without the when: "Nell and Sable: rivals for Juniper". */
  text: string;
  /** "since Sunday", "today", "on Friday", "now", "coming up". */
  when: string;
  /** When it began (or, for a date coming up, when it was announced), ISO. */
  at: string;
  /** What made it: the couple's page, the scene, the room. */
  href: string;
};

export type StoryMap = {
  season_id: string;
  /** The first day the map covers, YYYY-MM-DD. */
  since: string;
  built_at: string;
  /** The lead, when the season (or the coming one) has one who is on the map: "this season's Botchelor". */
  lead: { id: string; billing: string } | null;
  /** The cast first (the lead first of them), then everyone a tie brings, strongest tie first. */
  people: StoryPerson[];
  /** Strongest kind first, then newest. */
  ties: StoryTie[];
};

/* ------------------------------------------------ the rows ------------------------------------------------ */

export type RawPerson = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean; visibility: string; owner_id: string | null };
/** A producer's public beat: the kind, the two it is between and who it is over. Only a row with a public line counts. */
export type RawBeat = { day: string; tension: string | null; who: string[] | null; about: string | null; previously: string | null };
/** A pair's public layer (relationships.public_*). */
export type RawPair = { a: string; b: string; stage: string | null; dates: number; second_dates: number; last_at: string | Date | null };
// `stage`: the pair's public stage as it is SHOWN (storyMap resolves it: lib/relationship-stages.ts shownStage).
/** A room the lobby lists. `public`: the date is public (the read asks for nothing else; the shaper checks it again). */
export type RawRoom = { id: string; a: string; b: string; starts_at: string | Date | null; created_at: string | Date; public: boolean; ended: boolean };
/**
 * A stored house scene, cut to what the map may use: who spoke each line and which aired date it retold (never the
 * words), and how it came out. `shown`: the numbers (from 1) of the lines /house shows; `result_shown`: whether /house
 * shows the result. A scene /house does not list has neither.
 */
export type RawScene = {
  id: string;
  day: string;
  kind: string;
  lines: { character_id: string; tell?: { about: string; about_b: string } | null }[];
  result:
    | { kind: "confrontation"; a: string; b: string; outcome: Outcome }
    | { kind: "challenge"; winner: string; prize: { day: string; with: string | null } }
    | null;
  shown: number[];
  result_shown: boolean;
};

export type StoryFacts = {
  now: Date;
  season_id: string;
  /** This season's cast, in billing order. */
  cast: readonly string[];
  lead: { id: string; billing: string } | null;
  people: readonly RawPerson[];
  beats: readonly RawBeat[];
  pairs: readonly RawPair[];
  rooms: readonly RawRoom[];
  scenes: readonly RawScene[];
};

/* ------------------------------------------------ shaping ------------------------------------------------ */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const iso = (v: string | Date): string => new Date(v).toISOString();

/** "today", "yesterday" or the weekday, for a moment in the last week (UTC days, like the show's). */
export function dayWord(at: string, now: Date): string {
  const days = Math.round((Date.parse(`${dayOf(now)}T00:00:00Z`) - Date.parse(`${at.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return WEEKDAYS[new Date(at).getUTCDay()];
}
/** A state that began then and still stands: "since Sunday", "since yesterday", "today". */
const since = (at: string, now: Date): string => {
  const w = dayWord(at, now);
  return w === "today" ? "today" : `since ${w}`;
};
/** Something that happened then: "on Sunday", "yesterday", "today". */
const onDay = (at: string, now: Date): string => {
  const w = dayWord(at, now);
  return w === "today" || w === "yesterday" ? w : `on ${w}`;
};

const OUTCOME_WORDS: Record<Outcome, string> = {
  cleared_the_air: "had it out and cleared the air",
  agreed_to_disagree: "had it out and agreed to disagree",
  worse_than_before: "had it out, and it ended worse than it started",
};

/**
 * The map from the rows. Pure. Every rule of the header is applied here again, on the rows it is handed: a person who
 * is not public (or whose owner is gone) is not on the map and neither is any tie that touches them; a tie needs one
 * of the season's cast at an end; a beat with no public line, a scene line /house does not show and a room whose date
 * is not public make nothing.
 */
export function shapeStoryMap(f: StoryFacts): StoryMap {
  const from = new Date(f.now.getTime() - STORY_DAYS * DAY_MS);
  const today = dayOf(f.now);
  const known = new Map(f.people.filter((p) => p.visibility === "public" && p.owner_id !== DELETED_OWNER).map((p) => [p.id, p]));
  const cast = f.cast.filter((id) => known.has(id));
  const onCast = new Set(cast);
  const nm = (id: string): string => shortName(known.get(id)!.name);
  const inWeek = (at: string): boolean => Date.parse(at) >= from.getTime();

  const ties = new Map<string, StoryTie>();
  /** `keep`: which moment a repeated tie keeps: a state keeps its first day ("since"), an event its latest. */
  const add = (kind: TieKind, x: string, y: string, about: string | null, at: string, href: string, words: { label: string; text: string; when: string }, keep: "first" | "last" = "last") => {
    if (x === y || !known.has(x) || !known.has(y) || (about !== null && !known.has(about))) return;
    if (!onCast.has(x) && !onCast.has(y)) return;
    const [lo, hi] = x < y ? [x, y] : [y, x];
    const id = `${kind}|${lo}|${hi}|${about ?? ""}`;
    const had = ties.get(id);
    if (had && (keep === "first" ? Date.parse(had.at) <= Date.parse(at) : Date.parse(had.at) >= Date.parse(at))) return;
    ties.set(id, { id, kind, a: x, b: y, about, at, href, ...words });
  };
  /** The two by name in an order that says nothing but the alphabet. */
  const byName = (x: string, y: string): [string, string] => (nm(x).localeCompare(nm(y)) > 0 || (nm(x) === nm(y) && x > y) ? [y, x] : [x, y]);
  const pairPath = (x: string, y: string): string => `/couples/${[x, y].sort().join("/")}`;

  // The producer's public lines. A beat for a day that has not begun is not public yet (its line shows on its day).
  for (const b of f.beats) {
    if (!b.previously?.trim() || !b.who || b.who.length < 2 || b.day > today) continue;
    const at = `${b.day}T00:00:00.000Z`;
    if (!inWeek(`${b.day}T23:59:59.000Z`)) continue;
    const [p, q] = b.who;
    if (!known.has(p) || !known.has(q)) continue;
    const [x, y] = byName(p, q);
    const both = `${nm(x)} and ${nm(y)}`;
    if (b.tension === "rivals" && b.about && known.has(b.about)) {
      const label = `rivals for ${nm(b.about)}`;
      add("rivals", x, y, b.about, at, "/watch", { label, text: `${both}: ${label}`, when: since(at, f.now) }, "first");
    } else if (b.tension === "opposing_claims" && b.about && known.has(b.about)) {
      // Alphabetical, never the stored order: that one lists whoever holds the true story first.
      const label = `two stories about ${nm(b.about)}`;
      add("stories", x, y, b.about, at, "/house", { label, text: `${both}: heard two different stories about ${nm(b.about)}`, when: since(at, f.now) }, "first");
    } else if (b.tension === "knows_said") {
      // The roles are the public line itself ("A found out what B has been saying").
      add("feuding", p, q, null, at, "/house", { label: "found out what was said", text: `${nm(p)} found out what ${nm(q)} has been saying`, when: since(at, f.now) }, "first");
    } else if (b.tension === "mutual_distrust") {
      add("feuding", x, y, null, at, "/house", { label: "stopped trusting each other", text: `${both}: stopped trusting each other`, when: since(at, f.now) }, "first");
    }
  }

  // The house: what /house shows, and nothing it does not.
  for (const s of f.scenes) {
    const at = `${s.day}T12:00:00.000Z`;
    if (s.day > today || !inWeek(`${s.day}T23:59:59.000Z`)) continue;
    const href = scenePath(s.id);
    if (s.result_shown && s.result?.kind === "confrontation") {
      const { a, b, outcome } = s.result;
      if (known.has(a) && known.has(b)) {
        const [x, y] = byName(a, b);
        const words = OUTCOME_WORDS[outcome] ?? OUTCOME_WORDS.agreed_to_disagree;
        const kind: TieKind = outcome === "cleared_the_air" ? "cleared" : "feuding";
        add(kind, x, y, null, at, href, { label: outcome === "cleared_the_air" ? "cleared the air" : "had it out", text: `${nm(x)} and ${nm(y)} ${words}`, when: onDay(at, f.now) });
      }
    }
    if (s.result_shown && s.result?.kind === "challenge" && s.result.prize.with && s.result.prize.day >= today) {
      const { winner, prize } = s.result;
      if (known.has(winner) && known.has(prize.with!)) {
        const on = prize.day === today ? "today" : `on ${WEEKDAYS[new Date(`${prize.day}T12:00:00Z`).getUTCDay()]}`;
        add("date_next", winner, prize.with!, null, at, href, { label: "won the next date", text: `${nm(winner)} won a date with ${nm(prize.with!)}`, when: on });
      }
    }
    const shown = new Set(s.shown);
    s.lines.forEach((l, i) => {
      if (!l.tell || !shown.has(i + 1) || !known.has(l.character_id)) return;
      // A retelling names a date's two: without both of them public it is not on /house either.
      if (!known.has(l.tell.about) || !known.has(l.tell.about_b)) return;
      for (const subject of [l.tell.about, l.tell.about_b]) {
        if (subject === l.character_id) continue;
        add("talked", l.character_id, subject, null, at, href, { label: "talked about", text: `${nm(l.character_id)} talked about ${nm(subject)} in the house`, when: onDay(at, f.now) });
      }
    });
  }

  // Dates the lobby lists: on now, or coming up.
  for (const r of f.rooms) {
    if (!r.public || r.ended || !known.has(r.a) || !known.has(r.b)) continue;
    const start = r.starts_at ? new Date(r.starts_at) : null;
    const href = `/watch/${r.id}`;
    const both = `${nm(r.a)} and ${nm(r.b)}`;
    if (start && start.getTime() <= f.now.getTime()) {
      add("date_now", r.a, r.b, null, iso(start), href, { label: "on a date now", text: `${both}: on a date right now`, when: "now" });
    } else if (start || Date.parse(iso(r.created_at)) >= f.now.getTime() - OPEN_ROOM_DAYS * DAY_MS) {
      const when = start ? (dayOf(start) === today ? "today" : `on ${WEEKDAYS[start.getUTCDay()]}`) : "coming up";
      add("date_next", r.a, r.b, null, iso(r.created_at), href, { label: "date coming up", text: `${both}: a date`, when });
    }
  }

  // Where a pair stands on the public layer, when they dated this week.
  for (const p of f.pairs) {
    if (!p.last_at || p.dates < 1 || !known.has(p.a) || !known.has(p.b)) continue;
    const at = iso(p.last_at);
    if (!inWeek(at) || Date.parse(at) > f.now.getTime()) continue;
    const [x, y] = byName(p.a, p.b);
    const both = `${nm(x)} and ${nm(y)}`;
    const href = pairPath(x, y);
    if (isStage(p.stage) && TOGETHER_STAGES.includes(p.stage)) {
      const label = stageWords(p.stage);
      add("together", x, y, null, at, href, { label, text: `${both}: ${label}`, when: `last date ${onDay(at, f.now)}` });
    } else if (p.stage === "broke_up" || p.stage === "divorced") {
      const label = p.stage === "divorced" ? "divorced" : "broke up";
      add("broke_up", x, y, null, at, href, { label, text: `${both}: ${label}`, when: onDay(at, f.now) });
    } else if (p.stage === "sparks") {
      add("second_date", x, y, null, at, href, { label: "second date agreed", text: `${both}: agreed to a second date`, when: onDay(at, f.now) });
    } else if (p.stage === "bad_blood") {
      add("bad_blood", x, y, null, at, href, { label: "bad blood", text: `${both}: bad blood after their date`, when: since(at, f.now) });
    }
  }

  const sorted = [...ties.values()].sort((s, t) => rank(s.kind) - rank(t.kind) || Date.parse(t.at) - Date.parse(s.at) || s.id.localeCompare(t.id)).slice(0, TIES_MAX);
  const lead = f.lead && onCast.has(f.lead.id) ? f.lead : null;
  const order = [...(lead ? [lead.id] : []), ...cast.filter((id) => id !== lead?.id)];
  for (const t of sorted) for (const id of [t.a, t.b]) if (!order.includes(id)) order.push(id);
  const people = order.map((id): StoryPerson => {
    const p = known.get(id)!;
    return { id, name: shortName(p.name), full_name: p.name, hue: p.hue, portrait: p.portrait, house: p.house, cast: onCast.has(id), lead: id === lead?.id };
  });
  return { season_id: f.season_id, since: dayOf(from), built_at: f.now.toISOString(), lead, people, ties: sorted };
}

/* ------------------------------------------------ views of a map ------------------------------------------------ */

/** A pair's ties as the drawing shows them: one line, its strongest tie, and how many more the list has. */
export type DrawnTie = StoryTie & { more: number };

/**
 * What the drawing shows of a map: the cast and whoever the strongest ties bring, up to `max` people; one line a pair.
 * `left_out`: ties (with someone outside the cast) that did not fit; the list says so.
 */
export function mapView(map: StoryMap, max = MAP_PEOPLE_MAX): { people: StoryPerson[]; ties: StoryTie[]; lines: DrawnTie[]; left_out: number } {
  const castN = map.people.filter((p) => p.cast).length;
  const people = map.people.slice(0, Math.max(max, castN));
  const on = new Set(people.map((p) => p.id));
  const ties = map.ties.filter((t) => on.has(t.a) && on.has(t.b));
  const lines = new Map<string, DrawnTie>();
  for (const t of ties) {
    const key = t.a < t.b ? `${t.a}~${t.b}` : `${t.b}~${t.a}`;
    const had = lines.get(key);
    if (had) had.more++;
    else lines.set(key, { ...t, more: 0 });
  }
  // Someone no line reaches (a tie cut by the cap) would float alone: only the cast may stand without a line.
  const reached = new Set([...lines.values()].flatMap((t) => [t.a, t.b]));
  return { people: people.filter((p) => p.cast || reached.has(p.id)), ties, lines: [...lines.values()], left_out: map.ties.length - ties.length };
}

export type CircleData = {
  center: StoryPerson;
  /** Up to CIRCLE_MAX people, each with the strongest tie to them. */
  around: { person: StoryPerson; tie: StoryTie }[];
  /** Ties (and people) the circle had no room for. */
  more: number;
};

/** One character's circle from a map: them and the people their strongest ties reach. Null when they have none. */
export function circleOf(map: StoryMap | null, characterId: string, max = CIRCLE_MAX): CircleData | null {
  if (!map) return null;
  const center = map.people.find((p) => p.id === characterId);
  if (!center) return null;
  const byId = new Map(map.people.map((p) => [p.id, p]));
  const around = new Map<string, { person: StoryPerson; tie: StoryTie }>();
  let mine = 0;
  for (const t of map.ties) {
    if (t.a !== characterId && t.b !== characterId) continue;
    mine++;
    const other = byId.get(t.a === characterId ? t.b : t.a);
    if (other && !around.has(other.id) && around.size < max) around.set(other.id, { person: other, tie: t });
  }
  if (!around.size) return null;
  return { center, around: [...around.values()], more: mine - around.size };
}

/* ------------------------------------------------ the read ------------------------------------------------ */

type SceneRow = { id: string; day: string; kind: string; lines: { character_id: string; tell?: { about: string; about_b: string } | null }[] | null; result: RawScene["result"] };

/**
 * This season's map, in one read: four statements at once (the producer's public lines, the cast's public pairs, the
 * lobby's rooms, the house's scenes next to what /house shows of them), then one for the people they name.
 */
export async function storyMap(db: Db, now: Date = new Date(), env: Env = process.env): Promise<StoryMap> {
  const season = seasonIdOf(now);
  const cast = showCastIds(now);
  const from = new Date(now.getTime() - STORY_DAYS * DAY_MS);
  const fromDay = dayOf(from);
  const today = dayOf(now);
  const none = <T,>() => ({ rows: [] as T[] });
  // The lead: this season's (lib/season-cast.ts, already loaded), else the one casting is open for (next month's,
  // before the 1st), which is looked up next to the other reads.
  const seasonLead = leadAndSuitors(now)?.lead ?? null;
  const [beats, pairs, rooms, sceneRows, shown, casting] = await Promise.all([
    producerOn(env)
      ? db
          .query<RawBeat>(`select day, tension, who, about, previously from story_beats where day >= $1 and day <= $2 and status in ('staged', 'played', 'missed') order by day`, [fromDay, today])
          .catch(() => none<RawBeat>())
      : none<RawBeat>(),
    // The public layer's columns only, as lib/graph.ts reads them.
    db
      .query<RawPair & { shown: string | null }>(
        `select r.character_a as a, r.character_b as b, r.public_stage as stage, r.public_shown_stage as shown, r.public_dates as dates, r.public_second_dates as second_dates, r.public_last_at as last_at
           from relationships r
          where r.public_dates > 0 and r.public_last_at >= $2 and (r.character_a = any($1) or r.character_b = any($1))
          order by r.public_last_at desc limit 200`,
        [cast, from.toISOString()],
      )
      .catch(() => none<RawPair & { shown: string | null }>()),
    // The rooms /watch lists (lib/watch.ts listLobby), cut to public dates with one of the cast on them.
    db
      .query<{ id: string; a: string; b: string; starts_at: string | Date | null; created_at: string | Date }>(
        `select w.id, e.character_a as a, e.character_b as b, w.starts_at, w.created_at
           from watch_parties w join episodes e on e.id = w.episode_id
          where e.visibility = 'public' and (e.character_a = any($1) or e.character_b = any($1))
            and w.created_at >= $2
            and (select count(*) from reports r where r.episode_id = e.id) < $3
            and (w.kind <> 'template' or jsonb_array_length(e.transcript) > 0)
          order by w.created_at desc limit 40`,
        [cast, from.toISOString(), REPORT_HIDE_THRESHOLD],
      )
      .catch(() => none<{ id: string; a: string; b: string; starts_at: string | Date | null; created_at: string | Date }>()),
    houseScenesOn(env)
      ? db
          .query<SceneRow>(`select id, day, kind, lines, result from house_scenes where day >= $1 and source in ('model', 'template') and jsonb_array_length(lines) > 0 order by day desc limit 30`, [fromDay])
          .catch(() => none<SceneRow>())
      : none<SceneRow>(),
    // What /house shows of those scenes: the lines and results that passed its own checks.
    houseScenesOn(env) ? listHouseScenes(db, { limit: 30 }).catch(() => ({ scenes: [], total: 0 })) : { scenes: [], total: 0 },
    seasonLead ? null : castingLead(db, now, env).catch(() => null),
  ]);
  const views = new Map(shown.scenes.map((s) => [s.id, s]));
  const scenes: RawScene[] = sceneRows.rows.map((r) => {
    const v = views.get(r.id);
    return {
      id: r.id,
      day: r.day,
      kind: r.kind,
      // The speaker and the date's two only: a line's words and whether its claim is true never leave the row.
      lines: (r.lines ?? []).map((l) => ({ character_id: l.character_id, tell: l.tell ? { about: l.tell.about, about_b: l.tell.about_b } : null })),
      result: r.result,
      shown: v ? v.lines.map((l) => l.n) : [],
      result_shown: Boolean(v?.result),
    };
  });
  const roomRows: RawRoom[] = rooms.rows.map((r) => ({ ...r, public: true, ended: r.starts_at ? watchClock(r.starts_at, now).ended : false }));

  const lead = seasonLead ? { id: seasonLead, billing: "this season's Botchelor" } : casting ? { id: casting.lead.id, billing: leadBilling(casting) } : null;

  const ids = new Set<string>(cast);
  for (const b of beats.rows) for (const id of [...(b.who ?? []), b.about]) if (id) ids.add(id);
  for (const p of pairs.rows) ids.add(p.a).add(p.b);
  for (const r of roomRows) ids.add(r.a).add(r.b);
  for (const s of scenes) {
    for (const l of s.lines) {
      ids.add(l.character_id);
      if (l.tell) ids.add(l.tell.about).add(l.tell.about_b);
    }
    if (s.result?.kind === "confrontation") ids.add(s.result.a).add(s.result.b);
    if (s.result?.kind === "challenge") {
      ids.add(s.result.winner);
      if (s.result.prize.with) ids.add(s.result.prize.with);
    }
  }
  const people = ids.size
    ? (
        await db.query<RawPerson>(
          `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house, c.visibility, c.owner_id
             from characters c where c.id = any($1) and c.visibility = 'public' and c.owner_id is distinct from $2`,
          [[...ids], DELETED_OWNER],
        )
      ).rows
    : [];
  return shapeStoryMap({ now, season_id: season, cast, lead, people, beats: beats.rows, pairs: pairs.rows.map((p) => ({ ...p, stage: shownStage(isStage(p.stage) ? p.stage : null, isStage(p.shown) ? p.shown : null, env) })), rooms: roomRows, scenes });
}

/* ------------------------------------------------ the shared copy ------------------------------------------------ */

type Stamped = { at: number; data: StoryMap };
const cachedMap = unstable_cache(async (): Promise<Stamped> => ({ at: Date.now(), data: await storyMap(await getDb()) }), ["story-map", "v1"], {
  revalidate: GRAPH_TTL_SECONDS,
  // The Constellation's tag: lib/graph-cache.ts invalidateGraph (a visibility change, a report, a removal) drops both.
  tags: [GRAPH_TAG],
});
/** Outside a Next request (vitest, scripts) there's no data cache: unstable_cache throws this invariant. */
const noCacheHere = (err: unknown): boolean => err instanceof Error && /incrementalCache missing/.test(err.message);

/**
 * The map every page view shares, at most GRAPH_STALE_SECONDS old (GRAPH_TTL_SECONDS once anyone has visited), or null
 * with the switch off. /house, /graph and a character's circle all read this one copy.
 */
export async function cachedStoryMap(db?: Db, env: Env = process.env): Promise<StoryMap | null> {
  if (!storyMapOn(env)) return null;
  const build = async () => storyMap(db ?? (await getDb()), new Date(), env);
  let hit: Stamped;
  try {
    hit = await cachedMap();
  } catch (err) {
    if (noCacheHere(err)) return build();
    throw err;
  }
  if (Date.now() - hit.at > GRAPH_STALE_SECONDS * 1000) return build();
  return hit.data;
}

/**
 * One character's circle (app/Circle.tsx), for a page's own Promise.all: from the shared map, so it costs a page no
 * read of its own while the map is warm. Null when the character has no ties this week, the switch is off, or the map
 * could not be read (a circle never fails a page).
 */
export async function loadCircle(db: Db, characterId: string, env: Env = process.env): Promise<CircleData | null> {
  return circleOf(await cachedStoryMap(db, env).catch(() => null), characterId);
}
