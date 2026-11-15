/**
 * The story state (lib/story-state.ts, the drama wave 2026-11-15): opinions on airing only, things heard (deduped, with
 * who told them), the private prompt block (one side's never in the other's), a claim brought up on a line and the
 * knows_you_said fact it leaves, wants from rules, tensions, forgetting, the switch and the backfill. No paid calls.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteStory, GET as getStory, POST as postStory } from "@/app/api/characters/[id]/story/route";
import { airEpisode } from "@/lib/air";
import { assembleCharacter, type Character } from "@/lib/character";
import { companionMessages } from "@/lib/companion-prompt";
import { buildTurnMessages, simulateConversation } from "@/lib/conversation";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type Outcome, type SideOutcome, type SideSetup } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { innerOf } from "@/lib/inner-life";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { updateCharacterMemory } from "@/lib/memory";
import type { ChatMessage, Model } from "@/lib/model";
import { shortName } from "@/lib/names";
import { buildReflectionMessages } from "@/lib/reflection";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf, weekIdOf } from "@/lib/season-window";
import {
  afterAired,
  airedClaim,
  backfillStoryState,
  bringable,
  broughtUp,
  CLAIM_MAX,
  companionStory,
  ensureWants,
  firsthandOpinion,
  forgetStory,
  hear,
  knownSaid,
  markUsed,
  rememberStory,
  setOpinion,
  setWant,
  settleKnown,
  stateFor,
  storyPrompt,
  STORY_PROMPT_MAX,
  storyStateOn,
  storyUpkeep,
  storyView,
  TAKE_MAX,
  tensions,
  wantFor,
  wantFromRules,
  type FirsthandFacts,
  type StoryState,
  type WantFacts,
} from "@/lib/story-state";
import { pickVenue } from "@/lib/venues";
import { BASE_URL, jsonRequest, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: StoryPanel } = await import("@/app/characters/[id]/StoryPanel");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

// The cast: four house characters. Two more house characters (public, not on the cast) and people's characters stand by.
const CAST = HOUSE_CHARACTERS.slice(0, 4);
const [NELL, DEX, SABLE, JUNE] = CAST.map((c) => c.id);
const OFF_CAST = HOUSE_CHARACTERS[6].id;
const first = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
const NOW = new Date("2026-11-12T12:00:00Z");
const HOURS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOURS).toISOString();

beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

let n = 0;
type Ep = {
  ending?: string;
  revealedAt?: string | null;
  visibility?: string;
  sides?: [boolean, boolean];
  inner?: unknown;
  reflections?: { a: string | null; b: string | null };
  confessionals?: [string, string];
  transcript?: unknown[];
  drama?: ["rejected" | "leaves_first", "a" | "b" | "neither"];
  detail?: string;
};
async function episode(a: string, b: string, e: Ep = {}) {
  const id = `ss-ep-${++n}`;
  const sides = (e.sides ?? [true, true]).map((wants_another) => ({ wants_another, agenda_met: true, satisfied: wants_another, dealbreaker_hit: null, want_met: null, note_followed: null }));
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup,
                           sides, inner_life, reflections, confessionals, transcript, drama_question, drama_answer, ending_detail)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST', 'FINALE', $4, $5, $6, '{"venue":"rooftop_bar"}'::jsonb,
             $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14)`,
    [
      id, a, b, e.ending ?? "second_date", e.revealedAt === undefined ? ago(2) : e.revealedAt, e.visibility ?? "public",
      JSON.stringify(sides), e.inner ? JSON.stringify(e.inner) : null, e.reflections ? JSON.stringify(e.reflections) : null,
      e.confessionals ? JSON.stringify(e.confessionals) : null, JSON.stringify(e.transcript ?? []),
      e.drama?.[0] ?? null, e.drama?.[1] ?? null, e.detail ?? null,
    ],
  );
  return id;
}
async function person(name: string, opts: { owner?: string; visibility?: string } = {}) {
  const id = `ss-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'a person', '["kind"]'::jsonb, 'someone kind', 'liars', $4)`,
    [id, opts.owner ?? "owner-1", name, opts.visibility ?? "public"],
  );
  return id;
}
const opinions = async (holder?: string) =>
  (await t.db.query<{ holder_id: string; about_id: string; trust: number; attraction: number | null; take: string; basis: string; source: string }>(
    `select holder_id, about_id, trust, attraction, take, basis, source from character_opinions where ($1::text is null or holder_id = $1) order by holder_id, about_id`,
    [holder ?? null],
  )).rows;
const heardRows = async (holder?: string) =>
  (await t.db.query<{ id: string; holder_id: string; about_id: string; claim: string; told_by: string | null; source: string; used_at: string | null }>(
    `select id, holder_id, about_id, claim, told_by, source, used_at from character_heard where ($1::text is null or holder_id = $1) order by heard_at, id`,
    [holder ?? null],
  )).rows;

const facts = (over: Partial<FirsthandFacts> = {}): FirsthandFacts => ({
  ending: "second_date", feeling: null, strength: null, seeAgain: null, status: "seeing", turnedDown: null, walkedOut: null, otherName: "Nell Okafor", texts: [], ...over,
});

describe("a firsthand opinion (pure rules)", () => {
  it("reads attraction from the side's own see-again and trust from the ending, the feeling and the drama", () => {
    expect(firsthandOpinion(facts({ seeAgain: "yes", feeling: "smitten", strength: 0.9 }))).toMatchObject({ trust: 2, attraction: 2 });
    expect(firsthandOpinion(facts({ ending: "friends", status: "just_met", seeAgain: "yes", feeling: "comfortable" }))).toMatchObject({ trust: 1, attraction: 0 });
    expect(firsthandOpinion(facts({ ending: "friends", status: "just_met", seeAgain: "maybe" }))).toMatchObject({ trust: 0, attraction: 0 });
    // A disaster it was walked out on, feeling hurt: as low as it goes.
    expect(firsthandOpinion(facts({ ending: "disaster", status: "bad_blood", seeAgain: "no", feeling: "hurt", strength: 0.8, walkedOut: "them" }))).toMatchObject({ trust: -2, attraction: -2 });
    // Turned down, but it still wanted more: attraction stays, trust drops.
    const spurned = firsthandOpinion(facts({ ending: "friends", status: "just_met", seeAgain: "yes", feeling: "charmed", turnedDown: "you" }));
    expect(spurned.attraction).toBe(1);
    expect(spurned.trust).toBe(0);
    // No choice on the date: the ending stands in.
    expect(firsthandOpinion(facts({ ending: "disaster", status: "bad_blood" }))).toMatchObject({ trust: -1, attraction: -1 });
  });

  it("takes its one-line take from the side's own words (its reason, then its reflection), else a plain template; never over 140", () => {
    const own = firsthandOpinion(facts({ texts: ["She laughed at the goat and didn't flinch. I want more of that.", "Something else."] }));
    expect(own.take).toBe("She laughed at the goat and didn't flinch.");
    // The sentence about the other person wins over the first one.
    expect(firsthandOpinion(facts({ texts: [null, "The harbour was loud. Nell kept up with every joke I made."] })).take).toBe("Nell kept up with every joke I made.");
    const long = firsthandOpinion(facts({ texts: [`She ${"really ".repeat(40)}got me.`] }));
    expect(long.take.length).toBeLessThanOrEqual(TAKE_MAX);
    expect(firsthandOpinion(facts({ seeAgain: "yes" })).take).toBe("I like Nell, and I want to see where it goes.");
  });

  it("retells an aired date in public words only, inside the claim length", () => {
    expect(airedClaim({ a_name: "Dex Marlow", b_name: "Nell Okafor", ending: "second_date", date_number: 2, venue: null })).toBe("Dex and Nell's second date: both wanted a third date.");
    expect(airedClaim({ a_name: "Dex", b_name: "Nell", ending: "disaster", walked_out: "b" })).toBe("Dex and Nell's first date: Nell walked out.");
    expect(airedClaim({ a_name: "Dex", b_name: "Nell", ending: "friends", rejected: "a" })).toBe("Dex and Nell's first date: Nell turned Dex down.");
    expect(airedClaim({ a_name: "Dex", b_name: "Nell", ending: "friends", venue: "rooftop_bar" }).length).toBeLessThanOrEqual(CLAIM_MAX);
  });
});

describe("when a date airs (afterAired)", () => {
  it("writes both sides' firsthand opinions from an aired public date, and nothing from a private or unaired one", async () => {
    const unaired = await episode(NELL, DEX, { revealedAt: null });
    const priv = await episode(NELL, SABLE, { visibility: "private" });
    const unlisted = await episode(NELL, JUNE, { visibility: "unlisted" });
    for (const id of [unaired, priv, unlisted]) expect(await afterAired(t.db, id)).toEqual({ opinions: 0, watched: 0, used: 0 });
    expect(await opinions()).toEqual([]);
    expect(await heardRows()).toEqual([]);

    const aired = await episode(NELL, DEX, {
      ending: "second_date",
      inner: { v: 1, lines: [{ feeling: "charmed", strength: 0.8 }, { feeling: "wary", strength: 0.4 }], choices: { a: { see_again: "yes", reason: "He made me laugh twice before the drinks came." }, b: { see_again: "maybe", reason: "", read: true } } },
      transcript: [{ side: "a", dialogue: "Hi." }, { side: "b", dialogue: "Hello." }],
      reflections: { a: "Not used: the reason comes first.", b: "She is quick, and I can't tell yet if she means it." },
    });
    const done = await afterAired(t.db, aired);
    expect(done.opinions).toBe(2);
    const rows = await opinions();
    expect(rows).toHaveLength(2);
    const nell = rows.find((r) => r.holder_id === NELL)!;
    expect(nell).toMatchObject({ about_id: DEX, basis: "firsthand", source: aired, attraction: 2, trust: 2, take: "He made me laugh twice before the drinks came." });
    const dex = rows.find((r) => r.holder_id === DEX)!;
    // Its own answer was read from the date, so the take is its reflection's sentence about her.
    expect(dex).toMatchObject({ about_id: NELL, attraction: 0, take: "She is quick, and I can't tell yet if she means it." });
  });

  it("is idempotent, and the cast who weren't on the date watch it air (nobody who was, nobody off the cast)", async () => {
    const id = await episode(NELL, DEX, { ending: "disaster", sides: [false, false] });
    await afterAired(t.db, id);
    const once = { o: await opinions(), h: await heardRows() };
    await afterAired(t.db, id);
    await afterAired(t.db, id);
    expect({ o: await opinions(), h: await heardRows() }).toEqual(once);
    expect(once.h.map((h) => h.holder_id).sort()).toEqual([SABLE, JUNE].sort());
    expect(once.h.every((h) => h.told_by === null && h.source === id)).toBe(true);
    expect(once.h[0].claim).toContain(`${first(NELL)} and ${first(DEX)}'s first date`);
    expect(once.h[0].claim).toContain("it went badly");
    // Watching a date air leaves no opinion on its own.
    expect((await opinions(SABLE)).length).toBe(0);
  });

  it("keeps a person's character's opinion of a house character, and a private character is never a holder or a subject", async () => {
    const mine = await person("Rowan Vale");
    const hidden = await person("Hidden One", { visibility: "private" });
    await afterAired(t.db, await episode(mine, NELL, { ending: "friends", sides: [true, false] }));
    expect((await opinions(mine))[0]).toMatchObject({ about_id: NELL, basis: "firsthand" });
    expect((await opinions(NELL))[0]).toMatchObject({ about_id: mine });
    const n0 = (await opinions()).length;
    await afterAired(t.db, await episode(hidden, DEX));
    expect((await opinions()).length).toBe(n0);
    expect((await heardRows()).some((h) => h.about_id === hidden)).toBe(false);
  });

  it("follows the public record: a date taken off the air takes its opinion and what the cast saw with it", async () => {
    const earlier = await episode(NELL, DEX, { ending: "friends", revealedAt: ago(30), sides: [true, true] });
    const later = await episode(NELL, DEX, { ending: "disaster", revealedAt: ago(2), sides: [false, false] });
    await afterAired(t.db, earlier);
    await afterAired(t.db, later);
    expect((await opinions(NELL))[0]).toMatchObject({ source: later, attraction: -1 });
    expect((await heardRows()).filter((h) => h.source === later)).toHaveLength(2);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [later]);
    await afterAired(t.db, later);
    expect((await opinions(NELL))[0]).toMatchObject({ source: earlier });
    expect((await heardRows()).filter((h) => h.source === later)).toHaveLength(0);
    // And with no public date left, no opinion at all.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [earlier]);
    await afterAired(t.db, earlier);
    expect(await opinions()).toEqual([]);
  });

  it("runs from the show's own airing (lib/air.ts), once the date airs", async () => {
    const id = await episode(NELL, DEX, { revealedAt: null });
    expect(await opinions()).toEqual([]);
    expect(await airEpisode(t.db, id, "system")).not.toBeNull();
    expect((await opinions()).map((o) => o.holder_id).sort()).toEqual([NELL, DEX].sort());
    expect((await heardRows()).length).toBe(2);
  });
});

describe("things heard (hear)", () => {
  it("stores one row per holder and source, and gives a heard opinion only when someone told them and they had none", async () => {
    const one = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex told Nell he'd never been on a boat. He owns one.", toldBy: SABLE, source: "scene:1", isTrue: false, leans: -1 });
    expect(one?.created).toBe(true);
    const again = await hear(t.db, { holder: JUNE, about: DEX, claim: "A different retelling of the same scene.", toldBy: SABLE, source: "scene:1", isTrue: true });
    expect(again).toEqual({ id: one!.id, created: false });
    expect(await heardRows(JUNE)).toHaveLength(1);
    expect((await opinions(JUNE))[0]).toMatchObject({ about_id: DEX, basis: "heard", trust: -1, attraction: null });
    expect((await opinions(JUNE))[0].take).toContain(`${first(SABLE)} told me`);

    // A firsthand opinion is never replaced by hearsay, and a second thing heard doesn't rewrite the heard one.
    await setOpinion(t.db, { holder: JUNE, about: NELL, trust: 2, attraction: 1, take: "I trust her.", basis: "firsthand", source: "ep-x" });
    await hear(t.db, { holder: JUNE, about: NELL, claim: "Nell laughed at everyone at the mixer.", toldBy: SABLE, source: "scene:2", isTrue: true, leans: -1 });
    expect((await opinions(JUNE)).find((o) => o.about_id === NELL)).toMatchObject({ basis: "firsthand", trust: 2 });
    await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex is lovely, actually.", toldBy: NELL, source: "scene:3", isTrue: true, leans: 1 });
    expect((await opinions(JUNE)).find((o) => o.about_id === DEX)).toMatchObject({ basis: "heard", trust: -1 });
  });

  it("refuses a claim about the holder (they were there), from the holder, about or by a private character, or one that fails the PG checks", async () => {
    const hidden = await person("Hidden One", { visibility: "private" });
    expect(await hear(t.db, { holder: JUNE, about: JUNE, claim: "June did a thing.", toldBy: SABLE, source: "s1", isTrue: true })).toBeNull();
    expect(await hear(t.db, { holder: JUNE, about: DEX, aboutB: JUNE, claim: "June and Dex did a thing.", toldBy: SABLE, source: "s2", isTrue: true })).toBeNull();
    expect(await hear(t.db, { holder: JUNE, about: hidden, claim: "Hidden did a thing.", toldBy: SABLE, source: "s3", isTrue: true })).toBeNull();
    expect(await hear(t.db, { holder: hidden, about: DEX, claim: "Dex did a thing.", toldBy: SABLE, source: "s4", isTrue: true })).toBeNull();
    expect(await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex did a thing.", toldBy: hidden, source: "s5", isTrue: true })).toBeNull();
    expect(await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex took a 15 year old schoolgirl home.", toldBy: SABLE, source: "s6", isTrue: false })).toBeNull();
    expect(await heardRows()).toEqual([]);
  });
});

/* ------------------------------------------ the prompt block ------------------------------------------ */

