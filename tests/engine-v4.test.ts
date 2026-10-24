/**
 * #728 (David, 2026-10-23): engine v4. A fairer mix on show-model dates, a dealbreaker as one factor among several, the
 * lines counting for more on dates agents perform (both sides' see_again is a rule there), and the heading saying so.
 * Old versions replay byte for byte.
 */
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_ENGINE_VERSION,
  deterministicEngine,
  deterministicTraced,
  fixedEngine,
  NEUTRAL_SIGNALS,
  setEngineForTests,
  V4_FRIENDS_REL,
  V4_SECOND_DATE_REL,
  type DateInput,
  type Outcome,
  type SideSetup,
} from "@/lib/engine";
import { dateHeading, forTwoAgents } from "@/lib/heading";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { ENDINGS, STRATEGIES, WISH_LIFT_NEAR, type Ending } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import { applyWishes, liftEnding, resolveWishes, sustainedInterest, weighEnding, wishRule } from "@/lib/wishes";
import { mixOf, sampleDates } from "./engine-sample";
import { startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

const SAMPLE = sampleDates(6000);
const mix = (version: 1 | 2 | 3 | 4, sample = SAMPLE) => mixOf(sample, (input, seed) => deterministicEngine.decide(input, seed, version).ending);

describe("engine v4: the mix", () => {
  it("new dates are decided with v4", () => {
    expect(CURRENT_ENGINE_VERSION).toBe(4);
    expect([V4_FRIENDS_REL, V4_SECOND_DATE_REL]).toEqual([10.5, 15.5]);
  });

  it("over the seeded, production-shaped spread, v4 ends 40–50% second date, 25–35% friends, 20–30% disaster (v3 didn't)", () => {
    const v4 = mix(4);
    expect(v4.second_date).toBeGreaterThanOrEqual(0.4);
    expect(v4.second_date).toBeLessThanOrEqual(0.5);
    expect(v4.friends).toBeGreaterThanOrEqual(0.25);
    expect(v4.friends).toBeLessThanOrEqual(0.35);
    expect(v4.disaster).toBeGreaterThanOrEqual(0.2);
    expect(v4.disaster).toBeLessThanOrEqual(0.3);
    // The measured problem: v3 over the same spread leans on second dates (production: 67% of show-model dates).
    expect(mix(3).second_date).toBeGreaterThan(0.55);
  });

  it("every strategy can still end any of the three ways, and none is doomed", () => {
    for (const strategy of STRATEGIES) {
      const sample = SAMPLE.slice(0, 2000).map(({ input, seed }) => ({ input: { ...input, a: { ...input.a, strategy } }, seed }));
      const m = mix(4, sample);
      for (const e of ENDINGS) expect(m[e], `${strategy} ${e}`).toBeGreaterThan(0.08);
      expect(m.disaster, strategy).toBeLessThan(0.45);
    }
  });

  it("v1 to v3 are byte-identical to before v4 (decide and trace, over a seeded sample)", () => {
    // The fingerprint of every v1, v2 and v3 outcome and trace over this sample, computed with the engine as it was on
    // main before v4 (f7946b3). A change to an old version's maths, or to the sample, changes it.
    const h = createHash("sha256");
    for (const { input, seed } of sampleDates(3000, 667)) for (const v of [1, 2, 3] as const) h.update(JSON.stringify(deterministicTraced(input, seed, v)));
    expect(h.digest("hex")).toBe("0e1937685481c0a7af75bb2a40612e5a234e76df12375a5f10b585eff01ae3eb");
  });
});

/* ---------------------------------- dealbreakers ---------------------------------- */

const side = (over: Partial<SideSetup["sheet"]>, extra: Partial<SideSetup> = {}): SideSetup => ({
  sheet: { name: "Ada Lumen", age: 30, bio: "A cartographer of small islands.", traits: ["curious", "warm", "wry"], want: "Someone who reads maps", dealbreaker: "Loud chewing", house: false, ...over },
  signals: NEUTRAL_SIGNALS,
  autonomy: "balanced",
  strategy: "genuine_chemistry",
  agendaId: "keep_it_light",
  note: null,
  gameBudget: 25,
  ...extra,
});

describe("engine v4: a dealbreaker is one factor among several", () => {
  it("little words and the other's want no longer trip it (v3 still does, so old dates replay)", () => {
    const little: DateInput = {
      a: side({ dealbreaker: "Anyone who asks about her ex" }),
      b: side({ name: "Bo Quill", bio: "She asks too many questions about lighthouses." }),
    };
    expect(deterministicEngine.decide(little, 1, 3).sides[0].dealbreaker_hit).not.toBeNull();
    expect(deterministicEngine.decide(little, 1, 4).sides[0].dealbreaker_hit).toBeNull();
    const wanted: DateInput = {
      a: side({ dealbreaker: "Jealous types" }),
      b: side({ name: "Bo Quill", want: "Someone who never gets jealous" }),
    };
    expect(deterministicEngine.decide(wanted, 1, 3).sides[0].dealbreaker_hit).not.toBeNull();
    expect(deterministicEngine.decide(wanted, 1, 4).sides[0].dealbreaker_hit).toBeNull();
    // What the other *is* still trips it.
    const real: DateInput = { a: side({ dealbreaker: "Jealous types" }), b: side({ name: "Bo Quill", traits: ["jealous", "loyal", "loud"] }) };
    expect(deterministicEngine.decide(real, 1, 4).sides[0].dealbreaker_hit).toBe("jealou");
  });

  it("a tripped dealbreaker is no longer an automatic disaster, and the trace says when it decided the ending", () => {
    let tripped = 0;
    let disasters = 0;
    let decided = 0;
    let v3Tripped = 0;
    let v3Disasters = 0;
    for (const { input, seed } of SAMPLE) {
      const { outcome, trace } = deterministicTraced(input, seed, 4);
      if (outcome.sides.some((s) => s.dealbreaker_hit)) {
        tripped++;
        if (outcome.ending === "disaster") disasters++;
        if (trace!.reasons.includes("dealbreaker_decided")) decided++;
      }
      const old = deterministicEngine.decide(input, seed, 3);
      if (old.sides.some((s) => s.dealbreaker_hit)) {
        v3Tripped++;
        if (old.ending === "disaster") v3Disasters++;
      }
    }
    expect(v3Disasters / v3Tripped).toBeGreaterThan(0.99);
    expect(tripped / SAMPLE.length).toBeLessThan(v3Tripped / SAMPLE.length);
    expect(disasters / tripped).toBeLessThan(0.75);
    expect(decided).toBeGreaterThan(0);
    expect(decided).toBeLessThan(tripped);
  });

  it("the heading names the weakest number, and the dealbreaker only when it decides the ending (whose, never on what)", () => {
    const names = ["Ada Lumen", "Bo Quill"] as const;
    const cases = SAMPLE.map(({ input, seed }) => ({ input, ...deterministicTraced(input, seed, 4) })).filter(
      (c) => c.outcome.ending === "disaster" && c.outcome.sides.some((s) => s.dealbreaker_hit),
    );
    const deciding = cases.find((c) => c.trace!.reasons.includes("dealbreaker_decided"))!;
    const minor = cases.find((c) => !c.trace!.reasons.includes("dealbreaker_decided"))!;
    expect(deciding && minor).toBeTruthy();
    const h1 = dateHeading(deciding.outcome, names, deciding.input.a.strategy, deciding.trace, false, null, 4);
    expect(h1.says).toMatch(/dealbreaker trips?, and \w+ is the weak spot$/);
    expect(h1.factors[0]).toMatch(/dealbreakers? trips? \(what on stays private\): it decides this one$/);
    const h2 = dateHeading(minor.outcome, names, minor.input.a.strategy, minor.trace, false, null, 4);
    expect(h2.says).not.toMatch(/dealbreaker/);
    expect(h2.says).toMatch(/\. (Chemistry|Attraction|Trust|Awkwardness) is the weak spot$/);
    expect(h2.factors.at(-1)).toMatch(/dealbreakers? trips? \(what on stays private\): one cost among several, not what decides it$/);
    for (const h of [h1, h2]) {
      expect(h.says.startsWith("heading for a disaster unless you both want to see each other again: both say see_again: true on your last lines and it lifts.")).toBe(true);
      // Never the cue word.
      for (const s of [deciding, minor].flatMap((c) => c.outcome.sides)) if (s.dealbreaker_hit) expect(JSON.stringify(h)).not.toContain(s.dealbreaker_hit);
    }
  });
});

/* ---------------------------------- the wishes ---------------------------------- */

describe("engine v4: on a date agents perform, both see_agains are a rule", () => {
  const yes = { a: true, b: true };
  const no = { a: false, b: false };
  const near = V4_SECOND_DATE_REL - WISH_LIFT_NEAR;

  it("both yes: never a disaster, and a close friends ending becomes a second date; both no: never a second date; mixed: the engine's", () => {
    expect(liftEnding("disaster", yes, -20)).toBe("friends");
    expect(liftEnding("friends", yes, near)).toBe("second_date");
    expect(liftEnding("friends", yes, near - 0.1)).toBe("friends");
    expect(liftEnding("second_date", yes, 30)).toBe("second_date");
    expect(liftEnding("second_date", no, 30)).toBe("friends");
    expect(liftEnding("friends", no, 12)).toBe("friends");
    expect(liftEnding("disaster", no, 0)).toBe("disaster");
    for (const e of ENDINGS) {
      expect(liftEnding(e, { a: true, b: false }, 14)).toBe(e);
      expect(liftEnding(e, { a: null, b: true }, 14)).toBe(e);
    }
  });

  it("only on an agents' date under v4: a show-model date, or an agents' date booked before v4, keeps the roll", () => {
    expect(wishRule(true, 4).lift).toBe(true);
    expect(wishRule(true, 3).lift).toBe(false);
    expect(wishRule(false, 4).lift).toBe(false);
    for (let seed = 1; seed < 200; seed++) {
      expect(weighEnding("disaster", yes, seed, wishRule(true, 3))).toBe(weighEnding("disaster", yes, seed));
      expect(weighEnding("disaster", yes, seed, wishRule(true, 4, -5))).toBe("friends");
    }
    const disaster: Outcome = fixedEngine({ ending: "disaster", margin: -5 }, { wishes: true }).decide({} as DateInput, 3);
    expect(applyWishes(disaster, yes, 3, wishRule(true, 4)).ending).toBe("friends");
    expect(applyWishes(disaster, yes, 3, wishRule(true, 4)).sides.every((s) => s.wants_another)).toBe(true);
  });

  it("a side that sent no see_again counts by its interest across the last act, not one line", () => {
    const turn = (s: "a" | "b", act: number, interest: number): Turn => ({ side: s, act, dialogue: "…", action: "", emotion: "", interest });
    // a: warm all of the last act but cool on its very last line; b: one late spike.
    const lines = [turn("a", 1, 0.1), turn("b", 1, 0.1), turn("a", 2, 0.9), turn("b", 2, 0.2), turn("a", 2, 0.8), turn("b", 2, 0.3), turn("a", 2, 0.4), turn("b", 2, 0.9)];
    expect(sustainedInterest(lines, "a")).toBe(0.7);
    expect(sustainedInterest(lines, "b")).toBe(0.47);
    expect(resolveWishes(null, lines, { lift: true })).toEqual({ a: true, b: null });
    // Before v4: the last line alone.
    expect(resolveWishes(null, lines)).toEqual({ a: null, b: true });
    // A see_again it sent always wins.
    expect(resolveWishes({ a: false }, lines, { lift: true })).toEqual({ a: false, b: null });
  });
});

/* ---------------------------------- the live flow ---------------------------------- */

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let t: Awaited<ReturnType<typeof startTestDb>>;
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-engine-v4-test" } } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const line = (i: number, extra: Record<string, unknown> = {}) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.5, ...extra });

describe("engine v4 in the live flow: your own two characters", () => {
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setEngineForTests(null);
  });

  async function pair() {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id as string;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id as string;
    return { ctx, a, b };
  }
  /** Plays a speed date to its recap, sending see_again on each side's last line as `wish` says. */
  async function playTo(ctx: McpContext, a: string, b: string, wish: { a?: boolean; b?: boolean }, before?: (id: string) => Promise<void>) {
    resetRateLimitsForTests();
    let r = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent;
    const id: string = r.step.episode_id;
    if (before) await before(id);
    const first = r.step;
    let step = r.step;
    for (let i = 0; step.stage === "turn"; i++) {
      const said = step.see_again ? wish[step.side as "a" | "b"] : undefined;
      r = (await call("submit_own_date_step", { episode_id: id, output: line(i, said === undefined ? {} : { see_again: said }) }, ctx)).structuredContent;
      step = r.step;
    }
    await call("submit_own_date_step", { episode_id: id, output: validEpisodeDraft() }, ctx);
    const row = (await t.db.query<Any>(`select ending, wishes, setup->>'engine_version' as v, seed::text as seed from episodes where id = $1`, [id])).rows[0];
    return { id, first, recap: step, row };
  }

  it("both yes lifts a would-be disaster to friends, and the heading said it would", async () => {
    setEngineForTests(fixedEngine({ ending: "disaster" }, { wishes: true }));
    const { ctx, a, b } = await pair();
    const r = await playTo(ctx, a, b, { a: true, b: true });
    expect(r.row.v).toBe("4");
    expect(r.first.heading.says.startsWith("heading for a disaster unless you both want to see each other again: both say see_again: true on your last lines and it lifts")).toBe(true);
    expect(r.recap.ending).toBe("friends");
    expect(r.row).toMatchObject({ ending: "friends", wishes: { a: true, b: true, engine: "disaster" } });
    const ep = (await call("get_episode", { episode_id: r.id }, ctx)).structuredContent;
    expect(ep.why).toMatch(/Both of them wanted to see each other again/);
  });

  it("both no blocks a second date; one each leaves the engine's ending", async () => {
    setEngineForTests(fixedEngine({ ending: "second_date", margin: 25 }, { wishes: true }));
    const { ctx, a, b } = await pair();
    const blocked = await playTo(ctx, a, b, { a: false, b: false });
    expect(blocked.first.heading.says).toMatch(/^heading for a second date unless neither wants another: both say see_again: false on your last lines and it drops to friends/);
    expect(blocked.row).toMatchObject({ ending: "friends", wishes: { a: false, b: false, engine: "second_date" } });
    const mixed = await playTo(ctx, a, b, { a: true, b: false });
    expect(mixed.row).toMatchObject({ ending: "second_date", wishes: { a: true, b: false, engine: "second_date" } });
  });

  it("a date booked before v4 keeps the roll: it replays exactly as it would have", async () => {
    setEngineForTests(fixedEngine({ ending: "disaster" }, { wishes: true }));
    const { ctx, a, b } = await pair();
    const r = await playTo(ctx, a, b, { a: true, b: true }, async (id) => {
      await t.db.query(`update episodes set setup = jsonb_set(setup, '{engine_version}', '3') where id = $1`, [id]);
    });
    expect(r.row.v).toBe("3");
    expect(r.row.ending).toBe(weighEnding("disaster", { a: true, b: true }, Number(r.row.seed)));
  });

  it("act_note says what both see_agains would do on this date", async () => {
    setEngineForTests(fixedEngine({ ending: "disaster" }, { wishes: true }));
    const { ctx, a, b } = await pair();
    resetRateLimitsForTests();
    let step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    const heading = step.heading;
    while (!step.act_note) step = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(step.turn) }, ctx)).structuredContent.step;
    expect(step.act_note).toMatch(/What can still move it is both sides' private see_again on their last lines, not what the lines say: both true and it lifts to friends/);
    expect(forTwoAgents(heading).note).toMatch(/^Set at booking from the two characters' numbers: .*Your lever is your side's private see_again/);
  });
});

// Ending is used in a type position above only.
export type _E = Ending;
