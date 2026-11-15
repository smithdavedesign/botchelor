/**
 * Confrontations and challenges (the drama wave, 2026-11-15, item 3; docs/seasons.md "Confrontations and challenges").
 * Two more kinds of house scene (lib/house-scenes.ts: the same table, the same page, the same checks on every line),
 * each with a RESULT that is decided before a word is written, by seeded rules, never by a vote or a payment, and
 * never touching a date: the engine alone decides endings (lib/engine.ts).
 *
 * CONFRONTATIONS (kind 'confrontation'). When the story state holds a tension between two people who are both in the
 * house (lib/story-state.ts tensions: someone knows what another said about them, opposing claims, two who want the
 * same person, distrust both ways) at CONFRONT_MIN_WEIGHT or more, the house stages it at the next scene hour: those
 * two, six lines. At most CONFRONTATIONS_A_WEEK a week, the same pair rests PAIR_REST_DAYS (so never two days
 * running), and the same thing is had out once a season. The producer's beat for the day (story_beats) is preferred when it names a pair that qualifies.
 *  - How it ends (decideOutcome): cleared the air, agreed to disagree, or worse than before, weighted by the trust
 *    each holds for the other and by their temperaments (lib/temperament.ts sheetSignals: warmth against
 *    guardedness), then dealt by the day and the pair (lib/engine.ts seedFrom). The writer writes TO that result;
 *    a template for each result stands in when the call fails, too few lines pass, or the lines end somewhere else.
 *  - Effects, only through the story state: trust moves one step each way (setOpinion: up when they cleared the air,
 *    down when it got worse), what was confronted is closed (settleKnown: every unsettled knows_you_said fact
 *    between the two), and when someone else was in the room they saw it (hear, nobody told them) and the rest of the
 *    house hears it from them (hear, told by the witness).
 *  - An owner whose character was in one hears, as with the daily scene: a `house_talk` notification. The
 *    character's own text is lib/house-texts.ts (textAboutScene): the two who had it out, a challenge's winner and
 *    the ones who lost each text the threads that turned their texts on.
 *
 * CHALLENGES (kind 'challenge'). Once a week, on CHALLENGE_WEEKDAY (Wednesday; Sunday has the roses), the house
 * holds a group challenge: three to five cast members (on a Botchelor season the suitors still in), a premise from
 * the roleplay catalog that suits a group (CHALLENGES: the cook-off, the quiz about each other, talent night, the
 * treasure hunt), eight to ten lines.
 *  - The winner (challengeWinner) is decided by seeded rules from who they are: each trait of theirs the premise
 *    favours counts, and the week deals the rest. The writer writes to it.
 *  - What winning gives is the next one-on-one (house_prizes, read by lib/season-cast.ts): on a Botchelor season the
 *    winner takes the lead's next date in the rotation, swapping days with whoever's turn it was, so no date is
 *    added and nobody dates the lead less; on other formats the winner has first pick of the next day's house date
 *    (the partner is the one their own story state wants, else the one the day would have dealt).
 *
 * CONFRONTATIONS=0 and CHALLENGES=0 turn each off without a deploy of code; HOUSE_SCENES=0 turns off both.
 */
import { hiddenCastSecrets, slipped } from "./cast-secrets";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import type { Model, Usage } from "./model";
import { shortName } from "./names";
import { summarizeUsage } from "./pricing";
import { DATE_ROLEPLAYS } from "./roleplays";
import { checkSheetText, checkShowText } from "./safety";
import { forgetLoadedSeasonCast, leadAndSuitors, showCastIds } from "./season-cast";
import { seasonIdOf, weekIdOf } from "./season-window";
import { hear, knownSaid, setOpinion, settleKnown, tensions, type Tension } from "./story-state";
import { sheetSignals } from "./temperament";
import {
  basicLine,
  beatFor,
  claimScene,
  HOUSE_PLACES,
  housePlace,
  houseSceneHourUtc,
  houseScenesOn,
  houseVoiceOn,
  houseWriter,
  looseLines,
  OUTCOME_LABELS,
  OUTCOMES,
  prizeWords,
  quietScene,
  sceneIdOf,
  scenePath,
  sceneSource,
  sensitiveClaim,
  storeScene,
  textAboutScene,
  type ChallengeResult,
  type ConfrontResult,
  type HousePlaceId,
  type Outcome,
  type SceneLine,
} from "./house-scenes";

const DAY_MS = 24 * 60 * 60 * 1000;
const first = (name: string) => shortName(name);
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/* ------------------------------------------------ the switches ------------------------------------------------ */

/** CONFRONTATIONS: on unless it is "0" (and never without the house scenes themselves). */
export const confrontationsOn = (env: Record<string, string | undefined> = process.env): boolean => houseScenesOn(env) && env.CONFRONTATIONS?.trim() !== "0";
/** CHALLENGES: on unless it is "0" (and never without the house scenes themselves). */
export const challengesOn = (env: Record<string, string | undefined> = process.env): boolean => houseScenesOn(env) && env.CHALLENGES?.trim() !== "0";

/* ------------------------------------------------ confrontations ------------------------------------------------ */

