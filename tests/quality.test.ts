import { describe, expect, it } from "vitest";
import { assembleCharacter, type Character } from "@/lib/character";
import type { Turn } from "@/lib/conversation";
import type { CharacterSheet } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { contentWords, lineIssues, transcriptQuality } from "@/lib/quality";

const jun = HOUSE_CHARACTERS.find((c) => c.id === "house-juniper")!;
const juniperSheet: CharacterSheet = {
  name: jun.name, age: jun.age, bio: jun.bio, traits: jun.traits, want: jun.want, dealbreaker: jun.dealbreaker,
  house: true, appearance: jun.appearance, pronouns: jun.pronouns, voice: jun.voice,
};
const davidSheet: CharacterSheet = {
  name: "David Smith", age: 22, bio: "a dude", traits: ["hot", "cool", "naughty"], want: "fun", dealbreaker: "boring people",
  house: false, appearance: "a cool blue palette, dark and vivid", pronouns: "he/him",
};
const CHARS: [Character, Character] = [
  assembleCharacter({ id: "oc", sheet: davidSheet, soul: null, memory: null }),
  assembleCharacter({ id: "house-juniper", sheet: juniperSheet, soul: null, memory: null }),
];
const PRONOUNS: [string, string] = ["he/him", "she/her"];
const turn = (side: "a" | "b", dialogue: string, interest = 0.5, act = 0): Turn => ({ side, act, dialogue, action: "", emotion: "", interest });
const q = (t: Turn[], pronouns: [string, string] = PRONOUNS) => transcriptQuality(t, CHARS, { pronouns, shared: "a karaoke booth" });

describe("transcriptQuality — the audit's tells, on the real lines that showed them", () => {
  it("profile_reading: quoting the other's profile before they've said it", () => {
    const leaked = q([turn("a", "A lighthouse keeper with eleven podcast listeners? Okay, that's actually hilarious.")]);
    expect(leaked.profile_reading).toBe(1);
    // Once she has told him, it's fair game.
    const told = q([turn("b", "I keep a lighthouse. I also host a podcast nobody listens to."), turn("a", "A lighthouse AND a podcast? Tell me more.")]);
    expect(told.profile_reading).toBe(0);
  });

  it("profile_reading: labelling the other with their trait words", () => {
    expect(q([turn("a", "Let's see if your deadpan schtick can survive a duet.")]).profile_reading).toBe(1);
  });

  it("self_labels: announcing your own traits", () => {
    expect(q([turn("b", "I'm so deadpan it hurts.")]).self_labels).toBe(1);
    expect(q([turn("b", "The gulls have stopped answering me.")]).self_labels).toBe(0);
  });

  it("misgendered: words that contradict the other's pronouns", () => {
    expect(q([turn("a", "Alright, tough guy, let's see if you survive my power ballad.")]).misgendered).toBe(1);
    expect(q([turn("a", "Alright, tough guy, let's see if you survive my power ballad.")], ["he/him", "they/them"]).misgendered).toBe(0);
  });

  it("abrupt_flips: interest swinging half the scale between one side's lines", () => {
    const t = [
      turn("a", "Challenge accepted, let's duet.", 0.8),
      turn("b", "Lead the way.", 0.5),
      turn("a", "On second thought, this vibe is way too gloomy for me. I'm out.", 0),
    ];
    expect(q(t).abrupt_flips).toBe(1);
  });

  it("repeated_openers: the same speaker starting lines the same way", () => {
    const t = [turn("a", "Honestly, I love this place."), turn("b", "Do you."), turn("a", "Honestly, I could stay all night.")];
    expect(q(t).repeated_openers).toBe(1);
  });

  it("repeated_actions: a stage direction the date already used, by either side (from the eval's real lines)", () => {
    const act = (side: "a" | "b", dialogue: string, action: string): Turn => ({ ...turn(side, dialogue), action });
    // Juniper copies his "brushes dumpling dust off knee"; then he re-adjusts his shirt.
    const t = [
      act("a", "Sitting here is better than the foam.", "brushes dumpling dust off knee"),
      act("b", "That is remarkably true about the salt.", "brushes dumpling dust off knee"),
      act("a", "You keep the lighthouse alone?", "adjusts shirt cuff"),
      act("b", "Mostly the gulls keep it.", "smiles"),
      act("a", "Brave gulls.", "adjusts shirt collar"),
      act("b", "Very.", "smiles"), // one-word actions are too common to count
    ];
    expect(q(t).repeated_actions).toBe(2);
    expect(lineIssues(t.slice(0, 1), t[1], CHARS).repeated_action).toBe("brushes dumpling dust off knee");
  });

  it("name_tics: saying the other's name in line after line", () => {
    const t = [
      turn("b", "Oh, David, you're killing me."),
      turn("a", "Am I?"),
      turn("b", "You are full of surprises, David."),
      turn("a", "Guilty."),
      turn("b", "Text me Tuesday."),
    ];
    expect(q(t).name_tics).toBe(1);
  });

  it("question rate, responsiveness and distinct vocabulary behave sensibly", () => {
    const t = [
      turn("a", "What keeps you out on that rock all winter?"),
      turn("b", "The rock keeps me. Winter just visits. Why do you sing like someone's grading you?"),
      turn("a", "Because someone always is. Usually me."),
    ];
    const m = q(t);
    expect(m.question_rate).toBeCloseTo(2 / 3, 2);
    expect(m.responsiveness).toBe(1); // each reply picks up the line it answers
    expect(m.distinctness).toBeGreaterThan(0.5);
    expect(m.index).toBeGreaterThan(0);
    expect(m.index).toBeLessThanOrEqual(100);
  });

  it("is pure and handles an empty transcript", () => {
    const empty = q([]);
    expect(empty.turns).toBe(0);
    expect(empty.index).toBe(0);
    expect(contentWords("The fog, the GULLS, and the lighthouse!")).toEqual(["gulls", "lighthouse"]);
    expect(contentWords("The fog, the GULLS, and the lighthouse!", 3)).toEqual(["fog", "gulls", "lighthouse"]);
  });
});
