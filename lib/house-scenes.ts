/**
 * The daily house scene: where claims spread (the drama wave, 2026-11-15, item 2; docs/seasons.md "The house",
 * docs/character-depth.md "Story state"). The cast group chat (lib/cast-chat.ts) gossips about what aired and is
 * forgotten; this is the same kind of gossip, said out loud in the show's house, and it leaves STATE behind: every
 * aired fact a speaker retells becomes something the others in the room heard, from that speaker (lib/story-state.ts
 * hear), so a later date can bring it up ("Sable says you walked out") and the person it was about can find out who
 * said it.
 *
 *  - One scene a day while a season has a cast: two or three cast members who were NOT on the date being talked about,
 *    four to six lines, somewhere in the house (HOUSE_PLACES). Written once by the hourly lobby job (ensureHouseScene),
 *    on its first pass at or after HOUSE_SCENE_HOUR_UTC (18), about the public dates that aired since the scene before
 *    it (a day back at most). Stored (house_scenes), so a page view never calls a model. One call on the show's free
 *    model (getModel(…, false)), a template scene from the same facts when the call fails or too few lines pass.
 *    Measured 2026-11-15 on gemini-3.5-flash-lite with minimal thinking (three real calls): about 750 tokens in and
 *    190 out, no thinking tokens, 1.2 s: $0.0007 a scene at paid list prices (0.07 cents a day; $0 on the free tier).
 *  - What the writer may know: exactly the cast chat's rule (public aired dates between public characters, not reported
 *    away; nothing unaired, nothing private, never a hidden secret), plus each speaker's own story state for flavour: a
 *    house character's own opinions and what it has heard; a person's character on the cast, only what it has heard
 *    (the rule lib/story-state.ts companionStory keeps). Never another character's private take: a line that voices
 *    someone else's take is dropped.
 *  - Who is in the room and which date they talk about follows the state's hottest tension (lib/story-state.ts
 *    tensions) when one fits; the producer's beat for the day (lib/producer.ts beatFor) is preferred when there is one.
 *    Neither ever touches a date: the engine alone decides endings.
 *  - Every line is checked (checkSceneLines): a speaker in the scene, PG (lib/safety.ts), English, short, no meme-speak,
 *    no hidden secret, nobody claiming a date they weren't on (lib/cast-chat.ts misattributed), and nothing about crime,
 *    health, money or sex (SENSITIVE). The writer says per line which aired fact it retells and whether faithfully; what
 *    can be verified is: the names against the fact's two people, the place against the fact's venue, and the ending
 *    against the fact's ending. A line that contradicts the ending or moves the date somewhere else is dropped.
 *  - At most ONE retelling a scene may be wrong (is_true false), and only in harmless ways: who left first, who said
 *    what, an exaggeration of how it went (HARMLESS). A wrong retelling that is anything else is dropped, not softened.
 *    A faithful retelling is stored as the public record's own words (lib/story-state.ts airedClaim), never the model's.
 *  - People's characters: a public character's public aired date is public record, so the house may talk about a
 *    walk-on or a suitor someone made. Their owner hears (tellOwners): a `house_talk` notification, one per owner per
 *    scene. The character's own text about it is lib/house-texts.ts (textAboutScene, right after the scene is stored):
 *    to every thread with a character the scene names whose person turned its texts on, from what /house shows.
 *  - A line can be reported (reportSceneLine; REPORT_HIDE_THRESHOLD reports hide it, as on the watch room's chat), and
 *    a reported-away line takes what it told with it (retractLine). So does a date that stops being public
 *    (houseUpkeep), and a speaker who went private.
 *  - A small gift that followed an aired date (lib/character-gifts.ts) rides beside that date's fact as one public
 *    sentence, so the room may talk about it. It is never a claim anyone "heard" (nothing is stored from it).
 *  - HOUSE_SCENES=0 turns it off without a deploy of code: no scene is written, and the page says the house is quiet.
 */
import { misattributed, isMemeSpeak } from "./cast-chat";
import { hiddenCastSecrets, slipped } from "./cast-secrets";
import { dateNumberSql, publicDateSql } from "./date-number";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { episodeCode } from "./episode-title";
import { needsTranslation } from "./language-check";
import { getModel, type Model, type Usage } from "./model";
import { shortName } from "./names";
import { portraitPathSql } from "./portrait-sql";
import { summarizeUsage } from "./pricing";
import { beatFor as producersBeat } from "./producer";
import { dateLabel, REPORT_HIDE_THRESHOLD, REPORT_REASONS, type Ending } from "./rules";
import { checkSheetText, checkShowText } from "./safety";
import { showCastIds } from "./season-cast";
import { socialHook } from "./social/hook";
import { seasonIdOf } from "./season-window";
import { airedClaim, ATTRACTION_LABELS, CLAIM_MAX, hear, stateFor, tensions, TRUST_LABELS, type Tension } from "./story-state";
import { venueName, venuePhrase } from "./venues";

/* ------------------------------------------------ the switch ------------------------------------------------ */

/** HOUSE_SCENES: on unless it is "0". Off: no scene is written, and the page says the house is quiet. */
export const houseScenesOn = (env: Record<string, string | undefined> = process.env): boolean => env.HOUSE_SCENES?.trim() !== "0";

/** The hour (UTC) from which the day's scene may be written; HOUSE_SCENE_HOUR_UTC moves it. */
export function houseSceneHourUtc(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOUSE_SCENE_HOUR_UTC?.trim());
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 18;
}

/* ------------------------------------------------ shapes ------------------------------------------------ */

export const SCENE_LINES_MIN = 4;
export const SCENE_LINES_MAX = 6;
export const SCENE_LINE_MAX = 160;
/** How many aired dates one scene talks about. */
export const SCENE_TOPICS = 2;
/** How far back a scene looks for aired dates when no scene came before it. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** The furthest back the scene before this one may hand over from (a late pass yesterday, an early one today). */
const SINCE_MAX_MS = 36 * 60 * 60 * 1000;
/** How long the newest scene rides in "Since you were here" and the Tonight band. */
export const SCENE_SHOWN_DAYS = 2;
/** A claimed row still 'pending' after this long is taken over (the pass that claimed it died). */
const PENDING_STALE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** gossip: the daily scene (this file). confrontation, challenge: lib/house-conflict.ts. */
export const SCENE_KINDS = ["gossip", "confrontation", "challenge"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number] | (string & {});

/** Where in the house a scene happens: dealt by the day. */
export const HOUSE_PLACES = [
  { id: "kitchen", label: "the kitchen", at: "in the kitchen", when: "late, over the washing-up" },
  { id: "terrace", label: "the terrace", at: "on the terrace", when: "after dark, under the string lights" },
  { id: "stairs", label: "the stairs", at: "on the stairs", when: "halfway up, voices low" },
  { id: "sofa", label: "the big sofa", at: "on the big sofa", when: "with the show still on in the background" },
  { id: "pool", label: "the edge of the pool", at: "at the edge of the pool", when: "feet in the water" },
  { id: "laundry", label: "the laundry room", at: "in the laundry room", when: "folding other people's towels" },
] as const;
export type HousePlaceId = (typeof HOUSE_PLACES)[number]["id"];
export const housePlace = (id: string | null | undefined) => HOUSE_PLACES.find((p) => p.id === id) ?? HOUSE_PLACES[0];

export type SceneMember = { id: string; name: string; bio: string; house: boolean };

/** One aired date a scene may talk about: the public record, nothing else. */
export type SceneDate = {
  episode_id: string;
  a: string;
  b: string;
  a_name: string;
  b_name: string;
  ending: Ending;
  ending_detail: string | null;
  venue: string | null;
  date_number: number | null;
  rejected: "a" | "b" | null;
  walked_out: "a" | "b" | null;
  /**
   * A small gift that followed it (lib/character-gifts.ts), as one public sentence ("Sable sent Juniper a postcard of a
   * giraffe."): the writer may mention it. Flavour only: it is never a stored claim, and the checks ignore it.
   */
  gift?: string;
};

export type SceneFacts = {
  id: string;
  day: string;
  place: HousePlaceId;
  /** Who is in the scene (two or three), none of them on any of `dates`. */
  speakers: SceneMember[];
  /** The aired dates they talk about (one or two). */
  dates: SceneDate[];
  /** Each speaker's own story state as plain lines, for flavour: its own lines only (see the header). */
  notes: Record<string, string[]>;
  /** Each speaker's private takes, so a line by someone else that voices one can be dropped. */
  takes: Record<string, string[]>;
  /** Whether tonight's scene is asked for one harmless wrong retelling (dealt by the day). */
  askWrong: boolean;
  /** The tension that put these people in the room, when one did (for the record; never shown). */
  tension: Pick<Tension, "kind" | "a" | "b" | "about"> | null;
};