/** A tension this hot or hotter gets staged (lib/story-state.ts: knows_said 6-8, opposing_claims 5, rivals 4-5, mutual_distrust 3-5). */
export const CONFRONT_MIN_WEIGHT = 5;
export const CONFRONTATIONS_A_WEEK = 2;
/** The same two don't have it out again for this many days (so never two days running). */
export const PAIR_REST_DAYS = 3;
export const CONFRONT_LINES = 6;
const CONFRONT_LINES_MIN = 4;
/** The heard rows a confrontation leaves have sources of their own, apart from any line's ("scene:<id>#0", "#99"). */
const WITNESS_SAW = 0;
const HOUSE_HEARD = 99;

/** The same, as the end of a sentence ("… had it out in the kitchen: they cleared the air."). */
const OUTCOME_WORDS: Record<Outcome, string> = {
  cleared_the_air: "they cleared the air",
  agreed_to_disagree: "they agreed to disagree",
  worse_than_before: "it ended worse than it started",
};

/** A confrontation already staged this season: the day, the two, and what it was over. */
export type Confronted = { day: string; a: string; b: string; kind?: string; about?: string | null };
const samePair = (x: { a: string; b: string }, y: { a: string; b: string }) => (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a);
/**
 * Whether a tension has been had out already this season. The same two over the same thing is staged once; and one
 * untrue story is confronted once, whoever of the people who know better does it (opposing_claims: b holds the untrue
 * one). The two can still meet again over something else.
 */
const spent = (t: Tension, history: readonly Confronted[]): boolean =>
  history.some((h) => h.kind === t.kind && (h.about ?? null) === (t.about ?? null) && (t.kind === "opposing_claims" ? h.b === t.b : samePair(h, t)));

/**
 * Which tension the house stages today (pure), or null: hot enough, both of its people in the house, not had out
 * already this season, inside the week's cadence, and not a pair that had it out in the last PAIR_REST_DAYS. A pair
 * that has never been confronted this season goes before one that has; then the hottest (the order `tensions` gives).
 */
export function pickConfrontation(day: string, all: readonly Tension[], inHouse: readonly string[], history: readonly Confronted[]): Tension | null {
  const week = weekIdOf(new Date(`${day}T12:00:00Z`));
  const thisWeek = history.filter((h) => weekIdOf(new Date(`${h.day}T12:00:00Z`)) === week);
  if (thisWeek.length >= CONFRONTATIONS_A_WEEK) return null;
  const today = Date.parse(`${day}T00:00:00Z`);
  const resting = (t: Tension) => history.some((h) => samePair(h, t) && today - Date.parse(`${h.day}T00:00:00Z`) < PAIR_REST_DAYS * DAY_MS);
  const due = all.filter((t) => t.weight >= CONFRONT_MIN_WEIGHT && t.a !== t.b && inHouse.includes(t.a) && inHouse.includes(t.b) && !resting(t) && !spent(t, history));
  return due.find((t) => !history.some((h) => samePair(h, t))) ?? due[0] ?? null;
}

export type OutcomeFacts = {
  day: string;
  a: string;
  b: string;
  /** What each holds for the other on the trust scale (-2..2); 0 when it has no opinion. */
  trustA: number;
  trustB: number;
  /** Each one's temperament as its sheet reads (lib/temperament.ts sheetSignals). */
  a_signals: { warmth: number; guardedness: number };
  b_signals: { warmth: number; guardedness: number };
};

/** The three results' weights (pure): trust and warmth pull toward clearing the air, distrust and guardedness away. */
export function outcomeWeights(f: OutcomeFacts): Record<Outcome, number> {
  const trust = f.trustA + f.trustB;
  const warm = (f.a_signals.warmth + f.b_signals.warmth) / 2;
  const guarded = (f.a_signals.guardedness + f.b_signals.guardedness) / 2;
  const lean = trust + Math.round((warm - guarded) * 4);
  return { cleared_the_air: Math.max(1, 4 + lean), agreed_to_disagree: 4, worse_than_before: Math.max(1, 4 - lean) };
}

/** How a confrontation ends: dealt by the day and the pair from the weights. The same day and state give the same result. */
export function decideOutcome(f: OutcomeFacts): Outcome {
  const w = outcomeWeights(f);
  let roll = seedFrom("confrontation", f.day, ...[f.a, f.b].sort()) % (w.cleared_the_air + w.agreed_to_disagree + w.worse_than_before);
  for (const o of OUTCOMES) {
    if (roll < w[o]) return o;
    roll -= w[o];
  }
  return "agreed_to_disagree";
}

type Member = { id: string; name: string; bio: string; house: boolean; traits: string[]; voice: string | null; owner_id: string | null };

export type ConfrontFacts = {
  id: string;
  day: string;
  place: HousePlaceId;
  a: Member;
  b: Member;
  /** What it is over, as one plain line of public claims (lib/story-state.ts Tension.line). */
  over: string;
  kind: Tension["kind"];
  outcome: Outcome;
  /** Someone else who was in the room and said nothing, on about half the days there is anyone. */
  witness: Member | null;
};

