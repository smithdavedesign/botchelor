import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findMatches } from "@/lib/dating";
import { extrasForPrompt, extrasVisible, normaliseExtras } from "@/lib/extras";
import { sharedInterests } from "@/lib/interests";
import { DRAWN_TO_IDS, KIND_IDS, KIND_PLURALS, kindName, kindWords } from "@/lib/kinds";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { deckFor } from "@/lib/swipes";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// The review of #675 / #678: a hobby listed under two spellings counted twice, "drawn to witchs", and an unlabelled
// "other" read "is a something else".

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROMPTS = [
  { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
  { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
];

describe("the words for a kind (lib/kinds.ts)", () => {
  it("has a real plural for every kind: werewolves, witches, fae", () => {
    for (const k of KIND_IDS) expect(KIND_PLURALS[k], k).toBeTruthy();
    expect(DRAWN_TO_IDS.map((k) => kindName(k, "many").toLowerCase())).toEqual([
      "humans",
      "vampires",
      "werewolves",
      "ghosts",
      "robots",
      "aliens",
      "witches",
      "fae",
      "merfolk",
      "monsters",
      "talking animals",
    ]);
    expect(kindName("witch")).toBe("Witch"); // the singular is unchanged
    expect(kindName("dragon", "many")).toBe("dragon");
  });

  it("an 'other' says its own words, or nothing: never 'a something else'", () => {
    expect(kindWords({ kind: "vampire" })).toBe("Vampire");
    expect(kindWords({ kind: "other", kind_label: "Lighthouse spirit" })).toBe("Lighthouse spirit");
    expect(kindWords({ kind: "other" })).toBeNull();
    expect(kindWords({ kind: "other", kind_label: "  " })).toBeNull();
    expect(kindWords({})).toBeNull();

    const bare = normaliseExtras({ kind: "other" } as Any);
    expect(extrasVisible(bare).join(" ")).not.toMatch(/something else/i);
    expect(extrasVisible(bare)).toEqual([]);
    expect(extrasForPrompt(bare)).not.toHaveProperty("what_you_are");
    const labelled = normaliseExtras({ kind: "other", kind_label: "Lighthouse spirit" } as Any);
    expect(extrasVisible(labelled)).toEqual(["is a lighthouse spirit"]);
    expect(extrasForPrompt(labelled)).toMatchObject({ what_you_are: "Lighthouse spirit" });
    expect(extrasVisible(normaliseExtras({ kind: "alien" } as Any))).toEqual(["is an alien"]);
  });
});

describe("a shared pastime counts once, however many ways it's spelled (lib/interests.ts sharedInterests)", () => {
  it("dedupes by the canonical interest and keeps their first spelling", () => {
    expect(sharedInterests(["Climbing"], ["Bouldering", "Rock climbing", "Tarot"])).toEqual(["Bouldering"]);
    expect(sharedInterests(["Bouldering", "Rock climbing"], ["climbing"])).toEqual(["climbing"]);
    expect(sharedInterests(["Chess", "Movies"], ["cinema", "chess", "Films", "Chess"])).toEqual(["cinema", "chess"]);
    expect(sharedInterests([], ["Chess"])).toEqual([]);
  });

  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    setSeasonCastForTests([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    setSeasonCastForTests(null);
    vi.restoreAllMocks();
  });

  async function someone(name: string, extras: Record<string, unknown>) {
    const cookie = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name, open_to_dates: true, extras: { prompts: PROMPTS, ...extras } }), cookie)).json();
    return { userId: userIdOf(cookie), id: character.id as string };
  }

  it("'Bouldering' and 'Rock climbing' on one side is one shared hobby (+2, not +4), in find_matches and the deck alike", async () => {
    const me = await someone("Kit Crag", { hobbies: ["Climbing", "Old maps"] });
    const both = await someone("Ash Ledge", { hobbies: ["Bouldering", "Rock climbing"] });
    const one = await someone("Rue Scree", { hobbies: ["Bouldering", "Tarot"] });

    const found = await findMatches(t.db, me.userId, me.id, 20);
    const match = (id: string) => found!.matches.find((m) => m.id === id)!;
    expect(match(both.id).score).toBe(match(one.id).score);
    const why = match(both.id).why.join(" · ");
    expect(why).toMatch(/you both love bouldering(?! and)/);
    expect(why).not.toMatch(/rock climbing/);

    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    expect(deck.scores[both.id]).toBe(deck.scores[one.id]);
  });

  it("a deck that's drawn to werewolves says so in the plural", async () => {
    const wolf = await someone("Lon Howl", { kind: "werewolf", hobbies: ["Hiking", "Old maps"] });
    const me = await someone("Mira Drawn", { drawn_to: ["werewolf"], hobbies: ["Hiking", "Old maps"] });
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    const why = deck.cards.find((c) => c.id === wolf.id)!.why.join(" ");
    expect(why).toMatch(/drawn to werewolves/);
    expect(why).not.toMatch(/werewolfs/);
  });
});