/** What a line told: which aired date, in which words, and whether those words are true. */
export type SceneTell = { episode_id: string; about: string; about_b: string; claim: string; is_true: boolean };
export type SceneLine = { character_id: string; text: string; tell?: SceneTell; /** An admin took the line down for good. */ removed?: true };
/** What a line told to whom, as stored (house_scenes.told): `line` is the line's number from 1, `source` the heard rows' source. */
export type SceneTold = SceneTell & { line: number; by: string; to: string[]; source: string };

/* What a confrontation or a challenge came out as (lib/house-conflict.ts decides and writes them; house_scenes.result). */
export const OUTCOMES = ["cleared_the_air", "agreed_to_disagree", "worse_than_before"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  cleared_the_air: "They cleared the air",
  agreed_to_disagree: "They agreed to disagree",
  worse_than_before: "It ended worse than it started",
};
export type ConfrontResult = {
  kind: "confrontation";
  outcome: Outcome;
  /** Which kind of tension it was over (lib/story-state.ts TensionKind). */
  over: string;
  a: string;
  b: string;
  /** Someone else who was in the room, when anyone was. */
  witness: string | null;
  /** How each one's trust in the other moved. */
  moved: { holder: string; about: string; from: number; to: number }[];
  /** How many knows_you_said facts between the two it closed. */
  settled: number;
};
export type ChallengeResult = {
  kind: "challenge";
  challenge: string;
  title: string;
  winner: string;
  /** The one-on-one the winner gets: the day it is on, with whom, and which kind of prize. */
  prize: { day: string; with: string | null; kind: "lead_date" | "first_pick" };
};
export type SceneResult = ConfrontResult | ChallengeResult;

const first = (name: string) => shortName(name);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, word: string): boolean => word.length > 1 && new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "iu").test(text);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** A venue's name as a gossip would say it ("goat yoga"), or null for a long one-off place nobody would quote. */
function venueWords(v: string | null): string | null {
  if (!v) return null;
  // "A rooftop bar at golden hour" -> "rooftop bar"; "Goat yoga (one goat has a favourite)" -> "goat yoga".
  const name = venueName(v).toLowerCase().replace(/\s*\(.*?\)/g, "").split(/,|\s+(?:at|with|where|and|in|on|for)\s+/)[0].replace(/^(?:a|an|the)\s+/, "").trim();
  return name && name.length >= 4 && name.length <= 30 ? name : null;
}

/** The scene's id: the day and its kind (one scene of a kind a day). It is also the heard rows' source ("scene:<id>#n"). */
export const sceneIdOf = (day: string, kind: SceneKind = "gossip"): string => `${day}-${kind}`;
export const sceneSource = (sceneId: string, line: number): string => `scene:${sceneId}#${line}`;
export const scenePath = (sceneId: string): string => `/house?scene=${encodeURIComponent(sceneId)}#scene-${sceneId}`;

/** An aired date in the public record's own words (the claim a faithful retelling stores). */
export const factClaim = (d: SceneDate): string =>
  airedClaim({ a_name: d.a_name, b_name: d.b_name, ending: d.ending, ending_detail: d.ending_detail, date_number: d.date_number, venue: d.venue, rejected: d.rejected, walked_out: d.walked_out });

/* ------------------------------------------------ the facts ------------------------------------------------ */

type DateRow = Omit<SceneDate, "rejected" | "walked_out"> & { drama_question: string | null; drama_answer: string | null; walked: string | null };

/**
 * The public dates that aired in (since, now] between public characters, the cast's own first, newest first: what a
 * scene may talk about. The same rule as the story state's (publicDateSql): aired, public, not hidden by reports, not
 * a replay.
 */
export async function airedSince(db: Db, since: Date, now: Date, castIds: readonly string[], limit = 8): Promise<SceneDate[]> {
  const { rows } = await db.query<DateRow>(
    `select e.id as episode_id, e.character_a as a, e.character_b as b, ca.name as a_name, cb.name as b_name, e.ending, e.ending_detail,
            e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number, e.drama_question, e.drama_answer,
            (select t->>'side' from jsonb_array_elements(coalesce(e.transcript, '[]'::jsonb)) t where t->>'walked_out' = 'true' limit 1) as walked
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where ${publicDateSql("e")} and e.ending is not null and e.revealed_at > $1 and e.revealed_at <= $2
        and ca.visibility = 'public' and cb.visibility = 'public'
      order by (e.character_a = any($3) or e.character_b = any($3)) desc, e.revealed_at desc, e.id
      limit $4`,
    [since.toISOString(), now.toISOString(), castIds, limit],
  );
  return rows.map(({ drama_question, drama_answer, walked, ...r }) => ({
    ...r,
    rejected: drama_question === "rejected" && (drama_answer === "a" || drama_answer === "b") ? drama_answer : null,
    walked_out: walked === "a" || walked === "b" ? walked : null,
  }));
}