const CONFRONT_SYSTEM = [
  "You write one short scene for Botchelor, an AI reality-dating show the audience watches.",
  "Evening in the show's house. Two of this season's cast finally have it out, face to face.",
  "",
  `Write exactly ${CONFRONT_LINES} spoken lines, each under 120 characters. The two take turns; the first named speaks first.`,
  "- It is a real argument between two adults who live in the same house: direct, specific, in their own voices (the bio is for voice, not a topic). Sharp, never cruel. PG. No real people, no brands, no internet memes.",
  "- It is about the one thing given. Never invent a date, a secret or anything that happened that is not given.",
  "- Nothing about crime, health, money or sex, about anyone.",
  "- HOW IT ENDS is decided. Write toward it: the last two lines land exactly there.",
  'Reply with JSON only: {"lines": [{"from": "<first name>", "text": "..."}]}',
].join("\n");

const OUTCOME_ASK: Record<Outcome, string> = {
  cleared_the_air: "They clear the air: one of them owns up or explains, the other accepts it, and they end on better terms than they started.",
  agreed_to_disagree: "They agree to disagree: neither gives way, nobody storms off, and they end knowing where the other stands.",
  worse_than_before: "It ends worse than it started: something is said that can't be taken back, and they end further apart. No shouting match, no insults about looks.",
};

/** The writer's facts for a confrontation, as the prompt says them. */
export function confrontPrompt(f: ConfrontFacts): string {
  const place = housePlace(f.place);
  return [
    `Where: ${place.label}, ${place.when}.`,
    `The two (only they speak): ${first(f.a.name)} — ${f.a.bio.slice(0, 90)}; ${first(f.b.name)} — ${f.b.bio.slice(0, 90)}.`,
    `What it is about: ${f.over}`,
    `How it ends: ${OUTCOME_ASK[f.outcome]}`,
    ...(f.witness ? [`${first(f.witness.name)} is in the doorway and says nothing.`] : []),
    "Write the scene.",
  ].join("\n");
}

/** Words that land a scene somewhere other than its decided result, read off its last two lines. */
const ENDS_BADLY = /\b(?:never (?:speak|talk) to me|stay away from me|we(?:'re| are) done|i(?:'m| am) done with you|don'?t (?:ever )?(?:speak|talk) to me|get out|i hate)\b/i;
const ENDS_WELL = /\b(?:we(?:'re| are) good|friends again|truce|forgiven|i forgive you|apology accepted|water under the bridge|hug it out|i(?:'m| am) sorry)\b/i;

/** Whether the lines end where the result says (pure): cleared never ends on a slammed door, worse never on a truce. */
export function fitsOutcome(lines: readonly Pick<SceneLine, "text">[], outcome: Outcome): boolean {
  const end = lines.slice(-2).map((l) => l.text).join(" ");
  if (outcome === "cleared_the_air") return !ENDS_BADLY.test(end);
  if (outcome === "worse_than_before") return !ENDS_WELL.test(end);
  return !ENDS_BADLY.test(end) && !/\b(?:friends again|i forgive you|apology accepted)\b/i.test(end);
}

/** The model's confrontation, checked line by line; null when the call fails, too few lines pass, or it ends elsewhere. */
export async function writeConfrontation(model: Model, f: ConfrontFacts, hidden: readonly string[], onUsage?: (u: Usage) => void): Promise<SceneLine[] | null> {
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: CONFRONT_SYSTEM },
        { role: "user", content: confrontPrompt(f) },
      ],
      { temperature: 0.9, maxTokens: 2000, onUsage },
    );
  } catch {
    return null;
  }
  const parsed = looseLines(raw);
  if (!parsed) return null;
  const lines = parsed
    .slice(0, CONFRONT_LINES + 2)
    .map((r) => basicLine(r, [f.a, f.b], hidden))
    .filter((l): l is SceneLine => l !== null)
    .slice(0, CONFRONT_LINES);
  if (lines.length < CONFRONT_LINES_MIN || new Set(lines.map((l) => l.character_id)).size < 2) return null;
  return fitsOutcome(lines, f.outcome) ? lines : null;
}

/** The $0 confrontation: six plain lines for each result, opened by what it is over. Every line passes the same checks. */
export function templateConfrontation(f: ConfrontFacts): SceneLine[] {
  const a = f.a.id;
  const b = f.b.id;
  const B = first(f.b.name);
  const A = first(f.a.name);
  const open: Record<Tension["kind"], [string, string]> = {
    knows_said: [`${B}. We need to talk about what you've been telling people about me.`, "I repeated what I heard. I didn't make it up."],
    opposing_claims: [`${B}, we can't both be right about what happened.`, "Then one of us was told wrong. I know which one I think it is."],
    rivals: [`${B}. We both know what this is about.`, "We want the same thing. I wasn't going to pretend otherwise."],
    mutual_distrust: [`${B}, I don't trust you. I'd rather say it than smile about it.`, `That makes two of us, ${A}.`],
  };
  const close: Record<Outcome, [string, string, string, string]> = {
    cleared_the_air: ["You could have come to me first.", "I should have. That part is on me.", "Fine. Then it's said, and it's over.", "Over. I'll put the kettle on."],
    agreed_to_disagree: ["You could have come to me first.", "And you could have asked before deciding what I meant.", "We are not going to agree on this.", "No. But now you know where I stand."],
    worse_than_before: ["You could have come to me first.", "I don't answer to you.", "Then I know exactly how much to tell you from now on.", "Nothing would suit me."],
  };
  const texts = [...open[f.kind], ...close[f.outcome]];
  return texts
    .map((text, i) => ({ character_id: i % 2 === 0 ? a : b, text }))
    .filter((l) => checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok && !sensitiveClaim(l.text));
}

