import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftFromReading, EXPRESS_EXAMPLES, SILVER_FROM, suggestLooks } from "@/lib/express-create";
import { drawnAge, looksPortraitPrompt, workOutfit } from "@/lib/looks";

// 2026-11-22 audit: "Bonsai nursery owner" was drawn in hospital scrubs ("nurse" inside "nursery"), and a 64-year-old's
// suggested look was golden blonde, drawn as 60. Pure prompt checks: nothing here draws a picture.
describe("work clothes match whole job words only", () => {
  it("dresses the jobs it knows", () => {
    const cases: [string, string][] = [
      ["ER nurse", "scrubs"],
      ["Night-shift nurse", "scrubs"],
      ["Brain surgeon", "scrubs"],
      ["Army vet", "military"],
      ["Retired marine", "military"],
      ["Brigadier general", "military"],
      ["Police officer", "police"],
      ["Deputy sheriff", "police"],
      ["Marine biologist", "lab"],
      ["Bonsai nursery owner", "gardener"],
      ["Tree surgeon", "gardener"],
      ["Arborist", "gardener"],
      ["General practitioner", "doctor"],
      ["Sous-chef", "chef"],
      ["Café owner", "barista"],
      ["Restaurant server", "barista"],
      ["Diesel mechanic", "mechanic"],
      ["Civil engineer", "mechanic"],
      ["Personal trainer", "athlete"],
      ["Marathon runner", "athlete"],
      ["Surf instructor", "lifeguard"],
      ["Royal Navy officer", "captain"],
      ["Image consultant", "suit"],
      ["Chief executive officer", "suit"],
      ["General manager", "suit"],
      ["Co-founder", "suit"],
      ["Stockbroker", "suit"],
    ];
    for (const [job, id] of cases) expect([job, workOutfit(job).id]).toEqual([job, id]);
  });

  it("leaves a job in smart work clothes when its word only sits inside another, or means something else", () => {
    for (const job of [
      "Software engineer",
      "Loan officer",
      "Deputy head",
      "Twitch streamer",
      "Damage assessor",
      "Inventory clerk",
      "Surface pattern designer",
      "Gift wrapper",
      "Bodybuilder",
      "App builder",
      "Nail technician",
      "Server administrator",
      "Dog trainer",
      "Front-runner in local politics",
      "Make-up artist",
      "Tattoo artist",
      "Drag queen",
      "Royal Mail postman",
      "Team captain",
      "Spin doctor",
      "Pirate radio host",
      "Kindergarden helper",
      "War vet",
    ])
      expect([job, workOutfit(job).id]).toEqual([job, "work"]);
  });

  it("the bonsai grower's portrait wears a gardening apron, not scrubs", () => {
    const prompt = looksPortraitPrompt({ gender: "man", outfit: "work" }, 40, null, "Bonsai nursery owner")!;
    expect(prompt).toContain("a canvas gardening apron");
    expect(prompt).not.toContain("scrubs");
  });
});

describe("a portrait from picks is drawn at the character's own age", () => {
  it("draws ages up to a lifetime as written, older ones at the oldest look", () => {
    expect(drawnAge(29)).toBe(29);
    expect(drawnAge(64)).toBe(64);
    expect(drawnAge(99)).toBe(99);
    expect(drawnAge(212)).toBe(60);
    expect(looksPortraitPrompt({ gender: "man" }, 64)).toMatch(/a 64-year-old/);
    expect(looksPortraitPrompt({ gender: "woman" }, 81)).toMatch(/an? 81-year-old/);
  });
});

describe("the suggested look follows their age", () => {
  it(`gives silver hair from ${SILVER_FROM} unless their words give it a colour`, () => {
    const words = "A quiet man who grows bonsai";
    expect(suggestLooks({ pronouns: "he/him", words, age: 64 })!.hair_color).toBe("silver");
    expect(suggestLooks({ pronouns: "he/him", words, age: SILVER_FROM })!.hair_color).toBe("silver");
    expect(suggestLooks({ pronouns: "she/her", words: "A 64-year-old with golden hair", age: 64 })!.hair_color).toBe("blonde");
    // Younger, or ageless (drawn at the oldest look): the seeded pick, as before.
    const young = suggestLooks({ pronouns: "he/him", words })!.hair_color;
    expect(suggestLooks({ pronouns: "he/him", words, age: SILVER_FROM - 1 })!.hair_color).toBe(young);
    expect(suggestLooks({ pronouns: "he/him", words, age: 212 })!.hair_color).toBe(young);
    expect(young).not.toBe("silver");
  });

  it("the one-sentence draft passes the age and the job through to the portrait", () => {
    const text = "Barnaby, a 64-year-old bonsai nursery owner. He talks to his trees.";
    const r = draftFromReading(
      { name: "Barnaby Thorne", age: "64", gender: "male", occupation: "Bonsai nursery owner", description: "A patient bonsai grower.", personality: "patient, dry, warm", wants: "someone who slows down", dislikes: "rushing" },
      text,
    );
    if (!r.ok) throw new Error(r.message);
    const looks = r.draft.extras.looks!;
    expect(looks).toMatchObject({ gender: "man", hair_color: "silver", outfit: "work" });
    const prompt = looksPortraitPrompt(looks, Number(r.draft.sheet.age), null, r.draft.extras.occupation)!;
    expect(prompt).toMatch(/a 64-year-old/);
    expect(prompt).toContain("silver-grey");
    expect(prompt).toContain("a canvas gardening apron");
    expect(prompt).not.toMatch(/scrubs|blonde/);
  });
});

describe("the Look step around a suggested look", () => {
  it("every example chip says she or he, so its draft comes with a look", () => {
    for (const ex of EXPRESS_EXAMPLES) expect([ex.label, /\b(she|her|he|his|him)\b/i.test(ex.text)]).toEqual([ex.label, true]);
  });

  it("stops saying \"already picked\" once they pick by hand, and says a skipped look still gets a portrait", () => {
    const src = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(src).toMatch(/lookChanged\s*\?\s*"Their look is picked: change it any time, or go on\."\s*:\s*"A look that fits your words is already picked: change it, or go on\."/);
    expect(src).toMatch(/setLooks=\{\(l\) => \{\s*setLookChanged\(true\);/);
    expect(src).not.toContain("colour tile");
    expect(src).toContain("their free portrait is drawn from it, or from their bio if you skip it.");
  });
});
