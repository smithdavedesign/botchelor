// A roleplay of one's own in Step in (lib/adult/own-roleplay-card.ts; David, 2026-11-23: "story beats for your own
// roleplays"). A person's own roleplays (the Create library) couldn't be picked in Step in at all, and had no story
// card, so no goal, no beats and no ending. Now each gets a card drafted for it, held to what a card of the show's is,
// and plays like one of the show's: on the shelf, in the set-up, and in a scene that keeps its own copy.
// Its story is set somewhere too (a place drafted with the card), a goal is never shown ungrammatical, and a roleplay
// saved before any of this gets its story past the front page's response.
// The fixtures are mild lines; no live calls here.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
// A place's picture is asked for by name and never drawn here (lib/sets.ts ensureSet would reach a picture provider).
const sets = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("@/lib/sets", async (orig) => ({
  ...((await orig()) as object),
  ensureSet: async (_db: unknown, place: string) => {
    sets.asked.push(place);
    return "drawing";
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import { POST as startPost } from "@/app/api/admin/after-dark/step-in/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import {
  draftMissingOwnCards,
  draftOwnCard,
  draftOwnStory,
  ensureOwnCard,
  ensureOwnStory,
  OWN_CARD_DRAFTS,
  OWN_CARD_RETRY_MINUTES,
  OWN_CARDS_PER_VISIT,
  OWN_STORY_VERSION,
  ownCardMessages,
  ownCardReadingIssue,
  ownCardReadingIssues,
  ownPlaceDrawable,
  ownPlaceIssue,
  ownRoleplays,
  ownStoriesOpen,
  parseOwnCard,
  parseOwnPlace,
  setOwnCardOnSaveForTests,
  withoutBadBeats,
} from "@/lib/adult/own-roleplay-card";
import { ROLEPLAY_PLACE_MAX, ROLEPLAYS, sceneRoleplay, storedCard } from "@/lib/adult/roleplays";
import { isPublicPlace } from "@/lib/adult/scenes";
import { SHELF_OWN, SHELF_TONIGHT, shelfShown } from "@/lib/adult/step-in-shelf";
import { closeStepIn, drawStepInSet, getStepInScene, listStepInScenes, moveStepIn, playedRoleplays, quickStepIn, readStepInStory, sendStepInLine, setStepInRandomForTests, startStepIn, stepInOpen, storyPlaces } from "@/lib/adult/step-in";
import { storyGoal } from "@/lib/adult/step-in-story";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, Model } from "@/lib/model";
import { DATE_ROLEPLAYS, leaningVerbAt, premiseForYou, withoutLeaningVerbs } from "@/lib/roleplays";
import { adultCardIssue, adultCardTextIssue } from "@/lib/scene-card-check";
import { cardShownToYou, cardTexts, premiseShownToYou, type SceneCard } from "@/lib/scene-cards";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { deleteItem, saveRoleplay } from "@/lib/studio/library";
import { normalizeScene } from "@/lib/venues";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  sets.asked.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  // The scene's continuity sheet (lib/adult/step-in-tracker.ts) is read past a start's response: not these tests'
  // subject, and its read would otherwise reach the scripted model after a test has moved on.
  vi.stubEnv("STEP_IN_TRACKER", "0");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setStepInRandomForTests(() => 0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const HOME = "venue:home";

/** What a person wrote: the Create tab's own first idea. */
const TRUCKS = {
  title: "Rival food trucks",
  premise: "{a} and {b} run food trucks parked side by side; tonight one of them finally admits the rivalry was flirting all along.",
  roles: ["the taco truck owner", "the ramen truck owner"] as [string, string],
};
/** A card a model could draft for it: inside every line a card is held to, and reading right from either side. */
const CARD: SceneCard = {
  setup: "The lunch rush is over and both trucks are closing up. {a} walks one last taco across the gap, and {b} has been keeping a bowl of ramen warm for exactly this.",
  wants: [
    "{a} wants to find out whether a year of trash talk was ever about the food; pride keeps getting in the way.",
    "{b} wants {a} to admit it first; waiting is getting harder to make look casual.",
  ],
  beats: [
    "The last taco gets traded for the last bowl, and each pretends to judge it harshly.",
    "One of them admits to parking here on purpose.",
    "The rivalry gets called what it was, and nobody laughs it off.",
    "A truce is proposed, with terms that are obviously an excuse.",
  ],
  tone: "playful, competitive, a year of banter finally meaning something",
  openings: [
    "{a} sets a taco on {b}'s counter and says it is a peace offering.",
    "{b} leans out of the hatch and asks whether {a} is closing early or giving up.",
    "{a} and {b} flip the signs to closed at the same moment and notice.",
  ],
};

/** Where a model could say the trucks' story is set, as a draft writes it and as it's kept. */
const PLACE = { place: "the night market at closing time, both trucks shutting up", title: "The night market, closing time" };
const DRAFT = { ...CARD, place: PLACE.place, place_title: PLACE.title };
/** A kept card as it's stored since places: the card, where it's set, and the mark that says so. */
const kept = (card: SceneCard = CARD, at: typeof PLACE | null = PLACE) => ({ ...card, at, v: OWN_STORY_VERSION });

function signIn(id: string): string {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  return { id, cookie: signIn(id) };
}
async function subscriber() {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signIn(id) };
}

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const isReader = (m: ChatMessage[]) => m[0].content.startsWith("You read a private scene of adult fiction");
const isDraft = (m: ChatMessage[]) => m[0].content.startsWith("You write the story card behind a roleplay");
const REPLIES = [
  ['She took the taco without looking at it. "A peace offering. From you. I should check it for a note from your lawyer."', "The generator behind the ramen truck ticked as it cooled."],
  ['"You parked here on purpose," she said. "A year ago. I watched you measure the kerb."', "She slid a bowl across the counter anyway."],
  ['"We could call it a rivalry for one more week," she said, "or we could call it what it was."', "Neither of them reached for the napkins."],
  ['"A truce, then. Thursdays we trade, and whoever loses cooks the other dinner." She held out a hand, and kept holding it out.', "The street lamps came on over both trucks at once."],
  ['She pulled the hatch down behind her and locked it. "Same kerb tomorrow," she said, and smiled as she said it.', "The two signs said closed, side by side."],
  ['"Stay for the broth, at least," she said.', "The bowls were already out."],
];
/**
 * The scripted models: the card's drafter answers with `drafts` in order (the last again; an Error is a failed call),
 * the story's reader with `played` the same way, the writer with a different reply each time. What each was asked is kept.
 */
function scripted(o: { drafts?: unknown[]; played?: unknown[] } = {}) {
  const seen = { prompts: [] as ChatMessage[][], reader: [] as ChatMessage[][], drafts: [] as ChatMessage[][] };
  let i = 0;
  let r = 0;
  let d = 0;
  const answer = (a: unknown) => {
    if (a instanceof Error) throw a;
    return typeof a === "string" ? a : JSON.stringify(a);
  };
  const model: Model = {
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They traded a taco for a bowl of ramen and called a truce.", line: "The night the two trucks called a truce." });
      if (isDraft(m)) {
        seen.drafts.push(m);
        const drafts = o.drafts ?? [CARD];
        return answer(drafts[Math.min(d++, drafts.length - 1)]);
      }
      if (isReader(m)) {
        seen.reader.push(m);
        const played = o.played ?? [{ played: [] }];
        return answer(played[Math.min(r++, played.length - 1)]);
      }
      seen.prompts.push(m);
      return JSON.stringify({ story: REPLIES[Math.min(i++, REPLIES.length - 1)] });
    },
  };
  setAdultModelForTests(model);
  return { seen, model };
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
/** Saves the food trucks for someone and says its "u:" id. */
async function mine(owner: string, over: Partial<{ title: string; premise: string; roles: [string, string] | null; mode: "safe" | "after_dark" }> = {}) {
  const r = await saveRoleplay(t.db, owner, { ...TRUCKS, ...over });
  if (!r.ok) throw new Error(`not saved: ${r.message}`);
  return `u:${r.item.id}`;
}
/** Puts a card on a roleplay as if it had been drafted: by default one from before places (no place, no mark), which a scene plays as it is. */
const keep = (uid: string, card: object | null = CARD, at = "now()") => t.db.query(`update creator_roleplays set card = $2::jsonb, card_at = ${at} where id = $1`, [uid.slice(2), card ? JSON.stringify(card) : null]);
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
const say = async (viewer: string, id: string, line: string) => {
  const r = await sendStepInLine(t.db, viewer, id, line);
  if (!r.ok) throw new Error(`send failed: ${r.status} ${r.message}`);
  return r.view;
};
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const until = async (ok: () => Promise<boolean>) => {
  for (let n = 0; n < 100; n++) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("it never happened");
};

describe("the card that's drafted", () => {
  it("is asked for with what they wrote, who {a} and {b} are, and the rules a card of the show's follows", () => {
    const [system, user] = ownCardMessages(TRUCKS);
    expect(system.content).toMatch(/^You write the story card behind a roleplay/);
    expect(system.content).toMatch(/never describes anything sexual/);
    expect(system.content).toMatch(/never says how the evening ends/);
    expect(user.content).toContain("Title: Rival food trucks");
    expect(user.content).toContain(`The situation: ${TRUCKS.premise}`);
    expect(user.content).toContain("{a} plays the taco truck owner; {b} plays the ramen truck owner.");
    expect(user.content).toMatch(/never "he", "she"/);
    expect(user.content).toMatch(/three or four turns/);
    expect(user.content).not.toMatch(/couldn't be used/);
    // How the show's own cards keep every verb beside its name, and where the story is set, as theirs are written.
    expect(user.content).toContain('write the name again rather than leave it understood ("{a} wants to ask, and {a} keeps putting it off", never "{a} wants to ask but keeps putting it off")');
    expect(user.content).toContain("in a clause of its own after a semicolon");
    expect(user.content).toContain(`- "place": where the story is set, written so that it can follow the word "at"`);
    expect(user.content).toContain(`Under ${ROLEPLAY_PLACE_MAX} characters ("the night market at closing time, lanterns going out").`);
    expect(user.content).toContain('"openings": ["...", "...", "..."], "place": "...", "place_title": "..."}');
    // The words it's told to leave out are ones the card's check refuses in any sense (so the list can't drift from it).
    const left = /leave these words out even where they'd be innocent: ([^.]+)\./.exec(user.content)?.[1].split(", ") ?? [];
    expect(left.length).toBeGreaterThan(10);
    for (const word of left) expect(adultCardTextIssue(`The ${word} comes up once.`), word).not.toBeNull();
    // No roles, and a situation that doesn't say who is who: the first person it mentions is {a}.
    const plain = ownCardMessages({ title: "Pen pals", premise: "Two pen pals meet for the first time.", roles: null })[1].content;
    expect(plain).toContain("It has no named roles: {a} and {b} are the two people in it. The situation doesn't say which of them is {a}");
    expect(ownCardMessages({ ...TRUCKS, roles: null })[1].content).not.toMatch(/doesn't say which of them/);
    // What was wrong with the last one is said back, once, at the end.
    expect(ownCardMessages(TRUCKS, 'openings[0]: suggestive ("to bed")')[1].content).toMatch(/Your last card couldn't be used: openings\[0\]: suggestive \("to bed"\)\. Write the whole card again without that\.$/);
  });

  it("is read from the model's JSON, tidied; anything that isn't a card is none", () => {
    expect(parseOwnCard(JSON.stringify(CARD))).toEqual(CARD);
    // Inside a code fence, with stray space, a fifth beat, a fourth opening, and {A} for {a}.
    const messy = { ...CARD, setup: `  ${CARD.setup.replace("{a}", "{A}")}\n`, beats: [...CARD.beats, "A fifth turn."], openings: [...CARD.openings, "{b} waves."] };
    expect(parseOwnCard("```json\n" + JSON.stringify(messy) + "\n```")).toEqual(CARD);
    for (const junk of ["", "I can't write that.", "[]", '{"setup": "x"}', JSON.stringify({ ...CARD, wants: [CARD.wants[0]] }), JSON.stringify({ ...CARD, openings: CARD.openings.slice(0, 2) }), JSON.stringify({ ...CARD, tone: 7 })]) {
      expect(parseOwnCard(junk), junk).toBeNull();
    }
    // The fixture is what a kept card must be.
    expect(adultCardIssue(CARD)).toBeNull();
    expect(ownCardReadingIssue(CARD)).toBeNull();
    expect(storedCard(CARD)).toEqual(CARD);
    expect(storedCard({ ...CARD, beats: "none" })).toBeNull();
  });

  it("takes one call when the draft is a card inside every line", async () => {
    const { seen, model } = scripted();
    expect(await draftOwnCard(model, TRUCKS)).toEqual(CARD);
    expect(seen.drafts).toHaveLength(1);
  });

  it("is drafted once more with the reason said back, and is none when neither draft can be kept", async () => {
    const racy = { ...CARD, openings: ["{a} asks whether {b} wants to go to bed.", CARD.openings[1], CARD.openings[2]] };
    const again = scripted({ drafts: [racy, CARD] });
    expect(await draftOwnCard(again.model, TRUCKS)).toEqual(CARD);
    expect(again.seen.drafts).toHaveLength(2);
    expect(again.seen.drafts[1][1].content).toMatch(/Your last card couldn't be used: openings\[0\]: suggestive/);
    // Not JSON at all, then a card that names an ending: nothing is kept, and no third call is made.
    const never = scripted({ drafts: ["Sure! Here is a card.", { ...CARD, tone: "by the end they are in love" }] });
    expect(await draftOwnCard(never.model, TRUCKS)).toBeNull();
    expect(never.seen.drafts).toHaveLength(OWN_CARD_DRAFTS);
    expect(never.seen.drafts[1][1].content).toMatch(/it wasn't the JSON object asked for/);
    // A model that doesn't answer: none, and it isn't asked again.
    const down = scripted({ drafts: [new Error("no answer")] });
    expect(await draftOwnCard(down.model, TRUCKS)).toBeNull();
    expect(down.seen.drafts).toHaveLength(1);
    // Never a card with a line crossed, whatever the roleplay: the never-list holds for a drafted card too.
    const crossed = scripted({ drafts: [{ ...CARD, setup: "{a} is the teacher and {b} stays after the lesson." }] });
    expect(await draftOwnCard(crossed.model, TRUCKS)).toBeNull();
  });

  it("drops one bad beat of four and keeps the story, but never goes under three", async () => {
    const four = { ...CARD, beats: [CARD.beats[0], "They undress each other by the grill.", CARD.beats[2], CARD.beats[3]] };
    expect(withoutBadBeats(four).beats).toEqual([CARD.beats[0], CARD.beats[2], CARD.beats[3]]);
    const { seen, model } = scripted({ drafts: [four] });
    expect((await draftOwnCard(model, TRUCKS))?.beats).toHaveLength(3);
    expect(seen.drafts).toHaveLength(1);
    // Three beats with one bad: left as it is, for the check to refuse.
    const three = { ...CARD, beats: [CARD.beats[0], "By the end they leave together.", CARD.beats[2]] };
    expect(withoutBadBeats(three)).toEqual(three);
    expect(adultCardIssue(three)).toMatch(/^beats\[1\]: names an ending/);
  });

  it("is asked for again when it would read wrong as \"you\", and kept when the second is no better", async () => {
    const adverb: SceneCard = { ...CARD, openings: ["{a} quietly sets a taco on the counter.", CARD.openings[1], CARD.openings[2]] };
    expect(ownCardReadingIssue(adverb)).toMatch(/^openings\[0\]: put \{a\} or \{b\} straight before its verb/);
    const gendered: SceneCard = { ...CARD, wants: [CARD.wants[0], "{b} wants {a} to admit it first; she is tired of waiting."] };
    expect(ownCardReadingIssue(gendered)).toMatch(/^wants\[1\]: it says "he" or "she"/);
    // A better second draft is the one kept.
    const better = scripted({ drafts: [adverb, CARD] });
    expect(await draftOwnCard(better.model, TRUCKS)).toEqual(CARD);
    expect(better.seen.drafts[1][1].content).toMatch(/Your last card couldn't be used: openings\[0\]: put \{a\} or \{b\} straight before its verb/);
    // No better: the first is inside every line, so it's kept (a clumsy sentence beats no story).
    const same = scripted({ drafts: [adverb, gendered] });
    expect(await draftOwnCard(same.model, TRUCKS)).toEqual(adverb);
    // But never in place of a refusal: a second draft the check refuses doesn't lose the first.
    const worse = scripted({ drafts: [adverb, { ...CARD, tone: "naked ambition" }] });
    expect(await draftOwnCard(worse.model, TRUCKS)).toEqual(adverb);
  });
});

describe("kept on the roleplay", () => {
  it("is drafted once, kept, and read back without another call; only for its owner", async () => {
    const a = await admin();
    const other = await admin();
    const uid = await mine(a.id);
    const { seen } = scripted();
    expect(await ensureOwnCard(t.db, other.id, uid)).toBeNull();
    expect(await ensureOwnCard(t.db, a.id, "u:not-an-id")).toBeNull();
    expect(seen.drafts).toHaveLength(0);
    expect(await ensureOwnCard(t.db, a.id, uid)).toEqual(CARD);
    expect(await ensureOwnCard(t.db, a.id, uid)).toEqual(CARD);
    expect(seen.drafts).toHaveLength(1);
    const [row] = await rows(`select card, card_at from creator_roleplays where id = $1`, [uid.slice(2)]);
    // Kept with where it's set (this draft said nowhere) and the mark of a story drafted with a place.
    expect(row.card).toEqual(kept(CARD, null));
    expect(row.card_at).toBeTruthy();
    // On the front page's list it's shaped like one of the show's, with its card.
    expect(await ownRoleplays(t.db, a.id)).toEqual([{ id: uid, title: TRUCKS.title, icon: "✨", category: "romance", premise: TRUCKS.premise, roles: TRUCKS.roles, card: CARD }]);
    expect(await ownRoleplays(t.db, other.id)).toEqual([]);
  });

  it("isn't asked for again within the hour after a draft came to nothing, and is after that", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    const { seen } = scripted({ drafts: ["no", "still no", CARD] });
    const now = new Date("2026-11-24T10:00:00Z");
    expect(await ensureOwnCard(t.db, a.id, uid, now)).toBeNull();
    expect(seen.drafts).toHaveLength(2);
    expect(await ensureOwnCard(t.db, a.id, uid, new Date(now.getTime() + (OWN_CARD_RETRY_MINUTES - 1) * 60_000))).toBeNull();
    expect(seen.drafts).toHaveLength(2);
    expect(await ensureOwnCard(t.db, a.id, uid, new Date(now.getTime() + (OWN_CARD_RETRY_MINUTES + 1) * 60_000))).toEqual(CARD);
    expect(seen.drafts).toHaveLength(3);
    // Listed without a card until it has one, and a kept card a check has since turned against is drafted again.
    await keep(uid, { ...CARD, tone: "naked ambition" });
    expect((await ownRoleplays(t.db, a.id))[0].card).toBeUndefined();
    expect(await ensureOwnCard(t.db, a.id, uid, now)).toEqual(CARD);
    expect(seen.drafts).toHaveLength(4);
  });

  it("is only drafted where Step in is open: the same answer as the scene's own switch", async () => {
    const a = await admin();
    const s = await subscriber();
    for (const who of [a.id, s.id]) expect(await ownStoriesOpen(t.db, who), who).toBe(await stepInOpen(t.db, who));
    expect(await ownStoriesOpen(t.db, a.id)).toBe(true);
    expect(await ownStoriesOpen(t.db, s.id)).toBe(false);
  });

  it("is drafted past the response when a roleplay is saved, and the library says so once it's there", async () => {
    const a = await admin();
    const { seen } = scripted();
    setOwnCardOnSaveForTests(true);
    const saved = await libraryPost(post("/api/library", { action: "save_roleplay", ...TRUCKS, mode: "after_dark" }, a.cookie));
    expect(saved.status).toBe(200);
    const id = ((await saved.json()) as { item: { id: string } }).item.id;
    await until(async () => (await rows(`select 1 from creator_roleplays where id = $1 and card is not null`, [id])).length === 1);
    expect(seen.drafts).toHaveLength(1);
    const got = (await (await libraryGet(new Request(`${BASE_URL}/api/library`, { headers: { cookie: a.cookie } }))).json()) as { step_in: boolean; library: { roleplays: { id: string; story_beats?: number }[] } };
    expect(got.library.roleplays).toEqual([expect.objectContaining({ id, story_beats: CARD.beats.length })]);
    expect(got.step_in).toBe(true);
    // Someone Step in isn't open to: nothing is drafted for theirs, and nothing is said about a story.
    const s = await subscriber();
    const theirs = await libraryPost(post("/api/library", { action: "save_roleplay", ...TRUCKS, mode: "after_dark" }, s.cookie));
    expect(theirs.status).toBe(200);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.drafts).toHaveLength(1);
    const list = (await (await libraryGet(new Request(`${BASE_URL}/api/library`, { headers: { cookie: s.cookie } }))).json()) as { step_in: boolean; library: { roleplays: Record<string, unknown>[] } };
    expect(list.library.roleplays[0]).not.toHaveProperty("story_beats");
    expect(list.step_in).toBe(false);
  });
});

describe("a scene in a roleplay of one's own", () => {
  it("keeps its own copy of the roleplay and its card, and the reply's prompt carries both from the character's side", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid);
    const { seen } = scripted();
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid, you: 0 }, opening: 0 });
    if (!r.ok) throw new Error(r.message);
    expect(seen.drafts).toHaveLength(0);
    const [row] = await rows(`select roleplay, opening from adult_step_in_scenes where id = $1`, [r.id]);
    expect(row.roleplay).toEqual({ id: uid, you: 0, own: { title: TRUCKS.title, premise: TRUCKS.premise, roles: TRUCKS.roles, category: "romance", card: CARD, at: null } });
    expect(row.opening).toBe(CARD.openings[0]);
    expect(r.view.roleplay).toEqual({
      id: uid,
      title: "Rival food trucks",
      icon: "✨",
      you_play: "the taco truck owner",
      they_play: "the ramen truck owner",
      setup: `The lunch rush is over and both trucks are closing up. You walk one last taco across the gap, and ${NAME} has been keeping a bowl of ramen warm for exactly this.`,
    });
    expect(r.view.story).toMatchObject({ goal: "You want to find out whether a year of trash talk was ever about the food; pride keeps getting in the way.", beats: 4, done: 0, complete: false });
    // The writer's prompt: the premise and the card from the character's side, the character's own want only.
    const system = seen.prompts[0][0].content;
    expect(system).toContain(`Tonight's scene is a roleplay the two of you chose: Rival food trucks. Your scene partner and ${NAME} run food trucks parked side by side;`);
    expect(system).toContain("You play the ramen truck owner; they play the taco truck owner.");
    expect(system).toContain(`What you want in it: ${NAME} wants your scene partner to admit it first; waiting is getting harder to make look casual.`);
    expect(system).toContain("The last taco gets traded for the last bowl, and each pretends to judge it harshly. One of them admits to parking here on purpose.");
    expect(system).not.toContain("pride keeps getting in the way");
    expect(seen.prompts[0].at(-1)!.content).toContain(`It opens like this: Your scene partner sets a taco on ${NAME}'s counter and says it is a peace offering.`);
    // It's a roleplay everywhere a scene's roleplay is read: the list of scenes names it.
    expect((await listStepInScenes(t.db, a.id)).running[0].roleplay).toBe("Rival food trucks");
    // The other side, and one with no roles.
    const b = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid, you: 1 } });
    if (!b.ok) throw new Error(b.message);
    expect(b.view.roleplay).toMatchObject({ you_play: "the ramen truck owner", they_play: "the taco truck owner" });
    expect(b.view.story?.goal).toBe(`You want ${NAME} to admit it first; waiting is getting harder to make look casual.`);
  });

  it("refuses another person's roleplay, one that isn't there, and one a check has since turned against", async () => {
    const a = await admin();
    const other = await admin();
    const theirs = await mine(other.id);
    scripted();
    for (const id of [theirs, `u:${randomUUID()}`, "u:nope", "not-a-roleplay"]) {
      expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id } }), id).toMatchObject({ ok: false, status: 422, error: "invalid_roleplay" });
      expect(await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id } }), id).toMatchObject({ ok: false, status: 422, error: "invalid_roleplay" });
    }
    // Saved before a line moved: what they wrote is read again as it's used.
    const uid = await mine(a.id);
    await t.db.query(`update creator_roleplays set premise = $2 where id = $1`, [uid.slice(2), "{a} is {b}'s teacher, and stays after the lesson."]);
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid } });
    expect(r).toMatchObject({ ok: false, status: 422, error: "invalid_roleplay" });
    expect(!r.ok && r.message).toMatch(/can't be played/);
    expect(await ownRoleplays(t.db, a.id)).toEqual([]);
    expect(await rows(`select 1 from adult_step_in_scenes`)).toHaveLength(0);
    // It has no place of its own: the story's place is for the show's.
    const fine = await mine(a.id, { title: "Pen pals, finally", premise: "{a} and {b} have written letters for a year. Tonight they meet for the first time.", roles: null });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: "story", roleplay: { id: fine } })).toMatchObject({ ok: false, status: 422, error: "invalid_place", message: expect.stringContaining("no place of its own") });
  });

  it("drafts the card at the start when none is kept yet, after everything else has passed; without one it plays with no story", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    const { seen } = scripted();
    // A start that's refused (a written opening that crosses a line) drafts nothing.
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid }, opening: { written: "My sister walks in." } })).toMatchObject({ ok: false, status: 422 });
    expect(seen.drafts).toHaveLength(0);
    // One click: the card is drafted (one call), kept on the roleplay, and the scene starts at their place.
    const q = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    if (!q.ok) throw new Error(q.message);
    expect(seen.drafts).toHaveLength(1);
    expect(seen.prompts).toHaveLength(0);
    expect((await rows(`select card from creator_roleplays where id = $1`, [uid.slice(2)]))[0].card).toEqual(kept(CARD, null));
    const view = await viewOf(a.id, q.id);
    expect(view.place.id).toBe(HOME);
    expect(view.story).toMatchObject({ beats: 4, done: 0 });
    // The next one finds it kept.
    const again = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    expect(again.ok && again.id).not.toBe(q.id);
    expect(seen.drafts).toHaveLength(1);
    // No draft can be kept: two calls, and the scene still starts, as a roleplay without a story.
    const plain = await mine(a.id, { title: "Pen pals, finally", premise: "{a} and {b} have written letters for a year. Tonight they meet for the first time.", roles: null });
    const none = scripted({ drafts: ["no", "still no"] });
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: plain } });
    if (!r.ok) throw new Error(r.message);
    expect(none.seen.drafts).toHaveLength(2);
    expect(r.view.roleplay).toMatchObject({ title: "Pen pals, finally", you_play: null, setup: "" });
    expect(r.view.story).toBeNull();
    expect(none.seen.prompts[0][0].content).toContain(`Pen pals, finally. Your scene partner and ${NAME} have written letters for a year.`);
    expect(none.seen.prompts[0][0].content).not.toContain("The story behind it");
    expect((await readStepInStory(t.db, a.id, r.id)).ok).toBe(true);
    expect(none.seen.reader).toHaveLength(0);
  });

  it("plays on as it was after the roleplay is deleted from the library", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid);
    const { seen } = scripted({ played: [{ played: [1] }] });
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid } });
    if (!r.ok) throw new Error(r.message);
    expect(await deleteItem(t.db, a.id, "roleplay", uid.slice(2))).toBe(true);
    const view = await say(a.id, r.id, "I hold out the taco. Peace offering.");
    expect(view.roleplay?.title).toBe("Rival food trucks");
    expect(seen.prompts.at(-1)![0].content).toContain("Tonight's scene is a roleplay the two of you chose: Rival food trucks.");
    const story = await readStepInStory(t.db, a.id, r.id);
    expect(story.ok && story.story).toMatchObject({ done: 1, beats: 4 });
    // A new scene can't start in it any more.
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid } })).toMatchObject({ ok: false, error: "invalid_roleplay" });
    // What the scene stores reads back as the roleplay, with or without the library.
    const [row] = await rows(`select roleplay from adult_step_in_scenes where id = $1`, [r.id]);
    expect(sceneRoleplay(row.roleplay as { id: string })).toMatchObject({ id: uid, title: "Rival food trucks", icon: "✨", card: CARD });
    expect(sceneRoleplay({ id: uid })).toBeNull();
    expect(sceneRoleplay({ id: "neighbours" })).toBe(ROLEPLAYS.find((x) => x.id === "neighbours"));
  });

  it("has a goal, beats that tick one a reading, an ending offered and a played mark, like one of the show's", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid);
    const { seen } = scripted({ played: [{ played: [1, 2, 3, 4] }] });
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid } });
    if (!r.ok) throw new Error(r.message);
    const lines = ["I hold out the taco. Peace offering.", "I parked here on purpose too.", "It was never about the food.", "Thursdays, then. Deal."];
    for (let i = 0; i < lines.length; i++) {
      const view = await say(a.id, r.id, lines[i]);
      expect(view.story).toMatchObject({ done: i, due: true });
      const read = await readStepInStory(t.db, a.id, r.id);
      expect(read.ok && read.story).toMatchObject({ done: i + 1, beats: 4, complete: i === 3 });
    }
    // The reader was shown the card's beats from the reader's side: no braces, the character by name.
    expect(seen.reader[0][1].content).toContain("1. The last taco gets traded for the last bowl, and each pretends to judge it harshly.");
    expect(seen.reader[0][1].content.split("\n\n")[0]).not.toMatch(/[{}]/);
    expect(await playedRoleplays(t.db, a.id)).toEqual({ [uid]: 1 });
    // The ending: one last reply, then filed, the recap told to them.
    const closed = await closeStepIn(t.db, a.id, r.id);
    expect(closed.ok && closed.view.ended).toBeTruthy();
    expect(closed.ok && closed.view.story).toMatchObject({ complete: true });
    expect((await listStepInScenes(t.db, a.id)).ended[0]).toMatchObject({ roleplay: "Rival food trucks" });
  });
});