/** The take a confrontation leaves when its holder had no words of its own about the other. */
const takeAfter = (outcome: Outcome, other: string): string =>
  outcome === "cleared_the_air"
    ? `We had it out, and I think better of ${first(other)} for it.`
    : outcome === "worse_than_before"
      ? `We had it out, and I trust ${first(other)} less than I did.`
      : `${first(other)} and I don't agree, but at least it has been said.`;

/**
 * What a confrontation changes, only through the story state: trust one step each way (up when they cleared the air,
 * down when it got worse; agreeing to disagree moves nothing), every unsettled knows_you_said fact between the two
 * closed, and, when someone watched, their row and the rest of the house's (told by them). Idempotent per scene.
 */
export async function applyConfrontation(db: Db, f: ConfrontFacts, now: Date): Promise<Pick<ConfrontResult, "moved" | "settled">> {
  const source = `scene:${f.id}`;
  const step = f.outcome === "cleared_the_air" ? 1 : f.outcome === "worse_than_before" ? -1 : 0;
  const moved: ConfrontResult["moved"] = [];
  for (const [holder, about] of [
    [f.a, f.b],
    [f.b, f.a],
  ] as const) {
    const cur = (
      await db.query<{ trust: number; attraction: number | null; take: string; basis: string; source: string | null }>(
        `select trust, attraction, take, basis, source from character_opinions where holder_id = $1 and about_id = $2 and forgotten_at is null`,
        [holder.id, about.id],
      )
    ).rows[0];
    if (!step || cur?.source === source) continue;
    const from = cur?.trust ?? 0;
    const to = Math.max(-2, Math.min(2, from + step));
    // Face to face is firsthand now. Its own words about the person stay when it had any of its own.
    const wrote = await setOpinion(db, {
      holder: holder.id,
      about: about.id,
      trust: to,
      attraction: cur?.attraction ?? null,
      take: cur && cur.basis === "firsthand" ? cur.take : takeAfter(f.outcome, about.name),
      basis: "firsthand",
      source,
      at: now,
    });
    if (wrote) moved.push({ holder: holder.id, about: about.id, from, to });
  }
  let settled = 0;
  for (const [knower, sayer] of [
    [f.a.id, f.b.id],
    [f.b.id, f.a.id],
  ] as const) {
    for (const k of await knownSaid(db, knower, { unsettledOnly: true })) if (k.said_by_id === sayer && (await settleKnown(db, k.id, source))) settled++;
  }
  // Someone watched: they know it happened (nobody told them), and the rest of the house hears it from them.
  if (f.witness) {
    const claim = `${first(f.a.name)} and ${first(f.b.name)} had it out ${housePlace(f.place).at}: ${OUTCOME_WORDS[f.outcome]}.`;
    const leans = f.outcome === "cleared_the_air" ? 1 : f.outcome === "worse_than_before" ? -1 : 0;
    await hear(db, { holder: f.witness.id, about: f.a.id, aboutB: f.b.id, claim, toldBy: null, source: sceneSource(f.id, WITNESS_SAW), isTrue: true, leans, at: now });
    const rest = (await db.query<{ id: string }>(`select id from characters where id = any($1) and visibility = 'public'`, [showCastIds(now)])).rows
      .map((r) => r.id)
      .filter((id) => id !== f.a.id && id !== f.b.id && id !== f.witness!.id);
    for (const holder of rest) await hear(db, { holder, about: f.a.id, aboutB: f.b.id, claim, toldBy: f.witness.id, source: sceneSource(f.id, HOUSE_HEARD), isTrue: true, leans, at: now });
  }
  return { moved, settled };
}

async function membersOf(db: Db, ids: readonly string[]): Promise<Map<string, Member>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<Member>(
    `select id, name, bio, is_house as house, traits, voice, owner_id from characters where id = any($1) and visibility = 'public'`,
    [[...ids]],
  );
  return new Map(rows.map((r) => [r.id, { ...r, traits: Array.isArray(r.traits) ? r.traits : [] }]));
}

export type ConfrontationWritten =
  | { id: string; source: "model" | "template"; outcome: Outcome; over: Tension["kind"]; moved: number; settled: number; cost_usd: number | null; notified: number; texted: number }
  | { skipped: "off" | "early" | "already" | "none_due" };

/**
 * The hourly lobby job's part: stages today's confrontation, once, on the first pass from the scene hour on, when a
 * tension is due (pickConfrontation). The row is claimed first; a day with nothing due keeps an empty row so the job
 * asks once. The result is decided before the writer is called, and the state changes whether the model wrote the
 * lines or the template did.
 */
