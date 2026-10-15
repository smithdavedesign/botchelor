import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCharacter } from "@/lib/character";
import { deterministicEngine, NEUTRAL_SIGNALS, seedFrom, UNREMARKABLE_SIGNALS, type DateInput, type SideSetup, type SoulSignals } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { AGENDA_IDS, ENDINGS, type Ending } from "@/lib/rules";
import { baseSignals, describeTemperament, SHEET_CAP, sheetSignals } from "@/lib/temperament";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, startTestDb, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("a temperament from the character's own words", () => {
  it("a sheet with no temperament words reads exactly as before (unremarkable)", () => {
    expect(sheetSignals({ traits: ["bookish", "stubborn", "nocturnal"] })).toEqual(UNREMARKABLE_SIGNALS);
  });

  it("its traits move it, its voice a little, and nothing moves it past the cap", () => {
    const warm = sheetSignals({ traits: ["warm", "funny", "curious"] });
    expect(warm.warmth).toBeGreaterThan(UNREMARKABLE_SIGNALS.warmth);
    expect(warm.humor).toBeGreaterThan(UNREMARKABLE_SIGNALS.humor);
    expect(warm.openness).toBeGreaterThan(UNREMARKABLE_SIGNALS.openness);
    const cold = sheetSignals({ traits: ["cold", "serious", "guarded"] });
    expect(cold.warmth).toBeLessThan(UNREMARKABLE_SIGNALS.warmth);
    expect(cold.humor).toBeLessThan(UNREMARKABLE_SIGNALS.humor);
    expect(cold.guardedness).toBeGreaterThan(UNREMARKABLE_SIGNALS.guardedness);

    const byTrait = sheetSignals({ traits: ["deadpan", "x", "y"] }).humor - UNREMARKABLE_SIGNALS.humor;
    const byVoice = sheetSignals({ traits: ["x", "y", "z"], voice: "A deadpan delivery." }).humor - UNREMARKABLE_SIGNALS.humor;
    expect(byTrait).toBeGreaterThan(byVoice);
    expect(byVoice).toBeGreaterThan(0);

    const maxed = sheetSignals({ traits: ["warm kind gentle", "caring loyal sweet", "tender patient"], voice: "warm, kind, generous, soft" });
    expect(maxed.warmth).toBeLessThanOrEqual(UNREMARKABLE_SIGNALS.warmth + SHEET_CAP + 1e-9);
  });

  it("explicit signals win, then the soul's words, then the sheet", () => {
    const sheet = sheetSignals({ traits: ["warm", "funny", "curious"] });
    const set: SoulSignals = { warmth: 0.1, openness: 0.2, guardedness: 0.9, humor: 0.1 };
    const words: SoulSignals = { warmth: 0.33, openness: 0, guardedness: 0, humor: 0 };
    expect(baseSignals({ signals: set }, words, sheet)).toBe(set);
    expect(baseSignals({ signals: null }, words, sheet)).toBe(words);
    expect(baseSignals({ signals: null }, NEUTRAL_SIGNALS, sheet)).toBe(sheet); // a soul that names no temperament
    expect(baseSignals(null, null, sheet)).toBe(sheet);
  });

  it("reads in plain words for the owner", () => {
    expect(describeTemperament(sheetSignals({ traits: ["warm", "funny", "witty"] }))).toBe("warm, quick to joke");
    expect(describeTemperament(UNREMARKABLE_SIGNALS)).toBe("even-keeled");
  });
});