const sheetA: CharacterSheet = { name: "Mira Quill", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe Holt", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const sideOf = (sheet: CharacterSheet): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25 });
const INPUT: DateInput = { a: sideOf(sheetA), b: sideOf(sheetB) };
const so = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = fixedEngine({ ending: "friends", sides: [so(true), so(false)] }).decide(INPUT, 1);
const VENUE = pickVenue(1);

const TAKE_A = "He bakes like he argues: too much salt, and I liked it.";
const CLAIM_A1 = "Rafe and Sable's first date: Sable walked out.";
const CLAIM_A2 = "Rafe promised Juniper the lighthouse trip, then took someone else.";
const TAKE_B = "She maps everything except what she feels.";
const CLAIM_B = "Mira told Dex she has never once been lost.";
const WANT_A = "Change Rafe's mind after being turned down.";

const heardRow = (id: string, claim: string, toldBy: string | null, used = false): StoryState["heard"][number] => ({
  id, holder_id: "x", about_id: "y", about_name: "Y", about_b_id: null, about_b_name: null, claim, told_by: toldBy ? "teller" : null, told_by_name: toldBy,
  source: `src-${id}`, is_true: true, heard_at: NOW.toISOString(), used_at: used ? NOW.toISOString() : null, used_in: null,
});
const stateA = (): StoryState => ({
  holder_id: "mira-oc", with_id: "rafe-house",
  opinions: [{ holder_id: "mira-oc", about_id: "rafe-house", about_name: "Rafe Holt", trust: -1, attraction: 1, take: TAKE_A, basis: "firsthand", source: "ep-1", source_at: NOW.toISOString(), updated_at: NOW.toISOString() }],
  heard: [heardRow("h1", CLAIM_A2, "Sable Wren"), heardRow("h2", CLAIM_A1, null)],
  want: { holder_id: "mira-oc", season_id: "2026-11-01", week_id: "2026-11-09", want: WANT_A, about_id: "rafe-house", kind: "win_back", set_by: "rules" },
});
const stateB = (): StoryState => ({
  holder_id: "rafe-house", with_id: "mira-oc",
  opinions: [{ holder_id: "rafe-house", about_id: "mira-oc", about_name: "Mira Quill", trust: 1, attraction: 0, take: TAKE_B, basis: "firsthand", source: "ep-1", source_at: NOW.toISOString(), updated_at: NOW.toISOString() }],
  heard: [heardRow("h3", CLAIM_B, "Dex Marlow")],
  want: null,
});
function chars(withB = true): [Character, Character] {
  const a = assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: null, memory: null });
  const b = assembleCharacter({ id: "rafe-house", sheet: sheetB, soul: null, memory: null });
  a.story = stateA();
  if (withB) b.story = stateB();
  return [a, b];
}
const all = (messages: ChatMessage[]) => messages.map((m) => m.content).join("\n");
const said = (side: "a" | "b", dialogue: string, inner?: Record<string, unknown>) => ({ side, act: 1, dialogue, action: "", emotion: "warm", interest: 0.5, ...(inner ? { inner } : {}) });
const turnAt = (cs: [Character, Character], transcript: ReturnType<typeof said>[], i: number) =>
  buildTurnMessages(INPUT, OUTCOME, cs, "a_hard_question", VENUE, transcript as never, i, "classic", {}, { totalTurns: 12 });