export async function ensureConfrontation(
  db: Db,
  now: Date = new Date(),
  opts: { model?: Model; env?: Record<string, string | undefined>; anyHour?: boolean } = {},
): Promise<ConfrontationWritten> {
  const env = opts.env ?? process.env;
  if (!confrontationsOn(env)) return { skipped: "off" };
  if (!opts.anyHour && now.getUTCHours() < houseSceneHourUtc(env)) return { skipped: "early" };
  const day = dayOf(now);
  const id = sceneIdOf(day, "confrontation");
  if (!(await claimScene(db, id, day, "confrontation", now))) return { skipped: "already" };
  const seasonId = seasonIdOf(now);
  const cast = await membersOf(db, showCastIds(now));
  const history: Confronted[] = (
    await db.query<{ day: string; result: ConfrontResult | null; tension: { kind?: string; about?: string | null } | null }>(
      `select day, result, tension from house_scenes where kind = 'confrontation' and source in ('model', 'template') and season_id = $1`,
      [seasonId],
    )
  ).rows.flatMap((r) => (r.result ? [{ day: r.day, a: r.result.a, b: r.result.b, kind: r.tension?.kind ?? r.result.over, about: r.tension?.about ?? null }] : []));
  const all = await tensions(db, seasonId, { now }).catch(() => [] as Tension[]);
  // The producer's beat for the day goes first when it names two who are due; the state's own order after it.
  const beat = await beatFor(db, day, env);
  const ordered = beat ? [...all.filter((t) => samePair(t, beat)), ...all.filter((t) => !samePair(t, beat))] : all;
  const tension = pickConfrontation(day, ordered, [...cast.keys()], history);
  if (!tension) {
    await quietScene(db, id, now);
    return { skipped: "none_due" };
  }
  const a = cast.get(tension.a)!;
  const b = cast.get(tension.b)!;
  const trusts = (
    await db.query<{ holder_id: string; trust: number }>(
      `select holder_id, trust from character_opinions where forgotten_at is null and ((holder_id = $1 and about_id = $2) or (holder_id = $2 and about_id = $1))`,
      [a.id, b.id],
    )
  ).rows;
  const outcome = decideOutcome({
    day,
    a: a.id,
    b: b.id,
    trustA: trusts.find((t) => t.holder_id === a.id)?.trust ?? 0,
    trustB: trusts.find((t) => t.holder_id === b.id)?.trust ?? 0,
    a_signals: sheetSignals({ traits: a.traits, voice: a.voice }),
    b_signals: sheetSignals({ traits: b.traits, voice: b.voice }),
  });
  const others = [...cast.values()].filter((c) => c.id !== a.id && c.id !== b.id);
  const facts: ConfrontFacts = {
    id,
    day,
    place: HOUSE_PLACES[seedFrom("confrontation", day, "place") % HOUSE_PLACES.length].id,
    a,
    b,
    over: tension.line,
    kind: tension.kind,
    outcome,
    witness: others.length && seedFrom("confrontation", day, "witness") % 2 === 0 ? others[seedFrom("confrontation", day, "who") % others.length] : null,
  };
  const hidden = (await Promise.all([...cast.keys()].map((c) => hiddenCastSecrets(db, c, now).catch(() => [] as string[])))).flat();
  const model = opts.model ?? (houseVoiceOn() ? houseWriter() : null);
  const usage: Usage[] = [];
  const written = model ? await writeConfrontation(model, facts, hidden, (u) => usage.push(u)) : null;
  const lines = written ?? templateConfrontation(facts).filter((l) => !hidden.some((s) => slipped(l.text, s)));
  const effects = await applyConfrontation(db, facts, now);
  const result: ConfrontResult = { kind: "confrontation", outcome, over: tension.kind, a: a.id, b: b.id, witness: facts.witness?.id ?? null, moved: effects.moved, settled: effects.settled };
  const spent = summarizeUsage(usage, model ? 1 : 0, now);
  await storeScene(db, id, {
    place: facts.place,
    cast: [a.id, b.id, ...(facts.witness ? [facts.witness.id] : [])],
    lines,
    told: [],
    source: written ? "model" : "template",
    spent,
    tension: { kind: tension.kind, a: tension.a, b: tension.b, about: tension.about },
    result,
    now,
  });
  const owners = await tellParticipants(db, { id, people: [a, b], title: (me, other) => `🏠 ${first(me.name)} had it out with ${first(other.name)} in the house`, body: `${OUTCOME_LABELS[outcome]}.` });
  const texted = await textAboutScene(db, id, now, env);
  return { id, source: written ? "model" : "template", outcome, over: tension.kind, moved: effects.moved.length, settled: effects.settled, cost_usd: spent.cost_usd, ...owners, texted };
}

/**
 * The owners of people's characters who were IN a scene hear (a confrontation's two, a challenge's winner): a
 * `house_talk` notification each, once per scene. Never throws. The character's own text is textAboutScene's.
 */
async function tellParticipants(
  db: Db,
  s: { id: string; people: readonly Member[]; title: (me: Member, other: Member) => string; body: string },
): Promise<{ notified: number }> {
  const done = { notified: 0 };
  try {
    const { notify } = await import("./notifications");
    const link = scenePath(s.id);
    const seen = new Set<string>();
    for (const me of s.people) {
      const other = s.people.find((p) => p.id !== me.id) ?? me;
      const owner = me.owner_id;
      if (me.house || !owner || owner === "deleted" || seen.has(owner)) continue;
      seen.add(owner);
      const had = await db.query(`select 1 from notifications where user_id = $1 and kind = 'house_talk' and link = $2 limit 1`, [owner, link]);
      if (had.rows.length) continue;
      await notify(db, owner, { kind: "house_talk", title: s.title(me, other), body: s.body, link });
      done.notified++;
    }
  } catch (err) {
    console.error("[house-conflict] could not tell the owners:", err instanceof Error ? err.message : "unknown");
  }
  return done;
}