describe("calibration (engine only, no model: every ending stays in play, and temperament matters)", () => {
  const POOL = ["warm", "kind", "funny", "witty", "deadpan", "curious", "bold", "shy", "guarded", "cautious", "cold", "serious", "playful", "loyal",
    "bookish", "stubborn", "nocturnal", "dramatic", "precise", "loud", "vain", "charming", "brilliant", "reckless", "gentle", "anxious", "grumpy",
    "earnest", "sarcastic", "romantic", "chaotic", "patient", "private", "adventurous", "stoic", "chatty", "spontaneous", "aloof", "creative", "methodical"];

  /** Endings for many sheet-built characters against every house character, under engine v2. */
  function endings(traitsFor: (i: number) => string[], count = 200): Record<Ending, number> {
    const tally: Record<Ending, number> = { second_date: 0, friends: 0, disaster: 0 };
    let n = 0;
    for (let i = 0; i < count; i++) {
      const traits = traitsFor(i);
      for (const h of HOUSE_CHARACTERS) {
        const seed = seedFrom(i, h.id);
        const side = (sheet: SideSetup["sheet"], signals: SoulSignals, agenda: number): SideSetup => ({
          sheet, signals, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: AGENDA_IDS[agenda % AGENDA_IDS.length], note: null, gameBudget: 25,
        });
        const input: DateInput = {
          a: side({ name: "X", age: 30, bio: "bio", traits, want: "someone", dealbreaker: "nothing", house: false }, sheetSignals({ traits }), seed),
          b: side({ name: h.name, age: h.age, bio: h.bio, traits: h.traits, want: h.want, dealbreaker: h.dealbreaker, house: true }, h.signals, seed >>> 3),
        };
        tally[deterministicEngine.decide(input, seed, 2).ending]++;
        n++;
      }
    }
    return Object.fromEntries(ENDINGS.map((e) => [e, tally[e] / n])) as Record<Ending, number>;
  }

  it("a mixed cast still ends every way, roughly as before", () => {
    const mixed = endings((i) => [0, 1, 2].map((k) => POOL[seedFrom(i, "t", k) % POOL.length]));
    for (const e of ENDINGS) {
      expect(mixed[e], e).toBeGreaterThan(0.15);
      expect(mixed[e], e).toBeLessThan(0.55);
    }
  });

  it("warm, funny, curious characters land more second dates than cold, serious, guarded ones — but neither is doomed or guaranteed", () => {
    const warm = endings(() => ["warm", "funny", "curious"]);
    const cold = endings(() => ["cold", "serious", "guarded"]);
    expect(warm.second_date).toBeGreaterThan(cold.second_date + 0.2);
    expect(cold.disaster).toBeGreaterThan(warm.disaster + 0.2);
    for (const d of [warm, cold]) for (const e of ENDINGS) expect(d[e]).toBeGreaterThan(0.05);
  });
});

describe("in the live flow", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
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

  it("a soul-less character plays from its sheet; set it with the sliders; null hands it back to its words", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ traits: ["warm", "funny", "curious"] }), owner)).json()).id;
    expect((await loadCharacter(t.db, id))!.baseSignals).toEqual(sheetSignals({ traits: ["warm", "funny", "curious"] }));

    const set = { warmth: 0.2, openness: 0.3, guardedness: 0.8, humor: 0.25 };
    expect((await api.editCharacter(id, { temperament: set }, owner)).status).toBe(200);
    expect((await loadCharacter(t.db, id))!.baseSignals).toEqual(set);

    expect((await api.editCharacter(id, { temperament: null }, owner)).status).toBe(200);
    expect(await t.count("souls", `character_id = '${id}'`)).toBe(0); // nothing private left behind
    expect((await loadCharacter(t.db, id))!.baseSignals).toEqual(sheetSignals({ traits: ["warm", "funny", "curious"] }));

    expect((await api.editCharacter(id, { temperament: { warmth: 2, openness: 0, guardedness: 0, humor: 0 } }, owner)).status).toBe(422);
  });

  it("dropping the sliders keeps the soul's words", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ soul: { humor: "Deadpan, always." }, temperament: { warmth: 0.5, openness: 0.5, guardedness: 0.5, humor: 0.5 } }), owner)).json()).id;
    expect((await api.editCharacter(id, { temperament: null }, owner)).status).toBe(200);
    const soul = (await t.db.query<Any>(`select humor, signals from souls where character_id = $1`, [id])).rows[0];
    expect(soul).toEqual({ humor: "Deadpan, always.", signals: null });
  });

  it("changing a character's traits after a date never changes that date's replay (the signals were snapshotted)", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ traits: ["warm", "funny", "curious"] }), owner)).json()).id;
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: id, partner_id: HOUSE_PARTNER_ID }, owner)).json();
    const before = await (await api.slidingDoors(ep.id, "bolder", owner)).json();
    expect((await api.editCharacter(id, { traits: ["cold", "serious", "guarded"] }, owner)).status).toBe(200);
    const after = await (await api.slidingDoors(ep.id, "bolder", owner)).json();
    expect(after).toEqual(before);
  });

  it("agents can set it, and see how their character plays", async () => {
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const session: McpContext = { sessionId: ctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result;
    const made = (await call("create_character", validCharacter({ temperament: { warmth: 0.9, openness: 0.8, guardedness: 0.1, humor: 0.9 } }))).structuredContent;
    const mem = (await call("my_character_memory", { character_id: made.character.id })).structuredContent;
    expect(mem.plays_as).toBe("warm, quick to joke, game for anything, an open book");
    expect(JSON.stringify(made)).not.toContain("guardedness"); // private: never echoed back
  });
});