describe("the private block (storyPrompt) on a date", () => {
  it("is in its own side's prompt only: side A's opinion, claims and want never reach side B's messages, nor B's reach A's", () => {
    const cs = chars();
    const before = [said("a", "Hi."), said("b", "Hello."), said("a", "So."), said("b", "So."), said("a", "Right.")];
    const forA = all(turnAt(cs, before.slice(0, 4), 4).messages);
    const forB = all(turnAt(cs, before, 5).messages);
    for (const mine of [TAKE_A, CLAIM_A1, CLAIM_A2, WANT_A]) {
      expect(forA).toContain(mine);
      expect(forB).not.toContain(mine);
    }
    for (const theirs of [TAKE_B, CLAIM_B]) {
      expect(forB).toContain(theirs);
      expect(forA).not.toContain(theirs);
    }
    // Whether a claim is true is never said to anyone.
    expect(forA).not.toMatch(/is_true|isn't true|untrue/);
    // The one instruction: it may come up when the moment fits, at most once a date.
    expect(turnAt(cs, before.slice(0, 4), 4).messages[0].content).toMatch(/At most once in the whole date/);
    expect(turnAt(cs, before.slice(0, 4), 4).messages[0].content).toContain('"brought_up":0');
  });

  it("leaves every other prompt exactly as it was: a side with no story state has no section and no field", () => {
    const [a, b] = chars(false);
    const plain: [Character, Character] = [{ ...a, story: undefined }, b];
    const base = turnAt(plain, [], 0).messages;
    expect(all(base)).not.toMatch(/your_story|brought_up|WHAT YOU THINK/);
    const sideB = turnAt([a, b], [said("a", "Hi.")], 1).messages;
    expect(all(sideB)).not.toMatch(/your_story|brought_up|WHAT YOU THINK/);
  });

  it("holds what it heard back in the first act, numbers only what hasn't come up before, and takes it off the table once one has", () => {
    const cs = chars();
    // First line of the date (act 0): the opinion and the want, no gossip yet.
    const opening = all(turnAt(cs, [], 0).messages);
    expect(opening).toContain(TAKE_A);
    expect(opening).not.toContain(CLAIM_A2);
    // Later: both things heard, numbered, with who told them.
    const mid = all(turnAt(cs, [said("a", "Hi."), said("b", "Hello."), said("a", "So."), said("b", "So.")], 4).messages);
    expect(mid).toContain(`1. Sable told you: ${CLAIM_A2}`);
    expect(mid).toContain(`2. You watched it air: ${CLAIM_A1}`);
    // Once this side has brought one up tonight, neither is offered again.
    const after = all(turnAt(cs, [said("a", "Hi."), said("b", "Hello."), said("a", "Sable says you took someone else to the lighthouse.", { heard: "h1" }), said("b", "So.")], 4).messages);
    expect(after).toContain(TAKE_A);
    expect(after).not.toContain(CLAIM_A2);
    expect(after).not.toContain(CLAIM_A1);
    // A claim that came up on an earlier date isn't numbered tonight.
    const used = { ...stateA(), heard: [heardRow("h1", CLAIM_A2, "Sable Wren", true), heardRow("h2", CLAIM_A1, null)] };
    expect(bringable(used).map((h) => h.id)).toEqual(["h2"]);
    expect(JSON.stringify(storyPrompt(used))).not.toContain(CLAIM_A2);
  });

  it("is compact, and null when there is nothing to say", () => {
    const longest: StoryState = {
      ...stateA(),
      opinions: [{ ...stateA().opinions[0], take: "x".repeat(TAKE_MAX), basis: "heard" }],
      heard: [heardRow("h1", "y".repeat(CLAIM_MAX), "Bartholomew Longname"), heardRow("h2", "z".repeat(CLAIM_MAX), "Bartholomew Longname")],
      want: { ...stateA().want!, want: "w".repeat(140) },
    };
    expect(JSON.stringify(storyPrompt(longest)).length).toBeLessThanOrEqual(STORY_PROMPT_MAX);
    expect(storyPrompt(null)).toBeNull();
    expect(storyPrompt({ holder_id: "a", with_id: "b", opinions: [], heard: [], want: null })).toBeNull();
  });

  it("goes into the reflection's prompt for its own side only", () => {
    const cs = chars();
    const a = all(buildReflectionMessages(INPUT, OUTCOME, cs, VENUE, "classic", "a"));
    const b = all(buildReflectionMessages(INPUT, OUTCOME, cs, VENUE, "classic", "b"));
    expect(a).toContain(TAKE_A);
    expect(a).not.toContain(TAKE_B);
    expect(b).toContain(TAKE_B);
    expect(b).not.toContain(TAKE_A);
    expect(b).not.toContain(CLAIM_A2);
  });
});

describe("a claim brought up on a line", () => {
  it("counts only when the actor names it AND the line shares its words (or one word beside the teller's name)", () => {
    const h = { claim: CLAIM_A2, told_by_name: "Sable Wren" };
    expect(broughtUp("Sable says you promised someone the lighthouse.", h)).toBe(true);
    expect(broughtUp("I heard you promised Juniper a trip and took someone else.", h)).toBe(true);
    expect(broughtUp("Sable told me something about a lighthouse.", h)).toBe(true);
    expect(broughtUp("I've heard things about you.", h)).toBe(false);
    expect(broughtUp("Sable says hello.", h)).toBe(false);
    expect(broughtUp("Do you like lighthouses?", { claim: CLAIM_A2, told_by_name: null })).toBe(false);
  });

  it("is verified on the date, once a side, and kept in the date's inner life (never on a played line)", async () => {
    const cs = chars(false);
    const line = (dialogue: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ dialogue, action: "", emotion: "curious", interest_signal: 0.6, feeling: "curious", feeling_strength: 0.5, thought: `A thought about ${dialogue.slice(0, 12)}.`, they_claimed: "", ...extra });
    const outputs = [
      line("Evening. You found the place."), // a, act 0: says it brought one up, but act 0 never counts
      line("I did. The sign helped."),
      line("So what do you bake when nobody is looking?", { brought_up: 1 }), // a: names it, but the line doesn't say it
      line("Rye. Always rye."),
      line("Sable says you promised Juniper the lighthouse trip and took someone else.", { brought_up: 1 }), // a: counts
      line("That is not how it went."),
      line("And I watched Sable walk out of your first date.", { brought_up: 2 }), // a again: at most once a date
      line("You watch a lot of television."),
    ];
    const queue = [...outputs];
    const model: Model = { async complete() { const next = queue.shift(); if (next === undefined) throw new Error("out of outputs"); return next; } };
    const transcript = await simulateConversation(model, INPUT, OUTCOME, cs, "a_hard_question", VENUE, "classic", 8);
    expect(transcript).toHaveLength(8);
    expect(transcript.map((x) => x.inner?.heard ?? null)).toEqual([null, null, null, null, "h1", null, null, null]);
    expect(transcript.every((x) => x.inner?.brought_up === undefined)).toBe(true);
    expect(innerOf(transcript)?.lines[4]).toMatchObject({ heard: "h1" });
  });

  it("is marked used when that date airs, and its subject now knows who said it (knows_you_said)", async () => {
    // June heard two things about Dex: one Sable told her, one she watched air.
    const told = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex told Nell he'd never been on a boat. He owns one.", toldBy: SABLE, source: "scene:9", isTrue: false });
    const watched = await hear(t.db, { holder: JUNE, about: DEX, aboutB: NELL, claim: "Dex and Nell's first date: it went badly.", toldBy: null, source: "ep-old", isTrue: true });
    const date = await episode(JUNE, DEX, {
      revealedAt: null,
      transcript: [{ side: "a", dialogue: "Sable says you own a boat." }, { side: "b", dialogue: "Sable says a lot." }, { side: "a", dialogue: "I saw your date with Nell." }],
      inner: { v: 1, lines: [{ heard: told!.id }, null, { heard: watched!.id }] },
    });
    // Not aired: nothing is marked, nobody knows anything.
    await afterAired(t.db, date);
    expect((await heardRows(JUNE)).every((h) => h.used_at === null)).toBe(true);
    expect(await knownSaid(t.db, DEX)).toEqual([]);

    await t.db.query(`update episodes set revealed_at = $2 where id = $1`, [date, ago(1)]);
    expect((await afterAired(t.db, date)).used).toBe(2);
    expect((await heardRows(JUNE)).every((h) => h.used_at !== null)).toBe(true);
    // Dex knows Sable said it (June repeated it). What June watched air has nobody behind it.
    const knows = await knownSaid(t.db, DEX);
    expect(knows).toHaveLength(1);
    expect(knows[0]).toMatchObject({ knower_id: DEX, said_by_id: SABLE, repeated_by_id: JUNE, heard_id: told!.id, is_true: false, source: date, settled_at: null });
    // Idempotent; used things sort last and aren't numbered on the next date.
    await afterAired(t.db, date);
    expect(await knownSaid(t.db, DEX)).toHaveLength(1);
    expect(bringable(await stateFor(t.db, JUNE, { withId: DEX }))).toEqual([]);
    // A confrontation settles it.
    expect(await settleKnown(t.db, knows[0].id, "scene:confront-1")).toBe(true);
    expect(await knownSaid(t.db, DEX, { unsettledOnly: true })).toEqual([]);
  });

  it("markUsed records the fact only for the claim's own subject, and never against a line someone else's id slipped into", async () => {
    const h = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex cried at the rooftop bar.", toldBy: SABLE, source: "scene:4", isTrue: true });
    // Said to Nell, who isn't the subject: used, but Nell learns nothing about herself.
    expect(await markUsed(t.db, h!.id, "scene:5", { to: NELL })).toEqual({ used: true, knows: null });
    expect(await knownSaid(t.db, NELL)).toEqual([]);
    // A date whose inner life names a heard row the speaker doesn't hold changes nothing.
    const other = await hear(t.db, { holder: NELL, about: DEX, claim: "Dex hums when he lies.", toldBy: SABLE, source: "scene:6", isTrue: true });
    const date = await episode(JUNE, DEX, { transcript: [{ side: "a", dialogue: "Humming again?" }], inner: { v: 1, lines: [{ heard: other!.id }] } });
    expect((await afterAired(t.db, date)).used).toBe(0);
    expect((await heardRows(NELL))[0].used_at).toBeNull();
  });
});