/* ------------------------------------------------ challenges ------------------------------------------------ */

/** The day of the week (UTC, 0 = Sunday) the house holds its challenge: Wednesday. Sunday has the roses. */
export const CHALLENGE_WEEKDAY = 3;
export const CHALLENGE_MIN = 3;
export const CHALLENGE_MAX = 5;
export const CHALLENGE_LINES_MIN = 8;
export const CHALLENGE_LINES_MAX = 10;

export type ChallengeDef = {
  id: string;
  /** The roleplay in the show's catalog (lib/roleplays.ts) whose premise this is, played by the whole room. */
  roleplay: string;
  title: string;
  /** What the room is asked to do, in one line. */
  ask: string;
  /** The traits the premise favours: each one a contestant has counts toward winning. */
  favours: readonly string[];
};

export const CHALLENGES: readonly ChallengeDef[] = [
  { id: "cook-off", roleplay: "rival-chefs", title: "The cook-off", ask: "Everyone cooks one dish from whatever is in the house kitchen, and the plates are judged blind.", favours: ["generous", "precise", "exacting", "tireless", "capable", "patient", "meticulous", "kind", "warm", "tender", "gentle", "determined"] },
  { id: "quiz", roleplay: "quiz-partners", title: "The quiz about each other", ask: "Every question is about someone else in the house: who has actually been paying attention?", favours: ["curious", "observant", "nosy", "brilliant", "honest", "loyal", "quick", "fair", "earnest", "quiet"] },
  { id: "talent-night", roleplay: "old-film", title: "Talent night", ask: "Each of them plays a scene from a black-and-white film, with whatever the house has for props.", favours: ["dramatic", "theatrical", "charming", "loud", "fearless", "vain", "regal", "wry", "deadpan", "easy", "hopeful"] },
  { id: "treasure-hunt", roleplay: "treasure-map", title: "The treasure hunt", ask: "Half a map each and one prize hidden somewhere in the house: first to find it wins.", favours: ["competitive", "driven", "determined", "brave", "reckless", "restless", "stubborn", "scheming", "capable", "fearless", "unflappable"] },
];

/** This week's challenge: the premises take turns week by week, so no two weeks running have the same one. */
export function challengeOf(week: string): ChallengeDef {
  const weekNumber = Math.round(Date.parse(`${week}T00:00:00Z`) / (7 * DAY_MS));
  return CHALLENGES[((weekNumber % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length];
}

/** A contestant's score (pure): three for each of their traits the premise favours, and up to four dealt by the week. */
export function challengeScore(c: Pick<Member, "id" | "traits">, def: ChallengeDef, week: string): number {
  const traits = c.traits.map((t) => t.toLowerCase().trim());
  const fit = def.favours.filter((f) => traits.includes(f)).length;
  return fit * 3 + (seedFrom("challenge-roll", week, def.id, c.id) % 1000) / 250;
}

/** Who wins (pure): the best score, ties to the earlier id. Decided by who they are and the week, never by a vote. */
export function challengeWinner<T extends Pick<Member, "id" | "traits">>(contestants: readonly T[], def: ChallengeDef, week: string): T {
  return [...contestants].sort((x, y) => challengeScore(y, def, week) - challengeScore(x, def, week) || x.id.localeCompare(y.id))[0];
}

export type ChallengeFacts = {
  id: string;
  day: string;
  week: string;
  place: HousePlaceId;
  def: ChallengeDef;
  contestants: Member[];
  winner: Member;
  /** What the winner gets, in words for the prompt and the page. */
  prize: string;
};

const CHALLENGE_SYSTEM = [
  "You write one short scene for Botchelor, an AI reality-dating show the audience watches.",
  "This week's house challenge: a few of this season's cast compete, out loud, in the show's house.",
  "",
  `Write ${CHALLENGE_LINES_MIN} to ${CHALLENGE_LINES_MAX} spoken lines, each under 120 characters. Everyone listed speaks at least once.`,
  "- It is a game between adults who live together: trash talk, small disasters, one moment of real skill. Each sounds like themselves (the bio is for voice, not a topic). Playful, never cruel. PG. No real people, no brands, no internet memes.",
  "- Never mention a date, a secret, or anything about crime, health, money or sex.",
  "- WHO WINS is decided. Write toward it: the winner earns it in the scene, and the last line makes it plain who won. Nobody else is said to win.",
  'Reply with JSON only: {"lines": [{"from": "<first name>", "text": "..."}]}',
].join("\n");

export function challengePrompt(f: ChallengeFacts): string {
  const place = housePlace(f.place);
  return [
    `Where: ${place.label}.`,
    `The challenge: ${f.def.title}. ${f.def.ask}`,
    `Competing (only these people speak): ${f.contestants.map((c) => `${first(c.name)} — ${c.bio.slice(0, 80)}`).join("; ")}.`,
    `The winner: ${first(f.winner.name)}. The prize: ${f.prize}`,
    "Write the scene.",
  ].join("\n");
}

const WIN_WORDS = /\b(?:wins?|won|winner|takes it|victory|champion|first place)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (text: string, name: string) => new RegExp(`(?<![\\p{L}])${escapeRe(first(name))}(?![\\p{L}])`, "iu").test(text);

/** Whether a line hands the win to someone who didn't win (pure): it talks of winning and names another contestant, not the winner. */
export function namesWrongWinner(text: string, f: Pick<ChallengeFacts, "contestants" | "winner">): boolean {
  if (!WIN_WORDS.test(text) || names(text, f.winner.name)) return false;
  return f.contestants.some((c) => c.id !== f.winner.id && names(text, c.name));
}

/** The model's challenge, checked line by line; null when the call fails, too few lines pass, or the winner isn't in it. */
export async function writeChallenge(model: Model, f: ChallengeFacts, hidden: readonly string[], onUsage?: (u: Usage) => void): Promise<SceneLine[] | null> {
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: CHALLENGE_SYSTEM },
        { role: "user", content: challengePrompt(f) },
      ],
      { temperature: 0.9, maxTokens: 2400, onUsage },
    );
  } catch {
    return null;
  }
  const parsed = looseLines(raw);
  if (!parsed) return null;
  const lines = parsed
    .slice(0, CHALLENGE_LINES_MAX + 3)
    .map((r) => basicLine(r, f.contestants, hidden))
    .filter((l): l is SceneLine => l !== null && !namesWrongWinner(l.text, f))
    .slice(0, CHALLENGE_LINES_MAX);
  if (lines.length < CHALLENGE_LINES_MIN || new Set(lines.map((l) => l.character_id)).size < Math.min(3, f.contestants.length)) return null;
  // The winner is in the scene: they speak, or the scene names them.
  return lines.some((l) => l.character_id === f.winner.id || names(l.text, f.winner.name)) ? lines : null;
}

