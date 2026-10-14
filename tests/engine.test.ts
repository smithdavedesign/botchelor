import { describe, expect, it } from "vitest";
import {
  type CharacterSheet,
  type DateInput,
  type SideSetup,
  type SoulProfile,
  deriveSoulSignals,
  deterministicEngine,
  NEUTRAL_SIGNALS,
  seedFrom,
} from "@/lib/engine";
import { DATE_VARIABLES, ENDINGS } from "@/lib/rules";

const sheet = (o: Partial<CharacterSheet> = {}): CharacterSheet => ({
  name: "Mira Quell",
  age: 27,
  bio: "A cartographer who maps cities that only exist on Tuesdays.",
  traits: ["curious", "stubborn", "warm"],
  want: "Someone who can read a map upside down",
  dealbreaker: "People who hate surprises",
  house: false,
  ...o,
});

const side = (o: Partial<SideSetup> = {}): SideSetup => ({
  sheet: o.sheet ?? sheet(),
  signals: o.signals ?? NEUTRAL_SIGNALS,
  autonomy: o.autonomy ?? "guided",
  strategy: o.strategy ?? "genuine_chemistry",
  agendaId: o.agendaId ?? "find_funny",
  note: o.note ?? null,
  gameBudget: o.gameBudget ?? 25,
});

const input = (a: Partial<SideSetup>, b: Partial<SideSetup>): DateInput => ({ a: side(a), b: side(b) });

describe("the deterministic engine", () => {
  it("gives the same outcome for the same input and seed, every time", () => {
    const i = input({}, { sheet: sheet({ name: "Rafe" }) });
    const first = deterministicEngine.decide(i, 1234);
    for (let n = 0; n < 5; n++) expect(deterministicEngine.decide(i, 1234)).toEqual(first);
  });

  it("produces a valid ending and box score in range", () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = deterministicEngine.decide(input({}, { sheet: sheet({ name: "Rafe" }) }), seed);
      expect(ENDINGS).toContain(out.ending);
      for (const v of DATE_VARIABLES) {
        const arc = out.variables[v];
        expect(arc.final).toBeGreaterThanOrEqual(0);
        expect(arc.final).toBeLessThanOrEqual(100);
        expect(arc.delta).toBe(arc.final - arc.start);
      }
      // A second date never also rejects someone (the old schema invariant, now enforced by the engine).
      if (out.ending === "second_date") expect(out.drama_question).toBe("leaves_first");
    }
  });

  it("pushes a tripped dealbreaker toward a rejection, not a second date", () => {
    // Mira's dealbreaker is "People who hate surprises"; Otto's bio is all about surprises.
    const otto = sheet({ name: "Otto", bio: "A party planner obsessed with surprises and surprise parties.", traits: ["loud", "pushy", "blunt"] });
    let rejections = 0;
    for (let seed = 0; seed < 30; seed++) {
      const out = deterministicEngine.decide(input({}, { sheet: otto }), seed);
      expect(out.ending).not.toBe("second_date");
      if (out.drama_question === "rejected") rejections++;
      expect(out.sides[0].dealbreaker_hit).toBe("surprise");
    }
    expect(rejections).toBeGreaterThan(0);
  });

  it("pushes strong mutual affinity toward a second date", () => {
    const warm: SoulProfile = {
      values: "warm kind gentle loyal", insecurities: "", humor: "funny witty silly playful",
      boundaries: "no cruelty", romantic: "affectionate tender open", communication: "warm curious bold adventurous",
    };
    const shared = ["adventurous", "warm", "funny"] as const;
    const a = { sheet: sheet({ traits: [...shared], want: "Someone adventurous and warm", dealbreaker: "Cruelty" }), signals: deriveSoulSignals(warm), agendaId: "find_adventurous" as const };
    const b = { sheet: sheet({ name: "Sol", traits: [...shared], want: "Someone warm and funny", dealbreaker: "Cruelty" }), signals: deriveSoulSignals(warm), agendaId: "find_funny" as const };
    // Strong affinity should clear the second-date threshold for every seed, jitter and all.
    for (let seed = 0; seed < 25; seed++) {
      const out = deterministicEngine.decide(input(a, b), seed);
      expect(out.ending).toBe("second_date");
      expect(out.variables.chemistry.final).toBeGreaterThan(70);
    }
  });

  it("lets an unpredictable AI swing outcomes that a guided one keeps steady", () => {
    const seen = (autonomy: "guided" | "unpredictable") => {
      const set = new Set<string>();
      for (let seed = 0; seed < 40; seed++) set.add(deterministicEngine.decide(input({ autonomy }, { sheet: sheet({ name: "Rafe" }) }), seed).ending);
      return set.size;
    };
    expect(seen("unpredictable")).toBeGreaterThanOrEqual(seen("guided"));
  });

  it("records whether the note was followed, by autonomy", () => {
    expect(deterministicEngine.decide(input({ note: "Be yourself", autonomy: "guided" }, {}), 1).sides[0].note_followed).toBe(true);
    expect(deterministicEngine.decide(input({ note: null }, {}), 1).sides[0].note_followed).toBeNull();
  });
});

describe("soul signals", () => {
  it("reads warmth and humour from a written soul and stays neutral when empty", () => {
    const soul: SoulProfile = {
      values: "kindness and loyalty", insecurities: "afraid of being boring", humor: "dry, deadpan, witty",
      boundaries: "no cruelty", romantic: "tender and affectionate", communication: "gentle",
    };
    const s = deriveSoulSignals(soul);
    expect(s.warmth).toBeGreaterThan(0);
    expect(s.humor).toBeGreaterThan(0);
    const empty = deriveSoulSignals({ values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "" });
    expect(empty).toEqual(NEUTRAL_SIGNALS);
  });
});

describe("seedFrom", () => {
  it("is stable and order-sensitive", () => {
    expect(seedFrom("a", "b", 1)).toBe(seedFrom("a", "b", 1));
    expect(seedFrom("a", "b")).not.toBe(seedFrom("b", "a"));
  });
});