describe("what a character carries (stateFor)", () => {
  it("gives its opinion of the person it's with, up to two things heard about them (unused first, told before watched), and this week's want", async () => {
    await afterAired(t.db, await episode(JUNE, DEX, { ending: "friends", revealedAt: ago(40), sides: [true, false] }));
    await hear(t.db, { holder: JUNE, about: DEX, aboutB: NELL, claim: "Dex and Nell's first date: it went badly.", toldBy: null, source: "ep-a", isTrue: true, at: new Date(ago(5)) });
    const usedOne = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex snores on trains.", toldBy: NELL, source: "scene:a", isTrue: true, at: new Date(ago(1)) });
    await markUsed(t.db, usedOne!.id, "scene:b");
    await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:c", isTrue: false, at: new Date(ago(20)) });
    await hear(t.db, { holder: JUNE, about: NELL, claim: "Nell keeps a list of every dog she meets.", toldBy: SABLE, source: "scene:d", isTrue: true });
    await ensureWants(t.db, NOW);

    const withDex = (await stateFor(t.db, JUNE, { withId: DEX, now: NOW }))!;
    expect(withDex.opinions).toHaveLength(1);
    expect(withDex.opinions[0]).toMatchObject({ about_id: DEX, basis: "firsthand" });
    expect(withDex.heard.map((h) => h.source)).toEqual(["scene:c", "ep-a"]);
    expect(withDex.want?.holder_id).toBe(JUNE);
    // A claim about a pair is about either of them.
    expect((await stateFor(t.db, JUNE, { withId: NELL, now: NOW }))!.heard.map((h) => h.source).sort()).toEqual(["ep-a", "scene:d"]);
    // Without anyone in particular (a text): its latest opinions and the latest it heard.
    const texts = (await stateFor(t.db, JUNE, { now: NOW }))!;
    expect(texts.with_id).toBeNull();
    expect(texts.heard).toHaveLength(2);
    // Someone who holds nothing has no state.
    expect(await stateFor(t.db, OFF_CAST, { withId: DEX, now: NOW })).toBeNull();
  });

  it("reaches a text only for its own creator or a house character; a person's cast character texting a stranger shares only what it heard", async () => {
    const fan = await person("Rowan Vale");
    setSeasonCastForTests(CAST.map((c) => c.id), [fan]);
    await setOpinion(t.db, { holder: fan, about: NELL, trust: 1, attraction: 2, take: "I can't stop thinking about her.", basis: "firsthand", source: "ep-f" });
    await hear(t.db, { holder: fan, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:f", isTrue: false });
    const yours = await companionStory(t.db, { id: fan, house: false }, true, NOW);
    expect(yours.join("\n")).toContain("I can't stop thinking about her.");
    expect(yours.join("\n")).toContain(`${first(SABLE)} told you: Dex owns a boat`);
    const stranger = (await companionStory(t.db, { id: fan, house: false }, false, NOW)).join("\n");
    expect(stranger).toContain("Dex owns a boat");
    expect(stranger).not.toContain("I can't stop thinking about her.");
    // Off the cast and not yours: nothing.
    setSeasonCastForTests(CAST.map((c) => c.id), []);
    expect(await companionStory(t.db, { id: fan, house: false }, false, NOW)).toEqual([]);
    // The companion prompt carries the lines it's given, and none when there are none.
    const c = assembleCharacter({ id: "mira-oc", sheet: sheetA, soul: null, memory: null });
    const withStory = all(companionMessages({ character: c, turns: [], facts: [], summary: null, length: "normal", avoid: [], story: yours }));
    expect(withStory).toContain("What's on your mind about people on the show");
    expect(withStory).toContain(`${first(SABLE)} told you: Dex owns a boat`);
    expect(all(companionMessages({ character: c, turns: [], facts: [], summary: null, length: "normal", avoid: [] }))).not.toContain("What's on your mind about people");
  });
});

describe("wants (rules)", () => {
  const base = (over: Partial<WantFacts> = {}): WantFacts => ({ holder: "me", lead: null, suitors: [], knows: [], people: [], opinions: [], rivals: {}, ...over });
  const p = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Name`, status, last_ending: "friends", turned_down: null, wanted_more: null, ...over }) as WantFacts["people"][number];
  const o = (about: string, trust: number, attraction: number | null, basis = "firsthand") => ({ about_id: about, about_name: `${about[0].toUpperCase()}${about.slice(1)} Name`, trust, attraction, basis }) as WantFacts["opinions"][number];

  it("picks the first rule that applies, deterministically", () => {
    expect(wantFromRules(base({ knows: [{ said_by_id: "s", said_by_name: "Sable Wren" }], people: [p("xan", "bad_blood")] }))).toMatchObject({ kind: "settle_score", about_id: "s", want: "Have it out with Sable over what they said about you." });
    const lead = { id: "lead", name: "Nell Okafor" };
    expect(wantFromRules(base({ lead, suitors: [{ id: "me", name: "Me" }] }))).toMatchObject({ kind: "pursue", about_id: "lead", want: "Win Nell's rose on Sunday." });
    expect(wantFromRules(base({ holder: "lead", lead, suitors: [{ id: "a", name: "Ada Pike" }, { id: "b", name: "Bo Reed" }], opinions: [o("a", 0, 1), o("b", 1, 2)] }))).toMatchObject({ kind: "pursue", about_id: "b" });
    expect(wantFromRules(base({ holder: "lead", lead, suitors: [{ id: "a", name: "Ada Pike" }] }))).toMatchObject({ kind: "protect", about_id: null });
    expect(wantFromRules(base({ people: [p("xan", "bad_blood")], opinions: [o("xan", -2, -1)] }))).toMatchObject({ kind: "settle_score", about_id: "xan" });
    expect(wantFromRules(base({ people: [p("xan", "exes")] }))).toMatchObject({ kind: "win_back", about_id: "xan", want: "Win Xan back." });
    expect(wantFromRules(base({ people: [p("xan", "just_met", { turned_down: "you", wanted_more: true })] }))).toMatchObject({ kind: "win_back", want: "Change Xan's mind after being turned down." });
    expect(wantFromRules(base({ people: [p("xan", "seeing")], opinions: [o("xan", 1, 2)] }))).toMatchObject({ kind: "pursue", about_id: "xan" });
    expect(wantFromRules(base({ people: [p("xan", "seeing")], opinions: [o("xan", 1, 2)], rivals: { xan: "Dex Marlow" } }))).toMatchObject({ kind: "protect", want: "Keep Xan close: Dex is interested too." });
    expect(wantFromRules(base({ opinions: [o("yul", -1, null, "heard")] }))).toMatchObject({ kind: "avoid", about_id: "yul" });
    expect(wantFromRules(base({ people: [p("xan", "friends", { last_ending: "disaster" })] }))).toMatchObject({ kind: "prove", about_id: null });
    expect(wantFromRules(base())).toMatchObject({ kind: "pursue", about_id: null });
    const f = base({ people: [p("xan", "seeing")], opinions: [o("xan", 1, 2)] });
    expect(wantFromRules(f)).toEqual(wantFromRules(f));
  });

  it("gives every cast member one want a week from the state, keeps a producer's, and only upgrades a want with nobody in it", async () => {
    // Nell and Dex: bad blood, aired.
    await afterAired(t.db, await episode(NELL, DEX, { ending: "disaster", sides: [false, false] }));
    await t.db.query(
      `insert into character_memory (character_id, people) values ($1, $2::jsonb) on conflict (character_id) do update set people = excluded.people`,
      [NELL, JSON.stringify([{ id: DEX, name: "Dex Marlow", status: "bad_blood", last_ending: "disaster", turned_down: null, wanted_more: false }])],
    );
    await setWant(t.db, { holder: SABLE, want: "Find out what Dex is hiding.", kind: "prove", about: DEX, setBy: "producer", now: NOW });
    expect(await ensureWants(t.db, NOW)).toEqual({ set: 3 });
    const nell = (await wantFor(t.db, NELL, NOW))!;
    expect(nell).toMatchObject({ kind: "settle_score", about_id: DEX, set_by: "rules", week_id: weekIdOf(NOW), season_id: seasonIdOf(NOW) });
    expect((await wantFor(t.db, SABLE, NOW))!).toMatchObject({ set_by: "producer", want: "Find out what Dex is hiding." });
    expect((await wantFor(t.db, JUNE, NOW))!).toMatchObject({ kind: "pursue", about_id: null });
    // A second pass changes nothing...
    expect(await ensureWants(t.db, NOW)).toEqual({ set: 0 });
    // ...until June's state names someone: her fallback want is upgraded; Nell's, which names Dex, holds for the week.
    const told = await hear(t.db, { holder: NELL, about: JUNE, claim: "June cheats at cards.", toldBy: SABLE, source: "scene:w", isTrue: false });
    await markUsed(t.db, told!.id, "scene:x", { to: JUNE });
    expect(await ensureWants(t.db, NOW)).toEqual({ set: 1 });
    expect((await wantFor(t.db, JUNE, NOW))!).toMatchObject({ kind: "settle_score", about_id: SABLE });
    expect((await wantFor(t.db, NELL, NOW))!).toMatchObject({ kind: "settle_score", about_id: DEX });
    // Rules never overwrite the producer; the producer overwrites rules.
    expect(await setWant(t.db, { holder: SABLE, want: "Rules tried.", kind: "pursue", setBy: "rules", now: NOW })).toBe(false);
    expect(await setWant(t.db, { holder: NELL, want: "Make peace with Dex on camera.", kind: "protect", about: DEX, setBy: "producer", now: NOW })).toBe(true);
    expect((await wantFor(t.db, NELL, NOW))!.set_by).toBe("producer");
    // Next week starts clean.
    expect(await wantFor(t.db, NELL, new Date(NOW.getTime() + 7 * 24 * HOURS))).toBeNull();
  });

  it("on a Botchelor season, every suitor still in wants the lead's rose", async () => {
    const [s1, s2] = [await person("Ada Pike"), await person("Bo Reed")];
    setSeasonCastForTests([NELL], [s1, s2], NELL);
    await ensureWants(t.db, NOW);
    for (const s of [s1, s2]) expect((await wantFor(t.db, s, NOW))!).toMatchObject({ kind: "pursue", about_id: NELL, want: `Win ${first(NELL)}'s rose on Sunday.` });
    expect((await wantFor(t.db, NELL, NOW))!.kind).toBe("protect");
  });
});