const CHALLENGE_BEATS: Record<string, [string, string, string]> = {
  "cook-off": ["One dish each, judged blind. Nobody touch my pan.", "Something is on fire, and I would like it noted that it is not mine.", "That is not a sauce. That is a cry for help."],
  quiz: ["Every question is about one of us. I have been taking notes since day one.", "Whose favourite mug is the chipped one? Anyone? It's mine. It has always been mine.", "You live with me and you don't know how I take my tea."],
  "talent-night": ["A scene from an old film, with props from the hall cupboard. Places, everyone.", "I am holding a mop and you will believe it is a lamppost in the rain.", "That was not a pause. That was acting."],
  "treasure-hunt": ["Half a map each, and one prize somewhere in this house. Go.", "It is not under the sofa. I have now been under the sofa twice.", "Whoever drew this map has never seen a staircase."],
};

/** The $0 challenge: eight plain lines for any premise and any three to five contestants, ending on the winner. */
export function templateChallenge(f: ChallengeFacts): SceneLine[] {
  const c = f.contestants;
  const W = first(f.winner.name);
  const others = c.filter((x) => x.id !== f.winner.id);
  const [open, mid, jab] = CHALLENGE_BEATS[f.def.id] ?? CHALLENGE_BEATS["cook-off"];
  const say = (who: Member, text: string): SceneLine => ({ character_id: who.id, text });
  const lines = [
    say(others[0], `${f.def.title}. ${open}`),
    say(f.winner, "I'm not here to make friends. I'm here to make an effort."),
    say(others[1 % others.length], mid),
    say(others[0], jab),
    say(others[others.length - 1], `Has anyone seen what ${W} is doing? Because it's working.`),
    say(f.winner, "I would rather not explain it while it's going well."),
    say(others[1 % others.length], "I demand a recount. I don't know of what."),
    say(others[0], `Fine. ${W} wins. Fair and square, and I hate it.`),
  ];
  return lines.filter((l) => checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok && !sensitiveClaim(l.text));
}

export type ChallengeWritten =
  | { id: string; source: "model" | "template"; challenge: string; winner: string; prize_day: string; cost_usd: number | null; notified: number; texted: number }
  | { skipped: "off" | "early" | "already" | "not_today" | "too_few" };

/**
 * Whom the winner picks for the next day's house date on a season without a lead (pure): the one this week's want is
 * about, else whoever of the cast they are most drawn to, else the first of the cast in billing order.
 */
export function firstPick(winner: string, cast: readonly string[], want: string | null, drawn: readonly { about: string; attraction: number | null; trust: number }[]): string | null {
  const others = cast.filter((id) => id !== winner);
  if (want && others.includes(want)) return want;
  const best = [...drawn].filter((o) => others.includes(o.about) && (o.attraction ?? 0) >= 1).sort((x, y) => (y.attraction ?? 0) - (x.attraction ?? 0) || y.trust - x.trust || x.about.localeCompare(y.about))[0];
  return best?.about ?? others[0] ?? null;
}

