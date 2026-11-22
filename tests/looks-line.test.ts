import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { physicalLook } from "@/lib/adult/media";
import { tellApart } from "@/lib/adult/reels";
import type { Character } from "@/lib/character";
import { isLooksLine, looksAppearance, withoutLooksNoun, type Looks } from "@/lib/looks";
import { pgSubject } from "@/lib/studio/pg";

// 2026-11-22 audit: the looks builder's appearance line says "Black woman", not "Black" beside the hair words. A line it
// wrote before then is still its own, and a picture prompt, which names the person itself, says the noun once.
const read = (p: string) => readFileSync(p, "utf8");
const looks: Looks = { gender: "woman", ethnicity: "black", hair_style: "straight", hair_color: "red" };
const NOW = "Black woman, long straight copper-red hair falling past the shoulders";
const BEFORE = "Black, long straight copper-red hair falling past the shoulders";
const made = (appearance: string) => ({ id: "char-ines-1", name: "Ines Okafor", age: 30, pronouns: "she/her", look: { appearance }, extras: {} }) as unknown as Character;

describe("the looks builder's appearance line", () => {
  it("is its own in today's words and in the words it was saved in; a typed line isn't", () => {
    expect(looksAppearance(looks)).toBe(NOW);
    expect(isLooksLine(NOW, looks)).toBe(true);
    expect(isLooksLine(BEFORE, looks)).toBe(true);
    expect(isLooksLine(` ${BEFORE} `, looks)).toBe(true);
    expect(isLooksLine("Black, long straight copper-red hair, a chipped front tooth", looks)).toBe(false);
    expect(isLooksLine("", looks)).toBe(false);
    expect(isLooksLine(NOW, undefined)).toBe(false);
    // The create wizard and After Dark's restyle both ask it, so a line saved before still follows new picks.
    expect(read("app/create/CreateWizard.tsx")).toContain("!isLooksLine(init.appearance, init.extras.looks)");
    expect(read("lib/adult/studio.ts")).toContain("!isLooksLine(c.look.appearance, before)");
  });

  it("names the person once in a picture prompt, in the words it had before", () => {
    expect(withoutLooksNoun(NOW)).toBe(BEFORE);
    expect(withoutLooksNoun(looksAppearance({ ...looks, style: "anime" }))).toBe(`anime-style, ${BEFORE}`);
    expect(looksAppearance({ gender: "man", ethnicity: "latina" })).toBe("Latino man");
    expect(withoutLooksNoun("Latino man")).toBe("Latino");
    // Only a part that is where they're from and the noun: other words stay as they were typed.
    expect(withoutLooksNoun("a tall Black woman with a shaved head")).toBe("a tall Black woman with a shaved head");
    expect(withoutLooksNoun("Mixed race woman, freckles")).toBe("Mixed race woman, freckles");
    expect(pgSubject(made(NOW)).look).toBe(BEFORE);
    expect(physicalLook(made(NOW))).toBe(BEFORE);
  });

  it("still tells two women apart by where they're from", () => {
    const latina = physicalLook(made("Latina woman, long straight copper-red hair falling past the shoulders"));
    expect(tellApart([latina, physicalLook(made(NOW))], "woman")).toEqual(["the Latina woman", "the Black woman"]);
  });
});