/** A seeded shuffle (Fisher-Yates on lib/engine.ts seedFrom): the same day deals the same room. */
function dealt<T>(items: readonly T[], ...seed: (string | number)[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = seedFrom(...seed, i) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Who is in the room and what they talk about (pure): a date with at least two cast members who weren't on it. A
 * `beat` (the producer's, or the hottest tension that fits) seats its two people when both were off some aired date,
 * preferring a date its `about` was on; otherwise the newest date the cast can talk about and a dealt pair. A third
 * speaker joins on about half the days when there is one. A second date rides along when nobody in the room was on it.
 */
export function pickRoom(
  day: string,
  cast: readonly SceneMember[],
  dates: readonly SceneDate[],
  beats: readonly Pick<Tension, "kind" | "a" | "b" | "about">[] = [],
): { speakers: SceneMember[]; dates: SceneDate[]; tension: Pick<Tension, "kind" | "a" | "b" | "about"> | null } | null {
  const off = (d: SceneDate) => cast.filter((c) => c.id !== d.a && c.id !== d.b);
  let topic: SceneDate | null = null;
  let seated: SceneMember[] = [];
  let tension: Pick<Tension, "kind" | "a" | "b" | "about"> | null = null;
  for (const t of beats) {
    const fits = dates.filter((d) => off(d).some((c) => c.id === t.a) && off(d).some((c) => c.id === t.b));
    if (!fits.length) continue;
    topic = fits.find((d) => t.about && (d.a === t.about || d.b === t.about)) ?? fits[0];
    seated = [cast.find((c) => c.id === t.a)!, cast.find((c) => c.id === t.b)!];
    tension = { kind: t.kind, a: t.a, b: t.b, about: t.about };
    break;
  }
  if (!topic) {
    topic = dates.find((d) => off(d).length >= 2) ?? null;
    if (!topic) return null;
    seated = dealt(off(topic), "house-scene", day, "pair").slice(0, 2);
  }
  const rest = dealt(off(topic).filter((c) => !seated.includes(c)), "house-scene", day, "third");
  if (rest.length && seedFrom("house-scene", day, "three") % 2 === 0) seated = [...seated, rest[0]];
  const ids = new Set(seated.map((c) => c.id));
  const second = dates.find((d) => d !== topic && !ids.has(d.a) && !ids.has(d.b));
  return { speakers: seated, dates: second ? [topic, second].slice(0, SCENE_TOPICS) : [topic], tension };
}

/**
 * Everything the writer may know for one scene, or null on a quiet day (nothing aired that the cast can talk about).
 * `since`: where the scene before this one stopped looking. `skip`: dates an earlier scene already told.
 */
export async function sceneFacts(
  db: Db,
  now: Date,
  opts: { since?: Date; skip?: readonly string[]; beat?: Pick<Tension, "kind" | "a" | "b" | "about"> | null } = {},
): Promise<SceneFacts | null> {
  const day = now.toISOString().slice(0, 10);
  const castIds = showCastIds(now);
  const cast = (await db.query<SceneMember>(`select id, name, bio, is_house as house from characters where id = any($1) and visibility = 'public'`, [castIds])).rows.sort(
    (x, y) => castIds.indexOf(x.id) - castIds.indexOf(y.id),
  );
  if (cast.length < 2) return null;
  const since = opts.since && now.getTime() - opts.since.getTime() <= SINCE_MAX_MS ? opts.since : new Date(now.getTime() - LOOKBACK_MS);
  const skip = new Set(opts.skip ?? []);
  // One date a couple: when two of theirs aired since, the newest is the news (the list is newest first).
  const pairs = new Set<string>();
  const dates = (await airedSince(db, since, now, castIds)).filter((d) => {
    const pair = [d.a, d.b].sort().join("|");
    if (skip.has(d.episode_id) || pairs.has(pair)) return false;
    pairs.add(pair);
    return true;
  });
  if (!dates.length) return null;
  // A gift that followed one of them is part of what the house saw (CHARACTER_GIFTS=0: none).
  // Loaded here, not at the top: the gifts' writer imports the companion threads, which import this file.
  const gifts = await import("./character-gifts").then((m) => m.giftsFor(db, dates.map((d) => d.episode_id))).catch(() => new Map<string, string>());
  for (const d of dates) if (gifts.has(d.episode_id) && !sensitiveClaim(gifts.get(d.episode_id)!)) d.gift = gifts.get(d.episode_id);
  // The producer's beat first, then the state's own tensions, hottest first (lib/story-state.ts): who is worth seating.
  const beats = [...(opts.beat ? [opts.beat] : []), ...(await tensions(db, seasonIdOf(now), { now }).catch(() => [] as Tension[]))];
  const room = pickRoom(day, cast, dates, beats);
  if (!room) return null;

  // Each speaker's own state about the people on the dates: flavour for its own lines, never anyone else's. A note
  // says where the speaker stands (the two scales in words), never its private take word for word: the take stays the
  // holder's, and a line that voices one is dropped (checkSceneLines).
  const notes: Record<string, string[]> = {};
  const takes: Record<string, string[]> = {};
  const told = new Set(room.dates.map((d) => d.episode_id));
  for (const s of room.speakers) {
    const lines: string[] = [];
    const mine: string[] = [];
    for (const about of [...new Set(room.dates.flatMap((d) => [d.a, d.b]))]) {
      const state = await stateFor(db, s.id, { withId: about, now }).catch(() => null);
      if (!state) continue;
      mine.push(...state.opinions.map((o) => o.take));
      // A person's character on the cast speaks only from what it has heard: its opinions and want stay its owner's.
      if (s.house) {
        for (const o of state.opinions) lines.push(`${first(o.about_name)}: ${TRUST_LABELS[o.trust]}${o.attraction !== null ? `, ${ATTRACTION_LABELS[o.attraction]}` : ""}`);
        if (state.want) lines.push(`wants this week: ${state.want.want}`);
      }
      // The date itself is the fact on the table: what the speaker "watched air" of it is not a private note.
      for (const h of state.heard) if (!told.has(h.source) && h.told_by_name) lines.push(`${first(h.told_by_name)} told them: ${h.claim}`);
    }
    notes[s.id] = [...new Set(lines)].slice(0, 3).map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l));
    takes[s.id] = [...new Set(mine)];
  }
  return {
    id: sceneIdOf(day),
    day,
    place: HOUSE_PLACES[seedFrom("house-scene", day, "place") % HOUSE_PLACES.length].id,
    speakers: room.speakers,
    dates: room.dates,
    notes,
    takes,
    askWrong: seedFrom("house-scene", day, "wrong") % 2 === 0,
    tension: room.tension,
  };
}

/* ------------------------------------------------ the checks ------------------------------------------------ */

/**
 * What a house scene never says about anyone, true or not: crime, health, money, sex. Applied to every line and to a
 * wrong retelling's claim. Broad on purpose: a dropped line costs nothing (the template stands in), a false claim
 * about someone's character in one of these would.
 */
const SENSITIVE: readonly RegExp[] = [
  // crime
  /\b(?:st[eo]le|steal(?:s|ing)?|theft|thie(?:f|ves)|robb(?:ed|ery|ing)|shoplift\w*|arrest\w*|police|cops?|jail|prison|crim(?:e|es|inal)|illegal|fraud\w*|scam\w*|drugs?|dealer|assault\w*|stalk\w*|threat(?:s|en\w*)?|hit (?:him|her|them)|punch\w*|slapp\w*|lawsuit|restraining)\b/i,
  // health
  /\b(?:sick|ill(?:ness)?|disease|diagnos\w*|cancer|pregnan\w*|rehab|addict\w*|alcoholic|drunk|wasted|hungover|medicat\w*|pills?|therap(?:y|ist)|mental|breakdown|panic attack|depress\w*|anxiety|disorder|hospital|std|contagious|overdos\w*|threw up|vomit\w*)\b/i,
  // money
  /\b(?:money|broke|debts?|owes?|owed|loan\w*|rich|poor|salary|bankrupt\w*|gold[- ]?digg\w*|sugar (?:daddy|mommy|baby)|paid (?:for|him|her|them)|pays? for|the bill|cheque|wallet|credit card|cash|inherit\w*|rent)\b/i,
  // sex and bodies
  /\b(?:sex\w*|slept (?:with|together)|sleep(?:s|ing)? (?:with|together)|hook(?:ed|ing|s)? up|made out|making out|kiss(?:ed|es|ing)?|naked|nude|bed(?:room)?|one[- ]night|went home (?:with|together)|spent the night|overnight|cheat(?:ed|s|ing|er)?|affair|virgin\w*|horny|turned on|grop\w*|touch(?:ed|ing) (?:him|her|them))\b/i,
];
export const sensitiveClaim = (text: string): boolean => SENSITIVE.some((re) => re.test(text));

/** The harmless ways a retelling may be wrong: who left first, who said what, an exaggeration of how it went. */
const HARMLESS: readonly RegExp[] = [
  // who left first
  /\b(?:left|leaves|leaving|walked out|walked off|bailed|slipped out|ducked out|ran off|headed home|called it a night|got up and went)\b/i,
  // who said what
  /\b(?:said|says|told|called|asked|admitted|announced|promised|swore|claimed|mentioned|whispered|shouted|laughed at)\b/i,
  // an exaggeration of how it went
  /\b(?:whole (?:time|night|date)|entire (?:time|night|date)|all night|the worst|the best|ever|never|nonstop|non-stop|for (?:an hour|hours)|didn'?t (?:say|speak|laugh|smile)|not (?:a|one) (?:word|laugh|smile)|every (?:single )?(?:time|word|minute)|barely|practically|basically|couldn'?t stop|wouldn'?t stop|kept (?:on )?\w+ing|crying|cried|in tears|silent|silence|yawn\w*|fell asleep)\b/i,
];

/** What a line says about how a date ended, read with a few plain patterns: another date, just friends, went badly. */
function endingSaid(text: string): { again: boolean; friends: boolean; bad: boolean } {
  const t = text.toLowerCase();
  const noAgain = /\b(?:no|not|never|won'?t|isn'?t|without|didn'?t|doesn'?t|don'?t)\b[^.?!]{0,30}\b(?:second|third|fourth|another|next) date\b/.test(t) || /\b(?:second|third|fourth|another|next) date\b[^.?!]{0,12}\b(?:is(?:n'?t| not)|never|off)\b/.test(t);
  const again = !noAgain && /\b(?:(?:second|third|fourth|another|next) date|see(?:ing)? each other again|both said yes|going out again)\b/.test(t);
  const friends = /\b(?:just|only|as|stay(?:ing)?) friends\b|\bfriend[- ]?zon/.test(t);
  const bad = noAgain || /\b(?:disaster|catastroph\w*|train ?wreck|went (?:badly|south|sideways|wrong|terribly)|stormed (?:off|out)|a mess|car crash|bombed|crashed and burned)\b/.test(t);
  return { again, friends, bad };
}

export type EndingCheck = "ok" | "exaggerated" | "contradicts";

/**
 * A line against the fact's ending. Saying another date is on when it isn't, or off when it is, or "friends" over a
 * disaster, contradicts the record (dropped). Calling a friendly parting a disaster is an exaggeration: allowed only
 * as the scene's one wrong retelling.
 */
export function checkEnding(text: string, d: Pick<SceneDate, "ending">): EndingCheck {
  const said = endingSaid(text);
  if (d.ending === "second_date") return said.friends || said.bad ? "contradicts" : "ok";
  if (said.again) return "contradicts";
  if (d.ending === "friends") return said.bad ? "exaggerated" : "ok";
  return said.friends ? "contradicts" : "ok";
}

/** Whether a retelling of `d` moves it to another aired date's place (and never names its own). */
function wrongPlace(text: string, d: SceneDate, all: readonly SceneDate[]): boolean {
  const t = text.toLowerCase();
  const own = venueWords(d.venue);
  if (own && t.includes(own)) return false;
  return all.some((o) => o !== d && venueWords(o.venue) !== own && venueWords(o.venue) !== null && t.includes(venueWords(o.venue)!));
}

/** Whether `text` names either of the date's two people. */
const namesPair = (text: string, d: SceneDate): boolean => mentions(text, first(d.a_name)) || mentions(text, first(d.b_name));

/**
 * A wrong retelling's claim, checked: it names one of the date's two people and nobody else the scene knows, it is PG,
 * it is one of the harmless kinds, it says nothing about crime, health, money or sex, and it doesn't get the ending
 * itself wrong beyond an exaggeration. Returns the claim as it will be stored, or null (the line is dropped).
 */
export function harmlessWrong(raw: unknown, d: SceneDate, f: Pick<SceneFacts, "dates" | "speakers">): string | null {
  if (typeof raw !== "string") return null;
  const claim = oneLine(raw).replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (claim.length < 8 || claim.length > CLAIM_MAX) return null;
  if (!namesPair(claim, d)) return null;
  const others = [...f.dates.filter((o) => o !== d).flatMap((o) => [[o.a, o.a_name] as const, [o.b, o.b_name] as const]), ...f.speakers.map((s) => [s.id, s.name] as const)];
  if (others.some(([id, name]) => id !== d.a && id !== d.b && mentions(claim, first(name)))) return null;
  if (!checkSheetText({ claim }).ok || !checkShowText({ claim }).ok || needsTranslation(claim)) return null;
  if (sensitiveClaim(claim) || !HARMLESS.some((re) => re.test(claim))) return null;
  if (checkEnding(claim, d) === "contradicts" || wrongPlace(claim, d, f.dates)) return null;
  return claim;
}

const TAKE_STOP = new Set(["that", "this", "with", "have", "them", "they", "their", "about", "want", "think", "know", "what", "when", "where", "there", "would", "could", "just", "really", "date", "like", "been", "were", "from", "more", "than", "then", "into", "going", "goes"]);
const takeWords = (t: string, names: ReadonlySet<string>): Set<string> =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !TAKE_STOP.has(w) && !names.has(w)),
  );