describe("where it's picked", () => {
  it("the start route takes a \"u:\" id of theirs, one click or set up, and refuses anything else", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid);
    scripted();
    const quick = await startPost(post("/api/admin/after-dark/step-in", { character_id: WHO, quick: true, roleplay: { id: uid, you: 1 } }, a.cookie));
    expect(quick.status).toBe(200);
    const { id } = (await quick.json()) as { id: string };
    expect((await viewOf(a.id, id)).roleplay).toMatchObject({ id: uid, you_play: "the ramen truck owner" });
    const full = await startPost(post("/api/admin/after-dark/step-in", { character_id: WHO, place: HOME, roleplay: { id: uid }, opening: 2 }, a.cookie));
    expect(full.status).toBe(200);
    for (const bad of ["u:", "u:not-a-uuid", "U:" + randomUUID(), "someone-elses", ""]) {
      for (const body of [{ character_id: WHO, quick: true, roleplay: { id: bad } }, { character_id: WHO, place: HOME, roleplay: { id: bad } }]) {
        const res = await startPost(post("/api/admin/after-dark/step-in", body, a.cookie));
        expect(res.status, bad).toBe(422);
        expect(((await res.json()) as { error: string }).error, bad).toBe("invalid_request");
      }
    }
    // Well formed, and not theirs.
    const none = await startPost(post("/api/admin/after-dark/step-in", { character_id: WHO, quick: true, roleplay: { id: `u:${randomUUID()}` } }, a.cookie));
    expect(none.status).toBe(422);
    expect(((await none.json()) as { error: string }).error).toBe("invalid_roleplay");
  });

  it("the front page lists theirs: first under All, a kind of their own, the goal on the card, and in the set-up's menu", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid);
    const bare = await mine(a.id, { title: "Pen pals, finally", premise: "{a} and {b} have written letters for a year. Tonight they meet for the first time.", roles: null });
    // The newest first: the trucks were saved a minute before the pen pals.
    await t.db.query(`update creator_roleplays set created_at = now() - interval '1 minute' where id = $1`, [uid.slice(2)]);
    scripted();
    // The list itself: theirs lead "All", are a kind of their own, and tonight's eight are the show's.
    const own = await ownRoleplays(t.db, a.id);
    expect(own.map((r) => r.id)).toEqual([bare, uid]);
    const lists = { house: ROLEPLAYS, own, day: "2026-11-24", pictured: new Set(ROLEPLAYS.map((r) => r.id)), kinds: [{ id: "strangers", roleplays: ROLEPLAYS.slice(0, 3) }] };
    expect(shelfShown("all", lists).map((r) => r.id)).toEqual([bare, uid, ...ROLEPLAYS.map((r) => r.id)]);
    expect(shelfShown(SHELF_OWN, lists).map((r) => r.id)).toEqual([bare, uid]);
    expect(shelfShown("tonight", lists)).toHaveLength(SHELF_TONIGHT);
    expect(shelfShown("tonight", lists).every((r) => !r.id.startsWith("u:"))).toBe(true);
    expect(shelfShown("strangers", lists).map((r) => r.id)).toEqual(ROLEPLAYS.slice(0, 3).map((r) => r.id));
    expect(shelfShown("no-such-kind", lists)).toEqual([]);
    expect(shelfShown(SHELF_OWN, { house: ROLEPLAYS, day: "2026-11-24" })).toEqual([]);
    const page = await html(await StepInSetupPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain(`${ROLEPLAYS.length} stories and 2 of your own, each ready to play`);
    expect(page).toMatch(new RegExp(`All<span class="ad-si-shelf-n"> ${ROLEPLAYS.length + 2}</span>`));
    expect(page).toContain(`<option value="yours">✨ Yours (2)</option>`);
    expect(page).not.toContain("data-step-in-shelf-write");
    // Tonight's eight are the show's own.
    expect(page).not.toContain(`data-step-in-card="${uid}"`);
    // The set-up's menu has them first, under their own heading.
    expect(page).toMatch(new RegExp(`<optgroup label="✨ Yours"[^>]*><option value="${bare}">Pen pals, finally</option><option value="${uid}">Rival food trucks</option></optgroup>`));
    // "Set it up" on one of theirs: the set-up starts on it, told from the viewer's side, with its own three openings.
    const set = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: uid, you: "1" }) }));
    expect(set).toContain(`<option value="${uid}" selected="">Rival food trucks</option>`);
    expect(set).toContain(`${NAME} walks one last taco across the gap, and you have been keeping a bowl of ramen warm for exactly this.`);
    expect(set).toContain(`You lean out of the hatch and ask whether ${NAME} is closing early or giving up.`);
    expect(set).toContain("You play the ramen truck owner");
    expect(set).not.toContain("data-step-in-story-place");
    // One with no card yet is told by what they wrote, with the openings a scene without a roleplay has.
    const plain = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: bare }) }));
    expect(plain).toContain(`You and ${NAME} have written letters for a year. Tonight they meet for the first time.`);
    expect(plain).toContain(`You got there first and have been pretending not to watch the door when ${NAME} walks in.`);
  });

  it("says where one is written to someone who has none, and nothing more", async () => {
    const a = await admin();
    scripted();
    const page = await html(await StepInSetupPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain(`${ROLEPLAYS.length} stories, each ready to play`);
    expect(page).toMatch(/data-step-in-shelf-write="[^"]*"> Or <a href="\/after-dark\/studio\/house-[a-z]+\?tab=create">write your own<\/a>/);
    expect(page).not.toContain(`value="yours"`);
    expect(page).not.toContain("✨ Yours");
    expect(a.id).toBeTruthy();
  });
});