describe("tensions", () => {
  it("ranks what the state holds among the cast, each with the rows behind it", async () => {
    // Someone knows what another said (untrue): the hottest.
    const lie = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:t1", isTrue: false });
    await markUsed(t.db, lie!.id, "ep-t", { to: DEX });
    // Opposing claims about Dex: June holds the untrue one, Nell a true one.
    const truth = await hear(t.db, { holder: NELL, about: DEX, claim: "Dex has never owned a boat.", toldBy: SABLE, source: "scene:t2", isTrue: true });
    // Rivals: Nell and June both want Dex. Mutual distrust: Nell and Sable.
    await setOpinion(t.db, { holder: NELL, about: DEX, trust: 1, attraction: 2, take: "I want him.", basis: "firsthand", source: "ep-1" });
    await setOpinion(t.db, { holder: JUNE, about: DEX, trust: 0, attraction: 1, take: "I want him too.", basis: "firsthand", source: "ep-2" });
    await setOpinion(t.db, { holder: NELL, about: SABLE, trust: -2, attraction: -1, take: "No.", basis: "firsthand", source: "ep-3" });
    await setOpinion(t.db, { holder: SABLE, about: NELL, trust: -1, attraction: -1, take: "No.", basis: "firsthand", source: "ep-3" });

    const list = await tensions(t.db, seasonIdOf(NOW), { now: NOW });
    expect(list.map((x) => x.kind)).toEqual(["knows_said", "opposing_claims", "mutual_distrust", "rivals"]);
    const [knows, opposing, distrust, rivals] = list;
    expect(knows).toMatchObject({ a: DEX, b: SABLE, weight: 8 });
    expect(knows.evidence.heard).toEqual([lie!.id]);
    expect(knows.evidence.knows).toHaveLength(1);
    expect(opposing).toMatchObject({ a: NELL, b: JUNE, about: DEX, weight: 5 });
    expect(opposing.evidence.heard).toEqual([truth!.id, lie!.id]);
    expect(distrust).toMatchObject({ kind: "mutual_distrust", weight: 4 });
    expect([distrust.a, distrust.b].sort()).toEqual([NELL, SABLE].sort());
    expect(rivals).toMatchObject({ about: DEX, weight: 4 });
    expect([rivals.a, rivals.b].sort()).toEqual([NELL, JUNE].sort());
    expect(rivals.evidence.opinions).toHaveLength(2);
    // A private take never rides in a tension's line.
    expect(JSON.stringify(list)).not.toMatch(/I want him|"No\."/);
    // A settled fact stops being a tension; someone off the cast never is one.
    await settleKnown(t.db, (await knownSaid(t.db, DEX))[0].id, "scene:confront");
    expect((await tensions(t.db, seasonIdOf(NOW), { now: NOW })).some((x) => x.kind === "knows_said")).toBe(false);
    expect(await tensions(t.db, seasonIdOf(NOW), { now: NOW, holders: [NELL] })).toEqual([]);
  });
});