/**
 * Whether a line voices someone else's private take: it shares three of the take's own content words (names and
 * everyday words don't count; a take with fewer than three such words can't be told from small talk, so never matches).
 */
export function voicesTake(line: string, take: string, names: readonly string[]): boolean {
  const skip = new Set(names.flatMap((n) => [first(n).toLowerCase(), ...n.toLowerCase().split(/\s+/)]));
  const want = takeWords(take, skip);
  if (want.size < 3) return false;
  const have = takeWords(line, skip);
  return [...want].filter((w) => have.has(w)).length >= 3;
}

type RawLine = { from?: unknown; text?: unknown; retells?: unknown; faithful?: unknown; claim?: unknown };

/**
 * The checks every line of every kind of house scene passes (pure): it is from someone in the scene, 2 to 160
 * characters, PG (lib/safety.ts), in English, not meme-speak, nothing about crime, health, money or sex, and it gives
 * no hidden secret away. Null when it fails.
 */
export function basicLine(raw: unknown, speakers: readonly { id: string; name: string }[], hidden: readonly string[]): SceneLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawLine;
  if (typeof r.from !== "string" || typeof r.text !== "string") return null;
  const who = r.from.trim().toLowerCase();
  const speaker = speakers.find((c) => first(c.name).toLowerCase() === who || c.name.toLowerCase() === who);
  if (!speaker) return null;
  const text = oneLine(r.text).replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (text.length < 2 || text.length > SCENE_LINE_MAX) return null;
  if (!checkSheetText({ text }).ok || !checkShowText({ text }).ok || needsTranslation(text)) return null;
  if (isMemeSpeak(text) || sensitiveClaim(text)) return null;
  if (hidden.some((s) => slipped(text, s))) return null;
  return { character_id: speaker.id, text };
}

/**
 * The writer's lines, checked one by one, in order (pure). A line that fails any check is dropped; a retelling that
 * can't be tied to its fact's people loses the retelling and stays a plain line. At most one wrong retelling stands:
 * a second is dropped whole. Capped at SCENE_LINES_MAX.
 */
export function checkSceneLines(raw: readonly unknown[], f: SceneFacts, hidden: readonly string[]): SceneLine[] {
  const out: SceneLine[] = [];
  let wrong = 0;
  const known = [...f.speakers.map((c) => c.name), ...f.dates.flatMap((d) => [d.a_name, d.b_name])];
  for (const item of raw.slice(0, SCENE_LINES_MAX + 3)) {
    if (out.length >= SCENE_LINES_MAX) break;
    const line = basicLine(item, f.speakers, hidden);
    if (!line) continue;
    const r = item as RawLine;
    const text = line.text;
    const speaker = f.speakers.find((c) => c.id === line.character_id)!;
    // Nobody in the room was on these dates, so nobody talks as if they were (lib/cast-chat.ts).
    if (misattributed({ character_id: speaker.id, text }, { dates: f.dates })) continue;
    // Never another character's private take in this one's mouth.
    if (f.speakers.some((o) => o.id !== speaker.id && (f.takes[o.id] ?? []).some((take) => voicesTake(text, take, known)))) continue;

    const k = typeof r.retells === "number" && Number.isInteger(r.retells) ? r.retells : typeof r.retells === "string" && /^\d+$/.test(r.retells.trim()) ? Number(r.retells) : null;
    const d = k !== null ? f.dates[k - 1] : undefined;
    if (r.faithful === false) {
      // The writer says this line is the wrong one: it stands only as the scene's one harmless wrong retelling of a
      // fact it names, in the writer's own plain sentence. Anything else is dropped whole, never kept as a plain line.
      if (!d || checkEnding(text, d) === "contradicts" || wrongPlace(text, d, f.dates)) continue;
      const claim = harmlessWrong(r.claim, d, f);
      if (!claim || wrong >= 1) continue;
      wrong++;
      line.tell = { episode_id: d.episode_id, about: d.a, about_b: d.b, claim, is_true: false };
    } else if (!d || !namesPair(text, d)) {
      // Not a retelling we can tie to a fact. It still may not contradict the one date it plainly talks about.
      const about = f.dates.filter((o) => namesPair(text, o));
      if (about.length === 1 && checkEnding(text, about[0]) !== "ok") continue;
    } else {
      const ending = checkEnding(text, d);
      if (ending === "contradicts" || wrongPlace(text, d, f.dates)) continue;
      if (ending === "exaggerated") {
        // An exaggeration the writer didn't own up to: it counts as the scene's wrong retelling, in the line's own words.
        const claim = harmlessWrong(text, d, f);
        if (!claim || wrong >= 1) continue;
        wrong++;
        line.tell = { episode_id: d.episode_id, about: d.a, about_b: d.b, claim, is_true: false };
      } else {
        line.tell = { episode_id: d.episode_id, about: d.a, about_b: d.b, claim: factClaim(d), is_true: true };
      }
    }
    out.push(line);
  }
  return out;
}

/** Whether a set of checked lines is a scene: enough lines, two voices, and at least one retelling (the point is state). */
export const isScene = (lines: readonly SceneLine[]): boolean =>
  lines.length >= SCENE_LINES_MIN && new Set(lines.map((l) => l.character_id)).size >= 2 && lines.some((l) => l.tell);

/* ------------------------------------------------ the writer ------------------------------------------------ */

/** The writer thinks as little as it can: a handful of short lines needs none, and thinking bills as output. */
const WRITER_REASONING = "minimal" as const;
/** Room for the JSON (about 350 tokens) with slack for a model that thinks anyway. */
const WRITER_MAX_TOKENS = 2000;

const SYSTEM = [
  "You write one short scene for Botchelor, an AI reality-dating show the audience watches.",
  "Evening in the show's house. A few of this season's cast talk over a date that aired today. None of them was on it: they watched it air, like everyone else.",
  "",
  "Write exactly 5 spoken lines, each under 120 characters. They take turns, and everyone listed speaks.",
  "- It is gossip said out loud, not a recap: the first line retells what happened, the others react, tease, doubt, answer back.",
  "- Each person sounds like themselves (the bio is for voice, not a topic). Dry and playful, never cruel. PG. No real people, no brands, no internet memes.",
  "- Use ONLY the aired facts. Never invent another date, never predict what happens next, never mention a secret, and nobody talks as if they had been on the date.",
  "- Nothing about crime, health, money or sex, about anyone.",
  "- Undercurrents are what a person privately brings into the room. They shape that person's tone only: never said out loud, never quoted, never explained.",
  '- For each line: "retells" is the number of the aired fact the line retells, or null for a reaction. A line that retells a fact names at least one of the two people on that date.',
  "- Never get the ending itself, the two people or the place wrong.",
].join("\n");
const WRONG_ONE = [
  '- Tonight exactly ONE line passes on a small detail that is not true, the way gossip does. Only one of these harmless kinds: who left first, who said what, or an exaggeration of how it went. For that line set "faithful": false and add "claim": the untrue detail as one plain sentence that names the person. Every other line has "faithful": true.',
].join("\n");
const WRONG_NONE = '- Tonight everyone has their facts straight: every line has "faithful": true.';
const REPLY = [
  "",
  "The shape and the tone, with other people and another date (never copy its words):",
  '{"lines": [{"from": "Ana", "text": "Kit and Jo at the aquarium. Friends, apparently. After all that staring at the jellyfish.", "retells": 1, "faithful": true}, {"from": "Sol", "text": "I heard Kit was out of the door before the penguins were fed.", "retells": 1, "faithful": false, "claim": "Kit left before the penguin feeding."}, {"from": "Ana", "text": "Heard from whom?", "retells": null, "faithful": true}, {"from": "Sol", "text": "A source close to the penguins.", "retells": null, "faithful": true}, {"from": "Ana", "text": "Then the penguins are lying to you.", "retells": null, "faithful": true}]}',
  "Reply with JSON only, in that shape.",
].join("\n");
const systemFor = (f: Pick<SceneFacts, "askWrong">): string => `${SYSTEM}\n${f.askWrong ? WRONG_ONE : WRONG_NONE}\n${REPLY}`;

/** How an aired date reads as a numbered fact (the public record's own words). */
export const factLine = (d: SceneDate): string => factClaim(d);

