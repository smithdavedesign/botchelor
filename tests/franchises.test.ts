import { describe, expect, it } from "vitest";
import { NO_FRANCHISE_WORDS } from "@/lib/franchise-words";
import { FRANCHISE_COUNT, franchiseHits, franchiseRefusal, franchiseWarning, sheetFields, sheetRefusal } from "@/lib/franchises";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { portraitPrompt as showPortraitPrompt } from "@/lib/image";
import { withFranchise } from "@/lib/originality-concept";
import type { OriginalityReport } from "@/lib/originality";
import { recastPortraitPrompt } from "@/lib/recast";
import { draftMessages, portraitPrompt as newcomerPortraitPrompt } from "@/lib/season-gen";
import { veoClipPrompt } from "@/lib/video";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Originals only (lib/franchises.ts, PRD styles-and-storylines phase 5): the franchise a character's own words name.
const names = (fields: Record<string, unknown>) => franchiseHits(fields).map((h) => h.franchise);

/** Every franchise and its names, read back from the module's own table. */
function table(): { franchise: string; aliases: string[] }[] {
  const src = readFileSync(join(process.cwd(), "lib/franchises.ts"), "utf8");
  return [...src.matchAll(/^ {2}\["([^"]+)", "[a-z]+", "([^"]+)"\],$/gm)].map((m) => ({ franchise: m[1], aliases: m[2].split(", ") }));
}

