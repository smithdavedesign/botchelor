import { describe, expect, it } from "vitest";
import { ACTS, actById } from "@/lib/adult/acts";
import { everydayOf, lookWords } from "@/lib/adult/media";
import type { Character } from "@/lib/character";

// 2026-10-30: a character with no outfit picked was "in everyday clothes", so every picture dressed them differently; and
// the brief had no act for sitting together, so those moments came out vague.
const someone = (over: Partial<Character>): Character =>
  ({ id: "c-1", name: "Sam", age: 30, pronouns: "she/her", ownerId: "o", extras: {}, ...over }) as Character;

describe("everyday clothes for someone with no outfit", () => {
  it("is the same named outfit every time, by their id", () => {
    const one = everydayOf(someone({}));
    expect(one).not.toMatch(/everyday clothes/);
    expect(everydayOf(someone({}))).toBe(one);
    const picks = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => everydayOf(someone({ id }))));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("dresses a man from the men's picks, and someone with neither pronoun neutrally", () => {
    const his = new Set(["a", "b", "c", "d", "e", "f"].map((id) => everydayOf(someone({ id, pronouns: "he/him" }))));
    for (const w of his) expect(w).not.toMatch(/blouse|leggings|dress/);
    expect(everydayOf(someone({ pronouns: "they/them" }))).toBe("a plain t-shirt, a dark jacket and jeans");
  });

  it("uses their own style words when they're clean", () => {
    expect(everydayOf(someone({ extras: { style: "vintage band tees and a leather jacket" } as Character["extras"] }))).toBe("vintage band tees and a leather jacket");
  });

  it("goes into a looks-built character's picture words when they have no outfit", () => {
    const c = someone({ extras: { looks: { gender: "woman", hair_color: "brunette", body: "slim" } } as Character["extras"] });
    expect(lookWords(c, false, null, false, true)).toContain(`wearing ${everydayOf(c)}`);
  });
});

describe("sitting together", () => {
  it("is on the menu from the start, fully clothed, with both points of view", () => {
    const sit = actById("sit")!;
    expect(ACTS.indexOf(sit)).toBe(1);
    expect(sit.minStage).toBe(0);
    expect(sit.pose).toMatch(/sit side by side/);
    expect(sit.pov?.x && sit.pov.y).toBeTruthy();
    expect(actById("close")!.label).toBe("Standing close");
  });
});