/** The writer's facts, as the prompt says them. */
export function scenePrompt(f: SceneFacts): string {
  const place = housePlace(f.place);
  const lines = [`Where: ${place.label}, ${place.when}.`];
  lines.push(`In the scene (only these people speak): ${f.speakers.map((c) => `${first(c.name)} — ${c.bio.slice(0, 90)}`).join("; ")}.`);
  lines.push("Aired facts:");
  f.dates.forEach((d, i) => lines.push(`${i + 1}. ${factLine(d)}${d.gift ? ` Afterwards, ${d.gift}` : ""}`));
  const noted = f.speakers.filter((c) => f.notes[c.id]?.length);
  if (noted.length) {
    lines.push("Undercurrents (unspoken):");
    for (const c of noted) lines.push(`- ${first(c.name)}: ${f.notes[c.id].join(" | ")}`);
  }
  lines.push("Write the scene.");
  return lines.join("\n");
}

/**
 * The writer's reply as its lines: the JSON it was asked for (fenced or not), and when that doesn't parse (a stray
 * character, a cut-off tail: seen on flash-lite, 2026-11-15) every `{"from": ..., "text": ...}` object that does.
 * Each line is still checked on its own afterwards. Null when there is nothing to read.
 */
export function looseLines(raw: string): unknown[] | null {
  const body = raw.trim();
  try {
    const parsed = (JSON.parse(CODE_FENCE.exec(body)?.[1] ?? body) as { lines?: unknown }).lines;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to the objects that do parse
  }
  const found: unknown[] = [];
  for (const m of body.matchAll(/\{[^{}]*"from"[^{}]*\}/g)) {
    try {
      found.push(JSON.parse(m[0]));
    } catch {
      // one broken line doesn't lose the others
    }
  }
  return found.length ? found : null;
}

/** The scene's writer: the show's free model (never the paid upgrade), thinking as little as it can. */
export const houseWriter = (): Model => getModel(WRITER_REASONING, false);

/** The model's scene, checked line by line; null when the call fails or what passes isn't a scene. */
export async function writeScene(model: Model, f: SceneFacts, hidden: readonly string[], onUsage?: (u: Usage) => void): Promise<SceneLine[] | null> {
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: systemFor(f) },
        { role: "user", content: scenePrompt(f) },
      ],
      { temperature: 0.9, maxTokens: WRITER_MAX_TOKENS, onUsage },
    );
  } catch {
    return null;
  }
  const parsed = looseLines(raw);
  if (!parsed) return null;
  const lines = checkSceneLines(parsed, f, hidden);
  return isScene(lines) ? lines : null;
}

/** How a date ended, in a gossip's mouth (it has aired: the public record, not a spoiler). */
function gossip(d: SceneDate): string {
  const a = first(d.a_name);
  const b = first(d.b_name);
  const where = d.venue ? ` at ${venuePhrase(d.venue)}` : "";
  if (d.ending === "second_date") return `${a} and ${b}${where}. Both of them want a ${dateLabel((d.date_number ?? 1) + 1).toLowerCase()}.`;
  if (d.ending === "friends") return `${a} and ${b}${where}. Friends, and that was that.`;
  return `${a} and ${b}${where}. It did not go well.`;
}

/**
 * The $0 scene from the same facts: four or five plain lines in the show's voice, every retelling faithful (a template
 * never gets anything wrong). Speakers are the room's, in the order they were seated.
 */
export function templateScene(f: SceneFacts): SceneLine[] {
  if (f.speakers.length < 2 || !f.dates.length) return [];
  const [s1, s2, s3] = f.speakers;
  const [d, d2] = f.dates;
  const tell = (x: SceneDate): SceneTell => ({ episode_id: x.episode_id, about: x.a, about_b: x.b, claim: factClaim(x), is_true: true });
  const out: SceneLine[] = [];
  out.push({ character_id: s1.id, text: `So. ${gossip(d)}`, tell: tell(d) });
  out.push({
    character_id: s2.id,
    text: d.ending === "second_date" ? "I watched it twice. You could see it coming from the first hello." : d.ending === "friends" ? "I watched it. Nobody was unhappy, nobody was swept off their feet." : "I watched it through my fingers.",
  });
  if (d2) out.push({ character_id: (s3 ?? s1).id, text: `And then ${gossip(d2)}`, tell: tell(d2) });
  // A gift that followed the date is the better gossip, when there was one (lib/character-gifts.ts).
  else if (s3) out.push({ character_id: s3.id, text: d.gift ? `And afterwards, ${d.gift} Nobody tell me that means nothing.` : `Has anyone asked ${first(d.a_name)} about it yet? I'm not going to be the one.` });
  out.push({ character_id: s2.id === out[out.length - 1].character_id ? s1.id : s2.id, text: `I'm saying nothing to ${first(d.b_name)} until somebody else brings it up.` });
  if (out.length < SCENE_LINES_MIN) out.push({ character_id: s1.id, text: "Somebody will. In this house, somebody always does." });
  return out.filter((l) => checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok && !sensitiveClaim(l.text));
}

/* ------------------------------------------------ what it tells ------------------------------------------------ */

/**
 * What each line told to whom (pure): a retelling reaches everyone else in the room, once per claim, so a second
 * faithful line about the same date tells nobody anything new (its first teller knows it already). A wrong retelling
 * is a claim of its own. Each telling has its own source ("scene:<id>#n", n the line's number from 1).
 */
export function toldBy(sceneId: string, lines: readonly SceneLine[], roomIds: readonly string[]): SceneTold[] {
  const out: SceneTold[] = [];
  const knows = new Map<string, Set<string>>();
  lines.forEach((l, i) => {
    if (!l.tell || l.removed) return;
    const key = `${l.tell.episode_id}|${l.tell.is_true ? "true" : l.tell.claim}`;
    const have = knows.get(key) ?? new Set<string>();
    have.add(l.character_id);
    const to = roomIds.filter((id) => id !== l.character_id && id !== l.tell!.about && id !== l.tell!.about_b && !have.has(id));
    to.forEach((id) => have.add(id));
    knows.set(key, have);
    if (to.length) out.push({ ...l.tell, line: i + 1, by: l.character_id, to, source: sceneSource(sceneId, i + 1) });
  });
  return out;
}

/** How a claim makes a listener think of the people in it, for a heard opinion's trust (lib/story-state.ts hear). */
function leansOf(t: SceneTell, ending: Ending | null): -1 | 0 | 1 {
  if (!t.is_true) return endingSaid(t.claim).bad || /\b(?:walked out|bailed|ran off|worst|never)\b/i.test(t.claim) ? -1 : 0;
  return ending === "second_date" ? 1 : ending === "disaster" ? -1 : 0;
}

/** Writes what a scene told into the story state: each listener hears each claim, from its speaker. Idempotent (hear dedupes). */
export async function applyTold(db: Db, told: readonly SceneTold[], at: Date, endings: ReadonlyMap<string, Ending> = new Map()): Promise<number> {
  let n = 0;
  for (const t of told) {
    for (const holder of t.to) {
      const made = await hear(db, { holder, about: t.about, aboutB: t.about_b, claim: t.claim, toldBy: t.by, source: t.source, isTrue: t.is_true, leans: leansOf(t, endings.get(t.episode_id) ?? null), at }).catch(() => null);
      if (made?.created) n++;
    }
  }
  return n;
}

/**
 * Takes back what a line told (a reported-away line, a date that stopped being public): the heard rows with its
 * source (and the knows_you_said facts hanging off them), and any 'heard' opinion built on it.
 */
export async function retractLine(db: Db, sceneId: string, line: number): Promise<number> {
  forgetLatestHouseScene();
  const source = sceneSource(sceneId, line);
  await db.query(`delete from character_opinions where basis = 'heard' and source = $1 and forgotten_at is null`, [source]);
  await db.query(`update character_heard set used_at = null, used_in = null where used_in = $1`, [source]);
  return (await db.query(`delete from character_heard where source = $1 returning id`, [source])).rows.length;
}

/* ------------------------------------------------ the owners hear ------------------------------------------------ */

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type StoredScene = {
  id: string;
  day: string;
  season_id: string;
  kind: string;
  place: string;
  cast_ids: string[];
  lines: SceneLine[];
  told: SceneTold[];
  result?: SceneResult | null;
  source: string;
  model: string | null;
  cost_usd: string | number | null;
  written_at: string | Date | null;
  created_at: string | Date;
};

/**
 * The owners of people's characters a scene talked about hear: a `house_talk` notification each (one per owner per
 * scene), a wrong retelling told before a faithful one. Returns how many went out. Never throws. The character's own
 * text is textAboutScene's (lib/house-texts.ts).
 */
