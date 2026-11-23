// A roleplay's story in Step in (lib/adult/step-in-story.ts; docs/after-dark.md "A goal and an ending"): the goal the
// viewer can see, how far the story has got (read for each reply by a small call that only ever ticks beats), the
// ending offered once the last beat has played, and what counts as played. David, 2026-11-23: "A goal and an ending
// for a scene (Character.AI, CrushOn)". The fixtures are mild lines; no live calls here.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
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
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import { POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { POST as storyPost } from "@/app/api/admin/after-dark/step-in/[id]/story/route";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { saveAdultSettings } from "@/lib/adult/settings";
import { closeStepIn, endStepIn, getStepInScene, playedRoleplays, quickStepIn, readStepInStory, sendStepInLine, setStepInRandomForTests, startStepIn } from "@/lib/adult/step-in";
import { CLOSE_CUE } from "@/lib/adult/step-in-prompt";
import { SHELF_TONIGHT } from "@/lib/adult/step-in-shelf";
import { beatForReader, mergeBeats, parsePlayed, storedBeats, storyGoal, storyMessages, storyView, STORY_TURNS } from "@/lib/adult/step-in-story";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
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
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
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
const NEIGHBOURS = ROLEPLAYS.find((r) => r.id === "neighbours")!;
const BEATS = NEIGHBOURS.card.beats.length;

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
const REPLIES = [
  ['She opened the door before the second knock. "That parcel has my name on it. It has had my name on it for a week."', "The hallway light buzzed above them, the way it always did."],
  ['"The corkscrew in March," she said, counting on her fingers. "The sugar in June. Shall I go on?"', "She leaned on the door frame and did not move out of the way."],
  ['She looked at the open door, then at the hallway, then stepped back from it. "Well. One of us has to decide which side of this the evening happens on."', "A kettle clicked off somewhere behind her."],
  ['"I listened for your door every evening," she said quietly. "That is what the hallway was about."', "She set the parcel down on the shelf, where it had clearly been meant to go all along."],
  ['She closed the door behind them and let her hand rest on it a moment. "Good night, neighbour," she said, smiling, and meant the opposite.', "The hallway light buzzed on outside, with nobody under it."],
  ['"Stay for the tea, at least," she said.', "The cups were already out."],
];
/**
 * The scripted models: the writer's replies in order (each different), the notes, and the story's reader, which
 * answers with `played` in order (the last again) and records what it was asked. An Error is thrown as a failed call.
 */
function scripted(...played: unknown[]) {
  const seen = { prompts: [] as ChatMessage[][], reader: [] as ChatMessage[][] };
  let i = 0;
  let r = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They talked at her door about the parcel.", line: "The night the parcel excuse ran out." });
      if (isReader(m)) {
        seen.reader.push(m);
        const a = played.length ? played[Math.min(r++, played.length - 1)] : { played: [] };
        if (a instanceof Error) throw a;
        return typeof a === "string" ? a : JSON.stringify(a);
      }
      seen.prompts.push(m);
      return JSON.stringify({ story: REPLIES[Math.min(i++, REPLIES.length - 1)] });
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const replies = async (id: string) => Number((await rows(`select step_in from adult_usage where owner_id = $1`, [id]))[0]?.step_in ?? 0);
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
const lastUser = (m: ChatMessage[]) => m[m.length - 1].content;
/** A scene in "The neighbour next door", the viewer on its first side (the one who knocks). */
async function start(viewer: string, you: 0 | 1 = 0) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place: HOME, roleplay: { id: "neighbours", you } });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
const say = async (viewer: string, id: string, line: string) => {
  const r = await sendStepInLine(t.db, viewer, id, line);
  if (!r.ok) throw new Error(`send failed: ${r.status} ${r.message}`);
  return r.view;
};
const read = async (viewer: string, id: string) => {
  const r = await readStepInStory(t.db, viewer, id);
  if (!r.ok) throw new Error(`read failed: ${r.status}`);
  return r.story;
};
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

