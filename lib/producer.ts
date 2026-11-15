/**
 * The producer (the drama wave, 2026-11-15, part 4; docs/seasons.md "The producer"). Reality TV is produced: someone
 * decides tonight what tomorrow's episode is about. Ours runs once a night in the hourly lobby job, reads the story
 * state (lib/story-state.ts) and sets tomorrow's SITUATIONS. It never sets an outcome.
 *
 * What one night's run does, for the UTC day that is about to start (the 23:20 pass; a missed pass is caught up by the
 * next one, for the day it is by then), once per day (story_beats.day is the claim):
 *
 *  1. The beat (story_beats): ranks `tensions(db, seasonId)` and picks the one worth staging. Rules only, seeded from
 *     the day: the hottest tension, a tie dealt by the day, and a tension staged in the last two days steps behind one
 *     that wasn't (so the show doesn't tell the same story three nights running). The row keeps who it is about, the
 *     evidence ids from the tension, why it won, and what came of it (beatOutcome, written two nights later).
 *       knows_said, mutual_distrust -> kind 'same_room'      two people who should be put in a room
 *       opposing_claims             -> kind 'surface_claim'  a claim that should surface
 *       rivals                      -> kind 'rival_date'     a rival who should be on tonight's date
 *  2. Wants: the two or three characters the beat is about get this week's want overwritten (setWant, setBy
 *     'producer': the rules never write over it), so their next date and texts lean into the beat.
 *  3. Tonight's vote (lib/situations.ts): when the beat can be staged inside what the season's format allows, the day's
 *     situation vote offers two or three TWISTS of it instead of the dealt roleplays: who gets the date, where, or whose
 *     story gets asked about. A vote picks a situation, never an ending and never anyone's odds; with no beat, or one
 *     that can't be staged (a Botchelor season only dates the lead with a suitor still in), the dealt roleplays stand,
 *     and a day nobody votes makes no date, exactly as before.
 *  4. "Previously" and "Tonight": two template lines a day from the beat, and a one-line logline in the show's voice
 *     (the show's cheap model, one call, checked; the template when it fails). Shown where the show already has a daily
 *     line and offered to the clip pipeline (GET /api/story).
 *
 * The date plans written at night are lib/night-plans.ts (DATE_PLAN_AT_NIGHT); the house's scenes read `beatFor`.
 *
 * THE RULES THAT NEVER BEND
 *  - Never the engine: nothing here is read by lib/engine.ts, the points, the odds or the endings. A twist chooses which
 *    two of the cast the house's voted date is for and where it happens; the engine then decides that date as it
 *    decides any other.
 *  - Only the public aired record: the beat is built from tensions, which are built from public aired dates between
 *    public characters. No public line ever says whether a claim is true (story-state: is_true is server-side only):
 *    the lines name people and the fact that something was said, in an order that doesn't depend on who is right.
 *  - Every line a viewer can see passes the PG checks before it is stored.
 *  - PRODUCER=0 turns it off without a deploy of code: no beats, wants or vote choices are written, and none is read.
 *
 * Cost: rows and templates, plus one small call a night for the logline on the show's free model (about 250 tokens in,
 * 40 out: $0 on the free tier, under 0.01 cents at paid flash-lite rates).
 */
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { needsTranslation } from "./language-check";
import { getModel, type Model } from "./model";
import { shortName } from "./names";
import { REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { checkSheetText, checkShowText } from "./safety";
import { leadAndSuitors, showCastIds } from "./season-cast";
import { seasonFormatNow } from "./season-format-store";
import { seasonIdOf } from "./season-window";
import { setWant, storyStateOn, tensions, type Tension, type TensionKind, type WantKind } from "./story-state";
import { VENUE_IDS, venueName, venuePhrase, type VenueId } from "./venues";

type Env = Record<string, string | undefined>;

/* ------------------------------------------------ the switch ------------------------------------------------ */

/** PRODUCER: on unless it is "0". Off: no beat, want or vote choice is written, and none is read. */
export const producerOn = (env: Env = process.env): boolean => env.PRODUCER?.trim() !== "0" && storyStateOn(env);

/** The hourly pass (UTC hour) that produces the NEXT day: after the day's airings, before the 00:20 house dates. */
export const PRODUCER_HOUR_UTC = 23;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A UTC day as YYYY-MM-DD. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const noonOf = (day: string): Date => new Date(`${day}T12:00:00.000Z`);
const startOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const dayAfter = (day: string, n = 1): string => dayOf(new Date(startOf(day).getTime() + n * DAY_MS));

/** The day a run at `now` produces: tomorrow from the producer's hour on, otherwise today (a pass that was missed). */
export const producedDay = (now: Date): string => (now.getUTCHours() >= PRODUCER_HOUR_UTC ? dayAfter(dayOf(now)) : dayOf(now));

/* ------------------------------------------------ shapes ------------------------------------------------ */

export const BEAT_KINDS = ["surface_claim", "same_room", "rival_date"] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
/** staged: picked, its day running or ahead. played / missed: what came of it. skipped: the owner's control. none: nothing worth staging. */
export type BeatStatus = "pending" | "staged" | "played" | "missed" | "skipped" | "none";
/** The house scene a beat suits (lib/house-scenes.ts kinds), for its picker to prefer. */
export type BeatScene = "kitchen" | "confrontation" | "challenge";

export const LOGLINE_MAX = 120;
export const LINE_MAX = 140;
/** How many days back a staged tension counts as "just told". */
export const REPEAT_DAYS = 2;
export const TWISTS_MAX = 3;

const KIND_OF: Record<TensionKind, BeatKind> = { knows_said: "same_room", mutual_distrust: "same_room", opposing_claims: "surface_claim", rivals: "rival_date" };
const SCENE_OF: Record<TensionKind, BeatScene> = { knows_said: "confrontation", mutual_distrust: "confrontation", opposing_claims: "kitchen", rivals: "challenge" };

/** One thing the day's vote can pick: a situation, never an ending. */
export type Twist = {
  id: string;
  title: string;
  icon: string;
  premise: string;
  /** The two the house's voted date is for, in the order it is booked (a Botchelor season: the lead first). */
  pair: [string, string];
  /** Where it happens, when the twist is the place. */
  venue: VenueId | null;
  /** The want the one who asks carries into the date, when the twist is whose story gets asked about. */
  want: { holder: string; about: string; want: string; kind: WantKind } | null;
};

export type BeatWant = { holder: string; about: string | null; kind: WantKind; want: string };

export type Beat = {
  day: string;
  season_id: string;
  kind: BeatKind;
  status: BeatStatus;
  tension: TensionKind;
  /** The two it is between, then the one it is over when that is someone else. */
  who: string[];
  about: string | null;
  evidence: Tension["evidence"];
  /** Why it won, for the owner (may say whether a claim is true: never shown to a viewer). */
  why: string;
  logline: string;
  logline_by: "model" | "template";
  previously: string;
  tonight: string;
  choices: Twist[] | null;
  wants: BeatWant[];
  outcome: BeatOutcome | null;
  scene: BeatScene;
};

export type BeatOutcome = {
  /** The day's vote, when it made a date. */
  vote: { pick: string; title: string | null; votes: number; total: number; twist: boolean } | null;
  /** Dates between two of the beat's people made on its day or the next. `ending` only once it has aired. */
  dates: { episode_id: string; a: string; b: string; aired: boolean; ending: Ending | null }[];
  /** Claims in the evidence that came up on a date since. */
  claims_used: number;
  /** "X knows you said" facts in the evidence that were settled since. */
  settled: number;
};

type BeatRow = {
  day: string;
  season_id: string;
  kind: string;
  status: BeatStatus;
  tension: TensionKind | null;
  who: string[] | null;
  about: string | null;
  evidence: Tension["evidence"] | null;
  why: string | null;
  logline: string | null;
  logline_by: string | null;
  previously: string | null;
  tonight: string | null;
  choices: Twist[] | null;
  wants: BeatWant[] | null;
  outcome: BeatOutcome | null;
};

const BEAT_COLS = `day, season_id, kind, status, tension, who, about, evidence, why, logline, logline_by, previously, tonight, choices, wants, outcome`;

const beatOf = (r: BeatRow): Beat | null =>
  r.tension && (BEAT_KINDS as readonly string[]).includes(r.kind)
    ? {
        day: r.day,
        season_id: r.season_id,
        kind: r.kind as BeatKind,
        status: r.status,
        tension: r.tension,
        who: r.who ?? [],
        about: r.about,
        evidence: r.evidence ?? {},
        why: r.why ?? "",
        logline: r.logline ?? "",
        logline_by: r.logline_by === "model" ? "model" : "template",
        previously: r.previously ?? "",
        tonight: r.tonight ?? "",
        choices: Array.isArray(r.choices) && r.choices.length >= 2 ? r.choices : null,
        wants: r.wants ?? [],
        outcome: r.outcome,
        scene: SCENE_OF[r.tension],
      }
    : null;

/* ------------------------------------------------ reading a beat ------------------------------------------------ */

/**
 * The beat of a UTC day, or null: none was picked, the owner skipped it, or the producer is off. For the house's scenes
 * (lib/house-scenes.ts: prefer `scene`, cast `who`, bring up the claims in `evidence.heard`), the vote and the date
 * plans. Never anything a viewer may not see except `why` and `evidence`, which stay server-side.
 */
export async function beatFor(db: Db, day: string, env: Env = process.env): Promise<Beat | null> {
  if (!producerOn(env)) return null;
  const { rows } = await db.query<BeatRow>(`select ${BEAT_COLS} from story_beats where day = $1 and status in ('staged', 'played', 'missed')`, [day]);
  return rows[0] ? beatOf(rows[0]) : null;
}

/** The twists the day's vote offers, or null (no beat, one that can't be staged, or the producer is off): the dealt roleplays stand. */
export async function twistsFor(db: Db, day: string, env: Env = process.env): Promise<Twist[] | null> {
  return (await beatFor(db, day, env).catch(() => null))?.choices ?? null;
}

/* ------------------------------------------------ picking the beat ------------------------------------------------ */

/** A tension's identity from one night to the next: its kind and its people, whichever way round they are listed. */
export const tensionKey = (t: Pick<Tension, "kind" | "a" | "b" | "about">): string => `${t.kind}|${[t.a, t.b].sort().join("|")}|${t.about ?? ""}`;

/**
 * The tension worth staging, from the ranked list: one that wasn't just told before one that was, then the hottest,
 * then a deal from the day (so two equal tensions don't always resolve by id). Pure and deterministic.
 */
export function pickTension(list: readonly Tension[], day: string, recent: ReadonlySet<string> = new Set()): Tension | null {
  if (!list.length) return null;
  return [...list].sort(
    (x, y) =>
      Number(recent.has(tensionKey(x))) - Number(recent.has(tensionKey(y))) ||
      y.weight - x.weight ||
      seedFrom("beat", day, tensionKey(x)) - seedFrom("beat", day, tensionKey(y)) ||
      tensionKey(x).localeCompare(tensionKey(y)),
  )[0];
}

type Names = (id: string) => string;

/** The two it is between in an order that never depends on who is right (opposing claims list the true holder first). */
function publicOrder(t: Tension, nm: Names): [string, string] {
  if (t.kind === "knows_said") return [t.a, t.b]; // a found out, b said it: the roles are the story
  return [t.a, t.b].sort((x, y) => nm(x).localeCompare(nm(y)) || x.localeCompare(y)) as [string, string];
}

/** The two template lines and the template logline, from names and the kind only. `voted`: the day's vote stages it. */
export function beatLines(t: Tension, nm: Names, voted: boolean): { previously: string; tonight: string; logline: string } {
  const [a, b] = publicOrder(t, nm).map(nm);
  const x = t.about ? nm(t.about) : "";
  let prev: string;
  let ton: string;
  switch (t.kind) {
    case "knows_said":
      prev = `${a} found out what ${b} has been saying.`;
      ton = voted ? `${a} wants an answer, and you pick where ${a} gets to ask.` : `${a} wants an answer from ${b}.`;
      break;
    case "opposing_claims":
      prev = `${a} and ${b} heard two different stories about ${x}.`;
      ton = voted ? `you pick who gets to ask ${x} about it.` : `${a} and ${b} both want the real story.`;
      break;
    case "rivals":
      prev = `${a} and ${b} both set their sights on ${x}.`;
      ton = voted ? `you pick who gets the date with ${x}.` : `neither of them is backing down.`;
      break;
    default:
      prev = `${a} and ${b} stopped trusting each other.`;
      ton = voted ? `you pick where they have it out.` : `neither of them wants to blink first.`;
  }
  return { previously: `Previously: ${prev}`, tonight: `Tonight: ${ton}`, logline: `${prev} Tonight, ${ton}` };
}

/** The wants the beat hands its people (the cast only: they are who holds wants). Symmetric where the truth could show. */
export function beatWants(t: Tension, nm: Names, cast: ReadonlySet<string>): BeatWant[] {
  const out: BeatWant[] = [];
  const add = (holder: string, about: string | null, kind: WantKind, want: string) => {
    if (cast.has(holder) && !out.some((w) => w.holder === holder)) out.push({ holder, about, kind, want });
  };
  switch (t.kind) {
    case "knows_said":
      add(t.a, t.b, "settle_score", `Find out whether ${nm(t.b)} really said it, and hear it from ${nm(t.b)}.`);
      add(t.b, t.a, "protect", `${nm(t.a)} knows what you said. Decide whether you stand by it.`);
      break;
    case "opposing_claims":
      if (t.about) {
        for (const h of [t.a, t.b]) add(h, t.about, "prove", `Find out the real story about ${nm(t.about)}, from ${nm(t.about)} if you can.`);
        add(t.about, null, "settle_score", "Find out what people have been saying about you, and who started it.");
      }
      break;
    case "rivals":
      if (t.about) {
        add(t.a, t.about, "pursue", `Get time with ${nm(t.about)} before ${nm(t.b)} does.`);
        add(t.b, t.about, "pursue", `Get time with ${nm(t.about)} before ${nm(t.a)} does.`);
        add(t.about, null, "protect", `Work out which of ${nm(t.a)} and ${nm(t.b)} is really here for you.`);
      }
      break;
    default:
      add(t.a, t.b, "settle_score", `Clear the air with ${nm(t.b)}, or decide you're done trying.`);
      add(t.b, t.a, "settle_score", `Clear the air with ${nm(t.a)}, or decide you're done trying.`);
  }
  return out.slice(0, 3);
}

/** What the season lets the house's voted date be: on a lead season the lead with a suitor still in; otherwise two of the cast. */
export type Stage = { cast: ReadonlySet<string>; lead: { lead: string; suitors: readonly string[] } | null; venues: readonly VenueId[] };

/** The pair as the house may book it, or null when the format doesn't allow it. */
export function stagedPair(x: string, y: string, stage: Stage): [string, string] | null {
  if (x === y) return null;
  if (stage.lead) {
    const { lead, suitors } = stage.lead;
    if (x === lead && suitors.includes(y)) return [x, y];
    if (y === lead && suitors.includes(x)) return [y, x];
    return null;
  }
  return stage.cast.has(x) && stage.cast.has(y) ? [x, y] : null;
}

/**
 * The two or three twists the day's vote offers for a beat, or null when fewer than two can be staged. Who gets the
 * date (rivals), whose story gets asked about (opposing claims), or where the two of them sit down. Deterministic.
 */
export function beatTwists(t: Tension, nm: Names, stage: Stage, day: string): Twist[] | null {
  const out: Twist[] = [];
  const push = (tw: Omit<Twist, "id">) => {
    if (out.length < TWISTS_MAX) out.push({ ...tw, id: `twist-${out.length + 1}` });
  };
  const [a, b] = publicOrder(t, nm);
  if (t.kind === "rivals" && t.about) {
    for (const [who, other] of [[a, b], [b, a]] as const) {
      const pair = stagedPair(t.about, who, stage);
      if (pair) push({ title: `${nm(who)} gets the date`, icon: "💘", premise: `${nm(t.about)} goes out with ${nm(who)} tonight. ${nm(other)} hears about it afterwards.`, pair, venue: null, want: null });
    }
    const face = stagedPair(a, b, stage);
    if (face && out.length) push({ title: "The rivals share a table", icon: "👀", premise: `${nm(a)} and ${nm(b)} sit down without ${nm(t.about)} and find out what the other is really after.`, pair: face, venue: null, want: null });
  } else if (t.kind === "opposing_claims" && t.about) {
    for (const who of [a, b]) {
      const pair = stagedPair(who, t.about, stage);
      if (pair)
        push({
          title: `${nm(who)} asks ${nm(t.about)}`,
          icon: "🤫",
          premise: `${nm(who)} takes ${nm(t.about)} out and brings up the story going around.`,
          pair,
          venue: null,
          want: { holder: who, about: t.about, kind: "prove", want: `Ask ${nm(t.about)} about what you heard, and watch how ${nm(t.about)} takes it.` },
        });
    }
  } else {
    const pair = stagedPair(t.a, t.b, stage);
    const pool = stage.venues.length >= 2 ? stage.venues : VENUE_IDS;
    if (pair) {
      const first = seedFrom("twist-venue", day, 0) % pool.length;
      const second = (first + 1 + (seedFrom("twist-venue", day, 1) % (pool.length - 1))) % pool.length;
      for (const v of [pool[first], pool[second]]) {
        push({
          title: `At ${venuePhrase(v)}`,
          icon: "🎬",
          premise: t.kind === "knows_said" ? `${nm(t.a)} sits down with ${nm(t.b)} at ${venuePhrase(v)} and asks about what was said.` : `${nm(a)} and ${nm(b)} have it out at ${venuePhrase(v)}.`,
          pair,
          venue: v,
          want: null,
        });
      }
    }
  }
  if (out.length < 2) return null;
  return out.every((tw) => checkShowText({ title: tw.title, premise: tw.premise }).ok) ? out : null;
}

/* ------------------------------------------------ the logline ------------------------------------------------ */

// On in production; the shared test harness turns it off (a fire-and-forget call would eat a scripted output).
// tests/producer.test.ts passes a model of its own.
let voiceEnabled = true;
export function setProducerVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

const LOGLINE_SYSTEM = `You write the one-line logline for tonight's episode of "Botchelor", a comedic dating show starring fictional adults, in a reality-TV announcer's voice: dry, specific, present tense.
Rules: ONE sentence, at most 110 characters. Use only the names given, exactly as given. Say what the situation is, never how anything ends and never whether what was said is true. No hashtags, no emoji, no quotation marks, nothing sexual. Reply with ONLY the line.`;

/** Words that would say a rumour is or isn't true: a logline never does (story-state: is_true stays server-side). */
const TRUTH = /\b(true|untrue|false|falsely|lie|lies|lied|lying|liar|made (it|that) up|rumou?r is)\b/i;

/** A model's logline, or null when it isn't one line in the show's voice that names someone in the beat and passes the checks. */
export function checkLogline(raw: string, names: readonly string[]): string | null {
  const line = raw.trim().replace(/^["“'`]+|["”'`]+$/g, "").replace(/\s+/g, " ");
  if (line.length < 20 || line.length > LOGLINE_MAX || /[\n#]/.test(raw.trim())) return null;
  if (!names.some((n) => n && line.includes(n))) return null;
  if (TRUTH.test(line) || needsTranslation(line)) return null;
  if (!checkSheetText({ line }).ok || !checkShowText({ line }).ok) return null;
  return line;
}

async function writeLogline(model: Model, lines: { previously: string; tonight: string }, names: readonly string[]): Promise<string | null> {
  try {
    const raw = await model.complete(
      [
        { role: "system", content: LOGLINE_SYSTEM },
        { role: "user", content: JSON.stringify({ people: names, what_happened: lines.previously.replace(/^Previously: /, ""), tonight: lines.tonight.replace(/^Tonight: /, "") }) },
      ],
      { temperature: 0.8, maxTokens: 200 },
    );
    return checkLogline(raw, names);
  } catch {
    return null;
  }
}

/* ------------------------------------------------ the nightly run ------------------------------------------------ */

export type ProducerRun =
  | { day: string; skipped: "off" | "already" | "owner" }
  | { day: string; beat: null; reason: "no_tension" | "no_cast" }
  | { day: string; beat: BeatKind; tension: TensionKind; who: string[]; wants: number; twists: number; logline_by: "model" | "template" };

async function namesOf(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[...new Set(ids)]]);
  return new Map(rows.map((r) => [r.id, shortName(r.name)]));
}

/** What the season's format lets the voted date be on a day (lib/season-cast.ts, lib/season-format.ts). */
export async function stageOf(db: Db, at: Date): Promise<Stage> {
  const def = await seasonFormatNow(db, at).catch(() => null);
  const ls = def?.lead ? leadAndSuitors(at) : null;
  return { cast: new Set(showCastIds(at)), lead: ls, venues: def?.venues ?? [] };
}

/**
 * The night's run (the hourly lobby job calls it every pass; it does its work once per day). Claims the day's row
 * first, so two passes can't both produce it; an owner's skip is that row already there.
 */
export async function runProducer(db: Db, now: Date = new Date(), opts: { model?: Model | null; env?: Env } = {}): Promise<ProducerRun> {
  const day = producedDay(now);
  if (!producerOn(opts.env)) return { day, skipped: "off" };
  const at = noonOf(day);
  const season = seasonIdOf(at);
  // What came of the beats whose night is over (the voted date is made the morning after its day, and airs later still).
  await settleBeats(db, day).catch(() => 0);
  const claimed = await db.query(`insert into story_beats (day, season_id, kind, status) values ($1, $2, 'none', 'pending') on conflict (day) do nothing returning day`, [day, season]);
  if (!claimed.rows.length) {
    const was = (await db.query<{ status: BeatStatus }>(`select status from story_beats where day = $1`, [day])).rows[0]?.status;
    return { day, skipped: was === "skipped" ? "owner" : "already" };
  }
  const none = async (reason: "no_tension" | "no_cast"): Promise<ProducerRun> => {
    await db.query(`update story_beats set status = 'none', why = $2, updated_at = now() where day = $1`, [day, reason]);
    return { day, beat: null, reason };
  };
  const stage = await stageOf(db, at);
  if (stage.cast.size < 2) return none("no_cast");
  // The season the day falls in: on the 1st that is the new season, whose state starts empty (no beat on premiere day).
  const list = await tensions(db, season, { now: season === seasonIdOf(now) ? now : at });
  const recent = new Set(
    (await db.query<{ tension: TensionKind; who: string[]; about: string | null }>(`select tension, who, about from story_beats where day >= $1 and day < $2 and tension is not null and status <> 'skipped'`, [dayAfter(day, -REPEAT_DAYS), day])).rows.map(
      (r) => tensionKey({ kind: r.tension, a: r.who?.[0] ?? "", b: r.who?.[1] ?? "", about: r.about }),
    ),
  );
  const picked = pickTension(list, day, recent);
  if (!picked) return none("no_tension");
  const who = [picked.a, picked.b, ...(picked.about && picked.about !== picked.a && picked.about !== picked.b ? [picked.about] : [])];
  const names = await namesOf(db, who);
  const nm: Names = (id) => names.get(id) ?? "someone";
  const twists = beatTwists(picked, nm, stage, day);
  const lines = beatLines(picked, nm, Boolean(twists));
  if (!checkShowText({ previously: lines.previously, tonight: lines.tonight, logline: lines.logline }).ok) return none("no_tension");
  const model = opts.model !== undefined ? opts.model : voiceEnabled ? getModel("minimal", false) : null;
  const written = model ? await writeLogline(model, lines, who.map(nm)) : null;
  const wants: BeatWant[] = [];
  for (const w of beatWants(picked, nm, stage.cast)) {
    if (await setWant(db, { holder: w.holder, want: w.want, kind: w.kind, about: w.about, setBy: "producer", now: at }).catch(() => false)) wants.push(w);
  }
  const rank = list.findIndex((t) => tensionKey(t) === tensionKey(picked)) + 1;
  const why = `${picked.line} Weight ${picked.weight}, ranked ${rank} of ${list.length}${recent.size && rank > 1 ? " (hotter ones were staged in the last two days)" : ""}.`;
  await db.query(
    `update story_beats set kind = $2, status = 'staged', tension = $3, who = $4::jsonb, about = $5, evidence = $6::jsonb, why = $7, logline = $8, logline_by = $9,
            previously = $10, tonight = $11, choices = $12::jsonb, wants = $13::jsonb, updated_at = now()
      where day = $1`,
    [day, KIND_OF[picked.kind], picked.kind, JSON.stringify(who), picked.about, JSON.stringify(picked.evidence), why.slice(0, 600), (written ?? lines.logline).slice(0, 200), written ? "model" : "template",
     lines.previously.slice(0, LINE_MAX), lines.tonight.slice(0, LINE_MAX), twists ? JSON.stringify(twists) : null, JSON.stringify(wants)],
  );
  return { day, beat: KIND_OF[picked.kind], tension: picked.kind, who, wants: wants.length, twists: twists?.length ?? 0, logline_by: written ? "model" : "template" };
}

/* ------------------------------------------------ what came of it ------------------------------------------------ */

/** What came of a beat so far, from rows (no model): the vote's date, dates between its people, claims used, facts settled. */
export async function beatOutcome(db: Db, beat: Pick<Beat, "day" | "who" | "evidence">): Promise<BeatOutcome> {
  const from = startOf(beat.day).toISOString();
  const until = new Date(startOf(beat.day).getTime() + 2 * DAY_MS).toISOString();
  const [night, dates, used, settled] = await Promise.all([
    db.query<{ pick: string | null; title: string | null; votes: number; total: number }>(`select pick, title, votes, total from situation_nights where day = $1 and party_id is not null`, [beat.day]),
    db.query<{ id: string; a: string; b: string; aired: boolean; ending: Ending | null }>(
      `select e.id, e.character_a as a, e.character_b as b, (e.revealed_at is not null) as aired, case when e.revealed_at is not null then e.ending end as ending
         from episodes e
        where e.character_a = any($1) and e.character_b = any($1) and e.created_at >= $2 and e.created_at < $3 and e.status = 'ready'
        order by e.created_at limit 6`,
      [beat.who, from, until],
    ),
    // Since the beat was picked: a claim behind a "knows you said" fact had already come up, which is how they know.
    db.query<{ n: number }>(`select count(*)::int as n from character_heard where id = any($1) and used_at > (select created_at from story_beats where day = $2)`, [beat.evidence.heard ?? [], beat.day]),
    db.query<{ n: number }>(`select count(*)::int as n from character_knows_said where id = any($1) and settled_at >= $2`, [beat.evidence.knows ?? [], from]),
  ]);
  const n = night.rows[0];
  return {
    vote: n ? { pick: n.pick ?? "", title: n.title, votes: n.votes, total: n.total, twist: (n.pick ?? "").startsWith("twist-") } : null,
    dates: dates.rows.map((d) => ({ episode_id: d.id, a: d.a, b: d.b, aired: d.aired, ending: d.ending })),
    claims_used: used.rows[0]?.n ?? 0,
    settled: settled.rows[0]?.n ?? 0,
  };
}

const cameOf = (o: BeatOutcome): boolean => Boolean(o.vote?.twist) || o.dates.length > 0 || o.claims_used > 0 || o.settled > 0;

/** Writes what came of every staged beat whose night is over (two days before `day` or earlier). */
export async function settleBeats(db: Db, day: string): Promise<number> {
  const { rows } = await db.query<BeatRow>(`select ${BEAT_COLS} from story_beats where status = 'staged' and day <= $1 order by day`, [dayAfter(day, -2)]);
  let n = 0;
  for (const r of rows) {
    const beat = beatOf(r);
    if (!beat) continue;
    const outcome = await beatOutcome(db, beat);
    await db.query(`update story_beats set status = $2, outcome = $3::jsonb, updated_at = now() where day = $1 and status = 'staged'`, [beat.day, cameOf(outcome) ? "played" : "missed", JSON.stringify(outcome)]);
    n++;
  }
  return n;
}

/* ------------------------------------------------ the daily lines ------------------------------------------------ */

export type StoryToday = { day: string; previously: string; tonight: string; logline: string; vote: boolean };

/** Today's two lines and logline, for the places the show already has a daily line. Null on a day with no beat. */
export async function storyToday(db: Db, now: Date = new Date(), env: Env = process.env): Promise<StoryToday | null> {
  const beat = await beatFor(db, dayOf(now), env).catch(() => null);
  if (!beat || !beat.previously || !beat.tonight) return null;
  return { day: beat.day, previously: beat.previously, tonight: beat.tonight, logline: beat.logline, vote: Boolean(beat.choices) };
}

export type ClipStory = {
  day: string | null;
  logline: string | null;
  previously: string | null;
  tonight: string | null;
  /** Aired public dates the last few days' beats are about, newest beat first, each with the logline it played under. */
  episodes: { id: string; day: string; logline: string }[];
};
/** How many days of beats the clip pipeline is offered. */
export const CLIP_STORY_DAYS = 4;

/**
 * The day's story for the clip pipeline (GET /api/story; scripts/clips): today's lines, and the aired public dates the
 * recent beats are about (the date the vote staged, or any date between two of the beat's people made on its day or the
 * next), so the picker can prefer the episode the story is about and the caption can carry its logline. Aired public
 * dates only: nothing here spoils a date a viewer could still call.
 */
export async function clipStory(db: Db, now: Date = new Date(), env: Env = process.env): Promise<ClipStory> {
  const empty: ClipStory = { day: null, logline: null, previously: null, tonight: null, episodes: [] };
  if (!producerOn(env)) return empty;
  const today = dayOf(now);
  const { rows } = await db.query<BeatRow>(`select ${BEAT_COLS} from story_beats where day > $1 and day <= $2 and status in ('staged', 'played', 'missed') order by day desc`, [dayAfter(today, -CLIP_STORY_DAYS), today]);
  const beats = rows.map(beatOf).filter((b): b is Beat => b !== null);
  const episodes: ClipStory["episodes"] = [];
  for (const b of beats) {
    const { rows: eps } = await db.query<{ id: string }>(
      `select e.id from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
        where e.character_a = any($1) and e.character_b = any($1) and e.created_at >= $2 and e.created_at < $3
          and e.revealed_at is not null and e.visibility = 'public' and ca.visibility = 'public' and cb.visibility = 'public'
          and (select count(*) from reports r where r.episode_id = e.id) < $4
        order by e.revealed_at desc limit 3`,
      [b.who, startOf(b.day).toISOString(), new Date(startOf(b.day).getTime() + 2 * DAY_MS).toISOString(), REPORT_HIDE_THRESHOLD],
    );
    for (const e of eps) if (!episodes.some((x) => x.id === e.id)) episodes.push({ id: e.id, day: b.day, logline: b.logline });
  }
  const t = beats.find((b) => b.day === today) ?? null;
  return { day: t?.day ?? null, logline: t?.logline ?? null, previously: t?.previously ?? null, tonight: t?.tonight ?? null, episodes };
}

/* ------------------------------------------------ the owner's view ------------------------------------------------ */

/** The day the "skip tomorrow's beat" control acts on: the next day the producer has yet to air. */
export const skipDay = (now: Date): string => dayAfter(dayOf(now));

/**
 * The owner's skip: the day gets no beat, no wants and no vote twists (the dealt roleplays stand). Before the night's
 * run it is the claim row itself; after it, the staged beat is withdrawn (wants already set stay for the week).
 */
export async function skipBeat(db: Db, day: string): Promise<void> {
  await db.query(
    `insert into story_beats (day, season_id, kind, status) values ($1, $2, 'none', 'skipped')
     on conflict (day) do update set status = 'skipped', choices = null, updated_at = now()`,
    [day, seasonIdOf(noonOf(day))],
  );
}

/** Takes a skip back. A day the producer hadn't reached is freed for its run; a beat that was withdrawn is staged again. */
export async function unskipBeat(db: Db, day: string): Promise<void> {
  await db.query(`delete from story_beats where day = $1 and status = 'skipped' and tension is null`, [day]);
  await db.query(`update story_beats set status = 'staged', updated_at = now() where day = $1 and status = 'skipped'`, [day]);
}

export type ProducerBeatView = {
  day: string;
  status: BeatStatus;
  kind: string;
  tension: TensionKind | null;
  who: { id: string; name: string }[];
  why: string | null;
  logline: string | null;
  logline_by: string | null;
  previously: string | null;
  tonight: string | null;
  twists: { id: string; title: string; premise: string }[];
  wants: { name: string; want: string }[];
  /** The rows behind it, as the owner may read them (whether a claim is true included: this view is admin-only). */
  evidence: string[];
  outcome: BeatOutcome | null;
  came: string;
};

function cameWords(o: BeatOutcome | null, status: BeatStatus, nm: Names): string {
  if (status === "skipped") return "Skipped by the owner.";
  if (status === "none" || status === "pending") return "No beat that day.";
  if (!o) return "Its night isn't over yet.";
  const parts: string[] = [];
  if (o.vote) parts.push(`The vote ${o.vote.twist ? "staged it" : "went to a dealt roleplay"}: ${o.vote.title ?? o.vote.pick}, ${o.vote.votes} of ${o.vote.total} votes.`);
  else parts.push("Nobody voted, so the house made no date for it.");
  for (const d of o.dates) parts.push(`${nm(d.a)} × ${nm(d.b)} went on a date${d.aired ? `, which aired and ended "${String(d.ending).replace(/_/g, " ")}"` : " (not aired yet)"}.`);
  if (o.claims_used) parts.push(`${o.claims_used} ${o.claims_used === 1 ? "claim" : "claims"} from the evidence came up on a date.`);
  if (o.settled) parts.push(`${o.settled} "knows you said" ${o.settled === 1 ? "fact was" : "facts were"} settled.`);
  return parts.join(" ");
}

/** The last seven days' beats with their evidence and what came of them, and where the switches stand. Admin only. */
export async function producerView(db: Db, now: Date = new Date(), env: Env = process.env): Promise<{ on: boolean; next_day: string; next_skipped: boolean; beats: ProducerBeatView[] }> {
  const next = skipDay(now);
  const { rows } = await db.query<BeatRow>(`select ${BEAT_COLS} from story_beats where day <= $1 order by day desc limit 8`, [next]);
  const ids = rows.flatMap((r) => [...(r.who ?? []), ...(r.wants ?? []).map((w) => w.holder), ...(r.outcome?.dates ?? []).flatMap((d) => [d.a, d.b])]);
  const heardIds = rows.flatMap((r) => r.evidence?.heard ?? []);
  const [names, heard] = await Promise.all([
    namesOf(db, ids),
    heardIds.length
      ? db.query<{ id: string; claim: string; is_true: boolean; holder: string; told_by: string | null; used_at: string | null }>(
          `select h.id, h.claim, h.is_true, c.name as holder, t.name as told_by, h.used_at from character_heard h join characters c on c.id = h.holder_id left join characters t on t.id = h.told_by where h.id = any($1)`,
          [heardIds],
        )
      : Promise.resolve({ rows: [] as { id: string; claim: string; is_true: boolean; holder: string; told_by: string | null; used_at: string | null }[] }),
  ]);
  const nm: Names = (id) => names.get(id) ?? id;
  const beats: ProducerBeatView[] = [];
  for (const r of rows) {
    const beat = beatOf(r);
    const outcome = r.outcome ?? (beat && beat.status === "staged" ? await beatOutcome(db, beat).catch(() => null) : null);
    const ev: string[] = [];
    for (const id of r.evidence?.heard ?? []) {
      const h = heard.rows.find((x) => x.id === id);
      if (h) ev.push(`${shortName(h.holder)} ${h.told_by ? `was told by ${shortName(h.told_by)}` : "watched it air"}: "${h.claim}" (${h.is_true ? "true" : "not true"}${h.used_at ? ", has come up" : ""})`);
    }
    for (const o of r.evidence?.opinions ?? []) ev.push(`${nm(o.holder)}'s opinion of ${nm(o.about)}`);
    for (const w of r.evidence?.wants ?? []) ev.push(`${nm(w.holder)}'s want for the week of ${w.week}`);
    if (r.evidence?.knows?.length) ev.push(`${r.evidence.knows.length} "knows you said" ${r.evidence.knows.length === 1 ? "fact" : "facts"}`);
    beats.push({
      day: r.day,
      status: r.status,
      kind: r.kind,
      tension: r.tension,
      who: (r.who ?? []).map((id) => ({ id, name: nm(id) })),
      why: r.why,
      logline: r.logline,
      logline_by: r.logline_by,
      previously: r.previously,
      tonight: r.tonight,
      twists: (r.choices ?? []).map((t) => ({ id: t.id, title: t.title, premise: t.premise })),
      wants: (r.wants ?? []).map((w) => ({ name: nm(w.holder), want: w.want })),
      evidence: ev,
      outcome,
      came: cameWords(outcome, r.status, nm),
    });
  }
  return { on: producerOn(env), next_day: next, next_skipped: rows.some((r) => r.day === next && r.status === "skipped"), beats };
}

/** The venue's name for a twist's title elsewhere (the vote's "last" line). */
export const twistPlace = (t: Pick<Twist, "venue">): string | null => (t.venue ? venueName(t.venue) : null);
