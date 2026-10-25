import { describe, expect, it } from "vitest";
import { parseSceneLines } from "@/lib/adult/scenes";

// Chud × Coco on prod, 2026-10-25: a reply in plain text put each line's why and its memory id ("F38") under labels that
// started with the speaker's name, so they were read as more lines from him and glued onto what he said on screen.
const names = { a: "Chud the crusher", b: "Coco Delacroix-Santos" };

describe("a plain-text reply's notes stay notes", () => {
  it("'Chud (why)' and 'Chud (memory)' are the line's notes, never something he says", () => {
    const reply = [
      "Chud: Good thing I'm excellent at crossing them then.",
      "Chud (why): He flirts back on her own terms.",
      "Chud (memory): F38",
      "Coco: Is that your professional assessment?",
      "Why: She makes him declare himself.",
      "Memory: none",
    ].join("\n");
    expect(parseSceneLines(reply, names)).toEqual([
      { who: "a", text: "Good thing I'm excellent at crossing them then.", why: "He flirts back on her own terms.", memory: "F38" },
      { who: "b", text: "Is that your professional assessment?", why: "She makes him declare himself.", memory: null },
    ]);
  });

  it("a stage direction in the label is still the speaker; a loose memory id is never a line", () => {
    const reply = ["**Chud (softly):** Stay behind me.", "Coco: F31", "Coco: Always."].join("\n");
    expect(parseSceneLines(reply, names).map((l) => [l.who, l.text])).toEqual([
      ["a", "Stay behind me."],
      ["b", "Always."],
    ]);
  });

  it("a 'Doing' label is the line's doing", () => {
    expect(parseSceneLines("Chud: Stay behind me.\nDoing: guarding the stalled lift", names)).toEqual([{ who: "a", text: "Stay behind me.", doing: "guarding the stalled lift" }]);
  });

  it("a label that only starts with a name isn't them ('Chudley: …')", () => {
    expect(parseSceneLines("Chudley: Hi.\nCoco: Hello.", names).map((l) => l.who)).toEqual(["b"]);
  });

  it("the JSON shape is untouched", () => {
    const reply = JSON.stringify({ lines: [{ who: "a", text: "Stay behind me.", why: "He's on duty.", memory: "F38" }] });
    expect(parseSceneLines(reply, names)).toEqual([{ who: "a", text: "Stay behind me.", why: "He's on duty.", memory: "F38" }]);
  });
});