describe("where a roleplay of one's own is set", () => {
  const PEN_PALS = { title: "Pen pals, finally", premise: "{a} and {b} have written letters for a year. Tonight they meet for the first time.", roles: null };

  it("is read from the draft as the show's own places are written, and held to what theirs are", () => {
    // Tidied: the small letter first, the heading's capital, no full stop, a detail too many cut back.
    expect(parseOwnPlace(JSON.stringify({ ...CARD, place: "The night market at closing time, both trucks shutting up.", place_title: "the night market, closing time" }))).toEqual(PLACE);
    expect(parseOwnPlace(JSON.stringify({ place: `${PLACE.place}, broth on the air`, place_title: `"${PLACE.title}"` }))).toEqual(PLACE);
    expect(PLACE.place.length).toBeLessThanOrEqual(ROLEPLAY_PLACE_MAX);
    // Nowhere, or nowhere that can be kept.
    const nowhere = [
      {},
      { place: PLACE.place },
      { place: "", place_title: "A place" },
      { place: "the school gym after hours", place_title: "The gym" },
      { place: "{a}'s kitchen, the kettle on", place_title: "The kitchen" },
      { place: "a quiet bedroom above the shop", place_title: "A room above the shop" },
      { place: "x".repeat(ROLEPLAY_PLACE_MAX + 1), place_title: "A place" },
      { place: "the night market", place_title: "7" },
    ];
    for (const bad of nowhere) expect(parseOwnPlace(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    expect(parseOwnPlace("not json")).toBeNull();
    expect(ownPlaceIssue({ place: "The night market", title: "The night market" })).toMatch(/^place: it starts with a small letter/);
    expect(ownPlaceIssue({ place: "the night market", title: "the night market" })).toMatch(/^place_title: it starts with a capital/);
    expect(ownPlaceIssue({ place: 'the "night" market', title: "The night market" })).toMatch(/^place: a plain phrase/);
    // Every place of the show's own passes the same rule: a drafted one is held to theirs, and to nothing they'd fail.
    for (const rp of ROLEPLAYS) expect(ownPlaceIssue(rp.at), rp.id).toBeNull();
  });

  it("comes with whichever draft is kept, and is never a reason to ask again", async () => {
    const { seen, model } = scripted({ drafts: [DRAFT] });
    expect(await draftOwnStory(model, TRUCKS)).toEqual({ card: CARD, at: PLACE });
    expect(seen.drafts).toHaveLength(1);
    const bad = scripted({ drafts: [{ ...CARD, place: "the school gym after hours", place_title: "The gym" }] });
    expect(await draftOwnStory(bad.model, TRUCKS)).toEqual({ card: CARD, at: null });
    expect(bad.seen.drafts).toHaveLength(1);
    // The card alone, for whoever only wants that.
    expect(await draftOwnCard(scripted({ drafts: [DRAFT] }).model, TRUCKS)).toEqual(CARD);
  });

  it("is kept with the card, listed with the roleplay, and a scene started from its card starts there", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    const { seen } = scripted({ drafts: [DRAFT] });
    expect(await ensureOwnStory(t.db, a.id, uid)).toEqual({ card: CARD, at: PLACE });
    expect((await rows(`select card from creator_roleplays where id = $1`, [uid.slice(2)]))[0].card).toEqual(kept());
    const [listed] = await ownRoleplays(t.db, a.id);
    expect(listed.at).toEqual(PLACE);
    // A night market has other people in it: read from the place's words, like any other place.
    expect(isPublicPlace(PLACE.place)).toBe(true);
    expect(storyPlaces([listed])[uid]).toEqual({ title: PLACE.title, public: true });
    expect(storyPlaces()[uid]).toBeUndefined();
    expect(Object.keys(storyPlaces())).toHaveLength(ROLEPLAYS.length);
    // One click on its card: where its story is set, not the character's place.
    const q = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    if (!q.ok) throw new Error(q.message);
    const [row] = await rows(`select place, roleplay from adult_step_in_scenes where id = $1`, [q.id]);
    expect(row.place).toBe(PLACE.place);
    expect((row.roleplay as { own: { at: unknown } }).own.at).toEqual(PLACE);
    expect((await viewOf(a.id, q.id)).place).toEqual({ id: "story", title: PLACE.title, place: PLACE.place, image: null, backdrop: null, public: true });
    expect((await listStepInScenes(t.db, a.id)).running[0].place).toBe(PLACE.title);
    // Its picture, once one has been drawn, is the scene's backdrop (asked for by name: it's in nobody's list of 45).
    await t.db.query(`insert into place_sets (normalized, label, status) values ($1, $2, 'ready')`, [normalizeScene(PLACE.place), PLACE.place]);
    expect((await viewOf(a.id, q.id)).place.backdrop).toContain("/api/sets/");
    // The set-up's "where its story is set", and a place from the list instead.
    const there = await startStepIn(t.db, a.id, { character_id: WHO, place: "story", roleplay: { id: uid } });
    if (!there.ok) throw new Error(there.message);
    expect(there.view.place.id).toBe("story");
    const system = seen.prompts.at(-1)![0].content;
    expect(system).toContain(`imagining you are both at ${PLACE.place}`);
    expect(system).toContain(`You are out in public (${PLACE.place})`);
    const home = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid } });
    expect(home.ok && home.view.place.id).toBe(HOME);
    expect(seen.drafts).toHaveLength(1);
  });

  it("out in public it's held to a kiss until the scene moves, and it moves to their place from there", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid, kept());
    scripted();
    const q = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    if (!q.ok) throw new Error(q.message);
    expect((await viewOf(a.id, q.id)).place).toMatchObject({ id: "story", public: true });
    const moved = await moveStepIn(t.db, a.id, q.id, HOME);
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.view.place).toMatchObject({ id: HOME, public: false });
    expect(moved.view.messages.at(-1)).toMatchObject({ role: "system", kind: "place" });
    // Away from where the story is set, nothing is asked of that place's picture any more.
    expect(await drawStepInSet(t.db, a.id, q.id)).toBeNull();
    expect(sets.asked).toEqual([]);
  });

  it("drafted at a one-click start, the scene starts where the fresh draft says; with nowhere, at their place", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    const first = scripted({ drafts: [DRAFT] });
    const q = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    if (!q.ok) throw new Error(q.message);
    expect(first.seen.drafts).toHaveLength(1);
    expect((await viewOf(a.id, q.id)).place).toMatchObject({ id: "story", title: PLACE.title });
    // A draft that says nowhere: the card is kept, and one click starts at the character's place, as before.
    const plain = await mine(a.id, PEN_PALS);
    scripted({ drafts: [CARD] });
    const h = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: plain } });
    if (!h.ok) throw new Error(h.message);
    expect((await viewOf(a.id, h.id)).place.id).toBe(HOME);
    expect((await viewOf(a.id, h.id)).story).toMatchObject({ beats: 4 });
    // Asked for by name (the set-up never offers it for one with no place): refused, once the draft has said nowhere.
    const other = await mine(a.id, { title: "Lovers across time", premise: "{a} and {b} keep meeting in different centuries. Tonight, for once, they get a whole night in the same one.", roles: null });
    scripted({ drafts: [CARD] });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: "story", roleplay: { id: other } })).toMatchObject({ ok: false, status: 422, error: "invalid_place" });
    expect(await rows(`select 1 from adult_step_in_scenes where roleplay->>'id' = $1`, [other])).toHaveLength(0);
  });

  it("has its picture asked for like any story's place, unless the place has a name in it", async () => {
    expect(ownPlaceDrawable(PLACE.place)).toBe(true);
    expect(ownPlaceDrawable("the open front door of a flat, late on a Thursday")).toBe(true);
    expect(ownPlaceDrawable("a rooftop bar in Lisbon at dusk")).toBe(false);
    for (const rp of ROLEPLAYS) expect(ownPlaceDrawable(rp.at.place), rp.id).toBe(true);
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid, kept());
    scripted();
    const q = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: uid } });
    if (!q.ok) throw new Error(q.message);
    expect(await drawStepInSet(t.db, a.id, q.id)).toBe("drawing");
    expect(sets.asked).toEqual([PLACE.place]);
    // A place with a name in it still plays, under its own heading; its picture is never drawn (a set is everyone's).
    const named = { place: "a rooftop bar in Lisbon at dusk", title: "A rooftop bar in Lisbon" };
    expect(ownPlaceIssue(named)).toBeNull();
    const other = await mine(a.id, PEN_PALS);
    await keep(other, kept(CARD, named));
    const n = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: other } });
    if (!n.ok) throw new Error(n.message);
    expect((await viewOf(a.id, n.id)).place).toMatchObject({ id: "story", title: named.title, backdrop: null });
    sets.asked.length = 0;
    expect(await drawStepInSet(t.db, a.id, n.id)).toBeNull();
    expect(sets.asked).toEqual([]);
    // One of the show's own, as before.
    const house = await quickStepIn(t.db, a.id, WHO, new Date(), { roleplay: { id: "neighbours" } });
    if (!house.ok) throw new Error(house.message);
    expect(await drawStepInSet(t.db, a.id, house.id)).toBe("drawing");
    expect(sets.asked).toEqual([ROLEPLAYS.find((r) => r.id === "neighbours")!.at.place]);
  });

  it("the set-up offers where its story is set, and starts there unless they pick somewhere", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid, kept());
    scripted();
    const set = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: uid }) }));
    expect(set).toMatch(/<option(?=[^>]*value="story")(?=[^>]*selected="")[^>]*>Where the story is set: The night market, closing time · out in public</);
    expect(set).toContain("📍 Set at: The night market, closing time (out in public).");
    // One with no place: nothing of the kind, and their place is where it starts.
    const plain = await mine(a.id, PEN_PALS);
    await keep(plain, kept(CARD, null));
    const none = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: plain }) }));
    expect(none).not.toContain("Where the story is set");
    expect(none).not.toContain("📍 Set at");
  });
});

