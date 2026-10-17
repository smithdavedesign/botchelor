/**
 * Assembles a date from stored data and the owner's settings, runs the deterministic engine, and
 * keeps the persistent relationship between a pair up to date. The episodes route calls buildDate()
 * then getEngine().decide(), then narrateEpisode(). Souls and relationship memory live only here and
 * in the engine; they are never sent to spectators.
 */
import { endingWhy } from "./why";
import { shortName } from "./names";
import type { Db } from "./db";
import {
  CURRENT_ENGINE_VERSION,
  deriveSoulSignals,
  deterministicEngine,
  NEUTRAL_SIGNALS,
  seedFrom,
  type CharacterSheet,
  type DateHistory,
  type DateInput,
  type Outcome,
  type SideSetup,
  type SoulSignals,
} from "./engine";
import type { BoxScore, DateSetup } from "./game";
import { assembleCharacter, type Character } from "./character";
import type { CharacterExtras } from "./extras";
import { thisWeek, type StoredThisWeek } from "./life";
import { loadCharacterMemory, type CharacterMemory } from "./memory";
import { activeNudge, alsoSeeing } from "./between-dates";
import { engineHistory, loadRelationship, pairContext, pairSharedWords, refreshRelationship, venueForPlan, type Relationship } from "./relationships";
import { loadSoul, type StoredSoul } from "./souls";
import {
  AGENDA_IDS,
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
  PRODUCER_IDS,
  type AgendaId,
  type Autonomy,
  type Ending,
  type GameBudget,
  type ProducerId,
  type SlidingDoorChange,
  type Strategy,
} from "./rules";
import { pickVenue, type VenueId } from "./venues";
import { DEFAULT_FORMAT, type FormatId } from "./formats";
import { HOUSE_CHARACTERS } from "./house";

export type CharacterForDate = { id: string; sheet: CharacterSheet };

export type DateRequest = {
  autonomy: Autonomy;
  strategy: Strategy;
  gameBudget: GameBudget;
  /** The owner's chosen agenda for their side; null means the show deals one. */
  agendaId: AgendaId | null;
  note: string | null;
  /** The show format (lib/formats.ts): cosmetic framing only, never the engine. Defaults to classic. */
  format: FormatId;
};

export const DEFAULT_DATE_REQUEST: DateRequest = {
  autonomy: DEFAULT_AUTONOMY,
  strategy: DEFAULT_STRATEGY,
  gameBudget: DEFAULT_GAME_BUDGET,
  agendaId: null,
  note: null,
  format: DEFAULT_FORMAT,
};

const pickAgenda = (seed: number): AgendaId => AGENDA_IDS[seed % AGENDA_IDS.length];
const pickProducer = (seed: number): ProducerId => PRODUCER_IDS[seed % PRODUCER_IDS.length];

/** A real house regular to play the meet-the-parents chaperone: dealt by seed, never one of the two daters. */
function pickChaperone(seed: number, excludeIds: string[]): string {
  const pool = HOUSE_CHARACTERS.filter((c) => !excludeIds.includes(c.id));
  return (pool[seed % pool.length] ?? HOUSE_CHARACTERS[0]).name;
}

/**
 * The ex-returns format's real ex: A's most recent OTHER past partner from the relationship graph — one it once had a
 * second date with when there is one. Public edges only, so a private date's partner never turns up on air.
 */
async function findEx(db: Db, aId: string, bId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ name: string }>(
    `select case when r.character_a = $1 then cb.name else ca.name end as name
       from relationships r
       join characters ca on ca.id = r.character_a
       join characters cb on cb.id = r.character_b
      where $1 in (r.character_a, r.character_b) and $2 not in (r.character_a, r.character_b) and r.public_dates > 0
      order by (r.public_second_dates > 0) desc, r.public_last_at desc nulls last limit 1`,
    [aId, bId],
  );
  return rows[0]?.name;
}

/** The engine's view of the pair's history, from the relationship graph (every date between them). */
async function loadHistory(db: Db, aId: string, bId: string): Promise<DateHistory | undefined> {
  return engineHistory(await loadRelationship(db, aId, bId));
}

export type BuiltDate = {
  input: DateInput;
  /** The two fully-assembled characters (identity + soul + learned memory): what the LLM prompts consume. */
  characters: [Character, Character];
  /** Always carries the dealt venue: DateSetup.venue is only optional for episodes stored before it existed. */
  setup: DateSetup & { venue: VenueId };
  seed: number;
};