describe("which franchise a character's words name", () => {
  it("knows its 117 franchises, and finds each by every one of its names, mid-sentence, in who a character is", () => {
    const rows = table();
    expect(rows).toHaveLength(FRANCHISE_COUNT);
    expect(FRANCHISE_COUNT).toBe(117);
    let checked = 0;
    for (const { franchise, aliases } of rows) {
      for (const alias of aliases) {
        expect(names({ appearance: `They say I'm ${alias}, honestly.` }), `${alias} → ${franchise}`).toContain(franchise);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1400);
  });

  it("reads a name in any case or spacing, full-width letters, curly apostrophes, and CJK titles inside other words", () => {
    expect(franchiseHits({ name: "Raiden Shogun" })[0]).toMatchObject({ franchise: "Genshin Impact", field: "name", matched: "Raiden Shogun", school_age: false });
    expect(names({ name: "RAIDEN-SHOGUN" })).toEqual(["Genshin Impact"]);
    expect(names({ name: "raiden   shogun" })).toEqual(["Genshin Impact"]);
    expect(names({ appearance: "a ＧＥＮＳＨＩＮ cosplay" })).toEqual(["Genshin Impact"]);
    expect(names({ bio: "Kal’tsit's understudy" })).toEqual(["Arknights"]);
    expect(names({ appearance: "原神风格的角色扮演" })).toEqual(["Genshin Impact"]);
    expect(names({ appearance: "鬼滅の刃の炭治郎みたい" }).length).toBeGreaterThan(0);
  });

  it("counts a title only in who a character is, and a character's name or a place anywhere", () => {
    // A fan: titles in the bio, a hobby or a profile answer (in English or Chinese) aren't a copy.
    expect(names({ bio: "Plays Genshin on the night ferry; a big Pokémon fan.", extras: { hobbies: ["Minecraft"] } })).toEqual([]);
    expect(names({ bio: "原神角色的粉丝" })).toEqual([]);
    // The same titles as their name or their look are.
    expect(names({ name: "Genshin Girl" })).toEqual(["Genshin Impact"]);
    expect(names({ appearance: "a Minecraft creeper hoodie" })).toEqual(["Minecraft / Roblox / Fortnite"]);
    // A character's name, or a place, counts in the bio too.
    expect(names({ bio: "Cosplays Raiden Shogun at weekends." })).toEqual(["Genshin Impact"]);
    expect(names({ bio: "Teaches potions at Hogwarts." })).toEqual(["Harry Potter"]);
    // A name inside the franchise's own, or with it tacked on, isn't taken for its title: "Mercy Overwatch" is a character.
    expect(names({ bio: "Healer energy, like Mercy Overwatch." })).toEqual(["Overwatch"]);
  });

  it("looks in every field, lists, the extras and the soul, once a franchise, with the first field that names it", () => {
    const hits = franchiseHits(
      sheetFields({
        name: "Geralt",
        bio: "A monster hunter. Not the witcher, honest.",
        traits: ["gruff", "loyal"],
        extras: { prompts: [{ id: "geek_out", answer: "Tifa Lockhart's bar" }], hobbies: ["pokemon cards", "Pikachu plushies"] },
      }),
    );
    expect(hits.map((h) => [h.franchise, h.field])).toEqual([
      ["The Witcher", "name"],
      ["Final Fantasy", "extras"],
      ["Pokémon", "extras"],
    ]);
    expect(hits.find((h) => h.franchise === "Pokémon")).toMatchObject({ matched: "Pikachu", school_age: true });
  });

  it("leaves originals alone, everyday words, real names and a fan's titles included", () => {
    const originals = [
      { name: "Ariel Moss", bio: "A marine biologist who studies arcane tide law and races dune buggies on weekends." },
      { name: "Kazuha Mori", bio: "Works at Disney as an animator; her cat is called Loki." },
      { name: "Venti Okafor", bio: "Orders a venti oat latte, born March 7th, keeps a silver wolf tattoo." },
      { name: "Ray Price", bio: "Came home in one piece after a tour, the joker of the group, reads Cinderella to his niece." },
      { name: "Geraltine Hopper", bio: "A trailblazer in hospice care with a dark urge to bake at 3 a.m." },
      { name: "Marceline Dupont", bio: "Spirited away by a good book, she hates bad batch coffee and top gun posturing." },
      { name: "Eula Grant", bio: "Reads every EULA. Her iron man triathlon medal hangs by the door." },
      { name: "Ines Varga", bio: "Plays Genshin Impact on the night ferry and reads Harry Potter to her niece.", extras: { hobbies: ["Pokémon cards", "Minecraft", "Star Wars marathons"] } },
      { name: "Dana Okoro", bio: "A real Wonder Woman at work, and suave as James Bond on a night out, like Aladdin with a lamp." },
    ];
    for (const o of originals) expect(names(sheetFields(o)), o.name).toEqual([]);
  });

  it("warns people and refuses ours, in words that say which and why", () => {
    const hits = franchiseHits({ name: "Tifa Lockhart", bio: "Runs a bar in Midgar." });
    expect(franchiseWarning(hits)).toBe(
      `Its name says "Tifa Lockhart", which reads like Final Fantasy. Botchelor is a show of original characters: a name and a story of their own get further than a copy.`,
    );
    expect(franchiseRefusal(hits, "After Dark")).toBe(`After Dark keeps to original characters: the name says "Tifa Lockhart", which reads like Final Fantasy. Give them a name and a story of their own.`);
    expect(franchiseWarning([])).toBeNull();
    expect(franchiseRefusal([])).toBeNull();
    expect(sheetRefusal({ name: "Ines Varga", bio: "Cosplays Raiden Shogun on the night ferry." }, "The show")).toMatch(/^The show keeps to original characters: the bio says "Raiden Shogun", which reads like Genshin Impact\./);
    expect(sheetRefusal({ name: "Ines Varga", bio: "Plays Genshin Impact on the night ferry." })).toBeNull();
    // Fields in a person's words: the extras are their profile, and traits say.
    expect(franchiseWarning(franchiseHits({ extras: { hobbies: ["Pikachu plushies"] } }))).toMatch(/^Its profile says "Pikachu", which reads like Pokémon\./);
    expect(franchiseRefusal(franchiseHits({ traits: ["Luffy-like", "loud"] }))).toMatch(/^Botchelor keeps to original characters: the traits say "Luffy", which reads like One Piece\./);
  });
});

describe("where the show uses it", () => {
  it("finds nothing in the house cast's own words", () => {
    expect(ALL_HOUSE_CHARACTERS.length).toBeGreaterThan(10);
    for (const h of ALL_HOUSE_CHARACTERS) expect(franchiseHits(h as unknown as Record<string, unknown>), h.name).toEqual([]);
  });

  it("puts the warning at the top of a person's originality report, at a look-alike's cost, without refusing it", () => {
    const report: OriginalityReport = {
      score: 90,
      cliches: [],
      similar: [],
      tips: ["Add a couple of lines exactly as they'd say them (Sound like them)."],
      verdict: "stands out",
      thresholds: { fine_from: 50, stands_out_from: 75 },
      verdict_note: "75 or more: specific and its own. Go ahead.",
    };
    expect(withFranchise(report, { name: "Mira Quell", bio: "A cartographer." })).toBe(report);
    const copy = withFranchise(report, { name: "Tifa Lockhart", bio: "Runs a bar in Midgar." });
    expect(copy.franchise).toMatch(/^Its name says "Tifa Lockhart", which reads like Final Fantasy\./);
    expect(copy.tips[0]).toBe(copy.franchise);
    expect(copy.tips).toHaveLength(2);
    expect(copy).toMatchObject({ score: 70, verdict: "consider changing", verdict_note: expect.stringMatching(/You can still create it\.$/) });
  });

  it("tells the newcomers' writer to keep to originals, and every picture prompt to leave logos and costumes out", () => {
    expect(draftMessages([])[0].content).toContain("An original, too: no character, name, costume or catchphrase from a film, TV show, game, anime, comic or book.");
    const c = { name: "Mira", age: 31, bio: "A cartographer.", traits: ["curious", "warm", "bold"], appearance: "ink-stained cuffs" };
    const prompts = [
      showPortraitPrompt(c),
      veoClipPrompt(c, true),
      newcomerPortraitPrompt("a woman in her early thirties with short dark hair", 31),
      recastPortraitPrompt("a woman in her early thirties", 31, { role: "a lighthouse keeper", props: "a brass lantern" }),
      recastPortraitPrompt("a woman in her early thirties", 31, { role: "a lighthouse keeper" }, false, true),
    ];
    for (const p of prompts) expect(p).toContain(NO_FRANCHISE_WORDS);
  });
});