describe("a goal that reads right", () => {
  const WANT = "{a} wants to finally admit the rivalry was an excuse to be near {b}, but worries {b} might not feel the same.";
  const LEANING: SceneCard = { ...CARD, wants: [WANT, CARD.wants[1]] };

  it("finds a verb left leaning on the name that \"you\" replaced, only from the side it reads wrong for", () => {
    const told = premiseForYou(WANT, "a", "Wally");
    expect(told).toBe("You want to finally admit the rivalry was an excuse to be near Wally, but worries Wally might not feel the same.");
    expect(leaningVerbAt(told, "Wally")).toBe(told.indexOf(", but worries"));
    expect(withoutLeaningVerbs(told, "Wally")).toBe("You want to finally admit the rivalry was an excuse to be near Wally.");
    // From the other side the verb is Wally's own, and right as it is.
    const theirs = premiseForYou(WANT, "b", "Wally");
    expect(theirs).toBe("Wally wants to finally admit the rivalry was an excuse to be near you, but worries you might not feel the same.");
    expect(leaningVerbAt(theirs, "Wally")).toBe(-1);
    // After a comma, after "or", with an adverb between, in a clause of its own; what follows a semicolon is kept.
    for (const [raw, shown] of [
      ["{a} wants to ask {b} to stay, and hopes {b} says yes.", "You want to ask Mara to stay."],
      ["{a} wants to win; {a} smiles, yet is nervous.", "You want to win; you smile."],
      ["{a} wants to stay late, but still has a train to catch; the last one leaves at midnight.", "You want to stay late; the last one leaves at midnight."],
      ["{a} wants to dance or just watches the floor.", "You want to dance."],
    ]) {
      expect(withoutLeaningVerbs(premiseForYou(raw, "a", "Mara"), "Mara"), raw).toBe(shown);
    }
    // A verb joined by a bare "and" is already turned (lib/roleplays.ts premiseForYou), and nothing is cut.
    expect(withoutLeaningVerbs(premiseForYou(CARD.openings[0], "a", "Mara"), "Mara")).toBe("You set a taco on Mara's counter and say it is a peace offering.");
    // The other one's name is never taken for a verb, and nor is a word that only ends like one.
    expect(leaningVerbAt("You want to stay, and Miles has other plans.", "Miles Okafor")).toBe(-1);
    expect(leaningVerbAt("You want to stay, and this is the night for it.", "Mara")).toBe(-1);
    expect(leaningVerbAt("You and Mara flip the signs to closed at the same moment and notice.", "Mara")).toBe(-1);
  });

  it("touches no card of the show's own, whoever is in it", () => {
    for (const rp of [...ROLEPLAYS, ...DATE_ROLEPLAYS]) {
      for (const { field, text } of cardTexts(rp.card)) {
        for (const side of ["a", "b"] as const) {
          for (const name of ["Mara", "Miles", "Iris"]) expect(leaningVerbAt(premiseForYou(text, side, name), name), `${rp.id} ${field}/${side}/${name}`).toBe(-1);
        }
      }
    }
    for (const rp of ROLEPLAYS) {
      for (const you of [0, 1] as const) expect(storyGoal(rp, you, "Miles Okafor"), `${rp.id}:${you}`).toBe(premiseForYou(rp.card.wants[you], you === 1 ? "b" : "a", "Miles"));
    }
  });

  it("is asked for again when a draft leans a verb on a name, and the draft with fewer such texts is the one kept", async () => {
    expect(adultCardIssue(LEANING)).toBeNull();
    expect(ownCardReadingIssue(LEANING)).toMatch(/^wants\[0\]: a verb leans on \{a\} or \{b\} without the name/);
    const better = scripted({ drafts: [LEANING, CARD] });
    expect(await draftOwnCard(better.model, TRUCKS)).toEqual(CARD);
    expect(better.seen.drafts[1][1].content).toMatch(/Your last card couldn't be used: wants\[0\]: a verb leans on \{a\} or \{b\} without the name/);
    // The same fault twice: the first is kept (it's inside every line).
    expect(await draftOwnCard(scripted({ drafts: [LEANING, LEANING] }).model, TRUCKS)).toEqual(LEANING);
    // Two texts that read wrong, then one: the second is the better card, and it's the one kept.
    const two: SceneCard = { ...LEANING, openings: ["{a} quietly sets a taco on the counter.", CARD.openings[1], CARD.openings[2]] };
    expect(ownCardReadingIssues(two)).toHaveLength(2);
    expect(ownCardReadingIssues(CARD)).toEqual([]);
    expect(await draftOwnCard(scripted({ drafts: [two, LEANING] }).model, TRUCKS)).toEqual(LEANING);
    expect(await draftOwnCard(scripted({ drafts: [LEANING, two] }).model, TRUCKS)).toEqual(LEANING);
  });

  it("is never shown ungrammatical: the goal stops before the clause, and the writer's copy stays whole", async () => {
    expect(storyGoal({ card: LEANING }, 0, "Wally Brandt")).toBe("You want to finally admit the rivalry was an excuse to be near Wally.");
    expect(cardShownToYou(LEANING, "a", "Wally").wants[0]).toBe("You want to finally admit the rivalry was an excuse to be near Wally.");
    expect(cardShownToYou(CARD, "a", "Wally")).toEqual({ ...CARD, setup: premiseForYou(CARD.setup, "a", "Wally"), wants: [premiseForYou(CARD.wants[0], "a", "Wally"), premiseForYou(CARD.wants[1], "a", "Wally")], beats: CARD.beats, tone: CARD.tone, openings: CARD.openings.map((o) => premiseForYou(o, "a", "Wally")) });
    const a = await admin();
    const uid = await mine(a.id);
    await keep(uid, kept(LEANING, null));
    const { seen } = scripted();
    const mine0 = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid, you: 0 } });
    if (!mine0.ok) throw new Error(mine0.message);
    expect(mine0.view.story?.goal).toBe(`You want to finally admit the rivalry was an excuse to be near ${NAME}.`);
    // On the other side that want is the character's own, and the writer is told all of it.
    const theirs = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: uid, you: 1 } });
    if (!theirs.ok) throw new Error(theirs.message);
    expect(seen.prompts.at(-1)![0].content).toContain(`What you want in it: ${NAME} wants to finally admit the rivalry was an excuse to be near your scene partner, but worries your scene partner might not feel the same.`);
    // And the scene's own copy has the want as it was drafted.
    const [row] = await rows(`select roleplay from adult_step_in_scenes where id = $1`, [theirs.id]);
    expect((row.roleplay as { own: { card: SceneCard } }).own.card.wants[0]).toBe(WANT);
  });
});