/** Everything a date is assembled from, already loaded: the pure core of buildDate (no database). */
export type DateParts = {
  episodeId: string;
  a: CharacterForDate;
  b: CharacterForDate;
  req: DateRequest;
  seed: number;
  soulA: StoredSoul | null;
  soulB: StoredSoul | null;
  memoryA: CharacterMemory | null;
  memoryB: CharacterMemory | null;
  history: DateHistory | undefined;
  /** ex_returns: the name of A's real ex from the relationship graph, when there is one. */
  ex?: string;
  /** See buildDate: the snapshot a worker re-decides on. */
  signalsOverride?: { a: SoulSignals; b: SoulSignals };
  /** Each side's optional details (lib/extras.ts). Dialogue flavour only: the engine never reads them. */
  extrasA?: CharacterExtras | null;
  extrasB?: CharacterExtras | null;
  /** What's new in each side's life this week (lib/life.ts). Dialogue flavour only. */
  thisWeekA?: string | null;
  thisWeekB?: string | null;
  /**
   * The pair's edge in the relationship graph (lib/relationships.ts), who set this date up (it decides which past
   * dates each side may bring in: the public record plus that creator's own), and, for a second date, the date
   * whose plan it is. All optional: without them a date is built exactly as before.
   */
  relationship?: Relationship | null;
  creatorId?: string;
  followupOf?: string | null;
  /** Each owner's standing nudge about the other, and who else each is seeing (public). Flavour only. */
  nudges?: { a: string | null; b: string | null };
  alsoSeeing?: { a: string[]; b: string[] };
};

/**
 * Assembles a date from parts that are already loaded. Pure and deterministic: the same parts and seed give
 * the same date. buildDate loads the parts from the database; the quality eval (lib/eval.ts) passes them in
 * directly, so it can generate dates without touching any stored data.
 */