/**
 * The hourly lobby job's part: holds the week's challenge, once, on CHALLENGE_WEEKDAY from the scene hour on. The
 * winner is decided before the writer is called; the prize (house_prizes) is the next day's one-on-one.
 */
export async function ensureChallenge(
  db: Db,
  now: Date = new Date(),
  opts: { model?: Model; env?: Record<string, string | undefined>; anyHour?: boolean; anyDay?: boolean } = {},
): Promise<ChallengeWritten> {
  const env = opts.env ?? process.env;
  if (!challengesOn(env)) return { skipped: "off" };
  if (!opts.anyDay && now.getUTCDay() !== CHALLENGE_WEEKDAY) return { skipped: "not_today" };
  if (!opts.anyHour && now.getUTCHours() < houseSceneHourUtc(env)) return { skipped: "early" };
  const day = dayOf(now);
  const week = weekIdOf(now);
  const id = sceneIdOf(day, "challenge");
  if (!(await claimScene(db, id, day, "challenge", now))) return { skipped: "already" };
  // On a Botchelor season the suitors compete for the lead's next date; otherwise the whole cast for first pick.
  const house = leadAndSuitors(now);
  const pool = await membersOf(db, house ? house.suitors : showCastIds(now));
  const order = house ? house.suitors : showCastIds(now);
  let contestants = order.map((cid) => pool.get(cid)).filter((c): c is Member => Boolean(c));
  if (contestants.length > CHALLENGE_MAX) {
    contestants = [...contestants].sort((x, y) => seedFrom("challenge-seat", week, x.id) - seedFrom("challenge-seat", week, y.id)).slice(0, CHALLENGE_MAX);
  }
  if (contestants.length < CHALLENGE_MIN) {
    await quietScene(db, id, now);
    return { skipped: "too_few" };
  }
  const def = challengeOf(week);
  const winner = challengeWinner(contestants, def, week);
  const prizeDay = dayOf(new Date(now.getTime() + DAY_MS));
  let partner: string | null = house?.lead ?? null;
  if (!house) {
    const [want, drawn] = await Promise.all([
      db.query<{ about_id: string | null }>(`select about_id from character_wants where holder_id = $1 and week_id = $2 and kind in ('pursue', 'win_back')`, [winner.id, week]),
      db.query<{ about: string; attraction: number | null; trust: number }>(`select about_id as about, attraction, trust from character_opinions where holder_id = $1 and forgotten_at is null`, [winner.id]),
    ]);
    partner = firstPick(winner.id, [...(await membersOf(db, showCastIds(now))).keys()].sort((x, y) => showCastIds(now).indexOf(x) - showCastIds(now).indexOf(y)), want.rows[0]?.about_id ?? null, drawn.rows);
  }
  const partnerName = partner ? ((await db.query<{ name: string }>(`select name from characters where id = $1`, [partner])).rows[0]?.name ?? null) : null;
  const prizeOf: ChallengeResult["prize"] = { day: prizeDay, with: partner, kind: house ? "lead_date" : "first_pick" };
  const prize = `${prizeWords(prizeOf, partnerName)}.`;
  const facts: ChallengeFacts = { id, day, week, place: HOUSE_PLACES[seedFrom("challenge", day, "place") % HOUSE_PLACES.length].id, def, contestants, winner, prize };
  const hidden = (await Promise.all(showCastIds(now).map((c) => hiddenCastSecrets(db, c, now).catch(() => [] as string[])))).flat();
  const model = opts.model ?? (houseVoiceOn() ? houseWriter() : null);
  const usage: Usage[] = [];
  const written = model ? await writeChallenge(model, facts, hidden, (u) => usage.push(u)) : null;
  const lines = written ?? templateChallenge(facts).filter((l) => !hidden.some((s) => slipped(l.text, s)));
  const result: ChallengeResult = { kind: "challenge", challenge: def.id, title: def.title, winner: winner.id, prize: prizeOf };
  const spent = summarizeUsage(usage, model ? 1 : 0, now);
  await storeScene(db, id, { place: facts.place, cast: contestants.map((c) => c.id), lines, told: [], source: written ? "model" : "template", spent, tension: null, result, now });
  // The prize: the next day's one-on-one (lib/season-cast.ts reads it for the rotation and the lobby's first date).
  await db.query(
    `insert into house_prizes (day, season_id, winner_id, with_id, kind, title, scene_id) values ($1, $2, $3, $4, $5, $6, $7) on conflict (day) do nothing`,
    [prizeDay, seasonIdOf(now), winner.id, partner, result.prize.kind, def.title, id],
  );
  forgetLoadedSeasonCast();
  const owners = await tellParticipants(db, { id, people: [winner], title: (me) => `🏆 ${first(me.name)} won ${def.title.replace(/^The /, "the ")}`, body: `The prize: ${prize}` });
  const texted = await textAboutScene(db, id, now, env);
  return { id, source: written ? "model" : "template", challenge: def.id, winner: winner.id, prize_day: prizeDay, cost_usd: spent.cost_usd, ...owners, texted };
}

/** Every roleplay a challenge borrows its premise from is in the show's catalog (tests pin it). */
export const challengeRoleplay = (def: ChallengeDef) => DATE_ROLEPLAYS.find((r) => r.id === def.roleplay) ?? null;
