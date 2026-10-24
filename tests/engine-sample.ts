/**
 * A seeded, representative spread of date inputs for measuring the engine's ending mix (#728): house and agent-made
 * characters, every strategy, autonomy, budget and agenda, with and without a soul, a note and a history. Agent-made
 * characters are house sheets recombined field by field (one's bio, another's traits, a third's want...), so their words
 * meet each other the way real sheets' words do. Pure and deterministic: the same seed is the same sample.
 */
import { NEUTRAL_SIGNALS, seedFrom, type CharacterSheet, type DateInput, type SideSetup, type SoulSignals } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { AGENDA_IDS, AUTONOMY_LEVELS, ENDINGS, GAME_BUDGETS, STRATEGIES, type Ending } from "@/lib/rules";

/** mulberry32, as the engine's. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pick = <T>(list: readonly T[]) => T;

function houseSide(r: () => number, pick: Pick): { sheet: CharacterSheet; signals: SoulSignals } {
  const c = pick(HOUSE_CHARACTERS);
  return {
    sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: true, appearance: c.appearance },
    signals: c.signals,
  };
}

function agentSide(r: () => number, pick: Pick, i: number): { sheet: CharacterSheet; signals: SoulSignals } {
  const traits = [pick(HOUSE_CHARACTERS).traits[0], pick(HOUSE_CHARACTERS).traits[1], pick(HOUSE_CHARACTERS).traits[2]];
  const sheet: CharacterSheet = {
    name: `Agent Character ${i}`,
    age: 21 + Math.floor(r() * 30),
    bio: pick(HOUSE_CHARACTERS).bio,
    traits,
    want: pick(HOUSE_CHARACTERS).want,
    dealbreaker: pick(HOUSE_CHARACTERS).dealbreaker,
    house: false,
    appearance: r() < 0.7 ? pick(HOUSE_CHARACTERS).appearance : undefined,
  };
  // Some have no soul written (a blank temperament); the rest a written one, read as 0..1 signals, leaning the way
  // production's do (warm and open more often than guarded: across the replayable production dates, warmth averaged
  // 0.5 to 0.75 and guardedness 0.25 to 0.3).
  const between = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 10) / 10;
  const signals = r() < 0.1 ? NEUTRAL_SIGNALS : { warmth: between(0.4, 1), openness: between(0.3, 1), guardedness: between(0, 0.5), humor: between(0.3, 1) };
  return { sheet, signals };
}

/**
 * n date inputs and seeds, shaped like production's (the replayable dates of 2026-10-23): half an agent's character with
 * one of the house cast, a quarter two agents' characters, a quarter two of the house cast; the booker's settings mostly
 * the defaults (as most bookings leave them) but every strategy, autonomy and budget turns up; and about half a couple's
 * later date, which in production mostly follows a good one.
 */
export function sampleDates(n: number, seed = 728): { input: DateInput; seed: number }[] {
  const r = rng(seed);
  const pick: Pick = (list) => list[Math.floor(r() * list.length)];
  const usually = <T,>(usual: T, list: readonly T[], p = 0.65): T => (r() < p ? usual : pick(list));
  const out: { input: DateInput; seed: number }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 4; // 0, 1: agent with house; 2: agent with agent; 3: house with house
    const one = kind === 3 ? houseSide(r, pick) : agentSide(r, pick, i * 2);
    let two = kind === 2 ? agentSide(r, pick, i * 2 + 1) : houseSide(r, pick);
    while (two.sheet.name === one.sheet.name) two = houseSide(r, pick);
    const side = (c: { sheet: CharacterSheet; signals: SoulSignals }, booker: boolean): SideSetup => ({
      sheet: c.sheet,
      signals: c.signals,
      autonomy: booker ? usually("balanced", AUTONOMY_LEVELS) : "balanced",
      strategy: booker ? usually("genuine_chemistry", STRATEGIES) : "genuine_chemistry",
      agendaId: pick(AGENDA_IDS),
      note: booker && r() < 0.2 ? "Be yourself, and ask about their work." : null,
      gameBudget: booker ? usually(25, GAME_BUDGETS) : 25,
    });
    const input: DateInput = { a: side(one, true), b: side(two, false) };
    if (r() < 0.5) {
      input.history = {
        dates: 1 + Math.floor(r() * 4),
        last_ending: usually("second_date", ENDINGS, 0.6),
        chemistry: 50 + Math.round(r() * 40),
        trust: 40 + Math.round(r() * 35),
      };
    }
    out.push({ input, seed: seedFrom("mix", seed, i) });
  }
  return out;
}

/** The share of each ending over a sample, under one decide function. */
export function mixOf(sample: { input: DateInput; seed: number }[], decide: (input: DateInput, seed: number) => Ending): Record<Ending, number> {
  const tally: Record<Ending, number> = { second_date: 0, friends: 0, disaster: 0 };
  for (const { input, seed } of sample) tally[decide(input, seed)]++;
  return Object.fromEntries(ENDINGS.map((e) => [e, tally[e] / sample.length])) as Record<Ending, number>;
}