export async function tellOwners(db: Db, scene: Pick<StoredScene, "id" | "day" | "place" | "lines" | "told">): Promise<{ notified: number }> {
  const done = { notified: 0 };
  try {
    const told = [...scene.told].sort((x, y) => Number(x.is_true) - Number(y.is_true) || x.line - y.line);
    if (!told.length) return done;
    const ids = [...new Set(told.flatMap((t) => [t.about, t.about_b, t.by]))];
    const chars = new Map(
      (await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string }>(`select id, name, owner_id, is_house, visibility from characters where id = any($1)`, [ids])).rows.map((c) => [c.id, c]),
    );
    const { notify } = await import("./notifications");
    const seen = new Set<string>();
    const link = scenePath(scene.id);
    for (const t of told) {
      for (const [mineId, otherId] of [
        [t.about, t.about_b],
        [t.about_b, t.about],
      ] as const) {
        const mine = chars.get(mineId);
        const other = chars.get(otherId);
        const by = chars.get(t.by);
        const owner = mine?.owner_id;
        if (!mine || !other || !by || mine.is_house || !owner || owner === "deleted" || mine.visibility !== "public" || seen.has(owner)) continue;
        seen.add(owner);
        // Once per owner per scene (a rerun of the job, a line that came back from review).
        const had = await db.query(`select 1 from notifications where user_id = $1 and kind = 'house_talk' and link = $2 limit 1`, [owner, link]);
        if (had.rows.length) continue;
        const line = scene.lines[t.line - 1]?.text ?? t.claim;
        await notify(db, owner, {
          kind: "house_talk",
          title: `🏠 The house is talking about ${first(mine.name)}`,
          body: `${first(by.name)}, ${housePlace(scene.place).at}: “${line}”`,
          link,
        });
        done.notified++;
      }
    }
  } catch (err) {
    console.error("[house-scenes] could not tell the owners:", err instanceof Error ? err.message : "unknown");
  }
  return done;
}

/**
 * Everyone a stored scene names texts the people who turned their texts on (lib/house-texts.ts houseTextsForScene: the
 * owner first, anyone texting a cast member under the same opt-in, one house text a thread a day). Called right after a
 * scene of any kind is stored. Returns how many texts went out; never throws, and 0 with HOUSE_TEXTS=0. The people who
 * follow someone the scene names then get their notice (lib/character-follows.ts tellFollowersOfScene).
 */
export async function textAboutScene(db: Db, sceneId: string, now: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<number> {
  let sent = 0;
  try {
    const { houseTextsForScene } = await import("./house-texts");
    sent = (await houseTextsForScene(db, sceneId, now, { env })).sent;
  } catch {
    sent = 0;
  }
  // Then the people who follow someone it names (lib/character-follows.ts): one notice each, after the texts, so a
  // follower the character just texted about it isn't told twice.
  try {
    const { tellFollowersOfScene } = await import("./character-follows");
    await tellFollowersOfScene(db, sceneId, env);
  } catch {
    // Never in the way of the pass that wrote the scene.
  }
  return sent;
}

/* ------------------------------------------------ the hourly job ------------------------------------------------ */

// On in production; the shared test harness turns it off (its fire-and-forget calls would eat scripted outputs).
// tests/house-scenes.test.ts passes a model of its own.
let voiceEnabled = true;
export function setHouseSceneVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

export type HouseSceneWritten =
  | { id: string; source: "model" | "template"; lines: number; told: number; cost_usd: number | null; notified: number; texted: number }
  | { skipped: "off" | "early" | "already" | "quiet" | "no_cast" };

/** Whether the scenes' writer may be called (off in the shared test harness: lib/house-conflict.ts asks too). */
export const houseVoiceOn = (): boolean => voiceEnabled;

/**
 * The producer's beat for a day (lib/producer.ts beatFor: story_beats, picked overnight), as the tension it stages: its
 * two people are who the room seats first. Null with no beat that day, a skipped one, or PRODUCER=0: the state's own
 * tensions choose.
 */
export async function beatFor(db: Db, day: string, env: Record<string, string | undefined> = process.env): Promise<Pick<Tension, "kind" | "a" | "b" | "about"> | null> {
  const beat = await producersBeat(db, day, env).catch(() => null);
  // An arc's beat (lib/story-arcs.ts) stages a date, not a tension: the state's own tensions choose the scene.
  return beat?.tension && beat.who.length >= 2 ? { kind: beat.tension, a: beat.who[0], b: beat.who[1], about: beat.about } : null;
}

/**
 * Claims a day's row for one kind of scene, so two passes can't both write it. True when this caller holds it: the
 * row is new, or it was left 'pending' by a pass that died PENDING_STALE_MS ago.
 */
export async function claimScene(db: Db, id: string, day: string, kind: SceneKind, now: Date): Promise<boolean> {
  const claimed = await db.query(
    `insert into house_scenes (id, day, season_id, kind, place, source, created_at) values ($1, $2, $3, $4, 'kitchen', 'pending', $5)
     on conflict (id) do update set created_at = excluded.created_at
       where house_scenes.source = 'pending' and house_scenes.created_at < $6
     returning id`,
    [id, day, seasonIdOf(now), kind, now.toISOString(), new Date(now.getTime() - PENDING_STALE_MS).toISOString()],
  );
  return claimed.rows.length > 0;
}

/** A claimed row with nothing to write keeps the day: the job doesn't ask again. */
export async function quietScene(db: Db, id: string, now: Date): Promise<void> {
  await db.query(`update house_scenes set source = 'quiet', written_at = $2 where id = $1`, [id, now.toISOString()]);
}

/** Fills a claimed row: who, where, the checked lines, what they told, how it came out, and what the call would cost. */
export async function storeScene(
  db: Db,
  id: string,
  s: {
    place: string;
    cast: readonly string[];
    lines: readonly SceneLine[];
    told: readonly SceneTold[];
    source: "model" | "template";
    spent: { models: string[]; cost_usd: number | null; input_tokens: number; output_tokens: number };
    tension: Pick<Tension, "kind" | "a" | "b" | "about"> | null;
    result?: SceneResult | null;
    now: Date;
  },
): Promise<void> {
  await db.query(
    `update house_scenes set place = $2, cast_ids = $3::jsonb, lines = $4::jsonb, told = $5::jsonb, source = $6, model = $7, cost_usd = $8,
            input_tokens = $9, output_tokens = $10, tension = $11::jsonb, result = $12::jsonb, written_at = $13
      where id = $1`,
    [id, s.place, JSON.stringify(s.cast), JSON.stringify(s.lines), JSON.stringify(s.told), s.source, s.spent.models[0] ?? null, s.spent.cost_usd, s.spent.input_tokens, s.spent.output_tokens, JSON.stringify(s.tension), JSON.stringify(s.result ?? null), s.now.toISOString()],
  );
  forgetLatestHouseScene();
  await houseTies(db);
}

/**
 * The house's ties in the social network (lib/social/derive.ts deriveHouse: feuds, rivals, who told whom, who talked
 * about whom), worked out again from what /house shows. Best effort, after the response when there is one.
 */
const houseTies = (db: Db): Promise<void> => socialHook("house", (d, deadline) => d.deriveHouse(db, { deadline }), { key: "house" });

/**
 * The hourly lobby job's part: writes today's scene once, on the first pass at or after HOUSE_SCENE_HOUR_UTC. It claims
 * the day's row first (two passes can't both call the model), then fills it; a quiet day keeps an empty row so the job
 * doesn't ask again. Then the state (applyTold), the owners (tellOwners) and the texts (textAboutScene).
 */
export async function ensureHouseScene(
  db: Db,
  now: Date = new Date(),
  opts: { model?: Model; env?: Record<string, string | undefined>; /** An admin asked for it now (POST /api/admin/house-scene): don't wait for the hour. */ anyHour?: boolean } = {},
): Promise<HouseSceneWritten> {
  const env = opts.env ?? process.env;
  if (!houseScenesOn(env)) return { skipped: "off" };
  if (!opts.anyHour && now.getUTCHours() < houseSceneHourUtc(env)) return { skipped: "early" };
  const day = now.toISOString().slice(0, 10);
  const id = sceneIdOf(day);
  if (!(await claimScene(db, id, day, "gossip", now))) return { skipped: "already" };
  const quiet = async (why: "quiet" | "no_cast"): Promise<HouseSceneWritten> => {
    await quietScene(db, id, now);
    return { skipped: why };
  };
  // Where the scene before this one stopped looking, and what the last few already told.
  const before = (await db.query<{ created_at: string | Date; told: SceneTold[] }>(`select created_at, told from house_scenes where kind = 'gossip' and id <> $1 and source <> 'pending' order by day desc limit 3`, [id])).rows;
  const facts = await sceneFacts(db, now, {
    since: before[0] ? new Date(before[0].created_at) : undefined,
    skip: before.flatMap((r) => (r.told ?? []).map((t) => t.episode_id)),
    beat: await beatFor(db, day, env),
  });
  if (!facts) return quiet(showCastIds(now).length < 2 ? "no_cast" : "quiet");

  const hidden = (await Promise.all(showCastIds(now).map((c) => hiddenCastSecrets(db, c, now).catch(() => [] as string[])))).flat();
  const model = opts.model ?? (voiceEnabled ? houseWriter() : null);
  const usage: Usage[] = [];
  const written = model ? await writeScene(model, facts, hidden, (u) => usage.push(u)) : null;
  const lines = written ?? templateScene(facts).filter((l) => !hidden.some((s) => slipped(l.text, s)));
  if (!isScene(lines)) return quiet("quiet");
  const source = written ? "model" : "template";
  const roomIds = facts.speakers.map((s) => s.id);
  const told = toldBy(id, lines, roomIds);
  const spent = summarizeUsage(usage, model ? 1 : 0, now);
  await storeScene(db, id, { place: facts.place, cast: roomIds, lines, told, source, spent, tension: facts.tension, now });
  const heard = await applyTold(db, told, now, new Map(facts.dates.map((d) => [d.episode_id, d.ending])));
  const owners = await tellOwners(db, { id, day, place: facts.place, lines, told });
  const texted = await textAboutScene(db, id, now, env);
  return { id, source, lines: lines.length, told: heard, cost_usd: spent.cost_usd, ...owners, texted };
}

/**
 * The hourly upkeep: a date a recent scene talked about that is no longer public (made private, reported away) takes
 * what the scene told of it out of the story state. The page hides those lines on its own (sceneViews).
 */
export async function houseUpkeep(db: Db, now: Date = new Date()): Promise<{ retracted: number }> {
  const { rows } = await db.query<{ id: string; told: SceneTold[] }>(
    `select id, told from house_scenes where source in ('model', 'template') and day >= $1 and jsonb_array_length(told) > 0`,
    [new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10)],
  );
  const episodes = [...new Set(rows.flatMap((r) => r.told.map((t) => t.episode_id)).filter(Boolean))];
  if (!episodes.length) return { retracted: 0 };
  const gone = await goneEpisodes(db, episodes);
  let retracted = 0;
  for (const r of rows) for (const t of r.told) if (gone.has(t.episode_id)) retracted += await retractLine(db, r.id, t.line);
  if (retracted) await houseTies(db);
  return { retracted };
}