describe("the goal", () => {
  it("is the card's own want for the viewer's side, told to them, whichever side they play", () => {
    expect(storyGoal(NEIGHBOURS, 0, "Juniper Vale")).toBe("You want to stop inventing reasons to knock; saying the real one out loud is harder than carrying a parcel.");
    expect(storyGoal(NEIGHBOURS, 1, "Juniper Vale")).toBe("You want Juniper to stay past the doorway for once; the excuse is so thin it is hard not to tease.");
    // A person's own roleplay has no card, and so no goal.
    expect(storyGoal({ card: undefined }, 0, "Juniper")).toBeNull();
  });

  it("reads right for every roleplay from either side: plain words, about you, no placeholder left", () => {
    for (const rp of ROLEPLAYS) {
      for (const you of [0, 1] as const) {
        const goal = storyGoal(rp, you, "Juniper Vale");
        expect(goal, `${rp.id}:${you}`).toBeTruthy();
        expect(goal!, `${rp.id}:${you}`).not.toMatch(/[{}]/);
        expect(goal!, `${rp.id}:${you}`).toMatch(/\byou\b/i);
        expect(goal!.length, `${rp.id}:${you}`).toBeLessThan(260);
      }
    }
  });
});

describe("the beats", () => {
  it("are only ever ticked, and read back at the card's own length", () => {
    expect(storedBeats(null, 4)).toEqual([false, false, false, false]);
    expect(storedBeats([true, "yes", true], 4)).toEqual([true, false, true, false]);
    expect(storedBeats([true, true, true, true, true], 3)).toEqual([true, true, true]);
    expect(mergeBeats([true, false, false, false], [3])).toEqual([true, false, true, false]);
    // A later reading that leaves one out doesn't untick it.
    expect(mergeBeats([true, true, false, false], [])).toEqual([true, true, false, false]);
  });

  it("takes only numbers the card has from the reader, each once, and nothing from an answer it can't read", () => {
    expect(parsePlayed('{"played": [2, 1, 2]}', 4)).toEqual([1, 2]);
    expect(parsePlayed('Here you go: {"played": ["3", 0, 5, 4.5, 4]} hope that helps', 4)).toEqual([3, 4]);
    expect(parsePlayed('{"played": []}', 4)).toEqual([]);
    for (const junk of ["", "none of them", '{"played": "all"}', "{not json}", '{"done": [1]}']) expect(parsePlayed(junk, 4), junk).toEqual([]);
  });

  it("the reader is asked about the page only: the beats numbered, the viewer as the person, the scene's last stretch", () => {
    const beats = NEIGHBOURS.card.beats.map((b) => beatForReader(b, 0, "Juniper"));
    expect(beats.join(" ")).not.toMatch(/[{}]/);
    expect(beatForReader("{a} knocks, and {b} answers.", 0, "Juniper")).toBe("The person knocks, and Juniper answers.");
    expect(beatForReader("{a} knocks, and {b} answers.", 1, "Juniper")).toBe("Juniper knocks, and the person answers.");
    const turns = Array.from({ length: STORY_TURNS + 6 }, (_, i) => ({ who: i % 2 ? ("character" as const) : ("them" as const), text: `line ${i}` }));
    const m = storyMessages({ name: "Juniper", beats, recap: "They met in the hallway.", turns: [...turns, { who: "narrator", text: "The moment drifted." }] });
    expect(m[0].content).toMatch(/^You read a private scene of adult fiction between a person and Juniper/);
    expect(m[0].content).toContain("never what might happen next");
    expect(m[1].content).toContain(`1. ${beats[0]}\n2. ${beats[1]}`);
    expect(m[1].content).toContain("The scene so far, in brief: They met in the hallway.");
    // Only the last stretch, each line under who said it.
    expect(m[1].content).not.toContain("line 5\n");
    expect(m[1].content).toContain(`Juniper: line ${STORY_TURNS + 5}\n(Narrator): The moment drifted.`);
    expect(m[1].content).toContain('{"played": [the beats\' numbers]}');
  });

  it("what the viewer is shown: how many have played, never which, and when a reading is due", () => {
    const at = { newest: "r2", canRead: true };
    expect(storyView(NEIGHBOURS, 0, "Juniper", { beats: null, upto: null }, at)).toMatchObject({ beats: BEATS, done: 0, complete: false, due: true });
    expect(storyView(NEIGHBOURS, 0, "Juniper", { beats: [true, false, true], upto: "r2" }, at)).toMatchObject({ done: 2, complete: false, due: false });
    // An opening alone has played nothing; an ended scene isn't read; a finished story isn't read again.
    expect(storyView(NEIGHBOURS, 0, "Juniper", { beats: null, upto: null }, { newest: "r1", canRead: false })?.due).toBe(false);
    expect(storyView(NEIGHBOURS, 0, "Juniper", { beats: Array(BEATS).fill(true), upto: "r1" }, at)).toMatchObject({ done: BEATS, complete: true, due: false });
    expect(Object.keys(storyView(NEIGHBOURS, 0, "Juniper", { beats: null, upto: null }, at)!).sort()).toEqual(["beats", "complete", "done", "due", "goal"]);
    expect(storyView({ card: undefined }, 0, "Juniper", { beats: null, upto: null }, at)).toBeNull();
  });
});

