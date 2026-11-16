/**
 * Follow a character, and "Right now" at the top of its page (lib/character-follows.ts, lib/character-now.ts; 2026-11-16).
 *
 * Follow: who can be followed (public, not your own, creator still here) and by whom (anyone on a session, as a couple
 * is), what a follower hears and that it is one notice an event (a date airing, a step up, the house), that a muted
 * type rings nothing, that an account's follow switches the character's texts on in a quietly opened thread (the AI
 * notice, no opener, no model call) and unfollowing switches them off again without deleting anything, the account
 * export and deletion, and the switch.
 *
 * Right now: the pure shaping (ties, the latest thing, the spare week line, nothing at all when empty), that it is
 * built from public rows only (nothing from the story state, never a private or unaired date), where it sits on the
 * page, and the switch. The page's round trips are held by tests/perf-pages.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The After Dark teaser on a house character is its own async server component: not what these tests are about.
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { DELETE as unfollowRoute, POST as followRoute } from "@/app/api/characters/[id]/follow/route";
import CharacterPage from "@/app/characters/[id]/page";
import { deleteAccount, deleteCharacter, exportAccount } from "@/lib/account";
import { characterFollowers, characterFollowOn, characterFollowState, followCharacter, pairCharacterFollowers, tellFollowersOfScene, unfollowCharacter } from "@/lib/character-follows";
import { characterNowOn, NOW_QUOTE_MAX, shapeNow, type NowInput } from "@/lib/character-now";
import type { CharacterTalk, TalkAfter, TalkFriction, TalkSaid } from "@/lib/character-talk";
import { companionNotice, setCompanionModelForTests } from "@/lib/companion";
import type { SideOutcome } from "@/lib/engine";
import { followCouple } from "@/lib/follows";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ensureHouseScene, sceneIdOf, scenePath, textAboutScene } from "@/lib/house-scenes";
import { houseTextsForScene } from "@/lib/house-texts";
import { shortName } from "@/lib/names";
import { setMuted } from "@/lib/notification-mutes";
import { notificationTypeOf } from "@/lib/notification-types";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { refreshRelationship } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { seasonIdOf } from "@/lib/season-window";
import { clearSharedCache } from "@/lib/shared-cache";
import type { CircleData, StoryPerson, StoryTie, TieKind } from "@/lib/story-map";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const nameOf = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id;
const first = (id: string) => shortName(nameOf(id));
// 18:20 UTC on Nov 12: the first pass from the house scene's hour on (as tests/house-texts.test.ts).
const NOW = new Date("2026-11-12T18:20:00Z");
const DAY = "2026-11-12";
const SCENE = sceneIdOf(DAY);
const HOURS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOURS).toISOString();

let t: Awaited<ReturnType<typeof startTestDb>>;
let modelCalls = 0;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  for (const table of ["notifications", "notification_mutes", "story_beats", "character_follows"]) await t.db.query(`delete from ${table}`);
  clearSharedCache();
  jar.cookies.clear();
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  // Companions open to everyone, as on prod: the Text button's own rule decides who may text whom.
  vi.stubEnv("COMPANION_OPEN", "1");
  modelCalls = 0;
  setCompanionModelForTests({
    async complete() {
      modelCalls++;
      return JSON.stringify({ messages: ["Hello."] });
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setSeasonCastForTests(null);
  setCompanionModelForTests(null);
});

let n = 0;
async function episode(a: string, b: string, e: { ending?: string; revealedAt?: string | null; visibility?: string } = {}) {
  const id = `cf-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript, created_at)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', $4, $5, $6, '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb, $7)`,
    [id, a, b, e.ending ?? "friends", e.revealedAt === undefined ? ago(3) : e.revealedAt, e.visibility ?? "public", ago(5)],
  );
  await refreshRelationship(t.db, a, b);
  return id;
}
async function person(name: string, owner: string, visibility = "public") {
  const id = `cf-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4)`,
    [id, owner, name, visibility],
  );
  return id;
}
/** A stored scene of another kind, as lib/house-conflict.ts leaves one. */
async function storedScene(id: string, day: string, kind: string, cast: string[], result: unknown, at: Date = NOW) {
  await t.db.query(
    `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, created_at, written_at)
     values ($1, $2, $3, $4, 'stairs', $5::jsonb, $6::jsonb, '[]'::jsonb, $7::jsonb, 'template', $8, $8)`,
    [id, day, seasonIdOf(at), kind, JSON.stringify(cast), JSON.stringify(cast.slice(0, 3).map((c, i) => ({ character_id: c, text: `Line ${i + 1}, said plainly.` }))), JSON.stringify(result), at.toISOString()],
  );
}
const fight = (a: string, b: string, outcome = "cleared_the_air") => ({ kind: "confrontation", outcome, over: "mutual_distrust", a, b, witness: null, moved: [], settled: 0 });
const guest = (userId: string) => ({ userId, authenticated: false });
const account = (userId: string) => ({ userId, authenticated: true });
const followRow = async (userId: string, characterId: string) => (await t.db.query<{ texts_on: boolean }>(`select texts_on from character_follows where user_id = $1 and character_id = $2`, [userId, characterId])).rows[0] ?? null;
const thread = async (userId: string, characterId: string) =>
  (await t.db.query<{ id: string; muted_proactive: boolean }>(`select id, muted_proactive from companion_threads where user_id = $1 and character_id = $2`, [userId, characterId])).rows[0] ?? null;