/** Which of these dates are no longer part of the public record (or one of their two characters isn't public). */
async function goneEpisodes(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query<{ id: string }>(
    `select e.id from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.id = any($1) and ${publicDateSql("e")} and ca.visibility = 'public' and cb.visibility = 'public'`,
    [[...ids]],
  );
  const still = new Set(rows.map((r) => r.id));
  return new Set(ids.filter((id) => !still.has(id)));
}

/* ------------------------------------------------ reports ------------------------------------------------ */

export type SceneReportReason = (typeof REPORT_REASONS)[number];

/**
 * Reports one line of a scene (one report per person per line). Once REPORT_HIDE_THRESHOLD people have, the line is
 * hidden (derived at read time, as a date's reports are) and what it told is taken back out of the story state. A
 * report that doesn't count (lib/report-trust.ts: a brand-new identity) is kept for the admins' list and left out of
 * that count.
 */
export async function reportSceneLine(
  db: Db,
  sceneId: string,
  line: number,
  reporterId: string,
  reason: SceneReportReason = "other",
  opts: { counts?: boolean } = {},
): Promise<{ ok: true; reported: boolean; hidden: boolean } | { ok: false; status: number; error: string }> {
  const scene = (await db.query<{ lines: SceneLine[] }>(`select lines from house_scenes where id = $1 and source in ('model', 'template')`, [sceneId])).rows[0];
  if (!scene || !Number.isInteger(line) || line < 1 || line > scene.lines.length) return { ok: false, status: 404, error: "line_not_found" };
  const counts = opts.counts !== false;
  const made = await db.query(
    `insert into house_scene_reports (scene_id, line, reporter_id, reason, counts) values ($1, $2, $3, $4, $5) on conflict do nothing returning scene_id`,
    [sceneId, line, reporterId, reason, counts],
  );
  const n = (await db.query<{ n: number }>(`select count(*)::int as n from house_scene_reports where scene_id = $1 and line = $2 and counts`, [sceneId, line])).rows[0].n;
  const hidden = n >= REPORT_HIDE_THRESHOLD;
  // A report that doesn't count never sets that work going.
  if (hidden && counts) {
    await retractLine(db, sceneId, line);
    await houseTies(db);
  }
  return { ok: true, reported: made.rows.length > 0, hidden };
}

export const SCENE_REVIEW_DECISIONS = ["cleared", "removed"] as const;
export type SceneReviewDecision = (typeof SCENE_REVIEW_DECISIONS)[number];

/** Reported scene lines nobody has reviewed, most reported first (the admin's list). */
export async function listSceneReports(db: Db): Promise<{ scene_id: string; line: number; text: string; speaker: string; reports: number; hidden: boolean; reasons: Record<string, number>; last_reported_at: string }[]> {
  const { rows } = await db.query<{ scene_id: string; line: number; n: number; counted: number; last_at: string | Date; reasons: Record<string, number>; lines: SceneLine[] }>(
    `select r.scene_id, r.line, r.n, r.counted, r.last_at, r.reasons, s.lines
       from (select scene_id, line, count(*)::int as n, (count(*) filter (where counts))::int as counted, max(created_at) as last_at,
                    (select jsonb_object_agg(reason, c) from (select reason, count(*)::int as c from house_scene_reports x where x.scene_id = h.scene_id and x.line = h.line group by reason) g) as reasons
               from house_scene_reports h group by scene_id, line) r
       join house_scenes s on s.id = r.scene_id
      order by r.n desc, r.last_at desc limit 100`,
  );
  const ids = [...new Set(rows.map((r) => r.lines[r.line - 1]?.character_id).filter((x): x is string => Boolean(x)))];
  const names = new Map((await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [ids])).rows.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    scene_id: r.scene_id,
    line: r.line,
    text: r.lines[r.line - 1]?.text ?? "",
    speaker: names.get(r.lines[r.line - 1]?.character_id ?? "") ?? "?",
    reports: r.n,
    hidden: r.counted >= REPORT_HIDE_THRESHOLD,
    reasons: r.reasons ?? {},
    last_reported_at: new Date(r.last_at).toISOString(),
  }));
}

/**
 * An admin reviews a reported line. 'cleared': the reports stop counting, the line is back, and what it told is told
 * again. 'removed': the line is taken down for good (it stays in the row, marked) and what it told stays out.
 * Returns how many reports were reviewed (0: nothing was open on that line).
 */
export async function reviewSceneLine(db: Db, sceneId: string, line: number, decision: SceneReviewDecision): Promise<number> {
  const scene = (await db.query<StoredScene>(`select id, day, place, cast_ids, lines, told, written_at, created_at from house_scenes where id = $1`, [sceneId])).rows[0];
  if (!scene || line < 1 || line > scene.lines.length) return 0;
  const reviewed = (await db.query(`delete from house_scene_reports where scene_id = $1 and line = $2 returning scene_id`, [sceneId, line])).rows.length;
  if (!reviewed) return 0;
  forgetLatestHouseScene();
  if (decision === "removed") {
    const lines = scene.lines.map((l, i) => (i === line - 1 ? { ...l, removed: true as const } : l));
    await db.query(`update house_scenes set lines = $2::jsonb where id = $1`, [sceneId, JSON.stringify(lines)]);
    await retractLine(db, sceneId, line);
  } else {
    await applyTold(db, scene.told.filter((t) => t.line === line), new Date(scene.written_at ?? scene.created_at));
  }
  await houseTies(db);
  return reviewed;
}

/* ------------------------------------------------ reading ------------------------------------------------ */