describe("the owner's view and forgetting", () => {
  it("shows what it thinks and has heard (never whether a claim is true), and a forgotten thing stays gone until remembered or a later date", async () => {
    const mine = await person("Rowan Vale");
    const firstDate = await episode(mine, NELL, { ending: "friends", revealedAt: ago(30), sides: [true, false] });
    await afterAired(t.db, firstDate);
    const h = await hear(t.db, { holder: mine, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:v", isTrue: false });
    const view = (await storyView(t.db, mine, NOW))!;
    expect(view.thinks.map((x) => x.about_id).sort()).toEqual([DEX, NELL].sort());
    expect(view.thinks.find((x) => x.about_id === NELL)).toMatchObject({ basis: "firsthand", item: NELL });
    expect(view.heard).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("is_true");

    expect(await forgetStory(t.db, mine, "opinion", NELL)).toBe(true);
    expect(await forgetStory(t.db, mine, "opinion", NELL)).toBe(false);
    expect(await forgetStory(t.db, mine, "heard", h!.id)).toBe(true);
    const state = await stateFor(t.db, mine, { withId: NELL });
    expect(state).toBeNull();
    expect((await stateFor(t.db, mine, { withId: DEX }))!.heard).toEqual([]);
    const after = (await storyView(t.db, mine, NOW))!;
    expect(after.forgotten.map((f) => f.kind).sort()).toEqual(["heard", "opinion"]);
    // The same date never brings it back, nor the same scene.
    await afterAired(t.db, firstDate);
    await hear(t.db, { holder: mine, about: DEX, claim: "Told again.", toldBy: SABLE, source: "scene:v", isTrue: false });
    expect(await stateFor(t.db, mine, { withId: NELL })).toBeNull();
    expect((await storyView(t.db, mine, NOW))!.heard).toEqual([]);
    // Remember it again undoes it.
    expect(await rememberStory(t.db, mine, "heard", h!.id)).toBe(true);
    expect((await storyView(t.db, mine, NOW))!.heard).toHaveLength(1);
    // And a later date with that person forms a fresh opinion.
    vi.setSystemTime(new Date(NOW.getTime() + 2 * HOURS));
    const later = await episode(mine, NELL, { ending: "second_date", revealedAt: new Date(NOW.getTime() + HOURS).toISOString() });
    await afterAired(t.db, later);
    expect((await stateFor(t.db, mine, { withId: NELL }))!.opinions[0]).toMatchObject({ source: later });
  });

  it("the owner's panel shows the want, each opinion and thing heard with Forget, and what was forgotten", async () => {
    const mine = await person("Rowan Vale");
    const date = await episode(mine, NELL, { ending: "friends", sides: [true, false] });
    await afterAired(t.db, date);
    await hear(t.db, { holder: mine, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:p", isTrue: false });
    const gone = await hear(t.db, { holder: mine, about: JUNE, claim: "June cheats at cards.", toldBy: SABLE, source: "scene:q", isTrue: true });
    await forgetStory(t.db, mine, "heard", gone!.id);
    await setWant(t.db, { holder: mine, want: "Get closer to someone new.", kind: "pursue", setBy: "rules", now: NOW });
    const story = (await storyView(t.db, mine, NOW))!;
    const html = renderToStaticMarkup(createElement(StoryPanel, { characterId: mine, name: "Rowan Vale", story, episodes: [date] }));
    expect(html).toContain("This week Rowan wants:");
    expect(html).toContain("What Rowan thinks of people:");
    expect(html).toContain("What Rowan has heard:");
    expect(html).toContain(`href="/characters/${NELL}"`);
    expect(html).toContain(`href="/episodes/${date}"`);
    expect(html).toContain("Dex owns a boat he says he doesn&#x27;t.");
    expect(html).toContain(`${first(SABLE)} told it`);
    expect(html).toContain("(only from what it heard)");
    expect(html).toContain(">Forget<");
    expect(html).toContain("Forgotten (1)");
    expect(html).toContain("Remember it again");
    expect(html).not.toMatch(/is_true|untrue/);
  });

  it("is the owner's alone over the API: see it, forget, remember again", async () => {
    const cookie = newUserCookie();
    const stranger = newUserCookie();
    const mine = await person("Rowan Vale", { owner: userIdOf(cookie) });
    await afterAired(t.db, await episode(mine, NELL, { ending: "friends", sides: [true, false] }));
    const ctx = { params: Promise.resolve({ id: mine }) };
    const get = (c: string) => getStory(new Request(`${BASE_URL}/api/characters/${mine}/story`, { headers: { cookie: c } }), ctx);
    expect((await get(stranger)).status).toBe(404);
    const seen = await get(cookie);
    expect(seen.status).toBe(200);
    expect((await seen.json()).story.thinks).toHaveLength(1);
    const body = { kind: "opinion", item: NELL };
    expect((await postStory(jsonRequest(`/api/characters/${mine}/story`, body, { cookie: stranger }), ctx)).status).toBe(404);
    const forgot = await postStory(jsonRequest(`/api/characters/${mine}/story`, body, { cookie }), ctx);
    expect(forgot.status).toBe(200);
    expect((await forgot.json()).story.thinks).toEqual([]);
    expect((await postStory(jsonRequest(`/api/characters/${mine}/story`, body, { cookie }), ctx)).status).toBe(404);
    const back = await deleteStory(jsonRequest(`/api/characters/${mine}/story`, body, { cookie, method: "DELETE" }), ctx);
    expect(back.status).toBe(200);
    expect((await back.json()).story.thinks).toHaveLength(1);
    // A house character has no owner: nobody reads its state here.
    expect((await getStory(new Request(`${BASE_URL}/api/characters/${NELL}/story`, { headers: { cookie } }), { params: Promise.resolve({ id: NELL }) })).status).toBe(404);
  });
});

describe("agents (MCP)", () => {
  it("see their character's story state in my_character_memory and forget it with forget_memory, with no new tool", async () => {
    const mctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, mctx);
    const session: McpContext = { sessionId: mctx.issuedSessionId };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async (name: string, args: Record<string, unknown>): Promise<any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result;
    const ada = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent.character.id;
    await afterAired(t.db, await episode(ada, NELL, { ending: "friends", sides: [true, false] }));
    await updateCharacterMemory(t.db, ada);
    const h = await hear(t.db, { holder: ada, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:m", isTrue: false });

    const mem = (await call("my_character_memory", { character_id: ada })).structuredContent;
    expect(mem.what_it_thinks_of_people.map((o: { about: string }) => o.about).sort()).toEqual([DEX, NELL].sort());
    expect(mem.what_it_has_heard).toEqual([{ id: h!.id, claim: "Dex owns a boat he says he doesn't.", told_by: HOUSE_CHARACTERS.find((c) => c.id === SABLE)!.name, from: "scene:m" }]);
    expect(JSON.stringify(mem)).not.toContain("is_true");
    expect((await call("forget_memory", { character_id: ada, kind: "opinion", item: NELL })).isError).toBeUndefined();
    expect((await call("forget_memory", { character_id: ada, kind: "heard", item: h!.id })).isError).toBeUndefined();
    const after = (await call("my_character_memory", { character_id: ada })).structuredContent;
    expect(after.what_it_thinks_of_people.map((o: { about: string }) => o.about)).toEqual([DEX]);
    expect(after.what_it_has_heard).toBeUndefined();
    expect(after.forgotten).toEqual(expect.arrayContaining([{ kind: "opinion", item: NELL }, { kind: "heard", item: h!.id }]));
    expect((await call("forget_memory", { character_id: ada, kind: "opinion", item: NELL, remember_again: true })).isError).toBeUndefined();
    expect((await call("my_character_memory", { character_id: ada })).structuredContent.what_it_thinks_of_people).toHaveLength(2);
    // Forgetting something it doesn't hold is an error, as with memory.
    expect((await call("forget_memory", { character_id: ada, kind: "opinion", item: JUNE })).isError).toBe(true);
  });
});

describe("the switch (STORY_STATE=0)", () => {
  it("writes nothing and gives no prompt block", async () => {
    await afterAired(t.db, await episode(JUNE, DEX));
    await hear(t.db, { holder: JUNE, about: NELL, claim: "Nell keeps a list of every dog she meets.", toldBy: SABLE, source: "scene:on", isTrue: true });
    expect(await stateFor(t.db, JUNE, { withId: DEX })).not.toBeNull();
    const before = { o: (await opinions()).length, h: (await heardRows()).length };

    vi.stubEnv("STORY_STATE", "0");
    expect(storyStateOn()).toBe(false);
    expect(await afterAired(t.db, await episode(NELL, SABLE))).toEqual({ opinions: 0, watched: 0, used: 0 });
    expect(await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex snores on trains.", toldBy: SABLE, source: "scene:off", isTrue: true })).toBeNull();
    expect(await setOpinion(t.db, { holder: JUNE, about: SABLE, trust: 1, take: "Fine.", basis: "firsthand", source: "x" })).toBe(false);
    expect(await ensureWants(t.db, NOW)).toEqual({ set: 0 });
    expect(await storyUpkeep(t.db, NOW)).toBeNull();
    expect(await backfillStoryState(t.db, NOW)).toEqual({ pairs: 0, done: false });
    expect({ o: (await opinions()).length, h: (await heardRows()).length }).toEqual(before);
    expect(await t.count("character_wants" as never)).toBe(0);
    // Reads go quiet too: no block for any prompt, no view, no tensions.
    expect(await stateFor(t.db, JUNE, { withId: DEX })).toBeNull();
    expect(await storyView(t.db, JUNE)).toBeNull();
    expect(await companionStory(t.db, { id: JUNE, house: true }, false)).toEqual([]);
    expect(await tensions(t.db, seasonIdOf(NOW), { now: NOW })).toEqual([]);

    vi.stubEnv("STORY_STATE", "1");
    expect(storyStateOn()).toBe(true);
  });
});

describe("the backfill and the hourly upkeep", () => {
  it("derives the cast's firsthand opinions from the last 30 days of aired public dates, once, with no model call", async () => {
    const recent = await episode(NELL, DEX, { ending: "second_date", revealedAt: ago(24 * 10) });
    const older = await episode(NELL, DEX, { ending: "friends", revealedAt: ago(24 * 20) });
    const tooOld = await episode(SABLE, JUNE, { ending: "friends", revealedAt: ago(24 * 45) });
    const priv = await episode(SABLE, DEX, { revealedAt: ago(24 * 3), visibility: "private" });
    const unaired = await episode(JUNE, DEX, { revealedAt: null });
    const outsiders = await episode(OFF_CAST, HOUSE_CHARACTERS[7].id, { revealedAt: ago(24 * 2) });
    const withPerson = await episode(await person("Rowan Vale"), JUNE, { ending: "disaster", revealedAt: ago(24 * 5), sides: [false, false] });
    void older; void tooOld; void priv; void unaired; void outsiders;

    const first = await backfillStoryState(t.db, NOW);
    expect(first).toEqual({ pairs: 2, done: true });
    const rows = await opinions();
    expect(rows.map((r) => r.source).sort()).toEqual([recent, recent, withPerson, withPerson].sort());
    // Dates from days ago are not news: nobody "watched them air" now.
    expect(await heardRows()).toEqual([]);
    // Once.
    expect(await backfillStoryState(t.db, NOW)).toEqual({ pairs: 0, done: true });
    expect((await opinions()).length).toBe(4);
  });

  it("picks up where it left off when its time runs out, and the upkeep prunes old watched rows that never came up", async () => {
    await episode(NELL, DEX, { revealedAt: ago(24 * 2) });
    await episode(SABLE, JUNE, { revealedAt: ago(24 * 4) });
    expect(await backfillStoryState(t.db, NOW, -1)).toEqual({ pairs: 0, done: false });
    expect((await opinions()).length).toBe(0);
    // An old watched row nobody used, an old one that came up, and an old one someone told: only the first goes.
    for (const [id, toldBy, used, days] of [["w-old", null, false, 40], ["w-used", null, true, 40], ["w-told", SABLE, false, 40], ["w-new", null, false, 2]] as const) {
      await t.db.query(
        `insert into character_heard (id, holder_id, about_id, claim, told_by, source, is_true, heard_at, used_at) values ($1, $2, $3, 'A claim.', $4, $1, true, $5, $6)`,
        [id, JUNE, DEX, toldBy, ago(24 * days), used ? ago(24) : null],
      );
    }
    const kept = await storyUpkeep(t.db, NOW);
    expect(kept).toMatchObject({ backfilled: 2, wants: 4, pruned: 1 });
    // (June also watched Nell and Dex's date from two days ago air: the backfill treats a date that recent as news.)
    expect((await heardRows(JUNE)).map((h) => h.id).filter((id) => id.startsWith("w-")).sort()).toEqual(["w-new", "w-told", "w-used"]);
    expect((await heardRows(JUNE)).filter((h) => !h.id.startsWith("w-"))).toHaveLength(1);
    expect((await opinions()).length).toBe(4);
  });
});
