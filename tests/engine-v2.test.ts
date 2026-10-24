import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_ENGINE_VERSION,
  deterministicEngine,
  NEUTRAL_SIGNALS,
  seedFrom,
  type DateInput,
  type SideSetup,
  type SoulSignals,
} from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { AGENDA_IDS, ENDINGS, STRATEGIES, type Ending, type Strategy } from "@/lib/rules";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, startTestDb, validCharacter } from "./helpers";

type House = (typeof HOUSE_CHARACTERS)[number];
const side = (c: House | null, seed: number, tag: string, strategy: Strategy = "genuine_chemistry", signals?: SoulSignals): SideSetup => ({
  sheet: c
    ? { name: c.name, age: c.age, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker, house: true, appearance: c.appearance }
    : { name: "Jordan Pike", age: 22, bio: "a dude", traits: ["hot", "cool", "naughty"], want: "fun", dealbreaker: "boring people", house: false },
  signals: signals ?? (c ? c.signals : NEUTRAL_SIGNALS),
  autonomy: "balanced",
  strategy,
  agendaId: AGENDA_IDS[seedFrom(seed, tag) % AGENDA_IDS.length],
  note: null,
  gameBudget: 25,
});

/** Share of each ending over every ordered house pairing × seeds, under one version and strategy. */
function distribution(version: 1 | 2, strategy: Strategy = "genuine_chemistry", seeds = 8): Record<Ending, number> {
  const tally: Record<Ending, number> = { second_date: 0, friends: 0, disaster: 0 };
  let n = 0;
  for (const a of HOUSE_CHARACTERS) for (const b of HOUSE_CHARACTERS) {
    if (a === b) continue;
    for (let seed = 1; seed <= seeds; seed++) {
      const input: DateInput = { a: side(a, seed, "agenda-a", strategy), b: side(b, seed, "agenda-b") };
      tally[deterministicEngine.decide(input, seed, version).ending]++;
      n++;
    }
  }
  return Object.fromEntries(ENDINGS.map((e) => [e, tally[e] / n])) as Record<Ending, number>;
}

describe("engine v2 — calibrated endings (versioned)", () => {
  it("new dates are decided with v4 (#728: tests/engine-v4.test.ts)", () => {
    expect(CURRENT_ENGINE_VERSION).toBe(4);
  });

  it("v3 changes only repeat dates: a first date decides exactly as under v2", () => {
    const input: DateInput = { a: side(HOUSE_CHARACTERS[0], 3, "agenda-a"), b: side(HOUSE_CHARACTERS[1], 3, "agenda-b") };
    for (const seed of [1, 2, 3, 4, 5]) expect(deterministicEngine.decide(input, seed, 3)).toEqual(deterministicEngine.decide(input, seed, 2));
  });

  it("v3: familiarity counts once, and the box score starts where the couple left off; v2 replays as it was", () => {
    const history = { dates: 4, last_ending: "second_date" as const, chemistry: 72.6, trust: 56.3 };
    const input: DateInput = { a: side(HOUSE_CHARACTERS[0], 3, "agenda-a"), b: side(HOUSE_CHARACTERS[1], 3, "agenda-b"), history };
    const v2 = deterministicEngine.decide(input, 9, 2);
    const v3 = deterministicEngine.decide(input, 9, 3);
    expect(v2.variables.chemistry.start).toBe(50);
    expect(v2.variables.trust.start).toBe(45);
    expect(v3.variables.chemistry.start).toBe(73);
    expect(v3.variables.trust.start).toBe(56);
    // Four dates of familiarity under v2 (+16 trust, -12 awkwardness) against one under v3 (+4, -3).
    expect(v2.variables.trust.final - v3.variables.trust.final).toBe(12);
    expect(v3.variables.awkwardness.final - v2.variables.awkwardness.final).toBe(9);
    // One-step familiarity with only one past date: v2 and v3 agree on the outcome.
    const once = { ...input, history: { ...history, dates: 1 } };
    expect(deterministicEngine.decide(once, 9, 3).ending).toBe(deterministicEngine.decide(once, 9, 2).ending);
  });

  it("v1 is preserved exactly (old dates replay as they were decided), and both versions are deterministic", () => {
    const input: DateInput = { a: side(HOUSE_CHARACTERS[0], 3, "agenda-a"), b: side(HOUSE_CHARACTERS[1], 3, "agenda-b") };
    expect(deterministicEngine.decide(input, 3, 1)).toEqual(deterministicEngine.decide(input, 3, 1));
    expect(deterministicEngine.decide(input, 3, 2)).toEqual(deterministicEngine.decide(input, 3, 2));
    // The box score (the variables) is the same under both versions for a fully-signalled pair: v2 only
    // re-centres where the endings fall.
    expect(deterministicEngine.decide(input, 3, 2).variables).toEqual(deterministicEngine.decide(input, 3, 1).variables);
  });

  it("v1's measured problem: no second date is reachable, and disasters dominate", () => {
    const v1 = distribution(1);
    expect(v1.second_date).toBe(0);
    expect(v1.disaster).toBeGreaterThan(0.6);
  });

  it("v2 at default settings ends roughly a third each way (the calibration guard)", () => {
    const v2 = distribution(2);
    for (const e of ENDINGS) {
      expect(v2[e], e).toBeGreaterThan(0.18);
      expect(v2[e], e).toBeLessThan(0.48);
    }
  });

  it("v2: every strategy can end any of the three ways — a strategy changes the flavour, not the doom", () => {
    for (const strategy of STRATEGIES) {
      const d = distribution(2, strategy, 4);
      for (const e of ENDINGS) expect(d[e], `${strategy} ${e}`).toBeGreaterThan(0.05);
      expect(d.disaster, strategy).toBeLessThan(0.6);
    }
  });

  it("v2: a character with no soul gets a fair shot (an unremarkable temperament, not a blank zero)", () => {
    const tally: Record<Ending, number> = { second_date: 0, friends: 0, disaster: 0 };
    let n = 0;
    for (const b of HOUSE_CHARACTERS) for (let seed = 1; seed <= 20; seed++) {
      tally[deterministicEngine.decide({ a: side(null, seed, "agenda-a"), b: side(b, seed, "agenda-b") }, seed, 2).ending]++;
      n++;
    }
    expect(tally.second_date / n).toBeGreaterThan(0.1);
    expect(tally.disaster / n).toBeLessThan(0.5);
    // ...whereas v1 doomed the same visitor.
    let v1Disasters = 0;
    for (const b of HOUSE_CHARACTERS) for (let seed = 1; seed <= 20; seed++) {
      if (deterministicEngine.decide({ a: side(null, seed, "agenda-a"), b: side(b, seed, "agenda-b") }, seed, 1).ending === "disaster") v1Disasters++;
    }
    expect(v1Disasters / n).toBeGreaterThan(0.8);
  });

  it("reports the deciding margin (relative to a neutral date) on every computed outcome", () => {
    const o = deterministicEngine.decide({ a: side(HOUSE_CHARACTERS[2], 1, "agenda-a"), b: side(HOUSE_CHARACTERS[3], 1, "agenda-b") }, 1, 2);
    expect(typeof o.margin).toBe("number");
  });
});

describe("engine versions in the live flow", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it("a new date is stamped with the engine version that decided it", async () => {
    const creator = newUserCookie();
    const oc = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: oc.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const { rows } = await t.db.query<{ v: number }>(`select (setup->>'engine_version')::int as v from episodes where id = $1`, [ep.id]);
    expect(rows[0].v).toBe(CURRENT_ENGINE_VERSION);
  });
});
