import { describe, expect, it } from "vitest";
import { checkFamilyTalk, checkShowText } from "@/lib/safety";

// 2026-11-08 companion quality sim: a parent talking about their kid got the PG deflection.
describe("checkFamilyTalk (companion chats only)", () => {
  it("lets a person's family talk through that the show's age rule refuses", () => {
    for (const line of [
      "A six-year-old dino expert. Respect.",
      "What does a nine-year-old want for her birthday?",
      "The best thing at the bakery today was a little boy who ordered a croissant like a grown-up.",
      "My daughter is a teenager now and she hates everything I cook.",
      "Mateo starts kindergarten in the autumn.",
    ]) {
      expect(checkShowText({ dialogue: line }).ok, line).toBe(false);
      expect(checkFamilyTalk(line).ok, line).toBe(true);
    }
  });

  it("still refuses a child near anything romantic or bodily, and the words that sexualise one", () => {
    for (const line of [
      "She's a cute little girl, give her a kiss from me.",
      "a teenager in my bed",
      "jailbait",
      "schoolgirl outfit tonight?",
      "barely legal",
      "when I was twelve I had my first crush",
    ])
      expect(checkFamilyTalk(line).ok, line).toBe(false);
  });

  it("is the show's check for everything else", () => {
    expect(checkFamilyTalk("let's have sex").ok).toBe(false);
    expect(checkFamilyTalk("that's what she said").ok).toBe(false);
    expect(checkFamilyTalk("Taylor Swift is my favourite").ok).toBe(false);
    expect(checkFamilyTalk("See you tomorrow!").ok).toBe(true);
  });
});
