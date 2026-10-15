import { describe, expect, it } from "vitest";
import {
  buildReflectionMessages,
  parseReflection,
  REFLECTION_TEXT_MAX,
  simulateReflections,
} from "@/lib/reflection";
import { deterministicEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { assembleCharacter, type Character } from "@/lib/character";
import type { StoredSoul } from "@/lib/souls";
import { ModelError, type Model } from "@/lib/model";

const ALPHA = "ALPHASOULSECRET";
const BETA = "BETASOULSECRET";
const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet, agendaId: "find_adventurous" | "test_sincerity"): SideSetup => ({
  sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId, note: null, gameBudget: 25,
});
const INPUT: DateInput = { a: side(sheetA, "find_adventurous"), b: side(sheetB, "test_sincerity") };
const soul = (marker: string): StoredSoul =>
  ({ values: `honesty ${marker}`, insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false, signals: null });
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: soul(ALPHA), memory: null }),
  assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: soul(BETA), memory: null }),
];
const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = { ...deterministicEngine.decide(INPUT, 1), ending: "friends", sides: [sideOutcome(true), sideOutcome(false)] };

const content = (messages: { role: string; content: string }[]) => messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
const reflectionJson = (text: string) => JSON.stringify({ reflection: text });

describe("reflection — privacy (an in-character postmortem sees only its own side)", () => {
  it("a character's reflection prompt never carries the other's soul or secret agenda", () => {
    const a = content(buildReflectionMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", "a"));
    expect(a).toContain(ALPHA); // its own soul
    expect(a).not.toContain(BETA); // never the other's soul
    expect(a).not.toContain("Test whether the other is sincere"); // never the other's agenda label

    const b = content(buildReflectionMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", "b"));
    expect(b).toContain(BETA);
    expect(b).not.toContain(ALPHA);
    expect(b).not.toContain("Find someone adventurous");
  });

  it("each side is told its own want and its own engine-decided feeling", () => {
    const a = content(buildReflectionMessages(INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", "a"));
    expect(a).toContain("a map reader"); // A's own want
    expect(a).toMatch(/friend/i); // friends-ending feeling, worded for the ending
  });
});

describe("parseReflection", () => {
  it("accepts a valid reflection and trims an over-long one", () => {
    expect(parseReflection(reflectionJson("I think I talk too much when I'm nervous."))).toBe("I think I talk too much when I'm nervous.");
    const long = parseReflection(reflectionJson("word ".repeat(100)));
    expect(long && long.length).toBeLessThanOrEqual(REFLECTION_TEXT_MAX);
  });
  it("rejects bad JSON, the wrong shape, and anything the content filter blocks", () => {
    expect(parseReflection("not json")).toBeNull();
    expect(parseReflection(JSON.stringify({ text: "wrong key" }))).toBeNull();
    expect(parseReflection(reflectionJson("She was barely legal."))).toBeNull();
  });
});

describe("simulateReflections", () => {
  it("returns each side's reflection in character", async () => {
    const model: Model = { async complete() { return reflectionJson("I learned I want someone who asks a second question."); } };
    const out = await simulateReflections(model, INPUT, OUTCOME, CHARS, "rooftop_bar");
    expect(out.a).toBe("I learned I want someone who asks a second question.");
    expect(out.b).toBe("I learned I want someone who asks a second question.");
  });

  it("never throws when the model keeps failing: both sides are null", async () => {
    const model: Model = { async complete() { throw new ModelError("rate limited"); } };
    await expect(simulateReflections(model, INPUT, OUTCOME, CHARS, "rooftop_bar")).resolves.toEqual({ a: null, b: null });
  });

  it("a model that only returns garbage yields nulls, not an error", async () => {
    const model: Model = { async complete() { return "nope"; } };
    await expect(simulateReflections(model, INPUT, OUTCOME, CHARS, "rooftop_bar")).resolves.toEqual({ a: null, b: null });
  });

  it("runs a side on that side's own model when actorForSide is given (BYOK)", async () => {
    const platform: Model = { async complete() { return reflectionJson("platform reflection"); } };
    const aKey: Model = { async complete() { return reflectionJson("A's own key reflection"); } };
    const out = await simulateReflections(platform, INPUT, OUTCOME, CHARS, "rooftop_bar", "classic", {}, [], (s) => (s === "a" ? aKey : null));
    expect(out.a).toBe("A's own key reflection");
    expect(out.b).toBe("platform reflection");
  });
});
