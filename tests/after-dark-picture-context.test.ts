import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { autoPicturePrompt } from "@/lib/adult/auto-pictures";
import { pictureDress, wholeAction } from "@/lib/adult/media";
import { venueSituation } from "@/lib/adult/scene-catalog";
import { sceneMessages } from "@/lib/adult/scenes";
import { loadCharacter, type Character } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

// David, 2026-10-25, on a chapter picture's prompt: "not enough context of the scene and what they're wearing, like if
// they were just at a bar they wouldn't be in underwear … we are going to his apartment but they are both women"; and
// "the initial scene … was a double date … neither mention two others with them".
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const OWNER = "owner-1";
const LOOKS = { gender: "woman", ethnicity: "caucasian", hair_style: "straight", hair_color: "brunette", eyes: "brown", body: "slim", outfit: "casual", after_dark: { outfit: "lingerie" } };
/** Two women: hers (with an everyday outfit and After Dark's lingerie, owned by OWNER), and a house character. */
async function pair(): Promise<[Character, Character]> {
  const a = (await loadCharacter(t.db, HOUSE_CHARACTERS[0].id))!;
  const b = (await loadCharacter(t.db, HOUSE_CHARACTERS[1].id))!;
  return [
    { ...a, name: "Lexi", pronouns: "she/her", ownerId: OWNER, extras: { ...a.extras, looks: LOOKS } } as Character,
    { ...b, name: "Juniper Vale", pronouns: "she/her" } as Character,
  ];
}
const scene = (over: Partial<Parameters<typeof autoPicturePrompt>[0]>) => ({ id: "s", chapter: 1, place: null, set_place: null, stage: 0, lines: [], home: null, ...over });

describe("a chapter picture's prompt", () => {
  it("leaving a bar at the start of the night: dressed to go out, never in After Dark's lingerie", async () => {
    const [a, b] = await pair();
    const prompt = autoPicturePrompt(scene({ set_place: "bar", place: "a noisy downtown bar" }), a, b, OWNER);
    expect(prompt).toContain("a fitted white t-shirt and blue jeans");
    expect(prompt).not.toMatch(/lingerie|underwear|nude/i);
    expect(prompt).toMatch(/dressed for going out, in everyday clothes, out in public/);
  });

  it("at the double date: the smug couple is in the setting, and it's public", async () => {
    const [a, b] = await pair();
    const prompt = autoPicturePrompt(scene({ set_place: "An awkward double date", place: "An awkward double date", stage: 2 }), a, b, OWNER);
    expect(prompt).toContain("Setting: an awkward double date with a smug couple who finish each other's sentences.");
    expect(prompt).not.toMatch(/lingerie/i);
  });

  it("somewhere private once it's gone past flirting: After Dark's outfit; from undressing on, none", async () => {
    const [a, b] = await pair();
    expect(autoPicturePrompt(scene({ set_place: "Lexi's apartment", home: "a", stage: 2 }), a, b, OWNER)).toContain("black lace lingerie");
    expect(autoPicturePrompt(scene({ set_place: "Lexi's apartment", home: "a", stage: 1 }), a, b, OWNER)).not.toContain("lingerie");
    const undressing = autoPicturePrompt(scene({ set_place: "Lexi's apartment", home: "a", stage: 3 }), a, b, OWNER);
    expect(undressing).toMatch(/^Explicit, uncensored adult photograph/);
    expect(undressing).not.toMatch(/wearing/);
  });

  it("two women are never in 'his apartment'", async () => {
    const [a, b] = await pair();
    expect(autoPicturePrompt(scene({ set_place: "his apartment" }), a, b, OWNER)).toContain("Setting: her apartment.");
    expect(autoPicturePrompt(scene({ set_place: "his apartment", home: "b" }), a, b, OWNER)).toContain("Setting: Juniper's apartment.");
  });

  it("what they just did is whole: never cut off mid-phrase", async () => {
    const [a, b] = await pair();
    const lines = [
      { text: "*Lexi pushes the heavy bar door open, letting in a slice of cold night air and the hum of traffic from the street outside, then holds it for Juniper* After you." },
      { text: "*Juniper steps out into the quiet street, the city noise muffled behind.* Thanks." },
    ];
    const prompt = autoPicturePrompt(scene({ set_place: "the street", lines }), a, b, OWNER);
    const now = prompt.match(/Just now: (.+?)\. Photorealistic/)?.[1] ?? "";
    expect(now).toContain("letting in a slice of cold night air");
    expect(now).not.toMatch(/\b(of|a|the|in);/);
    const long = `${Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ")} letting in a slice of cold air and noise`;
    expect(wholeAction(long)).toBe(Array.from({ length: 21 }, (_, i) => `w${i}`).join(" "));
  });

  it("dress follows the stage and the place", () => {
    expect(pictureDress(undefined)).toBe("undressed");
    expect(pictureDress({ stage: 0 })).toBe("everyday");
    expect(pictureDress({ stage: 2, publicPlace: true })).toBe("everyday");
    expect(pictureDress({ stage: 2 })).toBe("after_dark");
    expect(pictureDress({ stage: 1, explicit: true })).toBe("undressed");
  });
});

describe("the writer's prompt at a library venue", () => {
  it("names what the venue puts them in, and lets the people in it be there without names or lines", async () => {
    const [a, b] = await pair();
    expect(venueSituation("An awkward double date")).toBe("an awkward double date with a smug couple who finish each other's sentences");
    expect(venueSituation("double_date")).toBe(venueSituation("An awkward double date"));
    expect(venueSituation("Lexi's apartment")).toBeNull();
    const text = sceneMessages(a, b, null, [], null, a.id, { place: "An awkward double date", set: "An awkward double date", stage: 0, cutTo: "An awkward double date" })
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("Tonight's situation: an awkward double date with a smug couple who finish each other's sentences.");
    expect(text).toContain("Only the two of them speak: Lexi and Juniper Vale.");
    expect(text).not.toContain("Nobody else speaks, arrives or is named");
    // Anywhere else, the two of them alone, as before.
    const alone = sceneMessages(a, b, null, [], null, a.id, { place: "her apartment", set: "her apartment", stage: 0 }).map((m) => m.content).join("\n");
    expect(alone).toContain("Nobody else speaks, arrives or is named");
    expect(alone).not.toContain("Tonight's situation");
  });
});
