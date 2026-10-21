import { describe, expect, it } from "vitest";
import { copiesSteer, stageShown, stagesFor, withoutSteerCopy } from "@/lib/adult/stage-floor";

// From David's Star Dust × Sable night (2026-10-21): the stage ran behind the words, and a Direct steer came back verbatim.
describe("the stage floor", () => {
  it("reads what a line plainly shows", () => {
    expect(stageShown("*laughs, leaning in closer* A preview? That's hardly fair, Star.")).toBeNull();
    expect(stageShown("*Reaches for Star's waist* Patience is overrated.")).toBe(1);
    expect(stageShown("*Pulls Star into a deep, passionate kiss* Oh, Star.")).toBe(2);
    expect(stageShown("*Quickly unbuttoning Star's blouse* You talk too much, Star.")).toBe(3);
    expect(stageShown("*Rips Star's pants off and starts eating her out* I've been dreaming about this.")).toBe(4);
    expect(stageShown("*Goes over to Sable's face and sits on it* Enjoy the show.")).toBe(4);
  });

  it("raises a claim that ran behind the lines, line by line, and never lowers one", () => {
    const lines = [
      { text: "*grins* Still talking, Star?" },
      { text: "*Unbuckling Star's belt slowly* Let's see how surprised you get." },
      { text: "*Rips Star's pants off and starts eating her out* This is the surprise of a lifetime." },
      { text: "*Grips Sable's hair* You're quite the surprise yourself." },
    ];
    // The model said "first touches" (1); the lines got to sex (4).
    expect(stagesFor(lines, 1, 1)).toEqual({ perLine: [1, 3, 4, 4], stage: 4 });
    // Lines that show nothing keep the claim, and the last line carries the scene's stage.
    expect(stagesFor([{ text: "Hi." }, { text: "Hello." }], 0, 1)).toEqual({ perLine: [0, 1], stage: 1 });
    // A higher claim stands.
    expect(stagesFor([{ text: "*kisses her* Hi." }], 3, 4).stage).toBe(4);
  });
});

describe("a Direct steer is acted out, never quoted", () => {
  it("drops an action that copies the steer and keeps the words", () => {
    expect(withoutSteerCopy("*Eat my pussy* This is the main event, Star.", "Eat my pussy")).toEqual({ text: "This is the main event, Star.", repaired: true });
    expect(withoutSteerCopy("*Rides her face harder* Still talking, Star?", "she rides her face harder")).toEqual({ text: "Still talking, Star?", repaired: true });
  });

  it("drops a line whose words copy it, or that has nothing left without the action", () => {
    expect(withoutSteerCopy("They go back to hers and into bed.", "They go back to hers and into bed")).toBeNull();
    expect(withoutSteerCopy("*Eat my pussy*", "Eat my pussy")).toBeNull();
  });

  it("leaves a line that acts it out in its own words, and any line with no steer", () => {
    const own = "*pulls her down onto the bed, laughing* Somebody's in a hurry tonight.";
    expect(withoutSteerCopy(own, "they go to bed")).toEqual({ text: own, repaired: false });
    expect(withoutSteerCopy(own, null)).toEqual({ text: own, repaired: false });
    // A word or two in common isn't a copy.
    expect(copiesSteer("she kisses her neck slowly", "kiss her on the neck")).toBe(false);
  });
});
