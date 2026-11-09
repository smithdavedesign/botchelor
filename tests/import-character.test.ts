import { describe, expect, it } from "vitest";
import {
  cardJsonFromPng,
  cutTo,
  freeTextFallback,
  importCharacter,
  importFromFields,
  readAttributes,
  readSource,
  statedAge,
  traitsFrom,
} from "@/lib/import-character";
import { CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";

const ST_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Marisol Vane",
    description:
      "{{char}} is a 29-year-old lighthouse keeper on a foggy island who repairs old radios and listens to ships talk at night. She trusts the sea more than people.\n[Appearance: salt-stiff braid, oversized yellow raincoat, ink-stained fingers]\nOccupation: lighthouse keeper\nLikes: shortwave radio, storms, black licorice\nDislikes: people who whistle indoors, liars",
    personality: "wry, patient, guarded",
    scenario: "{{user}} washes up on {{char}}'s island after a storm.",
    first_mes: '*She looks up from a radio in pieces.* "You\'re dripping on my schematics. Tea\'s on the stove, help yourself."',
    mes_example: '<START>\n{{user}}: What are you fixing?\n{{char}}: *taps the dial* "A radio that only picks up the weather. Like me."',
    creator_notes: "",
    tags: ["oc"],
  },
};

describe("import: SillyTavern chara_card_v2", () => {
  it("maps name, age, bio, traits, voice, hello and the labelled lines", () => {
    const r = importCharacter(JSON.stringify(ST_CARD));
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.format).toBe("chara_card_v2");
    const d = r.draft;
    expect(d.sheet.name).toBe("Marisol Vane");
    expect(d.sheet.age).toBe("29");
    expect(d.sheet.bio).toMatch(/^Marisol Vane is a 29-year-old lighthouse keeper/);
    expect(d.sheet.bio).not.toMatch(/\{\{|Appearance|Likes/);
    expect(d.traits).toEqual(["wry", "patient", "guarded"]);
    // One "she" in the prose is not enough to say: pronouns stay for them to pick.
    expect(d.pronouns).toBe("");
    expect(d.appearance).toMatch(/yellow raincoat/);
    expect(d.extras.occupation).toBe("lighthouse keeper");
    expect(d.extras.hobbies).toEqual(["shortwave radio", "storms", "black licorice"]);
    expect(d.sheet.dealbreaker).toBe("people who whistle indoors");
    expect(d.extras.pet_peeve).toBe("liars");
    expect(d.extras.lines?.hello).toBe("You're dripping on my schematics. Tea's on the stove, help yourself.");
    expect(d.voice).toBe('Talks like this: "A radio that only picks up the weather. Like me."');
    // The scenario is roleplay setup: never in the sheet.
    expect(JSON.stringify(d)).not.toMatch(/washes up/);
    expect(r.missing).toEqual(["what they want", "two dating-profile answers"]);
  });

  it("reads the v1 TavernAI shape and a v3 card the same way", () => {
    const v1 = readSource(JSON.stringify(ST_CARD.data));
    expect(v1?.format).toBe("tavern_v1");
    expect(v1?.fields.greeting).toMatch(/schematics/);
    const v3 = readSource(JSON.stringify({ ...ST_CARD, spec: "chara_card_v3" }));
    expect(v3?.format).toBe("chara_card_v3");
    expect(v3?.fields.name).toBe("Marisol Vane");
  });

  it("reads a Pygmalion file", () => {
    const r = readSource(JSON.stringify({ char_name: "Ovid Pell", char_persona: "earnest, nosy, kind", char_greeting: "Oh! Hello." }));
    expect(r?.format).toBe("pygmalion");
    expect(r?.fields).toMatchObject({ name: "Ovid Pell", personality: "earnest, nosy, kind", greeting: "Oh! Hello." });
  });

  it("reads W++ in the description", () => {
    const card = {
      name: "Tobias Wren",
      description: '[character("Tobias Wren") { Age("34") Gender("Male") Personality("Stubborn" + "Funny" + "Loyal") Occupation("Ferry captain") Likes("Accordion music" + "Fog") }]\nTobias runs the last night ferry and talks to the gulls.',
      first_mes: "Mind the gap, the boat bites.",
    };
    const r = importCharacter(JSON.stringify(card));
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.draft.sheet.age).toBe("34");
    expect(r.draft.pronouns).toBe("he/him");
    expect(r.draft.traits).toEqual(["stubborn", "funny", "loyal"]);
    expect(r.draft.extras.occupation).toBe("Ferry captain");
    expect(r.draft.extras.hobbies).toEqual(["Accordion music", "Fog"]);
    expect(r.draft.sheet.bio).toBe("Tobias runs the last night ferry and talks to the gulls.");
    expect(r.draft.extras.lines?.hello).toBe("Mind the gap, the boat bites.");
  });

  it("reads the card out of a PNG's chara chunk", () => {
    const json = JSON.stringify(ST_CARD);
    const b64 = Buffer.from(json, "utf8").toString("base64");
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", Buffer.alloc(13)),
      chunk("tEXt", Buffer.concat([Buffer.from("chara\0", "latin1"), Buffer.from(b64, "latin1")])),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(cardJsonFromPng(new Uint8Array(png))).toBe(json);
    expect(cardJsonFromPng(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("import: Character.AI-style labelled fields", () => {
  const PASTE = `Name: Pim Okafor
Tagline: Night-shift baker with opinions about rye
Description: Pim bakes bread for the whole street before sunrise and leaves notes in the loaves.
Greeting: Oh, hi. You're early. The rye isn't ready, but the gossip is.
Definition:
Age: 31
Gender: nonbinary
Personality: dry, generous, nosy
Likes: sourdough starters, crossword puzzles
Wants: someone who'll split the last croissant
{{char}}: Bread doesn't lie. People do.
{{user}}: Is that a threat?`;

  it("maps every labelled field", () => {
    const r = importCharacter(PASTE);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.format).toBe("labelled");
    expect(r.draft.sheet.name).toBe("Pim Okafor");
    expect(r.draft.sheet.bio).toBe("Night-shift baker with opinions about rye. Pim bakes bread for the whole street before sunrise and leaves notes in the loaves.");
    expect(r.draft.sheet.age).toBe("31");
    expect(r.draft.pronouns).toBe("they/them");
    expect(r.draft.traits).toEqual(["dry", "generous", "nosy"]);
    expect(r.draft.sheet.want).toBe("someone who'll split the last croissant");
    expect(r.draft.extras.hobbies).toEqual(["sourdough starters", "crossword puzzles"]);
    expect(r.draft.extras.lines?.hello).toBe("Oh, hi. You're early. The rye isn't ready, but the gossip is.");
  });

  it("takes labels on their own line, as copying the creator form gives", () => {
    const r = readSource("Name\nPim Okafor\nGreeting\nHello there.\nDescription\nA baker.");
    expect(r?.format).toBe("labelled");
    expect(r?.fields).toMatchObject({ name: "Pim Okafor", greeting: "Hello there.", description: "A baker." });
  });

  it("copes with a messy paste: markdown bold, odd spacing, emoji, a fandom tag in the name", () => {
    const messy = `**Name:**   Juniper Ash 🌿 (my OC)\r\n\r\n**Tagline** : plant witch, terrible at texting\r\n\r\n**Greeting:** *waves a trowel* "You're standing on my basil."\r\n\r\n   Personality:  Curious;  Scatterbrained ; WARM  \r\n`;
    const r = importCharacter(messy);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.draft.sheet.name).toBe("Juniper Ash");
    expect(r.draft.sheet.bio).toBe("plant witch, terrible at texting.");
    expect(r.draft.traits).toEqual(["curious", "scatterbrained", "warm"]);
    expect(r.draft.extras.lines?.hello).toBe("You're standing on my basil.");
    expect(r.missing).toContain("an adult age (18 or over)");
  });
});

describe("import: the show's rules", () => {
  it("refuses a stated age under 18", () => {
    const r = importCharacter(JSON.stringify({ name: "Kit", description: "Kit is 16 years old and loves skating.", first_mes: "hey" }));
    expect(r).toMatchObject({ ok: false, reason: "minor", message: CHARACTER_REJECTION_MESSAGES.minor });
  });

  it("refuses a minor anywhere in the source, even in a field that isn't imported", () => {
    const r = importCharacter(JSON.stringify({ name: "Ren Hollis", description: "A painter.", scenario: "{{char}} is a high school student in your class.", first_mes: "Hi." }));
    expect(r).toMatchObject({ ok: false, reason: "minor" });
  });

  it("refuses a real person's name", () => {
    const r = importCharacter(JSON.stringify({ name: "Taylor Swift", description: "A singer.", first_mes: "Hi." }));
    expect(r).toMatchObject({ ok: false, reason: "real_person" });
  });

  it("leaves out a field that isn't PG and says so, keeping the rest", () => {
    const r = importCharacter(
      JSON.stringify({ name: "Dax Orlow", description: "A chef who runs a tiny noodle bar.", personality: "bold, warm, loud", first_mes: "Wanna see my bedroom? *winks* It's very sexy." }),
    );
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.draft.extras.lines).toBeUndefined();
    expect(r.dropped).toEqual([{ field: "hello line", why: "the show is PG" }]);
    expect(r.draft.sheet.bio).toBe("A chef who runs a tiny noodle bar.");
  });

  it("says when there's nothing to read", () => {
    expect(importCharacter("   ")).toMatchObject({ ok: false, reason: "empty" });
    expect(importCharacter(JSON.stringify({ foo: 1 }))).toMatchObject({ ok: "free_text" });
  });
});

describe("import: free text", () => {
  it("is sent to the model, cut to size, unless it names a minor", () => {
    const blob = "She is a retired stunt double who now runs a quiet bookshop. ".repeat(200);
    const r = importCharacter(blob);
    expect(r.ok).toBe("free_text");
    if (r.ok !== "free_text") return;
    expect(r.text.length).toBeLessThanOrEqual(6000);
    expect(importCharacter("a shy middle schooler who loves cats")).toMatchObject({ ok: false, reason: "minor" });
  });

  it("falls back to a bio (and a name, when the first line is one) without a model", () => {
    expect(freeTextFallback("Mara Quill\nRuns a night market stall selling maps to places that don't exist.")).toEqual({
      name: "Mara Quill",
      description: "Runs a night market stall selling maps to places that don't exist.",
    });
    expect(freeTextFallback("a grumpy wizard who sells umbrellas")).toEqual({ description: "a grumpy wizard who sells umbrellas" });
  });

  it("maps what the model read out like any labelled source", () => {
    const r = importFromFields("free_text", { name: "Mara Quill", description: "Runs a map stall.", age: "41", gender: "female", personality: "sly, kind, restless", wants: "a co-pilot" }, "…");
    expect(r).toMatchObject({ ok: true, draft: { sheet: { name: "Mara Quill", age: "41", want: "a co-pilot" }, pronouns: "she/her", traits: ["sly", "kind", "restless"] } });
  });
});

describe("import helpers", () => {
  it("cuts at a sentence, then a word, never mid-word", () => {
    expect(cutTo("One two. Three four five six.", 12)).toBe("One two.");
    expect(cutTo("alpha beta gamma delta", 13)).toBe("alpha beta");
  });

  it("reads traits only from a list, not prose", () => {
    expect(traitsFrom("Shy. Kind. Curious.")).toEqual(["shy", "kind", "curious"]);
    expect(traitsFrom("She is the kind of person who always helps her neighbours with their shopping")).toEqual([]);
  });

  it("finds an age in prose or a label", () => {
    expect(statedAge(undefined, "a 45 year old pilot")).toBe(45);
    expect(statedAge("Age: around 30", "")).toBe(30);
    expect(statedAge(undefined, "an ageless spirit")).toBeNull();
  });

  it("takes labelled lines out of the prose", () => {
    const { attrs, prose } = readAttributes("Likes: tea\nShe repairs clocks for a living.\n- Hates: rain");
    expect(attrs).toEqual({ likes: "tea", dislikes: "rain" });
    expect(prose).toBe("She repairs clocks for a living.");
  });
});
