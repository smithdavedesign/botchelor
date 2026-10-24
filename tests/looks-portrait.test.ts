import { describe, expect, it } from "vitest";
import { looksPortraitPrompt } from "@/lib/looks";

describe("a character's portrait prompt (lib/looks.ts looksPortraitPrompt)", () => {
  it("draws an ageless character no older than the oldest look, and prefers the look's own age", () => {
    expect(looksPortraitPrompt({ gender: "man" }, 212)).toMatch(/a 60-year-old/);
    expect(looksPortraitPrompt({ gender: "man" }, 212)).not.toMatch(/212/);
    expect(looksPortraitPrompt({ gender: "woman", age: 34 }, 300)).toMatch(/a 34-year-old/);
    expect(looksPortraitPrompt({ gender: "woman" }, 29)).toMatch(/a 29-year-old/);
  });

  it("adds the kind's own fixed words, and nothing for a human", () => {
    const robot = looksPortraitPrompt({ gender: "woman", style: "anime" }, 24, "robot")!;
    expect(robot).toMatch(/^Clean modern anime illustration of a 24-year-old/);
    expect(robot).toMatch(/humanoid robot/);
    expect(robot.indexOf("humanoid robot")).toBeLessThan(robot.indexOf("Wearing"));
    expect(looksPortraitPrompt({ gender: "man" }, 30, "vampire")).toMatch(/A vampire: very pale skin/);
    const human = looksPortraitPrompt({ gender: "man" }, 30, "human")!;
    expect(human).toBe(looksPortraitPrompt({ gender: "man" }, 30));
  });

  it("needs a gender to draw anything", () => {
    expect(looksPortraitPrompt({}, 30, "ghost")).toBeNull();
  });
});
