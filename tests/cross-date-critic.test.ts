import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleCharacter, type Character } from "@/lib/character";
import type { Turn } from "@/lib/conversation";
import type { CharacterSheet, SideOutcome } from "@/lib/engine";
import { leanedOnWords } from "@/lib/memory";
import { lineIssues } from "@/lib/quality";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

// David / botchelor-4a (2026-10-18): across ten Chud × Sable dates, "captain" was read in 9, "dare" in 8. The
// within-date critic can't see across dates; leanedOnWords + the stale_catchphrase check do.

const sheet = (name: string): CharacterSheet => ({ name, age: 33, bio: "an engineer who wings it", traits: ["bold", "playful", "warm"], want: "someone who laughs", dealbreaker: "liars", house: false });
const line = (side: "a" | "b", dialogue: string): Turn => ({ side, act: 0, dialogue, action: "", emotion: "warm", interest: 0.6 });

describe("lineIssues.stale_catchphrase: a word the character leans on every date", () => {
  const chud: Character = assembleCharacter({ id: "chud", sheet: sheet("Chud the crusher"), soul: null, memory: null });
  const nell: Character = assembleCharacter({ id: "nell", sheet: sheet("Nell Abiodun"), soul: null, memory: null });
  chud.overused = ["captain", "dare", "quiet hike"];
  const chars: [Character, Character] = [chud, nell];

  it("flags a line reaching for a leaned-on word, and a leaned-on phrase", () => {
    expect(lineIssues([], line("a", "Aye aye, captain, let's get a drink."), chars).stale_catchphrase).toBe("captain");
    expect(lineIssues([], line("a", "Fancy a quiet hike this weekend?"), chars).stale_catchphrase).toBe("quiet hike");
  });

  it("leaves a fresh line alone, and never flags the side with no overused set", () => {
    expect(lineIssues([], line("a", "What's the strangest thing you've built?"), chars).stale_catchphrase).toBeNull();
    // Nell (side b) has no overused list, so nothing is stale for her even if she says "captain".
    expect(lineIssues([], line("b", "A captain goes down with the ship, they say."), chars).stale_catchphrase).toBeNull();
  });
});

describe("leanedOnWords: the words a character has leaned on across its recent aired dates", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
  async function airedDate(creator: string, characterId: string, at: string, myLines: string[], mySide: "a" | "b") {
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(200);
    const ep = await res.json();
    await api.reveal(ep.id, creator);
    const transcript = myLines.map((d) => line(mySide, d));
    await t.db.query(`update episodes set created_at = $2, revealed_at = $2, transcript = $3::jsonb where id = $1`, [ep.id, at, JSON.stringify(transcript)]);
    return ep.id as string;
  }

  it("returns words used across two-plus dates, not a one-date word, and needs at least two dates", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name: "Chud Testwell" }), creator)).json();
    // The owner's character is character_a when its id sorts... use whichever side the episode stored; both dates same char.
    const mySide: "a" | "b" = character.id < HOUSE_PARTNER_ID ? "a" : "b";
    // One aired date: nothing to compare across yet.
    await airedDate(creator, character.id, "2026-10-10T19:00:00Z", ["Aye captain, shall we dare a cartwheel?", "The lighthouse was lovely."], mySide);
    expect(await leanedOnWords(t.db, character.id)).toEqual([]);
    // A second aired date that reaches for "captain" and "dare" again, plus a one-off ("sourdough").
    await airedDate(creator, character.id, "2026-10-12T19:00:00Z", ["Captain on deck! Care to dare the karaoke?", "I baked sourdough earlier."], mySide);
    const leaned = await leanedOnWords(t.db, character.id);
    expect(leaned).toContain("captain");
    expect(leaned).toContain("dare");
    expect(leaned).not.toContain("sourdough"); // only one date
    expect(leaned).not.toContain("lighthouse"); // only one date
  });
});
