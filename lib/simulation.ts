/**
 * Assembles a date from stored data and the owner's settings, runs the deterministic engine, and
 * keeps the persistent relationship between a pair up to date. The episodes route calls buildDate()
 * then getEngine().decide(), then narrateEpisode(). Souls and relationship memory live only here and
 * in the engine; they are never sent to spectators.
 */
import type { Db } from "./db";
import {
  deriveSoulSignals,
  deterministicEngine,
  NEUTRAL_SIGNALS,
  seedFrom,
  type CharacterSheet,
  type DateHistory,
  type DateInput,
  type Outcome,
  type SideSetup,
} from "./engine";
import type { BoxScore, DateSetup } from "./game";
import { loadSoul, soulText } from "./souls";
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

export type CharacterForDate = { id: string; sheet: CharacterSheet };

export type DateRequest = {
  autonomy: Autonomy;
  strategy: Strategy;
  gameBudget: GameBudget;
  /** The owner's chosen agenda for their side; null means the show deals one. */
  agendaId: AgendaId | null;
  note: string | null;
};

export const DEFAULT_DATE_REQUEST: DateRequest = {
  autonomy: DEFAULT_AUTONOMY,
  strategy: DEFAULT_STRATEGY,
  gameBudget: DEFAULT_GAME_BUDGET,
  agendaId: null,
  note: null,
};

const pickAgenda = (seed: number): AgendaId => AGENDA_IDS[seed % AGENDA_IDS.length];
const pickProducer = (seed: number): ProducerId => PRODUCER_IDS[seed % PRODUCER_IDS.length];

/** The canonical (sorted) key for a pair, so one unordered pair is one relationships row. */
const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

async function loadHistory(db: Db, aId: string, bId: string): Promise<DateHistory | undefined> {
  const [lo, hi] = pairKey(aId, bId);
  const { rows } = await db.query<{ dates: number; last_ending: Ending | null }>(
    "select dates, last_ending from relationships where character_a = $1 and character_b = $2",
    [lo, hi],
  );
  return rows[0] ? { dates: rows[0].dates, last_ending: rows[0].last_ending } : undefined;
}

export type BuiltDate = {
  input: DateInput;
  souls: [string | null, string | null];
  /** Always carries the dealt venue: DateSetup.venue is only optional for episodes stored before it existed. */
  setup: DateSetup & { venue: VenueId };
  seed: number;
};

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
): Promise<BuiltDate> {
  const seed = seedOverride ?? seedFrom(episodeId);
  const [soulA, soulB] = await Promise.all([loadSoul(db, a.id), loadSoul(db, b.id)]);
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
    venue: pickVenue(seedFrom(seed, "venue")),
  };
  // A local-only soul drives the engine (signals) but its text is never sent to the model.
  const forModel = (s: typeof soulA) => (s && !s.local_only ? soulText(s) : null);
  // Image-trained signals take precedence over the text-derived ones: an image shapes the behaviour.
  const sideA: SideSetup = {
    sheet: a.sheet,
    signals: soulA ? (soulA.signals ?? deriveSoulSignals(soulA)) : NEUTRAL_SIGNALS,
    autonomy: req.autonomy,
    strategy: req.strategy,
    agendaId: agendaA,
    note: req.note,
    gameBudget: req.gameBudget,
  };
  const sideB: SideSetup = {
    sheet: b.sheet,
    signals: soulB ? (soulB.signals ?? deriveSoulSignals(soulB)) : NEUTRAL_SIGNALS,
    autonomy: DEFAULT_AUTONOMY,
    strategy: DEFAULT_STRATEGY,
    agendaId: agendaB,
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
  const history = await loadHistory(db, a.id, b.id);
  return { input: { a: sideA, b: sideB, history }, souls: [forModel(soulA), forModel(soulB)], setup, seed };
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
  base: { ending: Ending; box_score: BoxScore };
  alternate: { ending: Ending; box_score: BoxScore };
};

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
  const { rows } = await db.query<DoorRow>(
    `select e.seed::text as seed, e.setup, e.note, e.ending, e.box_score,
            a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
            a.dealbreaker a_dealbreaker, a.is_house a_house,
            b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
            b.dealbreaker b_dealbreaker, b.is_house b_house
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.creator_id = $2`,
    [episodeId, userId],
  );
  const row = rows[0];
  if (!row || !row.setup || row.seed === null || !row.box_score) return null;
  const seed = Number(row.seed);
  const setup = row.setup;
  const [soulA, soulB] = await Promise.all([loadSoul(db, row.a_id), loadSoul(db, row.b_id)]);
  const history = await loadHistory(db, row.a_id, row.b_id);

  const build = (s: DateSetup): DateInput => ({
    a: {
      sheet: toSheet(row, "a"),
      signals: soulA ? (soulA.signals ?? deriveSoulSignals(soulA)) : NEUTRAL_SIGNALS,
      autonomy: s.autonomy,
      strategy: s.strategy,
      agendaId: s.agenda_a,
      note: row.note,
      gameBudget: s.game_budget_a,
    },
    b: {
      sheet: toSheet(row, "b"),
      signals: soulB ? (soulB.signals ?? deriveSoulSignals(soulB)) : NEUTRAL_SIGNALS,
      autonomy: DEFAULT_AUTONOMY,
      strategy: DEFAULT_STRATEGY,
      agendaId: s.agenda_b,
      note: null,
      gameBudget: s.game_budget_b,
    },
    history,
  });

  const toArc = (o: Outcome) => ({ ending: o.ending, box_score: o.variables });
  const alt = deterministicEngine.decide(build(varySetup(setup, change)), seed);
  return { change, base: { ending: row.ending, box_score: row.box_score }, alternate: toArc(alt) };
}

/** Remembers that a pair dated and how it went: feeds the next date's engine run and the relationship graph. */
export async function rememberDate(db: Db, aId: string, bId: string, ending: Ending): Promise<void> {
  const [lo, hi] = pairKey(aId, bId);
  await db.query(
    `insert into relationships (character_a, character_b, dates, second_dates, last_ending, updated_at)
     values ($1, $2, 1, $3, $4, now())
     on conflict (character_a, character_b) do update set
       dates = relationships.dates + 1,
       second_dates = relationships.second_dates + $3,
       last_ending = $4,
       updated_at = now()`,
    [lo, hi, ending === "second_date" ? 1 : 0, ending],
  );
}