const messages = async (threadId: string) => (await t.db.query<{ role: string; text: string; action: string | null }>(`select role, text, action from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;
const inbox = async (userId: string) => (await listNotifications(t.db, userId)).map((x) => ({ kind: x.kind, title: x.title, body: x.body, link: x.link, read: x.read }));

/** Lexi (a person's character) dated Rafe; Dex and Marisol are left to talk about it (tests/house-texts.test.ts walkOn). */
async function walkOn(owner = "owner-1") {
  const lexi = await person("Lexi Marlowe", owner);
  const ep = await episode(lexi, RAFE);
  setSeasonCastForTests([RAFE, DEX, MARISOL]);
  return { lexi, ep };
}

/* ------------------------------------------------ following ------------------------------------------------ */

describe("following a character", () => {
  it("follows and unfollows a public character, counts followers, and never says who they are", async () => {
    expect(await characterFollowState(t.db, RAFE, "fan-a")).toEqual({ following: false, followers: 0 });
    expect(await followCharacter(t.db, guest("fan-a"), RAFE)).toMatchObject({ ok: true, state: { following: true, followers: 1 }, texts: false, thread_id: null });
    // Twice is once.
    expect(await followCharacter(t.db, guest("fan-a"), RAFE)).toMatchObject({ ok: true, state: { following: true, followers: 1 } });
    await followCharacter(t.db, guest("fan-b"), RAFE);
    // A stranger, and someone with no session at all, see the count and nothing else.
    expect(await characterFollowState(t.db, RAFE, "stranger")).toEqual({ following: false, followers: 2 });
    expect(await characterFollowState(t.db, RAFE, null)).toEqual({ following: false, followers: 2 });
    expect(Object.keys(await characterFollowState(t.db, RAFE, "stranger")).sort()).toEqual(["followers", "following"]);
    expect(await unfollowCharacter(t.db, "fan-a", RAFE)).toMatchObject({ ok: true, state: { following: false, followers: 1 }, texts_off: false });
    // Unfollowing what you don't follow is fine and changes nothing.
    expect(await unfollowCharacter(t.db, "fan-a", RAFE)).toMatchObject({ ok: true, state: { following: false, followers: 1 } });
  });

  it("refuses your own character, a private one, one whose creator left and one that isn't there", async () => {
    const mine = await person("Ira Fenn", "u-me");
    const hidden = await person("Wren Lurker", "u-other", "private");
    const left = await person("Gone Maker", "deleted");
    expect(await followCharacter(t.db, guest("u-me"), mine)).toMatchObject({ ok: false, status: 409, error: "own" });
    expect(await followCharacter(t.db, guest("u-me"), hidden)).toMatchObject({ ok: false, status: 404, error: "private" });
    expect(await followCharacter(t.db, guest("u-me"), left)).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect(await followCharacter(t.db, guest("u-me"), "no-such-character")).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect((await t.db.query(`select 1 from character_follows`)).rows).toHaveLength(0);
    // Someone else's public character is fine.
    expect(await followCharacter(t.db, guest("u-other"), mine)).toMatchObject({ ok: true });
  });

  it("the route follows on a session like a couple's does: a visitor with none is given one, and their follow is theirs", async () => {
    const ctx = { params: Promise.resolve({ id: RAFE }) };
    const res = await followRoute(new Request(`${BASE_URL}/api/characters/${RAFE}/follow`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ following: true, followers: 1, texts: false, thread_id: null });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^bz_sess=/);
    // No conversation was opened for someone without an account.
    expect((await t.db.query(`select 1 from companion_threads`)).rows).toHaveLength(0);
    // The same session unfollows; another visitor's DELETE touches nothing of theirs.
    const other = await unfollowRoute(new Request(`${BASE_URL}/api/characters/${RAFE}/follow`, { method: "DELETE", headers: { "content-type": "application/json", cookie: newUserCookie() }, body: "{}" }), ctx);
    expect(await other.json()).toMatchObject({ following: false, followers: 1 });
    const mine = await unfollowRoute(new Request(`${BASE_URL}/api/characters/${RAFE}/follow`, { method: "DELETE", headers: { "content-type": "application/json", cookie }, body: "{}" }), ctx);
    expect(await mine.json()).toMatchObject({ following: false, followers: 0, texts_off: false });
    // Your own character: refused, with why.
    const owner = newUserCookie();
    const own = await person("Ira Fenn", userIdOf(owner));
    const refused = await followRoute(new Request(`${BASE_URL}/api/characters/${own}/follow`, { method: "POST", headers: { "content-type": "application/json", cookie: owner }, body: "{}" }), { params: Promise.resolve({ id: own }) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "own" });
  });

  it("CHARACTER_FOLLOW=0 refuses the route both ways and tells no follower anything; the rows stay", async () => {
    expect(characterFollowOn({})).toBe(true);
    expect(characterFollowOn({ CHARACTER_FOLLOW: "0" })).toBe(false);
    await followCharacter(t.db, guest("fan-a"), RAFE);
    vi.stubEnv("CHARACTER_FOLLOW", "0");
    const ctx = { params: Promise.resolve({ id: RAFE }) };
    const request = (method: string) => new Request(`${BASE_URL}/api/characters/${RAFE}/follow`, { method, headers: { "content-type": "application/json", cookie: newUserCookie() }, body: "{}" });
    expect((await followRoute(request("POST"), ctx)).status).toBe(404);
    expect((await unfollowRoute(request("DELETE"), ctx)).status).toBe(404);
    expect(await followCharacter(t.db, guest("fan-b"), RAFE)).toMatchObject({ ok: false, error: "off" });
    expect((await characterFollowers(t.db, [RAFE])).size).toBe(0);
    expect(await pairCharacterFollowers(t.db, RAFE, JUNIPER)).toEqual([]);
    await storedScene(sceneIdOf(DAY, "confrontation"), DAY, "confrontation", [RAFE, DEX], fight(RAFE, DEX));
    expect(await tellFollowersOfScene(t.db, sceneIdOf(DAY, "confrontation"))).toBe(0);
    expect(await inbox("fan-a")).toEqual([]);
    expect(await followRow("fan-a", RAFE)).not.toBeNull();
  });
});

/* ------------------------------------------------ the texts ------------------------------------------------ */

describe("a follow and the character's texts", () => {
  it("an account's follow opens the thread quietly with texts on: the AI notice, no opener, no model call", async () => {
    const r = await followCharacter(t.db, account("acct-1"), RAFE, { now: NOW });
    expect(r).toMatchObject({ ok: true, texts: true });
    const th = (await thread("acct-1", RAFE))!;
    expect(r.ok && r.thread_id).toBe(th.id);
    expect(th.muted_proactive).toBe(false);
    expect(await messages(th.id)).toEqual([{ role: "system", text: companionNotice(nameOf(RAFE)), action: null }]);
    expect(modelCalls).toBe(0);
    expect(await followRow("acct-1", RAFE)).toEqual({ texts_on: true });
    // Following again changes nothing and writes nothing more.
    await followCharacter(t.db, account("acct-1"), RAFE, { now: NOW });
    expect(await messages(th.id)).toHaveLength(1);
    expect(await followRow("acct-1", RAFE)).toEqual({ texts_on: true });
  });

  it("the character's house text then reaches the follower, and unfollowing stops it without deleting the conversation", async () => {
    await walkOn();
    await followCharacter(t.db, account("acct-1"), RAFE, { now: new Date(NOW.getTime() - HOURS) });
    const th = (await thread("acct-1", RAFE))!;
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 1 });
    const after = await messages(th.id);
    expect(after.filter((m) => m.role === "character").every((m) => m.action === `house_scene:${SCENE}`)).toBe(true);
    expect(after.find((m) => m.role === "character")!.text).toContain("my date with Lexi");
    // Unfollow: the texts go off again, and every message is still there.
    expect(await unfollowCharacter(t.db, "acct-1", RAFE)).toMatchObject({ ok: true, texts_off: true, state: { following: false, followers: 0 } });
    expect((await thread("acct-1", RAFE))!).toEqual({ id: th.id, muted_proactive: true });
    expect(await messages(th.id)).toEqual(after);
    // The next day's scene texts nobody who unfollowed, and tells them nothing.
    const tomorrow = new Date(NOW.getTime() + 24 * HOURS);
    const again = sceneIdOf("2026-11-13", "confrontation");
    await storedScene(again, "2026-11-13", "confrontation", [RAFE, DEX], fight(RAFE, DEX), tomorrow);
    await textAboutScene(t.db, again, tomorrow);
    expect(await messages(th.id)).toEqual(after);
    expect((await inbox("acct-1")).filter((x) => x.link === scenePath(again))).toEqual([]);
  });

  it("leaves a choice made in the thread alone: texts that were already on stay on after unfollowing", async () => {
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ('th-own-choice', 'acct-2', $1, false)`, [RAFE]);
    expect(await followCharacter(t.db, account("acct-2"), RAFE, { now: NOW })).toMatchObject({ ok: true, texts: true, thread_id: "th-own-choice" });
    expect(await followRow("acct-2", RAFE)).toEqual({ texts_on: false });
    expect(await unfollowCharacter(t.db, "acct-2", RAFE)).toMatchObject({ ok: true, texts_off: false });
    expect((await thread("acct-2", RAFE))!.muted_proactive).toBe(false);
  });

  it("opens no thread for someone who may not text the character; a visitor without an account only gets texts where they already talk", async () => {
    // A person's public character that isn't open to texting: followed, never texted.
    const lexi = await person("Lexi Marlowe", "owner-1");
    expect(await followCharacter(t.db, account("acct-3"), lexi, { now: NOW })).toMatchObject({ ok: true, texts: false, thread_id: null });
    expect(await thread("acct-3", lexi)).toBeNull();
    // Without an account: no new conversation (a guest's few are theirs to spend).
    expect(await followCharacter(t.db, guest("guest-1"), RAFE, { now: NOW })).toMatchObject({ ok: true, texts: false, thread_id: null });
    expect(await thread("guest-1", RAFE)).toBeNull();
    // In one they already have, the texts go on, and off again with the follow.
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('th-guest', 'guest-2', $1)`, [RAFE]);
    expect(await followCharacter(t.db, guest("guest-2"), RAFE, { now: NOW })).toMatchObject({ ok: true, texts: true, thread_id: "th-guest" });
    expect((await thread("guest-2", RAFE))!.muted_proactive).toBe(false);
    await unfollowCharacter(t.db, "guest-2", RAFE);
    expect((await thread("guest-2", RAFE))!.muted_proactive).toBe(true);
    // Companions closed to all but admins: an account's follow is the notices alone.
    vi.stubEnv("COMPANION_OPEN", "0");
    expect(await followCharacter(t.db, account("acct-4"), RAFE, { now: NOW })).toMatchObject({ ok: true, texts: false, thread_id: null });
    expect(await thread("acct-4", RAFE)).toBeNull();
    expect(modelCalls).toBe(0);
  });
});

/* ------------------------------------------------ what a follower hears ------------------------------------------------ */

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
/** One more date for an owner's character with the house partner, aired. */
async function airedDate(creator: string, characterId: string, ending: "second_date" | "friends" | "disaster", wants: [boolean, boolean]) {
  scriptOutcome({ ending, sides: [side(wants[0]), side(wants[1])] });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();
  await api.reveal(ep.id, creator);
  return ep as { id: string };
}
async function ownerWithCharacter(name = "Ira Fenn") {
  const creator = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name }), creator)).json()) as { id: string };
  return { creator, owner: userIdOf(creator), character };
}

describe("a follower hears when a date airs", () => {
  it("one notice a date, in the couple's words: a first date, a step up, another date", async () => {
    const { creator, character } = await ownerWithCharacter();
    await followCharacter(t.db, guest("fan-cast"), HOUSE_PARTNER_ID);
    await followCharacter(t.db, guest("fan-theirs"), character.id);
    // Follows both of them: still one notice a date.
    await followCharacter(t.db, guest("fan-both"), HOUSE_PARTNER_ID);
    await followCharacter(t.db, guest("fan-both"), character.id);
    const couple = `Ira & ${first(HOUSE_PARTNER_ID)}`;

    const d1 = await airedDate(creator, character.id, "friends", [false, false]);
    for (const fan of ["fan-cast", "fan-theirs", "fan-both"]) {
      expect(await inbox(fan), fan).toEqual([{ kind: "couple_date", title: `${couple} went on a date`, body: "It ended: Just friends.", link: `/episodes/${d1.id}`, read: false }]);
    }
    // A second date agreed: the step up, once, not "another date" as well.
    await airedDate(creator, character.id, "second_date", [true, true]);
    for (const fan of ["fan-cast", "fan-both"]) {
      const got = await inbox(fan);
      expect(got, fan).toHaveLength(2);
      expect(got[0]).toMatchObject({ kind: "stage_up", link: expect.stringMatching(/^\/couples\//) });
    }
    // Someone who also follows the couple still hears each date once.
    await followCouple(t.db, "fan-both", character.id, HOUSE_PARTNER_ID);
    const d3 = await airedDate(creator, character.id, "friends", [true, false]);
    const both = await inbox("fan-both");
    expect(both).toHaveLength(3);
    expect(both[0]).toMatchObject({ kind: "couple_date", title: `${couple} went on another date`, link: `/episodes/${d3.id}` });
    // The kinds are ones a person can mute.
    expect(notificationTypeOf("couple_date")).toBe("dates");
    expect(notificationTypeOf("stage_up")).toBe("dates");
    expect(notificationTypeOf("house_talk")).toBe("show");
  });

  it("rings nothing for a muted type, tells an owner as the owner only, and says nothing once either one is private", async () => {
    const { creator, owner, character } = await ownerWithCharacter();
    await followCharacter(t.db, guest("fan-muted"), HOUSE_PARTNER_ID);
    await setMuted(t.db, "fan-muted", "dates", true);
    // The owner of one side follows the other side: they hear as the owner, not as a follower too.
    await followCharacter(t.db, guest(owner), HOUSE_PARTNER_ID);
    await airedDate(creator, character.id, "friends", [false, false]);
    expect(await unreadCount(t.db, "fan-muted")).toBe(0);
    expect((await inbox("fan-muted")).map((x) => [x.kind, x.read])).toEqual([["couple_date", true]]);
    expect((await inbox(owner)).filter((x) => x.kind === "couple_date")).toEqual([]);
    // Private now: the next date names them to nobody who follows the other one.
    await followCharacter(t.db, guest("fan-late"), HOUSE_PARTNER_ID);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [character.id]);
    await airedDate(creator, character.id, "friends", [false, false]);
    expect(await inbox("fan-late")).toEqual([]);
    expect(await pairCharacterFollowers(t.db, character.id, HOUSE_PARTNER_ID)).toEqual([]);
  });
});

describe("a follower hears what the house does", () => {
  it("one notice a scene, in the owners' words; whoever the character texted about it gets the text instead", async () => {
    const { lexi } = await walkOn();
    // An account with the texts on, a visitor who only follows, one who follows both people the scene names.
    await followCharacter(t.db, account("acct-1"), RAFE, { now: new Date(NOW.getTime() - HOURS) });
    await followCharacter(t.db, guest("fan-plain"), RAFE);
    await followCharacter(t.db, guest("fan-both"), RAFE);
    await followCharacter(t.db, guest("fan-both"), lexi);
    await followCharacter(t.db, guest("fan-gone"), RAFE);
    await unfollowCharacter(t.db, "fan-gone", RAFE);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 1 });
    const link = scenePath(SCENE);
    for (const fan of ["fan-plain", "fan-both"]) {
      const got = await inbox(fan);
      expect(got, fan).toHaveLength(1);
      expect(got[0]).toMatchObject({ kind: "house_talk", link, read: false });
      expect(got[0].title).toMatch(/^🏠 The house is talking about (Rafe|Lexi)$/);
      // Who said it, where, and the line, exactly as /house shows it.
      expect(got[0].body).toMatch(/^\w+, .+: “.+”$/);
    }
    // The texted follower: the character's own text is the notice, and there is no second one.
    expect((await inbox("acct-1")).map((x) => x.kind)).toEqual(["character_texted_you"]);
    expect(await inbox("fan-gone")).toEqual([]);
    // The scene again (a rerun of the job): nobody is told twice.
    await textAboutScene(t.db, SCENE, NOW);
    expect(await tellFollowersOfScene(t.db, SCENE)).toBe(0);
    expect(await inbox("fan-plain")).toHaveLength(1);
    expect(await inbox("fan-both")).toHaveLength(1);
    expect((await inbox("acct-1")).map((x) => x.kind)).toEqual(["character_texted_you"]);
  });

  it("a confrontation and the week's challenge, with the public result; a muted type rings nothing", async () => {
    await followCharacter(t.db, guest("fan-dex"), DEX);
    await followCharacter(t.db, guest("fan-muted"), DEX);
    await setMuted(t.db, "fan-muted", "show", true);
    const id = sceneIdOf(DAY, "confrontation");
    await storedScene(id, DAY, "confrontation", [DEX, MARISOL], fight(DEX, MARISOL));
    await textAboutScene(t.db, id, NOW);
    expect(await inbox("fan-dex")).toEqual([{ kind: "house_talk", title: `🏠 ${first(DEX)} had it out with ${first(MARISOL)} in the house`, body: "They cleared the air.", link: scenePath(id), read: false }]);
    expect(await unreadCount(t.db, "fan-muted")).toBe(0);
    expect((await inbox("fan-muted")).map((x) => x.read)).toEqual([true]);
    // The challenge: the winner's follower and a loser's each hear their own side of it, once.
    await followCharacter(t.db, guest("fan-teo"), TEO);
    const challenge = sceneIdOf("2026-11-11", "challenge");
    await storedScene(challenge, "2026-11-11", "challenge", [DEX, TEO, JUNIPER], { kind: "challenge", challenge: "cook_off", title: "The cook-off", winner: DEX, prize: { day: "2026-11-13", with: null, kind: "first_pick" } }, new Date(NOW.getTime() - 24 * HOURS));
    expect(await tellFollowersOfScene(t.db, challenge)).toBe(3);
    expect((await inbox("fan-dex"))[0]).toMatchObject({ kind: "house_talk", title: `🏆 ${first(DEX)} won the cook-off`, link: scenePath(challenge) });
    expect((await inbox("fan-dex"))[0].body).toMatch(/^The prize: /);
    expect((await inbox("fan-teo"))[0]).toMatchObject({ kind: "house_talk", title: `🏆 ${first(TEO)} was in the cook-off`, body: `${first(DEX)} won.` });
  });

  it("never tells a follower about a character that went private, and the character's owner hears as the owner", async () => {
    const { lexi } = await walkOn();
    await followCharacter(t.db, guest("fan-lexi"), lexi);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [lexi]);
    clearSharedCache();
    await ensureHouseScene(t.db, NOW);
    expect(await inbox("fan-lexi")).toEqual([]);
    expect((await characterFollowers(t.db, [lexi])).size).toBe(0);
  });

  it("the texts a follow switched on are the house's own: sent by the same pass, under its one-a-day rule", async () => {
    await walkOn();
    await followCharacter(t.db, account("acct-1"), RAFE, { now: new Date(NOW.getTime() - HOURS) });
    await ensureHouseScene(t.db, NOW);
    // The same scene again sends nothing more.
    expect(await houseTextsForScene(t.db, SCENE, NOW)).toMatchObject({ sent: 0 });
  });
});

/* ------------------------------------------------ data rights ------------------------------------------------ */

describe("data rights", () => {
  it("the export lists the characters they follow; deleting the account removes the follows; a character whose creator leaves loses its followers", async () => {
    await followCharacter(t.db, account("acct-1"), RAFE, { now: NOW });
    const exported = await exportAccount(t.db, "acct-1");
    expect(exported.character_follows).toEqual([expect.objectContaining({ character_id: RAFE, texts_on: true })]);
    await deleteAccount(t.db, "acct-1");
    expect((await t.db.query(`select 1 from character_follows where user_id = 'acct-1'`)).rows).toHaveLength(0);
    // A character deleted outright takes its follows with it (the foreign key); one kept for its dates loses them too.
    const { creator, owner, character } = await ownerWithCharacter();
    await followCharacter(t.db, guest("fan-a"), character.id);
    await airedDate(creator, character.id, "friends", [false, false]);
    expect(await deleteCharacter(t.db, owner, character.id)).toEqual({ deleted: false, anonymized: true });
    expect(await followRow("fan-a", character.id)).toBeNull();
    const fresh = await person("Never Dated", "u-x");
    await followCharacter(t.db, guest("fan-a"), fresh);
    expect(await deleteCharacter(t.db, "u-x", fresh)).toEqual({ deleted: true, anonymized: false });
    expect(await followRow("fan-a", fresh)).toBeNull();
  });
});

/* ------------------------------------------------ "Right now": the pure shaping ------------------------------------------------ */

const sp = (id: string): StoryPerson => ({ id, name: first(id), full_name: nameOf(id), hue: null, portrait: null, house: true, cast: true, lead: false });
const tie = (kind: TieKind, a: string, b: string, o: Partial<StoryTie> = {}): StoryTie => ({ id: `${kind}|${a}|${b}|`, kind, a, b, about: null, label: kind, text: "x", when: "today", at: `${DAY}T00:00:00.000Z`, href: `/couples/${[a, b].sort().join("/")}`, ...o });
const circleOf = (...around: [string, StoryTie][]): CircleData => ({ center: sp(RAFE), around: around.map(([id, t0]) => ({ person: sp(id), tie: t0 })), more: 0 });
const said = (o: Partial<TalkSaid> = {}): TalkSaid => ({ key: "s1#1", day: DAY, href: scenePath(SCENE), speaker: { id: DEX, name: first(DEX), hue: null, portrait: null, house: true }, text: "They left by separate doors.", where: "on the stairs", ...o });
const friction = (o: Partial<TalkFriction> = {}): TalkFriction => ({ key: "scene:f1", kind: "confrontation", day: "2026-11-11", href: scenePath("2026-11-11-confrontation"), text: `Had it out with ${first(DEX)} on the stairs.`, result: "They cleared the air.", other: { id: DEX, name: first(DEX) }, ...o });
const after = (o: Partial<TalkAfter> = {}): TalkAfter => ({ key: "beat:d:x", direction: "them", other: { id: TEO, name: first(TEO) }, text: "x", href: "/house", day: DAY, ...o });
const talkOf = (o: Partial<CharacterTalk>): CharacterTalk => {
  const full = { said: [], friction: [], after: [], ...o };
  return { ...full, empty: !full.said.length && !full.friction.length && !full.after.length };
};
const shape = (o: Partial<NowInput>) => shapeNow({ character: { id: RAFE, name: nameOf(RAFE) }, circle: null, talk: talkOf({}), week: null, lastDate: null, today: DAY, ...o });
const date = (o: Partial<NonNullable<NowInput["lastDate"]>> = {}): NonNullable<NowInput["lastDate"]> => ({ share_path: "/episodes/ep-1", ending: "friends", aired_at: `${DAY}T09:00:00.000Z`, partner: { id: JUNIPER, name: nameOf(JUNIPER) }, ...o });

describe("shapeNow", () => {
  it("is nothing at all when nothing public has happened, whatever the week's line says", () => {
    expect(shape({})).toBeNull();
    expect(shape({ week: "Accidentally joined a book club" })).toBeNull();
    expect(shape({ talk: null, week: "A new houseplant" })).toBeNull();
    // A private character has no lines, whatever is handed in.
    expect(shapeNow({ character: { id: RAFE, name: nameOf(RAFE), private: true }, circle: circleOf([DEX, tie("feuding", RAFE, DEX)]), talk: talkOf({ said: [said()] }), week: "x", lastDate: date(), today: DAY })).toBeNull();
  });

  it("leads with the two strongest ties in the character's own words, each linked to what made it", () => {
    const now = shape({
      circle: circleOf(
        [JUNIPER, tie("rivals", JUNIPER, RAFE, { label: `rivals for ${first(MARISOL)}`, href: "/watch", when: "since Sunday" })],
        [DEX, tie("together", DEX, RAFE, { label: "dating", when: "last date on Friday" })],
        [TEO, tie("bad_blood", RAFE, TEO)],
      ),
      talk: talkOf({ said: [said()] }),
    })!;
    expect(now.lines.map((l) => [l.kind, l.text, l.when, l.href])).toEqual([
      ["tie", `Rivals with ${first(JUNIPER)} for ${first(MARISOL)}`, "since Sunday", "/watch"],
      ["tie", `Dating ${first(DEX)}`, "last date on Friday", `/couples/${[DEX, RAFE].sort().join("/")}`],
      ["latest", `${first(DEX)}, on the stairs: “They left by separate doors.”`, null, scenePath(SCENE)],
    ]);
    expect(now.talk).toBe(true);
  });

  it("says every kind of tie from the character's side", () => {
    const words = (t0: StoryTie, other = DEX) => shape({ circle: circleOf([other, t0]) })!.lines[0];
    expect(words(tie("date_now", RAFE, DEX, { when: "now" }))).toMatchObject({ text: `On a date with ${first(DEX)} right now`, when: null });
    expect(words(tie("date_next", DEX, RAFE, { when: "on Friday" }))).toMatchObject({ text: `A date with ${first(DEX)} coming up`, when: "on Friday" });
    expect(words(tie("date_next", DEX, RAFE, { when: "coming up" })).when).toBeNull();
    expect(words(tie("feuding", RAFE, DEX, { label: "had it out" })).text).toBe(`Feuding with ${first(DEX)}: had it out`);
    expect(words(tie("cleared", RAFE, DEX)).text).toBe(`Cleared the air with ${first(DEX)}`);
    expect(words(tie("together", RAFE, DEX, { label: "going steady" })).text).toBe(`Going steady with ${first(DEX)}`);
    expect(words(tie("second_date", RAFE, DEX)).text).toBe(`Second date agreed with ${first(DEX)}`);
    expect(words(tie("bad_blood", RAFE, DEX)).text).toBe(`Bad blood with ${first(DEX)}`);
    expect(words(tie("stories", RAFE, DEX, { label: `two stories about ${first(TEO)}` })).text).toBe(`At odds with ${first(DEX)}: two stories about ${first(TEO)}`);
    // Who talked about whom keeps its direction.
    expect(words(tie("talked", DEX, RAFE)).text).toBe(`${first(DEX)} talked about ${first(RAFE)} in the house`);
    expect(words(tie("talked", RAFE, DEX)).text).toBe(`Talked about ${first(DEX)} in the house`);
  });

  it("outside this week's map, takes the Talk tab's standing rows: a couple, who is after them, bad blood; never a stale line", () => {
    const now = shape({
      talk: talkOf({
        after: [
          after({ key: "edge:j", direction: "both", other: { id: JUNIPER, name: first(JUNIPER) }, text: `${first(RAFE)} and ${first(JUNIPER)} agreed to a second date.`, href: "/couples/a/b", day: "2026-09-01" }),
          after({ key: "beat:old", direction: "them", other: { id: TEO, name: first(TEO) }, day: "2026-10-01" }),
          after({ key: "beat:new", direction: "theirs", other: { id: MARISOL, name: first(MARISOL) }, day: "2026-11-10" }),
        ],
        friction: [friction({ key: "edge:d", kind: "bad_blood", text: `Bad blood with ${first(DEX)}.`, result: null, day: "2026-11-01", href: "/couples/c/d" })],
      }),
    })!;
    // The standing second date (however old), then the fresh line; the six-week-old "is after" line is not "now".
    expect(now.lines.map((l) => l.text)).toEqual([`${first(RAFE)} and ${first(JUNIPER)} agreed to a second date`, `After ${first(MARISOL)}`]);
    // One line a person: the circle's tie with Juniper stands, the talk's row about her is not said again.
    const one = shape({ circle: circleOf([JUNIPER, tie("second_date", JUNIPER, RAFE)]), talk: talkOf({ after: [after({ key: "edge:j", direction: "both", other: { id: JUNIPER, name: first(JUNIPER) }, text: "x." })], friction: [friction({ key: "edge:d", kind: "bad_blood", text: `Bad blood with ${first(DEX)}.`, result: null })] }) })!;
    expect(one.lines.map((l) => l.text)).toEqual([`Second date agreed with ${first(JUNIPER)}`, `Bad blood with ${first(DEX)}`]);
  });

  it("the latest thing is the newest of a line said, a scene they were in and an aired date; the house leads on the same day", () => {
    const latest = (o: Partial<NowInput>) => shape(o)!.lines.find((l) => l.kind === "latest")!;
    expect(latest({ talk: talkOf({ said: [said({ day: "2026-11-10" })], friction: [friction({ day: "2026-11-11" })] }), lastDate: date({ aired_at: "2026-11-09T10:00:00.000Z" }) })).toMatchObject({
      text: `Had it out with ${first(DEX)} on the stairs. They cleared the air`,
      icon: "⚡",
    });
    expect(latest({ talk: talkOf({ said: [said({ day: "2026-11-10" })] }), lastDate: date({ aired_at: "2026-11-12T10:00:00.000Z", ending: "second_date", date_number: 2 }) })).toMatchObject({
      text: `Latest date, with ${first(JUNIPER)}: A third date`,
      href: "/episodes/ep-1",
    });
    expect(latest({ talk: talkOf({ said: [said({ day: DAY })] }), lastDate: date({ aired_at: `${DAY}T23:00:00.000Z` }) }).text).toContain("on the stairs");
    // Bad blood is a standing, not something that happened today: it is a tie, never the latest thing.
    expect(shape({ talk: talkOf({ friction: [friction({ key: "edge:d", kind: "bad_blood", text: `Bad blood with ${first(DEX)}.`, result: null, day: DAY })] }) })!.lines.map((l) => l.kind)).toEqual(["tie"]);
    // A long line is cut at a word.
    const long = latest({ talk: talkOf({ said: [said({ text: "word ".repeat(60).trim() })] }) }).text;
    expect(long.length).toBeLessThan(NOW_QUOTE_MAX + 40);
    expect(long).toMatch(/word…”$/);
  });

  it("never says the same thing twice: a tie's own scene, or the date behind a pair's standing, isn't the latest thing too", () => {
    const fightHref = scenePath("2026-11-11-confrontation");
    const now = shape({
      circle: circleOf([DEX, tie("cleared", DEX, RAFE, { href: fightHref, when: "yesterday" })], [JUNIPER, tie("bad_blood", JUNIPER, RAFE, { when: "today" })]),
      talk: talkOf({ friction: [friction({ href: fightHref })] }),
      lastDate: date({ ending: "disaster" }),
      week: "A new houseplant",
    })!;
    expect(now.lines.map((l) => [l.kind, l.text])).toEqual([
      ["tie", `Cleared the air with ${first(DEX)}`],
      ["tie", `Bad blood with ${first(JUNIPER)}`],
      ["week", "This week: A new houseplant"],
    ]);
    // A date with someone else is still news, and so is an older line said about them.
    expect(shape({ circle: circleOf([JUNIPER, tie("bad_blood", JUNIPER, RAFE)]), lastDate: date({ partner: { id: TEO, name: nameOf(TEO) } }) })!.lines.map((l) => l.text)).toEqual([`Bad blood with ${first(JUNIPER)}`, `Latest date, with ${first(TEO)}: Just friends`]);
    expect(shape({ circle: circleOf([JUNIPER, tie("bad_blood", JUNIPER, RAFE)]), talk: talkOf({ said: [said({ day: "2026-11-01" })] }), lastDate: date() })!.lines.map((l) => l.kind)).toEqual(["tie", "latest"]);
    // The talk's own standing rows count the same way.
    expect(shape({ talk: talkOf({ after: [after({ key: "edge:j", direction: "both", other: { id: JUNIPER, name: first(JUNIPER) }, text: "x.", href: "/couples/a/b" })] }), lastDate: date() })!.lines.map((l) => l.kind)).toEqual(["tie"]);
  });

  it("never names a date whose other half is private, and the week's line only ever fills a spare line", () => {
    expect(shape({ lastDate: date({ partner: { id: "p", name: "Wren Lurker", private: true } }), week: "A new houseplant" })).toBeNull();
    const one = shape({ lastDate: date(), week: "accidentally joined a book club" })!;
    expect(one.lines.map((l) => [l.kind, l.text, l.href])).toEqual([
      ["latest", `Latest date, with ${first(JUNIPER)}: Just friends`, "/episodes/ep-1"],
      ["week", "This week: Accidentally joined a book club", null],
    ]);
    // Nothing in the Talk tab: no link to it.
    expect(one.talk).toBe(false);
    // Three real lines leave no room for it.
    const full = shape({ circle: circleOf([JUNIPER, tie("rivals", JUNIPER, RAFE, { label: "rivals for x" })], [DEX, tie("feuding", DEX, RAFE, { label: "had it out" })]), talk: talkOf({ said: [said()] }), week: "A new houseplant" })!;
    expect(full.lines.map((l) => l.kind)).toEqual(["tie", "tie", "latest"]);
    // With the Talk tab off there is no link to it either.
    expect(shape({ talk: null, lastDate: date() })!.talk).toBe(false);
  });

  it("has a switch", () => {
    expect(characterNowOn({})).toBe(true);
    expect(characterNowOn({ CHARACTER_NOW: "0" })).toBe(false);
  });
});

/* ------------------------------------------------ the page ------------------------------------------------ */

const SECRET = { opinion: "OPINION-TAKE-OWNER-ONLY", heard: "HEARD-CLAIM-OWNER-ONLY", want: "WANT-OWNER-ONLY", unairedWith: "Yara Unaired", privateWith: "Zelda Offline" };
const page = async (id: string, cookie: string | null = null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.slice(cookie.indexOf("=") + 1));
  return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id }) }));
};
const head = (html: string) => html.slice(0, html.indexOf('<div class="page-tabs"'));
const nowBlock = (html: string) => /<section class="character-now"[\s\S]*?<\/section>/.exec(html)?.[0] ?? null;

/** A week of public story around Rafe, with what a viewer may not see planted beside it. */
async function seedStory() {
  // History first, then the disaster: bad blood with cause (one date that ended badly "didn't click", and is no tie).
  await episode(RAFE, JUNIPER, { ending: "friends" });
  await episode(RAFE, JUNIPER, { ending: "disaster" });
  const unairedWith = await person(SECRET.unairedWith, "u-y");
  const privateWith = await person(SECRET.privateWith, "u-z");
  await episode(RAFE, unairedWith, { ending: "second_date", revealedAt: null });
  await episode(RAFE, privateWith, { ending: "second_date", visibility: "private" });
  const id = sceneIdOf("2026-11-11", "confrontation");
  await storedScene(id, "2026-11-11", "confrontation", [RAFE, DEX], fight(RAFE, DEX), new Date("2026-11-11T18:20:00Z"));
  await t.db.query(`insert into character_opinions (holder_id, about_id, trust, attraction, take, basis) values ($1, $2, -2, 2, $3, 'heard')`, [DEX, RAFE, SECRET.opinion]);
  await t.db.query(`insert into character_heard (id, holder_id, about_id, claim, told_by, source, is_true) values ('cf-h1', $1, $2, $3, $4, 'scene:x#1', false)`, [MARISOL, RAFE, SECRET.heard, DEX]);
  await t.db.query(`insert into character_wants (holder_id, season_id, week_id, want, about_id, kind, set_by) values ($1, '2026-11-01', '2026-W46', $2, $3, 'pursue', 'rules')`, [RAFE, SECRET.want, DEX]);
  return { scene: id };
}

describe("the character page", () => {
  beforeEach(async () => {
    for (const table of ["house_scenes", "character_opinions", "character_heard", "character_wants", "cast_secrets"]) await t.db.query(`delete from ${table}`);
    clearSharedCache();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  it("has one row of small actions under the name: Text, Follow and ⋯, and no share row of its own", async () => {
    const html = await page(RAFE, signedInCookie(crypto.randomUUID()));
    const top = head(html);
    const row = /<div class="contestant-actions">[\s\S]*?<\/div><\/span><\/div>/.exec(top)?.[0] ?? "";
    expect(row).toContain(`>Text ${first(RAFE)}</button>`);
    // Signed in, the tap will also let them text first, and the control says so before it is pressed.
    expect(row).toContain(`title="Hear when something happens to ${first(RAFE)}, and let ${first(RAFE)} text you"`);
    expect(row).toMatch(/<button type="button" class="secondary small" aria-pressed="false"[^>]*data-track="character-follow" data-track-to="on">🔔 Follow<\/button>/);
    // ⋯ holds the link to share, closed until it is asked for.
    expect(row).toMatch(/aria-haspopup="menu" aria-expanded="false"[^>]*aria-label="More for [^"]+" title="More">⋯<\/button>/);
    expect(row).toMatch(/role="menu"[^>]*hidden=""/);
    expect(row).toMatch(/<button type="button" role="menuitem" class="thread-menu-item" data-track="character-share">/);
    expect(top).not.toContain('class="small character-share"');
    expect(top).not.toContain("contestant-text");
    // In the header, before the page's verb.
    expect(top.indexOf("contestant-actions")).toBeLessThan(top.indexOf("hero-ratings"));
    // Nobody follows yet: no count anywhere.
    expect(html).not.toMatch(/follows? Rafe/);
  });

  it("shows Following to a follower, a count behind ⋯ and never a name; nothing to its owner; nothing on a private page", async () => {
    const fan = newUserCookie();
    await followCharacter(t.db, guest(userIdOf(fan)), RAFE);
    await followCharacter(t.db, guest("someone-else"), RAFE);
    const theirs = head(await page(RAFE, fan));
    expect(theirs).toMatch(/<button type="button" class="button-ghost small" aria-pressed="true"[^>]*data-track-to="off">Following ✓<\/button>/);
    expect(theirs).toContain(`2 people follow ${first(RAFE)}.`);
    expect(theirs).not.toContain("someone-else");
    expect(theirs).not.toContain(userIdOf(fan));
    // A stranger: the control, unpressed, and the same count.
    const stranger = head(await page(RAFE, newUserCookie()));
    expect(stranger).toContain("🔔 Follow</button>");
    expect(stranger).toContain(`2 people follow ${first(RAFE)}.`);
    // Their own character: no follow (they already hear everything); ⋯ still shares it.
    const owner = newUserCookie();
    const mine = await person("Ira Fenn", userIdOf(owner));
    const own = head(await page(mine, owner));
    expect(own).not.toContain("character-follow");
    expect(own).toContain('data-track="character-share"');
    // A person's public character, to someone else: Follow is there even where Text is not.
    const other = head(await page(mine, newUserCookie()));
    expect(other).toContain("🔔 Follow</button>");
    expect(other).not.toContain(">Text Ira<");
    // Private: the name only.
    const hidden = await person("Wren Lurker", "u-hidden", "private");
    const closed = await page(hidden, newUserCookie());
    expect(closed).toContain("Their creator keeps this character private.");
    expect(closed).not.toContain("character-follow");
    expect(closed).not.toContain("contestant-actions");
  });

  it("CHARACTER_FOLLOW=0 hides the control and keeps the rest of the row", async () => {
    vi.stubEnv("CHARACTER_FOLLOW", "0");
    const top = head(await page(RAFE, newUserCookie()));
    expect(top).not.toContain("character-follow");
    expect(top).toContain(`>Text ${first(RAFE)}</a>`);
    expect(top).toContain('data-track="character-share"');
  });

  it("opens on Right now: the ties, the latest thing and the way into the Talk tab, from public rows only", async () => {
    const { scene } = await seedStory();
    const html = await page(RAFE, newUserCookie());
    const block = nowBlock(html)!;
    expect(block).not.toBeNull();
    // Under the header, above the verb and the tabs.
    expect(html.indexOf('class="character-now"')).toBeGreaterThan(html.indexOf('class="contestant-actions"'));
    expect(html.indexOf('class="character-now"')).toBeLessThan(html.indexOf('<div class="page-tabs"'));
    expect(block).toContain('<p class="kicker">Right now</p>');
    // The confrontation with its public result and the public bad blood with Juniper (the aired disaster), each once:
    // the date behind the bad blood and the scene behind the tie aren't told again as "the latest thing".
    expect(block).toContain(`href="${scenePath(scene).replace(/&/g, "&amp;")}">Cleared the air with ${first(DEX)}</a><span class="muted">, yesterday</span>`);
    expect(block).toContain(`Bad blood with ${first(JUNIPER)}`);
    expect(block).not.toContain("Latest date");
    expect(block).not.toContain("Had it out");
    expect(block).toContain("This week: ");
    expect(block).toContain('<a href="#talk" data-track="character-now" data-track-where="talk">See the talk →</a>');
    expect((block.match(/<li>/g) ?? []).length).toBeLessThanOrEqual(3);
    // Nothing from the story state, and neither the unaired date nor the private one, anywhere above the tabs.
    for (const [what, words] of Object.entries(SECRET)) expect(head(html), what).not.toContain(words);
    // The owner of another character and a stranger with no session read the same lines.
    expect(nowBlock(await page(RAFE))).toBe(block);
  });

  it("renders nothing at all for a character with nothing going on: no box, no heading", async () => {
    const owner = newUserCookie();
    const fresh = (await (await api.createCharacter(validCharacter({ name: "Nova Quiet" }), owner)).json()).id as string;
    for (const html of [await page(fresh, newUserCookie()), await page(fresh, owner)]) {
      expect(html).not.toContain("character-now");
      expect(html).not.toContain("Right now");
      expect(html).not.toContain("See the talk");
    }
    // With one aired public date it has a line, and the week's line joins it.
    await episode(fresh, JUNIPER, { ending: "friends" });
    const block = nowBlock(await page(fresh, newUserCookie()))!;
    expect(block).toContain(`Latest date, with ${first(JUNIPER)}: Just friends`);
    expect(block).toContain("This week: ");
  });

  it("CHARACTER_NOW=0 hides the lines and nothing else", async () => {
    await seedStory();
    vi.stubEnv("CHARACTER_NOW", "0");
    const html = await page(RAFE, newUserCookie());
    expect(html).not.toContain("character-now");
    expect(head(html)).toContain("contestant-actions");
    expect(html).toContain("Talk of the house");
  });
});