export type SceneFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
export type SceneLineView = SceneFace & {
  /** The line's number in the stored scene, from 1: what a report names. */
  n: number;
  text: string;
  /** The two the line's retelling is about, by id (lib/character-talk.ts: which lines name whom). Never whether it was true. */
  about?: [string, string];
};
export type HouseSceneView = {
  id: string;
  day: string;
  kind: string;
  /** `at` reads after a name ("on the stairs"). */
  place: { id: string; label: string; at: string; when: string };
  /** "S2 · Night 15": the night it was said. */
  code: string | null;
  written_at: string;
  cast: SceneFace[];
  lines: SceneLineView[];
  /** The aired dates it talks about: the two names and the episode. */
  about: { episode_id: string; a: string; b: string; a_id?: string; b_id?: string }[];
  /**
   * How a confrontation or a challenge came out (lib/house-conflict.ts), in words for the page: the two and the result,
   * or the winner and what they won. Null for the daily scene.
   */
  result: { kind: "confrontation"; a: string; b: string; a_id?: string; b_id?: string; outcome: Outcome; label: string } | { kind: "challenge"; title: string; winner: SceneFace; prize: string } | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** A challenge's prize in words: "Nell's next date, on Thursday" or "first pick of Thursday's house date, with Dex". */
export function prizeWords(prize: ChallengeResult["prize"], withName: string | null): string {
  const on = WEEKDAYS[new Date(`${prize.day}T12:00:00Z`).getUTCDay()];
  if (prize.kind === "lead_date") return `${withName ? first(withName) : "the lead"}'s next date, on ${on}`;
  return `first pick of ${on}'s house date${withName ? `, with ${first(withName)}` : ""}`;
}

/** How many scenes a page of /house lists. */
export const HOUSE_PAGE_SIZE = 7;
const SCENE_COLS = `id, day, season_id, kind, place, cast_ids, lines, told, result, source, model, cost_usd, written_at, created_at`;
/** The day's scenes in the order they matter: a challenge, then a confrontation, then the daily scene. */
const KIND_ORDER = `case kind when 'challenge' then 0 when 'confrontation' then 1 else 2 end`;

/**
 * Stored scenes as the page shows them. Left out: a line reported away or removed, a line whose speaker went private,
 * a retelling of a date that is no longer public (or whose people aren't); a scene with fewer than two lines left is
 * left out whole.
 */
async function sceneViews(db: Db, rows: readonly StoredScene[]): Promise<HouseSceneView[]> {
  if (!rows.length) return [];
  const sceneIds = rows.map((r) => r.id);
  const resultIds = (r: StoredScene): string[] => (!r.result ? [] : r.result.kind === "confrontation" ? [r.result.a, r.result.b] : [r.result.winner, ...(r.result.prize.with ? [r.result.prize.with] : [])]);
  const charIds = [...new Set(rows.flatMap((r) => [...r.cast_ids, ...r.lines.map((l) => l.character_id), ...r.told.flatMap((t) => [t.about, t.about_b]), ...resultIds(r)]))];
  const episodeIds = [...new Set(rows.flatMap((r) => r.lines.flatMap((l) => (l.tell ? [l.tell.episode_id] : []))))];
  const [chars, reports, gone] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null; house: boolean; visibility: string }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.is_house as house, c.visibility from characters c where c.id = any($1)`,
      [charIds],
    ),
    db.query<{ scene_id: string; line: number }>(`select scene_id, line from house_scene_reports where scene_id = any($1) and counts group by scene_id, line having count(*) >= $2`, [sceneIds, REPORT_HIDE_THRESHOLD]),
    goneEpisodes(db, episodeIds),
  ]);
  const byId = new Map(chars.rows.filter((c) => c.visibility === "public").map((c) => [c.id, c]));
  const face = (id: string): SceneFace | null => {
    const c = byId.get(id);
    return c ? { id: c.id, name: first(c.name), hue: c.hue, portrait: c.portrait, house: c.house } : null;
  };
  const hidden = new Set(reports.rows.map((r) => `${r.scene_id}#${r.line}`));
  const out: HouseSceneView[] = [];
  for (const r of rows) {
    const lines = r.lines.flatMap((l, i): SceneLineView[] => {
      const who = face(l.character_id);
      if (!who || l.removed || hidden.has(`${r.id}#${i + 1}`)) return [];
      if (l.tell && (gone.has(l.tell.episode_id) || !byId.has(l.tell.about) || !byId.has(l.tell.about_b))) return [];
      return [{ ...who, n: i + 1, text: l.text, ...(l.tell ? { about: [l.tell.about, l.tell.about_b] as [string, string] } : {}) }];
    });
    if (lines.length < 2) continue;
    const about = [...new Map(r.lines.flatMap((l) => (l.tell && !gone.has(l.tell.episode_id) && byId.has(l.tell.about) && byId.has(l.tell.about_b) ? [[l.tell.episode_id, l.tell] as const] : []))).values()];
    const place = housePlace(r.place);
    // The result names its people only while they are still public.
    let result: HouseSceneView["result"] = null;
    if (r.result?.kind === "confrontation" && byId.has(r.result.a) && byId.has(r.result.b)) {
      result = { kind: "confrontation", a: first(byId.get(r.result.a)!.name), b: first(byId.get(r.result.b)!.name), a_id: r.result.a, b_id: r.result.b, outcome: r.result.outcome, label: OUTCOME_LABELS[r.result.outcome] ?? OUTCOME_LABELS.agreed_to_disagree };
    } else if (r.result?.kind === "challenge" && face(r.result.winner)) {
      const partner = r.result.prize.with ? byId.get(r.result.prize.with)?.name ?? null : null;
      result = { kind: "challenge", title: r.result.title, winner: face(r.result.winner)!, prize: prizeWords(r.result.prize, partner) };
    }
    out.push({
      id: r.id,
      day: r.day,
      kind: r.kind,
      place: { id: place.id, label: place.label, at: place.at, when: place.when },
      code: episodeCode(new Date(`${r.day}T12:00:00Z`)),
      written_at: new Date(r.written_at ?? r.created_at).toISOString(),
      cast: r.cast_ids.map(face).filter((c): c is SceneFace => c !== null),
      lines,
      about: about.map((t) => ({ episode_id: t.episode_id, a: byId.get(t.about)!.name, b: byId.get(t.about_b)!.name, a_id: t.about, b_id: t.about_b })),
      result,
    });
  }
  return out;
}

/** The house page's scenes, newest first: `limit` of them from `offset`, and how many there are in all. Empty when the switch is off. */
export async function listHouseScenes(db: Db, opts: { limit?: number; offset?: number } = {}): Promise<{ scenes: HouseSceneView[]; total: number }> {
  if (!houseScenesOn()) return { scenes: [], total: 0 };
  const limit = Math.min(Math.max(opts.limit ?? HOUSE_PAGE_SIZE, 1), 30);
  const where = `source in ('model', 'template') and jsonb_array_length(lines) > 0`;
  const [{ rows }, total] = await Promise.all([
    db.query<StoredScene>(`select ${SCENE_COLS} from house_scenes where ${where} order by day desc, ${KIND_ORDER}, created_at desc limit $1 offset $2`, [limit, Math.max(opts.offset ?? 0, 0)]),
    db.query<{ n: number }>(`select count(*)::int as n from house_scenes where ${where}`),
  ]);
  return { scenes: await sceneViews(db, rows), total: total.rows[0]?.n ?? 0 };
}

/**
 * Every scene /house shows, newest first, read whole and whatever the switch (lib/social/derive.ts works the house's
 * ties out from them, and decides for itself what to do while the house is off).
 */
export async function allHouseScenes(db: Db): Promise<HouseSceneView[]> {
  const { rows } = await db.query<StoredScene>(
    `select ${SCENE_COLS} from house_scenes where source in ('model', 'template') and jsonb_array_length(lines) > 0 order by day desc, ${KIND_ORDER}, created_at desc`,
  );
  return sceneViews(db, rows);
}

/** One scene by its id (a notification's or a text's link), or null. */
export async function houseScene(db: Db, id: string): Promise<HouseSceneView | null> {
  if (!houseScenesOn()) return null;
  const { rows } = await db.query<StoredScene>(`select ${SCENE_COLS} from house_scenes where id = $1 and source in ('model', 'template')`, [id]);
  return (await sceneViews(db, rows))[0] ?? null;
}

/**
 * The newest scene as this process last read it. Home asks on every render (the Tonight band's house line), and the
 * answer changes a few times a day, so it is kept for a minute per day and dropped whenever this module writes
 * (a scene stored, a line reported or reviewed, a retelling taken back). tests/perf-pages.test.ts holds home to its
 * round trips; without this the line cost it one more.
 */
let latestMemo: { db: Db; day: string; at: number; scene: HouseSceneView | null } | null = null;
const LATEST_FRESH_MS = 60_000;
export function forgetLatestHouseScene(): void {
  latestMemo = null;
}

/** The newest scene, while it's from the last SCENE_SHOWN_DAYS: the Tonight band's house line and Since you were here. */
export async function latestHouseScene(db: Db, now: Date = new Date()): Promise<HouseSceneView | null> {
  if (!houseScenesOn()) return null;
  const day = now.toISOString().slice(0, 10);
  if (latestMemo && latestMemo.db === db && latestMemo.day === day && Date.now() - latestMemo.at < LATEST_FRESH_MS) return latestMemo.scene;
  const { rows } = await db.query<StoredScene>(
    `select ${SCENE_COLS} from house_scenes where source in ('model', 'template') and jsonb_array_length(lines) > 0 and day >= $1 order by day desc, ${KIND_ORDER}, created_at desc limit 4`,
    [new Date(now.getTime() - SCENE_SHOWN_DAYS * DAY_MS).toISOString().slice(0, 10)],
  );
  const scene = (await sceneViews(db, rows))[0] ?? null;
  latestMemo = { db, day, at: Date.now(), scene };
  return scene;
}

/**
 * One line about a scene for the Tonight band and Since you were here: who was talking, where, about whom; for a
 * confrontation who had it out and how it ended; for a challenge who won and what.
 */
export function houseLine(s: Pick<HouseSceneView, "cast" | "place" | "about" | "result">): string {
  if (s.result?.kind === "confrontation") return `${s.result.a} and ${s.result.b} had it out ${s.place.at}: ${lowerFirst(s.result.label)}`;
  if (s.result?.kind === "challenge") return `${s.result.winner.name} won ${s.result.title.replace(/^The /, "the ")}: ${s.result.prize}`;
  const who = s.cast.map((c) => c.name);
  const names = who.length > 2 ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}` : who.join(" and ");
  const d = s.about[0];
  return `${names} ${s.place.at}${d ? `, on ${first(d.a)} and ${first(d.b)}'s date` : ""}`;
}
