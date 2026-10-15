import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sheetSignals } from "@/lib/temperament";
import {
  assembleCharacter,
  characterPublicView,
  characterSelfView,
  characterSheet,
  effectiveSignals,
  loadCharacter,
  soulBaseSignals,
  type Character,
} from "@/lib/character";
import type { CharacterSheet, SoulSignals } from "@/lib/engine";
import type { StoredSoul } from "@/lib/souls";
import type { CharacterMemory } from "@/lib/memory";
import { MEMORY_SIGNAL_CAP } from "@/lib/memory";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

const SHEET: CharacterSheet = {
  name: "Mira Quell",
  age: 27,
  bio: "a cartographer who maps streets that only exist on Tuesdays",
  traits: ["curious", "stubborn"],
  want: "a map reader",
  dealbreaker: "DEALBREAKER-despises-cilantro",
  house: false,
  appearance: "ink-stained cuffs, a compass on a chain",
};

const SOUL: StoredSoul = {
  values: "honesty SOULSECRET", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "",
  local_only: false, signals: null,
};

const MEMORY: CharacterMemory = {
  dates: 4,
  second_dates: 2,
  friends: 1,
  disasters: 1,
  likes: ["LIKECUE-adventurous"],
  turnoffs: ["TURNOFFCUE-aloof"],
  signal_delta: { openness: 0.08, warmth: 0.06, guardedness: 0.05 },
  memorable_lines: ["MEMORABLELINE I only trust people who get lost on purpose"],
  reflections: ["REFLECTION I learned I want someone who asks a second question"],
  arc: "ARCTEXT 4 dates in; warms to adventurous",
};

const char = (over: Partial<Parameters<typeof assembleCharacter>[0]> = {}): Character =>
  assembleCharacter({ id: "mira-oc", sheet: SHEET, soul: SOUL, memory: MEMORY, ...over });

const json = (v: unknown) => JSON.stringify(v);

describe("assembleCharacter", () => {
  it("gathers identity, look, persona, soul, memory and effective signals", () => {
    const c = char();
    expect(c.name).toBe("Mira Quell");
    expect(c.persona.traits).toEqual(["curious", "stubborn"]);
    expect(c.look.appearance).toBe("ink-stained cuffs, a compass on a chain");
    expect(c.look.portrait).toBeNull(); // not a house id
    expect(c.soul).toBe(SOUL);
    expect(c.memory).toBe(MEMORY);
    // The soul's words name no temperament ("honesty"), so the base is what its own traits and voice describe
    // (lib/temperament.ts: "curious" opens it up); effective = base + the memory's bounded drift.
    expect(c.baseSignals).toEqual(sheetSignals(SHEET));
    expect(c.baseSignals).toEqual(soulBaseSignals(SOUL, SHEET));
    expect(c.signals.openness).toBeCloseTo(c.baseSignals.openness + 0.08, 5);
  });
});

describe("characterSheet", () => {
  it("round-trips the minimal engine input, appearance included", () => {
    expect(characterSheet(char())).toEqual(SHEET);
  });
});

describe("characterSelfView — the agent's own inner life", () => {
  it("includes the soul text, the dealbreaker and the learned memory", () => {
    const text = json(characterSelfView(char()));
    expect(text).toContain("SOULSECRET");
    expect(text).toContain("DEALBREAKER-despises-cilantro");
    expect(text).toContain("ARCTEXT");
    expect(text).toContain("LIKECUE-adventurous");
    expect(text).toContain("TURNOFFCUE-aloof");
    expect(text).toContain("MEMORABLELINE");
  });

  it("merges this date's private context without losing the soul", () => {
    const view = characterSelfView(char(), { secret_agenda: "AGENDA-find-funny", note_from_creator: "NOTE-be-brave" });
    const priv = (view.private as Record<string, unknown>);
    expect(priv.secret_agenda).toBe("AGENDA-find-funny");
    expect(priv.note_from_creator).toBe("NOTE-be-brave");
    expect(priv.soul).toContain("SOULSECRET");
    expect(priv.memory).toBeDefined();
  });

  it("hides a local-only soul's text (engine-only), and omits memory before the first date", () => {
    const localOnly = char({ soul: { ...SOUL, local_only: true }, memory: null });
    const view = characterSelfView(localOnly);
    const priv = view.private as Record<string, unknown>;
    expect(json(view)).not.toContain("SOULSECRET");
    expect(priv.soul).toContain("none");
    expect(priv.memory).toBeUndefined();
  });
});

describe("characterPublicView — what the other agent and spectators see", () => {
  it("has the public persona and NOTHING private", () => {
    const view = characterPublicView(char());
    expect(view).toEqual({
      name: "Mira Quell",
      age: 27,
      bio: SHEET.bio,
      traits: ["curious", "stubborn"],
      appearance: SHEET.appearance,
    });
    const text = json(view);
    expect(text).not.toContain("SOULSECRET");
    expect(text).not.toContain("DEALBREAKER");
    expect(text).not.toContain("ARCTEXT");
    expect(text).not.toContain("LIKECUE");
    expect(text).not.toContain("MEMORABLELINE");
    expect(text).not.toContain("warmth"); // no signals leak
    expect(text).not.toContain("openness");
  });
});

describe("effectiveSignals — the learned, bounded drift", () => {
  const base: SoulSignals = { warmth: 0.5, openness: 0.5, guardedness: 0.5, humor: 0.5 };

  it("adds the memory's delta per axis", () => {
    const sig = effectiveSignals(base, { ...MEMORY, signal_delta: { warmth: 0.1, guardedness: -0.1 } });
    expect(sig.warmth).toBeCloseTo(0.6, 5);
    expect(sig.guardedness).toBeCloseTo(0.4, 5);
    expect(sig.openness).toBe(0.5); // untouched axis
  });

  it("clamps the result to 0..1", () => {
    const high = effectiveSignals({ ...base, warmth: 0.95 }, { ...MEMORY, signal_delta: { warmth: 0.15 } });
    expect(high.warmth).toBe(1);
  });

  it("clamps a stored delta defensively to ±MEMORY_SIGNAL_CAP even if a row is out of range", () => {
    const sig = effectiveSignals({ ...base, openness: 0.1 }, { ...MEMORY, signal_delta: { openness: 5 } });
    expect(sig.openness).toBeCloseTo(0.1 + MEMORY_SIGNAL_CAP, 5);
  });

  it("is a no-op with no memory", () => {
    expect(effectiveSignals(base, null)).toEqual(base);
  });
});

describe("loadCharacter — assembles from the database", () => {
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

  it("loads a fresh OC: identity + soul + base signals, empty memory and record", async () => {
    const creator = newUserCookie();
    const created = await (await api.createCharacter(validCharacter(), creator)).json();
    await api.putSoul(created.id, { values: "warm and curious and adventurous" }, creator);

    const c = await loadCharacter(t.db, created.id);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Mira Quell");
    expect(c!.ownerId).toBe(creator.split("=")[1]);
    expect(c!.soul).not.toBeNull();
    expect(c!.memory).toBeNull(); // no dates yet
    expect(c!.record).toEqual({ dates: 0, second_dates: 0, friends: 0, disasters: 0 });
    // base signals derived from the soul text (warm/curious/adventurous hit the lexicon)
    expect(c!.baseSignals.warmth).toBeGreaterThan(0);
    expect(c!.signals).toEqual(c!.baseSignals); // no memory, no drift
  });

  it("returns null for an unknown id", async () => {
    expect(await loadCharacter(t.db, "nope")).toBeNull();
  });
});
