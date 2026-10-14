/**
 * Assembles a date from stored data and the owner's settings, runs the deterministic engine, and
 * keeps the persistent relationship between a pair up to date. The episodes route calls buildDate()
 * then getEngine().decide(), then narrateEpisode(). Souls and relationship memory live only here and
 * in the engine; they are never sent to spectators.
 */
import type { Db } from "./db";
import {
  deriveSoulSignals,
  NEUTRAL_SIGNALS,
  seedFrom,
  type CharacterSheet,
  type DateHistory,
  type DateInput,
  type SideSetup,
  type SoulProfile,
} from "./engine";
import type { DateSetup } from "./game";
import {
  AGENDA_IDS,
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
  type AgendaId,
  type Autonomy,
  type Ending,
  type GameBudget,
  type Strategy,
} from "./rules";

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

export async function loadSoul(db: Db, characterId: string): Promise<SoulProfile | null> {
  const { rows } = await db.query<SoulProfile>(
    "select values, insecurities, humor, boundaries, romantic, communication from souls where character_id = $1",
    [characterId],
  );
  return rows[0] ?? null;
}

/** The soul as one block of private guidance for the model, or null when there is no soul. */
export function soulText(soul: SoulProfile | null): string | null {
  if (!soul) return null;
  const parts = [
    soul.values && `Values: ${soul.values}`,
    soul.insecurities && `Insecurities: ${soul.insecurities}`,
    soul.humor && `Humour: ${soul.humor}`,
    soul.boundaries && `Boundaries: ${soul.boundaries}`,
    soul.romantic && `Romantic preferences: ${soul.romantic}`,
    soul.communication && `Communication style: ${soul.communication}`,
  ].filter(Boolean);
  return parts.length ? parts.join(". ") : null;
}

const pickAgenda = (seed: number): AgendaId => AGENDA_IDS[seed % AGENDA_IDS.length];

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
  setup: DateSetup;
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
  const setup: DateSetup = {
    autonomy: req.autonomy,
    strategy: req.strategy,
    agenda_a: agendaA,
    agenda_b: agendaB,
    game_budget_a: req.gameBudget,
    game_budget_b: DEFAULT_GAME_BUDGET,
  };
  const sideA: SideSetup = {
    sheet: a.sheet,
    signals: soulA ? deriveSoulSignals(soulA) : NEUTRAL_SIGNALS,
    autonomy: req.autonomy,
    strategy: req.strategy,
    agendaId: agendaA,
    note: req.note,
    gameBudget: req.gameBudget,
  };
  const sideB: SideSetup = {
    sheet: b.sheet,
    signals: soulB ? deriveSoulSignals(soulB) : NEUTRAL_SIGNALS,
    autonomy: DEFAULT_AUTONOMY,
    strategy: DEFAULT_STRATEGY,
    agendaId: agendaB,
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
  const history = await loadHistory(db, a.id, b.id);
  return { input: { a: sideA, b: sideB, history }, souls: [soulText(soulA), soulText(soulB)], setup, seed };
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