describe("how far the story has got", () => {
  it("is read once a reply, from the viewer's first line on, and only ever moves forward", async () => {
    const seen = scripted({ played: [1] }, { played: [2] }, { played: [1] }, { played: [3, 4] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    // The opening alone: a goal, nothing played, nothing to read.
    expect(s.view.story).toEqual({ goal: storyGoal(NEIGHBOURS, 0, NAME), beats: BEATS, done: 0, complete: false, due: false });
    expect(await read(a.id, s.id)).toMatchObject({ done: 0, due: false });
    expect(seen.reader).toHaveLength(0);
    // Their first line and its reply: a reading is due, and the reader is shown the beats and the scene.
    expect((await say(a.id, s.id, "I hold the parcel out. I think this one is yours.")).story).toMatchObject({ done: 0, due: true });
    expect(await read(a.id, s.id)).toMatchObject({ done: 1, complete: false, due: false });
    expect(seen.reader).toHaveLength(1);
    expect(seen.reader[0][1].content).toContain(`1. ${beatForReader(NEIGHBOURS.card.beats[0], 0, NAME)}`);
    expect(seen.reader[0][1].content).toContain("The person: I hold the parcel out. I think this one is yours.");
    expect(seen.reader[0][1].content).toContain(`${NAME}: She opened the door before the second knock.`);
    // Asked again for the same reply: nothing is read twice.
    expect(await read(a.id, s.id)).toMatchObject({ done: 1, due: false });
    expect(seen.reader).toHaveLength(1);
    expect((await viewOf(a.id, s.id)).story).toMatchObject({ done: 1, due: false });
    // The next reply ticks another; the one after says only the first again, and nothing is unticked.
    await say(a.id, s.id, "I have run out of things to borrow.");
    expect(await read(a.id, s.id)).toMatchObject({ done: 2 });
    await say(a.id, s.id, "I step a little closer to the door.");
    expect(await read(a.id, s.id)).toMatchObject({ done: 2, complete: false });
    expect(await playedRoleplays(t.db, a.id)).toEqual({});
    // The last beats play: the story is complete, it counts as played, and it isn't read again.
    await say(a.id, s.id, "It was never about the corkscrew.");
    expect(await read(a.id, s.id)).toMatchObject({ done: BEATS, complete: true, due: false });
    expect(await playedRoleplays(t.db, a.id)).toEqual({ neighbours: 1 });
    const doneAt = (await rows(`select story_done_at from adult_step_in_scenes where id = $1`, [s.id]))[0].story_done_at;
    expect(doneAt).toBeTruthy();
    await say(a.id, s.id, "I stay.");
    expect((await viewOf(a.id, s.id)).story).toMatchObject({ complete: true, due: false });
    expect(await read(a.id, s.id)).toMatchObject({ complete: true });
    expect(seen.reader).toHaveLength(4);
    expect((await rows(`select story_done_at from adult_step_in_scenes where id = $1`, [s.id]))[0].story_done_at).toEqual(doneAt);
    // Reading the story is free: only the replies were counted (the opening and five answers).
    expect(await replies(a.id)).toBe(6);
  });

  it("a reader that doesn't answer, or answers nonsense, leaves the story where it was", async () => {
    scripted(new Error("the model is down"), "I would rather not say.", { played: [1, 2] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    await say(a.id, s.id, "I hold the parcel out.");
    expect(await read(a.id, s.id)).toMatchObject({ done: 0, due: false });
    // Nothing was kept for that reply, so the scene still says a reading is due.
    expect((await viewOf(a.id, s.id)).story).toMatchObject({ done: 0, due: true });
    expect(await read(a.id, s.id)).toMatchObject({ done: 0, due: false });
    await say(a.id, s.id, "I have run out of things to borrow.");
    expect(await read(a.id, s.id)).toMatchObject({ done: 2 });
  });

  it("there is no story without a roleplay, none is read in a scene that has ended, and nobody reads someone else's", async () => {
    const seen = scripted({ played: [1, 2, 3, 4] });
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    const a = await admin();
    const plain = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME });
    if (!plain.ok) throw new Error("start failed");
    expect(plain.view.story).toBeNull();
    await say(a.id, plain.id, "I sit down.");
    expect(await read(a.id, plain.id)).toBeNull();
    const s = await start(a.id);
    await say(a.id, s.id, "I hold the parcel out.");
    const other = await subscriber();
    expect(await readStepInStory(t.db, other.id, s.id)).toMatchObject({ ok: false, status: 404 });
    await endStepIn(t.db, a.id, s.id);
    expect((await viewOf(a.id, s.id)).story).toMatchObject({ done: 0, due: false });
    expect(await read(a.id, s.id)).toMatchObject({ done: 0 });
    expect(seen.reader).toHaveLength(0);
  });

  it("the other side of the roleplay has its own goal, and the reader is told who is who", async () => {
    const seen = scripted({ played: [1] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id, 1);
    expect(s.view.story?.goal).toBe(storyGoal(NEIGHBOURS, 1, NAME));
    await say(a.id, s.id, "I open the door before the second knock.");
    await read(a.id, s.id);
    // The viewer answers the door here, so the one who knocks is the character.
    expect(seen.reader[0][1].content).toContain(`1. ${beatForReader(NEIGHBOURS.card.beats[0], 1, NAME)}`);
  });
});

describe("the ending", () => {
  it("is one last reply that lands the scene, then the scene is filed; asked for, never decided by the writer", async () => {
    const seen = scripted({ played: [1, 2, 3, 4] });
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    const sub = await subscriber();
    const s = await start(sub.id);
    await say(sub.id, s.id, "It was never about the corkscrew.");
    await read(sub.id, s.id);
    const before = await replies(sub.id);
    const prompts = seen.prompts.length;
    const closed = await closeStepIn(t.db, sub.id, s.id);
    if (!closed.ok) throw new Error(`close failed: ${closed.status} ${closed.message}`);
    // One reply, asked for with the closing cue after everything said so far (a draft the checks refuse is drawn
    // again with the same cue), and counted once like any reply.
    expect(seen.prompts.length).toBeGreaterThan(prompts);
    for (const asked of seen.prompts.slice(prompts)) expect(lastUser(asked)).toContain(CLOSE_CUE);
    expect(CLOSE_CUE).toMatch(/bring the scene to a close/);
    expect(CLOSE_CUE).toMatch(/Don't start anything new/);
    expect(await replies(sub.id)).toBe(before + 1);
    // The closing line is the scene's last, and the scene is ended and filed with its story played.
    expect(closed.view.ended).toBeTruthy();
    expect(closed.view.messages.at(-1)).toMatchObject({ role: "character" });
    expect(closed.view.messages.filter((m) => m.role === "character")).toHaveLength(3);
    expect(closed.view.story).toMatchObject({ complete: true, due: false });
    expect(closed.view.can).toEqual({ regenerate: false, carry_on: false, take_back: false });
    expect((await rows(`select line from adult_step_in_scenes where id = $1`, [s.id]))[0].line).toBe("The night the parcel excuse ran out.");
    // Nothing more can be asked of a scene that has ended.
    expect(await closeStepIn(t.db, sub.id, s.id)).toMatchObject({ ok: false, status: 409, error: "ended" });
  });

  it("can be asked for in any scene; with nothing said yet the scene simply ends; at the month's cap or with no model it stays open", async () => {
    const seen = scripted();
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" }, caps: { step_in: 2 } });
    const sub = await subscriber();
    // Made in one click and never opened: nothing to close, no model asked.
    const quick = await quickStepIn(t.db, sub.id, WHO);
    if (!quick.ok) throw new Error("quick failed");
    expect(await closeStepIn(t.db, sub.id, quick.id)).toMatchObject({ ok: true, view: { ended: expect.anything() } });
    expect(seen.prompts).toHaveLength(0);
    // No roleplay: a closing line all the same.
    const plain = await startStepIn(t.db, sub.id, { character_id: WHO, place: HOME });
    if (!plain.ok) throw new Error("start failed");
    await say(sub.id, plain.id, "I sit down across from you.");
    // The month's two replies are used: refused with the cap's own sentence, and the scene is still open.
    expect(await closeStepIn(t.db, sub.id, plain.id)).toMatchObject({ ok: false, status: 429, error: "capped" });
    expect((await viewOf(sub.id, plain.id)).ended).toBeNull();
    await saveAdultSettings(t.db, { caps: { step_in: 50 } });
    setAdultModelForTests({
      complete: async () => {
        throw new Error("down");
      },
    });
    expect(await closeStepIn(t.db, sub.id, plain.id)).toMatchObject({ ok: false, status: 502 });
    expect((await viewOf(sub.id, plain.id)).ended).toBeNull();
    scripted();
    expect(await closeStepIn(t.db, sub.id, plain.id)).toMatchObject({ ok: true, view: { ended: expect.anything(), story: null } });
  });
});

describe("the routes and the page", () => {
  it("the story is read by its own route and closed by the scene's, both closed like the rest of Step in", async () => {
    scripted({ played: [1, 2] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    await say(a.id, s.id, "I hold the parcel out.");
    const path = `/api/admin/after-dark/step-in/${s.id}`;
    // Step in is admins only until its switch is opened: a subscriber gets the same not-found.
    const sub = await subscriber();
    expect((await storyPost(post(`${path}/story`, {}, sub.cookie), ctx(s.id))).status).toBe(404);
    expect((await scenePost(post(path, { action: "close" }, sub.cookie), ctx(s.id))).status).toBe(404);
    const res = await storyPost(post(`${path}/story`, {}, a.cookie), ctx(s.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ story: { goal: storyGoal(NEIGHBOURS, 0, NAME), beats: BEATS, done: 2, complete: false, due: false } });
    const closed = await scenePost(post(path, { action: "close" }, a.cookie), ctx(s.id));
    expect(closed.status).toBe(200);
    expect((await closed.json()).scene.ended).toBeTruthy();
  });

  it("the scene shows the goal and a dot a beat, offers the ending once the last has played, and says so when it's over", async () => {
    scripted({ played: [1, 2] }, { played: [3, 4] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const s = await start(a.id);
    await say(a.id, s.id, "I hold the parcel out.");
    await read(a.id, s.id);
    signIn(a.id);
    const page = async () => html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }));
    const playing = await page();
    expect(playing).toContain('data-step-in-story="playing" data-step-in-story-done="2"');
    expect(playing).toContain(storyGoal(NEIGHBOURS, 0, NAME)!.replace(/'/g, "&#x27;"));
    expect(playing.match(/<span class="on"><\/span>/g)).toHaveLength(2);
    expect(playing).toContain(`aria-label="2 of ${BEATS} of the story&#x27;s beats played"`);
    expect(playing).not.toContain("data-step-in-ending");
    // The beats themselves are never on the page.
    for (const beat of NEIGHBOURS.card.beats) expect(playing).not.toContain(beatForReader(beat, 0, NAME).slice(0, 30));
    // The menu has a closing line always, as a plain button (it sits inside the composer's form).
    expect(playing).toMatch(/<button type="button"[^>]*data-step-in-close-menu/);
    await say(a.id, s.id, "It was never about the corkscrew.");
    await read(a.id, s.id);
    const complete = await page();
    expect(complete).toContain('data-step-in-story="complete"');
    expect(complete).toContain("data-step-in-ending");
    expect(complete).toMatch(/<button type="button"[^>]*data-step-in-close[^-]/);
    expect(complete).toContain("data-step-in-keep-going");
    await closeStepIn(t.db, a.id, s.id);
    const over = await page();
    expect(over).toContain("data-step-in-played");
    expect(over).toContain("Played to the end: The neighbour next door.");
    expect(over).not.toContain("data-step-in-ending");
  });

  it("the shelf says what each card is played for, and which ones they've played to the end", async () => {
    scripted({ played: [1, 2, 3, 4] });
    await saveAdultSettings(t.db, {});
    const a = await admin();
    signIn(a.id);
    const fresh = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO }) }));
    expect(fresh.match(/data-step-in-card-goal/g)).toHaveLength(SHELF_TONIGHT);
    expect(fresh).not.toContain("data-step-in-card-played");
    expect(fresh).not.toContain("data-step-in-shelf-played");
    const s = await start(a.id);
    await say(a.id, s.id, "It was never about the corkscrew.");
    await read(a.id, s.id);
    expect(await playedRoleplays(t.db, a.id)).toEqual({ neighbours: 1 });
    const after = await html(await StepInSetupPage({ searchParams: Promise.resolve({ with: WHO }) }));
    expect(after).toContain("You&#x27;ve played 1 of them to the end.");
    // Its card says so when it's among tonight's eight (it's a different eight each day).
    const shown = [...after.matchAll(/data-step-in-card="([^"]+)"/g)].map((m) => m[1]);
    expect(after.includes("data-step-in-card-played")).toBe(shown.includes("neighbours"));
  });
});