describe("roleplays saved before stories were drafted", () => {
  const NOW = new Date("2026-11-24T10:00:00Z");
  const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
  /** Three roleplays of theirs, the first the oldest, none with a card. */
  async function three(owner: string) {
    const ids: string[] = [];
    for (const [i, [title, where]] of [["The last ferry", "on the quay"], ["Pen pals, finally", "at the post office"], ["Rival food trucks", "at the kerb"]].entries()) {
      const uid = await mine(owner, { title, premise: `{a} and {b} meet again ${where}, and this time neither leaves early.` });
      await t.db.query(`update creator_roleplays set created_at = now() - ($2::int * interval '1 minute') where id = $1`, [uid.slice(2), 30 - i * 10]);
      ids.push(uid);
    }
    return ids;
  }
  const carded = async (owner: string) => (await rows(`select id from creator_roleplays where owner_id = $1 and card is not null order by created_at desc`, [owner])).map((r) => `u:${r.id}`);

  it("get theirs two at a visit, the newest first, and nothing once every one has a story", async () => {
    const a = await admin();
    const [oldest, middle, newest] = await three(a.id);
    const { seen } = scripted({ drafts: [DRAFT] });
    // Switched off for every test but this kind (tests/setup-no-live-checks.ts): nothing is asked of any model.
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(0);
    expect(seen.drafts).toHaveLength(0);
    setOwnCardOnSaveForTests(true);
    expect(OWN_CARDS_PER_VISIT).toBe(2);
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(2);
    expect(seen.drafts).toHaveLength(2);
    expect(await carded(a.id)).toEqual([newest, middle]);
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(1);
    expect(await carded(a.id)).toEqual([newest, middle, oldest]);
    expect(await draftMissingOwnCards(t.db, a.id, later(120))).toBe(0);
    expect(seen.drafts).toHaveLength(3);
    // Each has its goal and where it's set on the next visit.
    for (const rp of await ownRoleplays(t.db, a.id)) expect(rp).toMatchObject({ card: CARD, at: PLACE });
    // Someone else's are never touched.
    const other = await admin();
    await mine(other.id);
    expect(await draftMissingOwnCards(t.db, a.id, later(180))).toBe(0);
    expect(await carded(other.id)).toEqual([]);
  });

  it("wait an hour after a draft that came to nothing; a card from before places is drafted again once, and stays if nothing better comes", async () => {
    const a = await admin();
    const uid = await mine(a.id);
    setOwnCardOnSaveForTests(true);
    const none = scripted({ drafts: ["no"] });
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(1);
    expect(none.seen.drafts).toHaveLength(OWN_CARD_DRAFTS);
    expect(await draftMissingOwnCards(t.db, a.id, later(OWN_CARD_RETRY_MINUTES - 1))).toBe(0);
    expect(none.seen.drafts).toHaveLength(OWN_CARD_DRAFTS);
    const got = scripted({ drafts: [DRAFT] });
    expect(await draftMissingOwnCards(t.db, a.id, later(OWN_CARD_RETRY_MINUTES + 1))).toBe(1);
    expect(got.seen.drafts).toHaveLength(1);
    expect((await ownRoleplays(t.db, a.id))[0]).toMatchObject({ card: CARD, at: PLACE });
    // A card kept before places were drafted (no mark): it plays as it is, a scene's start never drafts it again,
    // and the front page's pass does, once.
    await keep(uid, CARD, "'2026-11-24T06:00:00Z'");
    expect((await ownRoleplays(t.db, a.id))[0]).toMatchObject({ card: CARD });
    expect((await ownRoleplays(t.db, a.id))[0].at).toBeUndefined();
    const again = scripted({ drafts: [DRAFT] });
    expect(await ensureOwnStory(t.db, a.id, uid, NOW)).toEqual({ card: CARD, at: null });
    expect(again.seen.drafts).toHaveLength(0);
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(1);
    expect(again.seen.drafts).toHaveLength(1);
    expect((await ownRoleplays(t.db, a.id))[0].at).toEqual(PLACE);
    // Drafted again and nothing usable coming: the card it had stays, marked, and isn't tried a third time.
    const old: SceneCard = { ...CARD, tone: "an older draft, kept" };
    await keep(uid, old, "'2026-11-24T06:00:00Z'");
    const failing = scripted({ drafts: ["no"] });
    expect(await draftMissingOwnCards(t.db, a.id, NOW)).toBe(1);
    expect(failing.seen.drafts).toHaveLength(OWN_CARD_DRAFTS);
    expect((await rows(`select card from creator_roleplays where id = $1`, [uid.slice(2)]))[0].card).toEqual(kept(old, null));
    expect(await draftMissingOwnCards(t.db, a.id, later(600))).toBe(0);
    expect(failing.seen.drafts).toHaveLength(OWN_CARD_DRAFTS);
  });

  it("the front page asks for them past its response, and shows a person's own sentence with a capital until then", async () => {
    const a = await admin();
    const uid = await mine(a.id, { title: "The last ferry", premise: "the last ferry of the night, {a} and {b} the only two aboard.", roles: null });
    const { seen } = scripted({ drafts: [DRAFT] });
    setOwnCardOnSaveForTests(true);
    expect(premiseShownToYou("the last ferry of the night, {a} and {b} the only two aboard.", "a", "Wally Brandt")).toBe("The last ferry of the night, you and Wally the only two aboard.");
    const page = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: uid }) }));
    expect(page).toContain(`The last ferry of the night, you and ${NAME} the only two aboard.`);
    expect(page).not.toContain("Where the story is set");
    await until(async () => (await rows(`select 1 from creator_roleplays where id = $1 and card is not null`, [uid.slice(2)])).length === 1);
    expect(seen.drafts).toHaveLength(1);
    // The next visit has its story: how it starts, and where it's set.
    const next = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO, roleplay: uid }) }));
    expect(next).toContain("Where the story is set: The night market, closing time");
    expect(next).toContain(premiseForYou(CARD.setup, "a", NAME));
    // And someone with none of their own: nothing is asked of anything.
    const b = await admin();
    await html(await StepInSetupPage({ searchParams: Promise.resolve({}) }));
    await new Promise((r) => setTimeout(r, 40));
    expect(seen.drafts).toHaveLength(1);
    expect(b.id).toBeTruthy();
  });
});