export function assembleDate(p: DateParts): BuiltDate {
  const { a, b, req, seed } = p;
  const charA = assembleCharacter({ id: a.id, sheet: a.sheet, soul: p.soulA, memory: p.memoryA, extras: p.extrasA, thisWeek: p.thisWeekA });
  const charB = assembleCharacter({ id: b.id, sheet: b.sheet, soul: p.soulB, memory: p.memoryB, extras: p.extrasB, thisWeek: p.thisWeekB });
  // Each side's own view of the relationship (never the other's private wish), and the words both already know.
  if (p.relationship && p.creatorId !== undefined) {
    charA.pair = pairContext(p.relationship, a.id, p.creatorId, p.followupOf ?? null);
    charB.pair = pairContext(p.relationship, b.id, p.creatorId, p.followupOf ?? null);
    charA.pairShared = charB.pairShared = pairSharedWords(p.relationship, p.creatorId);
  }
  if (p.nudges?.a) charA.nudge = p.nudges.a;
  if (p.nudges?.b) charB.nudge = p.nudges.b;
  if (p.alsoSeeing?.a.length) charA.alsoSeeing = p.alsoSeeing.a;
  if (p.alsoSeeing?.b.length) charB.alsoSeeing = p.alsoSeeing.b;
  // A second date happens where they planned it, when the plan names a kind of place we have, unless their last two
  // dates were both there already: a running joke about tea shouldn't keep a couple in the same café for good.
  const plans = p.followupOf ? (p.relationship?.plans ?? []).filter((x) => x.episode_id === p.followupOf) : [];
  const planned = venueForPlan(plans);
  const recentVenues = (p.relationship?.history ?? []).slice(-2).map((h) => h.venue);
  const plannedVenue = planned && !(recentVenues.length === 2 && recentVenues.every((v) => v === planned)) ? planned : null;
  // The effective engine signals this date runs on: the base soul/image signals nudged by the learned
  // memory's bounded drift (lib/character.ts), so a bot genuinely evolves across its dates. A worker
  // rebuilding a stored date passes the snapshot so it re-decides EXACTLY what POST stored.
  const signalsA = p.signalsOverride?.a ?? charA.signals;
  const signalsB = p.signalsOverride?.b ?? charB.signals;
  const agendaA = req.agendaId ?? pickAgenda(seedFrom(seed, "agenda-a"));
  const agendaB = pickAgenda(seedFrom(seed, "agenda-b"));
  const setup: DateSetup & { venue: VenueId } = {
    autonomy: req.autonomy,
    strategy: req.strategy,
    agenda_a: agendaA,
    agenda_b: agendaB,
    game_budget_a: req.gameBudget,
    game_budget_b: DEFAULT_GAME_BUDGET,
    producer: pickProducer(seedFrom(seed, "producer")),
    venue: plannedVenue ?? pickVenue(seedFrom(seed, "venue")),
    format: req.format,
    // Snapshot the exact effective signals this date ran on, so a replay reproduces it even after memory drifts.
    signals_a: signalsA,
    signals_b: signalsB,
    // ...and the sheets it read, since a character can be edited after its date.
    sheet_a: a.sheet,
    sheet_b: b.sheet,
    // ...and the engine calibration that decides it, for the same reason.
    engine_version: CURRENT_ENGINE_VERSION,
    // ...and the pair's history as the engine read it, so a replay sees the relationship as it stood that night.
    ...(p.history ? { history: p.history } : {}),
    ...(p.followupOf ? { followup_of: p.followupOf, plan: plans.map((x) => x.text) } : {}),
    ...(p.nudges?.a ? { nudge_a: p.nudges.a } : {}),
    ...(p.nudges?.b ? { nudge_b: p.nudges.b } : {}),
  };
  // Fill the format's cast from real data (flavour only, never the engine): a named house regular as the
  // meet-the-parents chaperone, and a real past partner as the returning ex when the graph has one.
  if (req.format === "meet_the_parents") setup.chaperone = pickChaperone(seedFrom(seed, "chaperone"), [a.id, b.id]);
  if (req.format === "ex_returns") setup.ex = p.ex;
  // The engine itself is unchanged (still deterministic given signals); only its input signals now carry
  // the learned drift, and setup.signals_a/b above snapshots exactly what it ran on for reproducible replays.
  const sideA: SideSetup = {
    sheet: a.sheet,
    signals: signalsA,
    autonomy: req.autonomy,
    strategy: req.strategy,
    agendaId: agendaA,
    note: req.note,
    gameBudget: req.gameBudget,
  };
  const sideB: SideSetup = {
    sheet: b.sheet,
    signals: signalsB,
    autonomy: DEFAULT_AUTONOMY,
    strategy: DEFAULT_STRATEGY,
    agendaId: agendaB,
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
  return { input: { a: sideA, b: sideB, history: p.history }, characters: [charA, charB], setup, seed };
}

/**
 * Builds the full engine input for one date. The seed comes from the episode id, so the outcome is
 * reproducible and a Sliding Doors replay can reuse it with one input changed. Side A is the owner's;
 * side B (a house character or another user's OC) plays on balanced defaults with a dealt agenda.
 */
export async function buildDate(
  db: Db,
  episodeId: string,
  a: CharacterForDate,
  b: CharacterForDate,
  req: DateRequest,
  seedOverride?: number,
  /**
   * The exact effective signals to run on, instead of recomputing them from current memory. The async
   * worker passes the snapshot POST stored (setup.signals_a/b) so it re-decides the SAME canonical outcome
   * even if a character's memory has since drifted (e.g. a concurrent template date). Omitted at POST time.
   */
  signalsOverride?: { a: SoulSignals; b: SoulSignals },
  /**
   * Who set the date up (the relationship layer each side may draw on), the date this is the second date of, and the
   * pair history to run on instead of today's (the worker passes the snapshot POST stored, like the signals).
   */
  opts: {
    creatorId?: string;
    followupOf?: string | null;
    historyOverride?: DateHistory | null;
    legacyHistory?: boolean;
    /** The nudges as booked (the worker passes the setup's snapshot: by then they've been used). */
    nudges?: { a: string | null; b: string | null };
  } = {},
): Promise<BuiltDate> {
  const [soulA, soulB, memoryA, memoryB, relationship, ex, extras, nudges, seeingA, seeingB] = await Promise.all([
    loadSoul(db, a.id),
    loadSoul(db, b.id),
    loadCharacterMemory(db, a.id),
    loadCharacterMemory(db, b.id),
    loadRelationship(db, a.id, b.id),
    req.format === "ex_returns" ? findEx(db, a.id, b.id) : Promise.resolve(undefined),
    // Loaded here, beside the soul and memory, so every path that builds a date gets the details.
    db.query<{ id: string; extras: CharacterExtras | null; this_week: StoredThisWeek | null }>(
      `select id, extras, this_week from characters where id = any($1)`,
      [[a.id, b.id]],
    ),
    opts.nudges
      ? Promise.resolve(opts.nudges)
      : Promise.all([activeNudge(db, a.id, b.id), activeNudge(db, b.id, a.id)]).then(([x, y]) => ({ a: x, b: y })),
    alsoSeeing(db, a.id, b.id).catch(() => []),
    alsoSeeing(db, b.id, a.id).catch(() => []),
  ]);
  const rowOf = (id: string) => extras.rows.find((r) => r.id === id);
  // A worker re-deciding a stored date passes its snapshot; a date stored before snapshots ran on dates + last ending.
  const current = engineHistory(relationship);
  const history =
    opts.historyOverride !== undefined && opts.historyOverride !== null
      ? opts.historyOverride
      : opts.historyOverride === null
        ? undefined
        : opts.legacyHistory && current
          ? { dates: current.dates, last_ending: current.last_ending }
          : current;
  return assembleDate({
    episodeId, a, b, req, seed: seedOverride ?? seedFrom(episodeId),
    soulA, soulB, memoryA, memoryB, history, ex, signalsOverride,
    relationship, creatorId: opts.creatorId, followupOf: opts.followupOf ?? null,
    nudges, alsoSeeing: { a: seeingA, b: seeingB },
    extrasA: rowOf(a.id)?.extras ?? null, extrasB: rowOf(b.id)?.extras ?? null,
    thisWeekA: thisWeek(a.id, rowOf(a.id)?.this_week), thisWeekB: thisWeek(b.id, rowOf(b.id)?.this_week),
  });
}

/* ------------------------------------- Sliding Doors ------------------------------------- */

function varySetup(setup: DateSetup, change: SlidingDoorChange): DateSetup {
  switch (change) {
    case "bolder":
      return { ...setup, autonomy: "unpredictable" };
    case "safer":
      return { ...setup, autonomy: "guided" };
    case "bigger_budget":
      return { ...setup, game_budget_a: 100 };
    case "long_game":
      return { ...setup, strategy: "long_term" };
  }
}

type DoorRow = {
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  ending: Ending;
  box_score: BoxScore | null;
  a_id: string;
  a_name: string;
  a_age: number;
  a_bio: string;
  a_traits: string[];
  a_want: string;
  a_dealbreaker: string;
  a_house: boolean;
  b_id: string;
  b_name: string;
  b_age: number;
  b_bio: string;
  b_traits: string[];
  b_want: string;
  b_dealbreaker: string;
  b_house: boolean;
};

const toSheet = (r: DoorRow, p: "a" | "b"): CharacterSheet => ({
  name: r[`${p}_name`],
  age: r[`${p}_age`],
  bio: r[`${p}_bio`],
  traits: r[`${p}_traits`],
  want: r[`${p}_want`],
  dealbreaker: r[`${p}_dealbreaker`],
  house: r[`${p}_house`],
});

export type SlidingDoorsResult = {
  change: SlidingDoorChange;
  /** In words: what was changed, and on whose side (always the side of the character whose owner booked it). */
  what_changed: string;
  base: { ending: Ending; box_score: BoxScore; why?: string };
  alternate: { ending: Ending; box_score: BoxScore; why?: string };
};

/** What each change does, said plainly (varySetup). */
const CHANGE_SAYS: Record<SlidingDoorChange, string> = {
  bolder: "made more unpredictable (its AI may go off-script)",
  safer: "made more guided (its AI sticks closer to what its owner would want)",
  bigger_budget: "given the biggest date budget",
  long_game: "playing for long-term compatibility (the ending is scored on trust most)",
};

const DOORS_SELECT = `
  select e.seed::text as seed, e.setup, e.note, e.ending, e.box_score,
         a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
         a.dealbreaker a_dealbreaker, a.is_house a_house,
         b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
         b.dealbreaker b_dealbreaker, b.is_house b_house
    from episodes e
    join characters a on a.id = e.character_a
    join characters b on b.id = e.character_b`;

/** Recompute the one-thing-changed alternate for a loaded date row. No model call; deterministic. */
async function computeDoors(db: Db, row: DoorRow, change: SlidingDoorChange): Promise<SlidingDoorsResult | null> {
  if (!row.setup || row.seed === null || !row.box_score) return null;
  const seed = Number(row.seed);
  const setup = row.setup;
  const [soulA, soulB] = await Promise.all([loadSoul(db, row.a_id), loadSoul(db, row.b_id)]);
  // The relationship as it stood that night (snapshotted since the graph); older dates fall back to today's dates and
  // last ending only, which is all the engine read back then.
  const today = await loadHistory(db, row.a_id, row.b_id);
  const history: DateHistory | undefined = setup.history ?? (today ? { dates: today.dates, last_ending: today.last_ending } : undefined);

  // Reproducibility: use the signals the date actually ran on (snapshotted on the setup in M14 part 2), so
  // an old date replays identically even after the character's learned memory has drifted since. Episodes
  // built before the snapshot fall back to deriving signals from the soul, exactly as they did then.
  const fromSoul = (soul: typeof soulA) => (soul ? (soul.signals ?? deriveSoulSignals(soul)) : NEUTRAL_SIGNALS);
  const sigA = setup.signals_a ?? fromSoul(soulA);
  const sigB = setup.signals_b ?? fromSoul(soulB);

  const build = (s: DateSetup): DateInput => ({
    a: {
      sheet: setup.sheet_a ?? toSheet(row, "a"),
      signals: sigA,
      autonomy: s.autonomy,
      strategy: s.strategy,
      agendaId: s.agenda_a,
      note: row.note,
      gameBudget: s.game_budget_a,
    },
    b: {
      sheet: setup.sheet_b ?? toSheet(row, "b"),
      signals: sigB,
      autonomy: DEFAULT_AUTONOMY,
      strategy: DEFAULT_STRATEGY,
      agendaId: s.agenda_b,
      note: null,
      gameBudget: s.game_budget_b,
    },
    history,
  });

  // Replay under the calibration the date was decided with (v1 for dates from before versioning).
  const varied = varySetup(setup, change);
  const alt = deterministicEngine.decide(build(varied), seed, setup.engine_version ?? 1);
  const baseWhy = endingWhy(row.ending, row.box_score, null, setup.strategy);
  const altWhy = endingWhy(alt.ending, alt.variables, alt.sides, varied.strategy);
  return {
    change,
    what_changed: `${shortName(row.a_name)}'s side was ${CHANGE_SAYS[change]}; ${shortName(row.b_name)}'s stayed as it was. Same seed, so nothing else moved.`,
    base: { ending: row.ending, box_score: row.box_score, ...(baseWhy ? { why: baseWhy } : {}) },
    alternate: { ending: alt.ending, box_score: alt.variables, ...(altWhy ? { why: altWhy } : {}) },
  };
}

/**
 * Replays an owner's date with exactly one input changed, reusing the stored seed so the only
 * difference is the change (PRD "Sliding doors"). No model call: the engine recomputes the outcome
 * deterministically, so the two timelines are a fair, reproducible comparison. Owner-only.
 */
export async function slidingDoors(
  db: Db,
  episodeId: string,
  userId: string,
  change: SlidingDoorChange,
): Promise<SlidingDoorsResult | null> {
  const row = (await db.query<DoorRow>(`${DOORS_SELECT} where e.id = $1 and e.creator_id = $2`, [episodeId, userId])).rows[0];
  return row ? computeDoors(db, row, change) : null;
}

/**
 * The chaos button's "chaos timeline" (lib/watch.ts): the same deterministic one-thing-changed replay, but
 * NOT owner-gated — it's a public, clearly-non-canon "what if the audience's curveball had hit" for a watch
 * party. Predictions still resolve on the canonical ending (row.ending / base), so this changes nothing real.
 */
export async function chaosReplay(db: Db, episodeId: string, change: SlidingDoorChange): Promise<SlidingDoorsResult | null> {
  const row = (await db.query<DoorRow>(`${DOORS_SELECT} where e.id = $1`, [episodeId])).rows[0];
  return row ? computeDoors(db, row, change) : null;
}

/**
 * Remembers that a pair dated: recomputes their edge in the relationship graph from all their dates
 * (lib/relationships.ts), which feeds the next date's engine run and the couple's page. Idempotent.
 */
export async function rememberDate(db: Db, aId: string, bId: string): Promise<void> {
  await refreshRelationship(db, aId, bId);
}
