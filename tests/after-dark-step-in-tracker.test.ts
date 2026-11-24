// A Step in scene's continuity sheet (lib/adult/step-in-tracker.ts; lib/adult/step-in.ts stepInTrack): where the two of
// them are, what each has on and what's within reach, read again after every reply by one small call, said to the
// writer in the turn its reply answers, and the viewer's to correct. David, 2026-11-24: "a scene tracker, so a
// character doesn't pick up a sweater she never had". The fixtures are mild lines plus the short phrases the checks
// must refuse; no live calls here.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { GET as trackerGet, PUT as trackerPut } from "@/app/api/admin/after-dark/step-in/[id]/tracker/route";
import { POST as setupPost } from "@/app/api/admin/after-dark/step-in/route";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { exportAdultProfile } from "@/lib/adult/profile-data";
import { saveAdultSettings } from "@/lib/adult/settings";
import {
  endStepIn,
  getStepInScene,
  getStepInTracker,
  moveStepIn,
  quickStepIn,
  regenerateStepIn,
  saveStepInLimits,
  saveStepInTracker,
  sendStepInLine,
  setStepInRandomForTests,
  startStepIn,
  stepInFollowUp,
  stepInPlaces,
  stepInTrack,
  swipeStepIn,
  takeBackStepIn,
  writeStepInNote,
} from "@/lib/adult/step-in";
import { planStepInPicture, stepInBriefMessages } from "@/lib/adult/step-in-picture";
import { STEP_IN_TALK, TALK_CUE } from "@/lib/adult/step-in-prompt";
import {
  afterMove,
  holdSheet,
  parseSheet,
  sheetFor,
  sheetLine,
  sheetNow,
  sheetShown,
  TRACKER_FIELD_MAX,
  TRACKER_LINE_CHARS,
  TRACKER_REPLY_CHARS,
  trackerCue,
  trackerMessages,
  type SceneSheet,
  type StoredTracker,
} from "@/lib/adult/step-in-tracker";
import { setTrackerModelForTests } from "@/lib/adult/step-in-tracker-model";
import { loadCharacter } from "@/lib/character";
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
  await saveAdultSettings(t.db, {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setTrackerModelForTests(null);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const HOME = "venue:home";

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
const isTalk = (m: ChatMessage[]) => m[0].content.includes(STEP_IN_TALK);
const isSheet = (m: ChatMessage[]) => m[0].content.startsWith("You keep the continuity sheet of a private scene of adult fiction");
const story = (...paragraphs: string[]) => ({ story: paragraphs });
/** Mild replies, each different (a reply mustn't say an earlier one again). */
const FINE = [
  story('She set her glass down and turned on the sofa. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the side table made a small warm circle of it."),
  story('She took the parcel and weighed it in one hand. "This has my name on it. It has had my name on it for a week."', "The radiator ticked, and somewhere below a door closed."),
  story('"Tell me the worst part of your week," she said, and tucked her feet under her on the cushion.', "Somewhere in the building a radio found a song from ten summers ago and kept it low."),
  story('She laughed, short and surprised. "That is not how that story ends and we both know it."', "The candle on the shelf had burned down to a stub, and nobody had thought to change it."),
  story('"Walk with me," she said, already reaching for her coat. "The rain has stopped pretending."', "The street outside was all reflections, and the bus shelter across the road hummed under its one light."),
  story('She held the door with her shoulder. "After you. I want to see which way you turn."', "The night air smelled of wet pavement and somebody else's dinner."),
  story('"There is a bench by the water," she said. "It is mine on weeknights."', "A gull complained once from the roof and thought better of it."),
];
/** The scripted writer: prose in order (Talk's prompts get a spoken line), each prompt kept; notes and the self-harm maybes answered. */
function writer() {
  const seen = { prompts: [] as ChatMessage[][] };
  let i = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      seen.prompts.push(m);
      if (isTalk(m)) return JSON.stringify({ say: "Stay a while. I just put the kettle on." });
      return JSON.stringify(FINE[Math.min(i++, FINE.length - 1)]);
    },
  });
  return seen;
}

/** A sheet as the read answers with it (to the model the character's line is "character" and the viewer's "person"). */
type Answer = { where: string; character: string; person: string; around: string };
const S0: Answer = { where: "the living room, by the sofa", character: "a grey cardigan over a white tee, jeans, barefoot", person: "", around: "a lamp on the side table" };
const S1: Answer = { where: "the living room, on the sofa", character: "a grey cardigan over a white tee, jeans, barefoot; holding a parcel", person: "a dark coat, wet from the rain", around: "a lamp on the side table; a glass on the floor" };
const S2: Answer = { where: "the living room, on the sofa", character: "a white tee, jeans, barefoot", person: "a dark coat, wet from the rain", around: "a lamp on the side table; a grey cardigan over the sofa's arm" };
const kept = (a: Answer): SceneSheet => ({ where: a.where, them: a.character, you: a.person, around: a.around });
/** The scripted read: its answers in order (the last again), each prompt kept. An Error is a failed call; a function is called for its answer. */
function reader(...answers: unknown[]) {
  const seen = { asked: [] as ChatMessage[][] };
  let i = 0;
  setTrackerModelForTests({
    complete: async (m) => {
      seen.asked.push(m);
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      if (typeof a === "function") return (a as () => Promise<string>)();
      return typeof a === "string" ? a : JSON.stringify(a);
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const stored = async (id: string) => ((await rows(`select tracker from adult_step_in_scenes where id = $1`, [id]))[0]?.tracker ?? null) as StoredTracker | null;
const steps = async (id: string) => rows(`select status, http, message, flags from adult_steps where owner_id = $1 order by created_at`, [id]);
const everything = async () => JSON.stringify([await rows(`select * from adult_step_in_scenes`), await rows(`select * from adult_step_in_messages`), await rows(`select * from adult_steps`)]);
const system = (m: ChatMessage[]) => m[0].content;
const lastUser = (m: ChatMessage[]) => m[m.length - 1].content;
const user = (m: ChatMessage[]) => m[1].content;
/** A scene at the character's place with its opening drawn; the opening's id. */
async function start(viewer: string) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place: HOME });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return { id: r.id, opening: r.view.messages.filter((m) => m.role === "character").at(-1)!.id };
}
/** One line of the viewer's and the reply to it: the reply's id. */
async function say(viewer: string, id: string, line: string, opts: { talk?: boolean } = {}) {
  const r = await sendStepInLine(t.db, viewer, id, line, new Date(), opts);
  if (!r.ok) throw new Error(`send failed: ${r.status} ${r.message}`);
  return r.view.messages.filter((m) => m.role === "character").at(-1)!.id;
}
const LINES = ["I hang my wet coat by the door and hold the parcel out to you.", "I sit down next to you.", "I ask what is in the parcel.", "I laugh and shake my head."];
const request = (method: string, path: string, cookie: string, body?: unknown) =>
  new Request(`${BASE_URL}${path}`, { method, headers: { "content-type": "application/json", cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

describe("the sheet's own rules", () => {
  it("a line is one line of plain things: held to its length at a whole thing, and nothing at all when it only says there's nothing", () => {
    expect(sheetLine("  a grey cardigan,\n  jeans  ")).toBe("a grey cardigan, jeans");
    expect(sheetLine('"the kitchen, by the counter"')).toBe("the kitchen, by the counter");
    for (const nothing of ["", "none", "None.", "nothing", "N/A", "unknown", "not said", "Not mentioned", "-", 7, null, undefined]) expect(sheetLine(nothing), String(nothing)).toBe("");
    // No clothes at all is a fact of the scene, and is said as one.
    expect(sheetLine("naked")).toBe("naked");
    const long = sheetLine(`${"a long wool coat with brass buttons, ".repeat(6)}a scarf`);
    expect(long.length).toBeLessThanOrEqual(TRACKER_FIELD_MAX);
    expect(long.endsWith("brass buttons")).toBe(true);
    expect(sheetLine("x".repeat(400))).toHaveLength(TRACKER_FIELD_MAX);
  });

  it("a read's answer is all four lines or it isn't a sheet: prose, a reply meant for the writer and a missing line keep nothing", () => {
    expect(parseSheet(JSON.stringify(S1))).toEqual(kept(S1));
    // The sheet's own names for the two lines read too, and words around the JSON don't matter.
    expect(parseSheet(`Here it is:\n${JSON.stringify(kept(S1))}\nDone.`)).toEqual(kept(S1));
    expect(parseSheet("She set her glass down and smiled.")).toBeNull();
    expect(parseSheet(JSON.stringify(FINE[0]))).toBeNull();
    expect(parseSheet(JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." }))).toBeNull();
    expect(parseSheet(JSON.stringify({ where: "the sofa", character: "jeans", person: "" }))).toBeNull();
    expect(parseSheet(JSON.stringify({ where: "the sofa", character: ["jeans"], person: "", around: "" }))).toBeNull();
    expect(parseSheet('{"where": "the sofa", "character": "jea')).toBeNull();
    // A sheet with nothing on it says nothing: what was there stays.
    expect(parseSheet(JSON.stringify({ where: "", character: "none", person: "not said", around: "n/a" }))).toBeNull();
  });

  it("a line that fails the check keeps what was there, and an emptied line stays empty", () => {
    const before = kept(S0);
    const ok = (text: string) => !text.includes("cardigan");
    expect(holdSheet(kept(S1), before, ok)).toEqual({ ...kept(S1), them: before.them });
    expect(holdSheet({ ...kept(S1), around: "" }, before, () => true).around).toBe("");
    expect(holdSheet(kept(S1), null, ok).them).toBe("");
  });

  it("the sheet that holds is the kept one while its turn stands, else the one before it, else none", () => {
    const keptAt: StoredTracker = { upto: "r2", sheet: kept(S1), before: { upto: "r1", sheet: kept(S0) } };
    expect(sheetFor(keptAt, new Set(["r1", "l1", "r2"]))).toEqual({ upto: "r2", sheet: kept(S1) });
    // The reply it was read at was drawn again, taken back or flipped away: how things stood before it.
    expect(sheetFor(keptAt, new Set(["r1", "l1", "r2b"]))).toEqual({ upto: "r1", sheet: kept(S0) });
    expect(sheetFor(keptAt, new Set(["r0"]))).toBeNull();
    // A sheet from before anything was said (the viewer's own) always stands.
    expect(sheetFor({ upto: "gone", sheet: kept(S1), before: { upto: null, sheet: kept(S0) } }, new Set())).toEqual({ upto: null, sheet: kept(S0) });
    for (const junk of [null, undefined, "x", 3, [], {}, { upto: "r1" }, { upto: "r1", sheet: "no" }, { upto: "r1", sheet: {} }]) expect(sheetFor(junk, new Set(["r1"]))).toBeNull();
  });

  it("once the scene has moved, where they were and what was around them no longer hold", () => {
    const keptAt: StoredTracker = { upto: "r1", sheet: kept(S1), before: null };
    const still = sheetNow(keptAt, [{ id: "r1" }, { id: "l2" }]);
    expect(still).toMatchObject({ upto: "r1", moved: false });
    expect(sheetShown(still)).toEqual(kept(S1));
    const moved = sheetNow(keptAt, [{ id: "r1" }, { id: "p1", moved: true }]);
    expect(moved?.moved).toBe(true);
    expect(sheetShown(moved)).toEqual({ ...kept(S1), where: "", around: "" });
    expect(afterMove(kept(S1))).toEqual({ where: "", them: kept(S1).them, you: kept(S1).you, around: "" });
    // A move from before the sheet was read is already on it.
    expect(sheetNow(keptAt, [{ id: "p0", moved: true }, { id: "r1" }])?.moved).toBe(false);
    expect(sheetShown(null)).toBeNull();
  });

  it("the read is asked for the sheet after the newest lines, told where it starts only when asked to, and is never mistaken for the notes", () => {
    const first = trackerMessages({
      name: "Juniper",
      base: null,
      seed: { place: "Juniper's own home, the living room and the kitchen", wearing: "a grey cardigan and jeans" },
      lines: [
        { who: "character", text: "She   set her glass down." },
        { who: "them", text: "I hang up my coat." },
        { who: "moved", text: "a rooftop bar" },
      ],
    });
    expect(system(first)).toMatch(/^You keep the continuity sheet of a private scene of adult fiction between a person and Juniper/);
    expect(isSheet(first)).toBe(true);
    expect(isNotes(first)).toBe(false);
    expect(user(first)).toContain("There is no sheet yet.");
    expect(user(first)).toContain("The scene is set at Juniper's own home, the living room and the kitchen. Unless the lines say otherwise, Juniper starts in: a grey cardigan and jeans.");
    expect(user(first)).toContain("Juniper: She set her glass down.\nThe person: I hang up my coat.\n(The scene moves: the two of them are now at a rooftop bar.)");
    expect(user(first)).toContain('Reply with a JSON object: {"where": "...", "character": "...", "person": "...", "around": "..."}');
    const next = trackerMessages({ name: "Juniper", base: kept(S1), lines: [{ who: "them", text: "x".repeat(2000) }, { who: "character", text: "y".repeat(3000) }] });
    expect(user(next)).toContain(`The sheet so far:\n${JSON.stringify(S1)}`);
    expect(user(next)).not.toContain("The scene is set at");
    expect(user(next)).toContain(`The person: ${"x".repeat(TRACKER_LINE_CHARS)}\n`);
    expect(user(next)).toContain(`Juniper: ${"y".repeat(TRACKER_REPLY_CHARS)}\n`);
    expect(user(next)).not.toContain("x".repeat(TRACKER_LINE_CHARS + 1));
    expect(user(next)).not.toContain("y".repeat(TRACKER_REPLY_CHARS + 1));
  });

  it("the character is told it from its own side, only the lines there are, in one parenthetical", () => {
    expect(trackerCue(kept(S1))).toBe(
      "(For continuity, how things stood just before this. Where you both are: the living room, on the sofa. What you have on: a grey cardigan over a white tee, jeans, barefoot; holding a parcel. What they have on: a dark coat, wet from the rain. Within reach: a lamp on the side table; a glass on the floor. Keep to it, changed only by what has happened since: nothing else is worn, held or in the room unless your reply brings it in and says where it came from. Don't recite any of it.)",
    );
    const some = trackerCue({ where: "", them: "a white tee, jeans.", you: "", around: "" })!;
    expect(some).toContain("What you have on: a white tee, jeans. Keep to it");
    for (const left of ["Where you both are", "What they have on", "Within reach"]) expect(some).not.toContain(left);
    expect(trackerCue({ where: "", them: "", you: "", around: "" })).toBeNull();
    expect(trackerCue(null)).toBeNull();
  });
});

describe("read after a reply", () => {
  it("the first read starts from where the scene is set and what they start in; the next from the sheet and only the lines since", async () => {
    const wrote = writer();
    const read = reader(S0, S1);
    const a = await admin();
    const s = await start(a.id);
    expect(await stored(s.id)).toBeNull();
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(await stored(s.id)).toEqual({ upto: s.opening, sheet: kept(S0), before: null, reads: 1, cost: 0 });
    expect(read.asked).toHaveLength(1);
    expect(isSheet(read.asked[0])).toBe(true);
    expect(user(read.asked[0])).toContain("There is no sheet yet.");
    expect(user(read.asked[0])).toMatch(new RegExp(`The scene is set at ${NAME}'s own home, the living room and the kitchen\\. Unless the lines say otherwise, ${NAME} starts in: \\S`));
    expect(user(read.asked[0])).toContain(`${NAME}: She set her glass down and turned on the sofa.`);
    // One exchange on: the sheet so far, and only what's been said since it was read.
    const r1 = await say(a.id, s.id, LINES[0]);
    expect(await stepInFollowUp(t.db, s.id)).toBe(false);
    expect(await stored(s.id)).toEqual({ upto: r1, sheet: kept(S1), before: { upto: s.opening, sheet: kept(S0) }, reads: 2, cost: 0 });
    const asked = user(read.asked[1]);
    expect(asked).toContain(`The sheet so far:\n${JSON.stringify(S0)}`);
    expect(asked).not.toContain("The scene is set at");
    expect(asked).toContain(`The person: ${LINES[0]}\n${NAME}: She took the parcel and weighed it in one hand.`);
    expect(asked).not.toContain("She set her glass down");
    // The writer's own prompts never carry the read's, and the read is no reply: nothing is counted for it.
    expect(wrote.prompts.some(isSheet)).toBe(false);
    expect(Number((await rows(`select step_in from adult_usage where owner_id = $1`, [a.id]))[0]?.step_in)).toBe(2);
  });

  it("is read past the response: after a line through the scene's route, and after an opening drawn at the start", async () => {
    writer();
    const read = reader(S0, S1);
    const a = await admin();
    const made = await setupPost(request("POST", "/api/admin/after-dark/step-in", a.cookie, { character_id: WHO, place: HOME }));
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    await vi.waitFor(async () => expect((await stored(id))?.sheet).toEqual(kept(S0)), { timeout: 8000 });
    const sent = await scenePost(request("POST", `/api/admin/after-dark/step-in/${id}`, a.cookie, { action: "send", text: LINES[0] }), ctx(id));
    expect(sent.status).toBe(200);
    await vi.waitFor(async () => expect((await stored(id))?.sheet).toEqual(kept(S1)), { timeout: 8000 });
    expect(read.asked).toHaveLength(2);
    // A scene started in one click has nothing to read until its character has opened it.
    const quick = await setupPost(request("POST", "/api/admin/after-dark/step-in", a.cookie, { character_id: HOUSE_CHARACTERS[1].id, quick: true }));
    const q = (await quick.json()) as { id: string };
    expect(await stepInTrack(t.db, q.id)).toBe(false);
    expect(read.asked).toHaveLength(2);
  });

  it("nothing is read before the character has said anything, twice for the same reply, or in a scene that has ended", async () => {
    writer();
    const read = reader(S0, S1);
    const a = await admin();
    const q = await quickStepIn(t.db, a.id, WHO);
    if (!q.ok) throw new Error("no scene");
    expect(await stepInTrack(t.db, q.id)).toBe(false);
    expect(await stepInTrack(t.db, "no-such-scene")).toBe(false);
    expect(read.asked).toHaveLength(0);
    const s = await start(a.id);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(await stepInTrack(t.db, s.id)).toBe(false);
    expect(read.asked).toHaveLength(1);
    await say(a.id, s.id, LINES[0]);
    await endStepIn(t.db, a.id, s.id);
    expect(await stepInTrack(t.db, s.id)).toBe(false);
    expect(read.asked).toHaveLength(1);
    // With reads off (every other test file: tests/setup-no-live-checks.ts) nothing is asked of anyone.
    setTrackerModelForTests(null);
    const again = await start(a.id);
    expect(await stepInTrack(t.db, again.id)).toBe(false);
    expect(await stored(again.id)).toBeNull();
  });

  it("STEP_IN_TRACKER=off stops the reads and stops the sheet being said, and leaves what's kept where it is", async () => {
    const wrote = writer();
    const read = reader(S0, S1);
    const a = await admin();
    const s = await start(a.id);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    vi.stubEnv("STEP_IN_TRACKER", "off");
    await say(a.id, s.id, LINES[0]);
    expect(lastUser(wrote.prompts.at(-1)!)).toBe(LINES[0]);
    expect(await stepInTrack(t.db, s.id)).toBe(false);
    expect(read.asked).toHaveLength(1);
    expect((await stored(s.id))?.sheet).toEqual(kept(S0));
    // Back on: the next reply is told it again, and the read picks up where it left off.
    vi.stubEnv("STEP_IN_TRACKER", "");
    await say(a.id, s.id, LINES[1]);
    expect(lastUser(wrote.prompts.at(-1)!)).toBe(`${LINES[1]}\n\n${trackerCue(kept(S0))}`);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(user(read.asked[1])).toContain(`The person: ${LINES[0]}`);
  });

  it("an answer that isn't a sheet keeps nothing, a failed call keeps nothing, and a line that fails the recap's check keeps the old one", async () => {
    writer();
    const a = await admin();
    const s = await start(a.id);
    // A reply meant for the writer, prose, and a model that doesn't answer: no sheet, and nothing broken.
    reader(FINE[0], "She set her glass down.", new Error("the model is down"));
    for (let i = 0; i < 3; i++) expect(await stepInTrack(t.db, s.id)).toBe(false);
    expect(await stored(s.id)).toBeNull();
    reader(S0, { ...S1, character: "her sister's cardigan, jeans", around: "a school bag by the door" });
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    const r1 = await say(a.id, s.id, LINES[0]);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    // The two lines the narrator's guard refuses stay as they were; the other two are the new read's.
    expect(await stored(s.id)).toMatchObject({ upto: r1, sheet: { where: S1.where, them: S0.character, you: S1.person, around: S0.around } });
    expect(await everything()).not.toContain("sister");
  });

  it("is kept only if its reply still stands when the answer comes back, and never over a line the viewer corrected meanwhile", async () => {
    writer();
    const a = await admin();
    const s = await start(a.id);
    await say(a.id, s.id, LINES[0]);
    // The read is in flight while the viewer takes the exchange back: its reply is gone, and so is what it found.
    let answer!: (raw: string) => void;
    const read = reader(() => new Promise<string>((done) => (answer = done)));
    let reading = stepInTrack(t.db, s.id);
    await vi.waitFor(() => expect(read.asked).toHaveLength(1), { timeout: 8000 });
    expect((await takeBackStepIn(t.db, a.id, s.id)).ok).toBe(true);
    answer(JSON.stringify(S1));
    expect(await reading).toBe(false);
    expect(await stored(s.id)).toBeNull();
    // And while the viewer corrects a line: theirs is kept, and the next read starts from it.
    const next = reader(() => new Promise<string>((done) => (answer = done)));
    reading = stepInTrack(t.db, s.id);
    await vi.waitFor(() => expect(next.asked).toHaveLength(1), { timeout: 8000 });
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "a red scarf" })).toMatchObject({ ok: true, tracker: { you: "a red scarf" } });
    answer(JSON.stringify(S0));
    expect(await reading).toBe(false);
    expect((await stored(s.id))?.sheet).toEqual({ where: "", them: "", you: "a red scarf", around: "" });
  });
});

describe("said to the writer", () => {
  it("in the turn the reply answers, with the system prompt and every earlier turn exactly as they were", async () => {
    const wrote = writer();
    reader(S0, S1);
    const a = await admin();
    const s = await start(a.id);
    // No sheet yet: the prompt is what it always was.
    await say(a.id, s.id, LINES[0]);
    const plain = wrote.prompts.at(-1)!;
    expect(lastUser(plain)).toBe(LINES[0]);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    await say(a.id, s.id, LINES[1]);
    const told = wrote.prompts.at(-1)!;
    expect(lastUser(told)).toBe(`${LINES[1]}\n\n${trackerCue(kept(S0))}`);
    // Not a word of it above the last turn: the system prompt is the same to the byte, and so is every turn before.
    expect(system(told)).toBe(system(plain));
    expect(told.slice(0, plain.length)).toEqual(plain);
    expect(JSON.stringify(told.slice(0, -1))).not.toContain("For continuity");
    // The reply after that is told the newer sheet, and the turn that carried the older one is plain again.
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    await say(a.id, s.id, LINES[2]);
    const after = wrote.prompts.at(-1)!;
    expect(lastUser(after)).toBe(`${LINES[2]}\n\n${trackerCue(kept(S1))}`);
    expect(after[told.length - 1]).toEqual({ role: "user", content: LINES[1] });
    expect(system(after)).toBe(system(plain));
  });

  it("a reply drawn again is told how things stood before it; taken back or flipped to another draw, the sheet falls back and is read again", async () => {
    const wrote = writer();
    const read = reader(S0, S1, S2);
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    const r1 = await say(a.id, s.id, LINES[0]);
    await stepInTrack(t.db, s.id);
    expect((await stored(s.id))?.upto).toBe(r1);
    // Drawn again: the reply being replaced isn't part of the scene the new one is written after, nor is what it brought in.
    expect((await regenerateStepIn(t.db, a.id, s.id)).ok).toBe(true);
    expect(lastUser(wrote.prompts.at(-1)!)).toBe(`${LINES[0]}\n\n${trackerCue(kept(S0))}`);
    const view = await getStepInScene(t.db, a.id, s.id);
    if (!view.ok) throw new Error("no scene");
    const r1b = view.view.messages.filter((m) => m.role === "character").at(-1)!.id;
    expect(r1b).not.toBe(r1);
    // The new draw is read from the sheet before it, and shown the same line again.
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(await stored(s.id)).toMatchObject({ upto: r1b, sheet: kept(S2), before: { upto: s.opening, sheet: kept(S0) } });
    expect(user(read.asked[2])).toContain(`The sheet so far:\n${JSON.stringify(S0)}`);
    expect(user(read.asked[2])).toContain(`The person: ${LINES[0]}`);
    // Flipped back to the first draw: the kept sheet was read at the other one, so the panel reads this one first.
    expect((await swipeStepIn(t.db, a.id, s.id, "prev")).ok).toBe(true);
    expect(sheetFor(await stored(s.id), new Set([s.opening, r1]))).toEqual({ upto: s.opening, sheet: kept(S0) });
    expect(await getStepInTracker(t.db, a.id, s.id)).toEqual({ ok: true, tracker: kept(S2) });
    expect((await stored(s.id))?.upto).toBe(r1);
    expect(read.asked).toHaveLength(4);
    // Taken back: only the opening stands, and the sheet is the one from before the exchange, with nothing to read.
    expect((await takeBackStepIn(t.db, a.id, s.id)).ok).toBe(true);
    expect(await getStepInTracker(t.db, a.id, s.id)).toEqual({ ok: true, tracker: kept(S0) });
    expect(read.asked).toHaveLength(4);
    await say(a.id, s.id, LINES[1]);
    expect(lastUser(wrote.prompts.at(-1)!)).toBe(`${LINES[1]}\n\n${trackerCue(kept(S0))}`);
  });

  it("after the scene moves, only what they have on is said until the next reply is read there", async () => {
    const wrote = writer();
    const read = reader(S0, S1, { ...S2, where: "a table by the window", around: "two menus on the table" });
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    await say(a.id, s.id, LINES[0]);
    await stepInTrack(t.db, s.id);
    const place = stepInPlaces().find((p) => p.id !== HOME)!;
    expect((await moveStepIn(t.db, a.id, s.id, place.id)).ok).toBe(true);
    expect(await getStepInTracker(t.db, a.id, s.id)).toEqual({ ok: true, tracker: { ...kept(S1), where: "", around: "" } });
    await say(a.id, s.id, LINES[1]);
    const told = lastUser(wrote.prompts.at(-1)!);
    expect(told).toContain(trackerCue({ ...kept(S1), where: "", around: "" })!);
    expect(told).not.toContain("Where you both are");
    expect(told).not.toContain("Within reach");
    // The next read is shown the move, and the sheet is the new place's.
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(user(read.asked[2])).toContain("(The scene moves: the two of them are now at ");
    expect(user(read.asked[2])).toContain(`The sheet so far:\n${JSON.stringify(S1)}`);
    expect(await getStepInTracker(t.db, a.id, s.id)).toMatchObject({ tracker: { where: "a table by the window", around: "two menus on the table" } });
  });

  it("a spoken reply is told it before its own cue, and a note the character writes first isn't told it at all", async () => {
    const wrote = writer();
    reader(S0);
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    await say(a.id, s.id, LINES[0], { talk: true });
    expect(lastUser(wrote.prompts.at(-1)!)).toBe(`${LINES[0]}\n\n${trackerCue(kept(S0))}\n\n${TALK_CUE}`);
    const note = await writeStepInNote(t.db, s.id, new Date(), { away: "a few hours" });
    expect(note.ok).toBe(true);
    expect(lastUser(wrote.prompts.at(-1)!)).not.toContain("For continuity");
  });
});

describe("the viewer's corrections", () => {
  it("a line they rewrite is kept as theirs, said to the next reply, and still there when that reply is drawn again", async () => {
    const wrote = writer();
    const read = reader(S0, S1, S2);
    const a = await admin();
    const s = await start(a.id);
    // Before anything is noted they can already say what they have on.
    const q = await quickStepIn(t.db, a.id, HOUSE_CHARACTERS[1].id);
    if (!q.ok) throw new Error("no scene");
    expect(await saveStepInTracker(t.db, a.id, q.id, { you: "  a red dress,\n heels " })).toEqual({ ok: true, tracker: { where: "", them: "", you: "a red dress, heels", around: "" } });
    expect(await stored(q.id)).toMatchObject({ upto: null, before: null });
    await stepInTrack(t.db, s.id);
    const r1 = await say(a.id, s.id, LINES[0]);
    await stepInTrack(t.db, s.id);
    const fixed = await saveStepInTracker(t.db, a.id, s.id, { them: "a green jumper, jeans", around: "" });
    expect(fixed).toEqual({ ok: true, tracker: { ...kept(S1), them: "a green jumper, jeans", around: "" } });
    // Good as of the newest turn, and the sheet from before the last read takes the same corrections.
    expect(await stored(s.id)).toMatchObject({ upto: r1, sheet: { them: "a green jumper, jeans", around: "" }, before: { upto: s.opening, sheet: { where: S0.where, them: "a green jumper, jeans", around: "" } }, reads: 2 });
    expect(await getStepInTracker(t.db, a.id, s.id)).toEqual(fixed);
    expect(read.asked).toHaveLength(2);
    expect((await regenerateStepIn(t.db, a.id, s.id)).ok).toBe(true);
    const again = lastUser(wrote.prompts.at(-1)!);
    expect(again).toContain("What you have on: a green jumper, jeans.");
    expect(again).not.toContain("grey cardigan");
    await say(a.id, s.id, LINES[1]);
    expect(lastUser(wrote.prompts.at(-1)!)).toContain("What you have on: a green jumper, jeans.");
    // The next read starts from their sheet.
    await stepInTrack(t.db, s.id);
    expect(user(read.asked.at(-1)!)).toContain('"character":"a green jumper, jeans"');
  });

  it("their words are held to what a line of theirs is, and to the sheet's own shape; a refusal keeps nothing", async () => {
    writer();
    reader(S0);
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    expect(await saveStepInLimits(t.db, a.id, s.id, { intensity: "slow_burn", hard_nos: { chips: ["spitting"], own: ["tickling"] } }, { consent: true })).toMatchObject({ ok: true });
    const before = { sheet: await stored(s.id), steps: (await steps(a.id)).length };
    for (const [text, message] of [
      ["dressed as if she were only fifteen", "That note crosses one of the lines that never move (nobody under 18, or anything that suggests it)."],
      ["my stepsister's jumper", "That note crosses one of the lines that never move (no family or step-family roleplay)."],
      ["a feather for tickling", 'That note asks for one of your hard limits for this scene ("tickling"). Change it, or the limits, first.'],
      ["she unbuttons her shirt", "That note goes past kissing, as far as slow burn goes. Change it, or turn the intensity up, first."],
    ] as const) {
      expect(await saveStepInTracker(t.db, a.id, s.id, { them: text, where: "the kitchen" }), text).toMatchObject({ ok: false, status: 422, message });
    }
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "x".repeat(TRACKER_FIELD_MAX + 1) })).toMatchObject({ ok: false, status: 422, error: "invalid_tracker" });
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "a {b} coat" })).toMatchObject({ ok: false, status: 422, error: "invalid_tracker" });
    expect(await saveStepInTracker(t.db, a.id, s.id, {})).toMatchObject({ ok: false, status: 400, error: "empty" });
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: 7, nonsense: "x" } as never)).toMatchObject({ ok: false, status: 400, error: "empty" });
    expect(await stored(s.id)).toEqual(before.sheet);
    // Counted as refusals by their kind, with no word of what was written.
    const refusals = (await steps(a.id)).slice(before.steps);
    expect(refusals.map((r) => (r.flags as { action: string; refused: string }).refused)).toEqual(["lines", "lines", "limits", "limits"]);
    expect(refusals.every((r) => r.status === "error" && r.http === 422 && (r.flags as { action: string }).action === "tracker")).toBe(true);
    const all = await everything();
    for (const words of ["fifteen", "stepsister", "feather", "unbuttons"]) expect(all).not.toContain(words);
    // Exactly at the length: kept. Someone else's scene, and one that has ended: not theirs to write.
    const longest = `${"a long dark wool coat, a red scarf, grey gloves and black boots; ".repeat(4).slice(0, TRACKER_FIELD_MAX - 1)}s`;
    expect(longest).toHaveLength(TRACKER_FIELD_MAX);
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: longest })).toMatchObject({ ok: true, tracker: { you: longest } });
    const other = await admin();
    expect(await saveStepInTracker(t.db, other.id, s.id, { you: "a hat" })).toMatchObject({ ok: false, status: 404 });
    expect(await getStepInTracker(t.db, other.id, s.id)).toMatchObject({ ok: false, status: 404 });
    await endStepIn(t.db, a.id, s.id);
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "a hat" })).toMatchObject({ ok: false, status: 409, error: "ended" });
    // Still there to read.
    expect(await getStepInTracker(t.db, a.id, s.id)).toMatchObject({ ok: true, tracker: { where: S0.where } });
  });

  it("the self-harm check comes first: the scene pauses with the resources, and nothing they wrote is kept", async () => {
    writer();
    reader(S0);
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    const r = await saveStepInTracker(t.db, a.id, s.id, { you: "a coat, and I want to kill myself" });
    expect(r).toMatchObject({ ok: false, status: 200, error: "paused" });
    expect((r as { crisis_resources?: { lines: unknown[] } }).crisis_resources?.lines.length).toBeGreaterThan(0);
    const view = await getStepInScene(t.db, a.id, s.id);
    expect(view.ok && view.view.paused).toBe(true);
    expect(await everything()).not.toContain("kill myself");
    expect((await stored(s.id))?.sheet).toEqual(kept(S0));
    // Paused: nothing more is corrected until they carry on.
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "a coat" })).toMatchObject({ ok: false, status: 409, error: "paused" });
  });
});

describe("a picture of the moment", () => {
  it("is told what the sheet says they have on, only when the sheet is of that very reply", async () => {
    writer();
    reader(S0, S1);
    const asked: ChatMessage[][] = [];
    setBriefModelForTests({
      complete: async (m) => {
        asked.push(m);
        return JSON.stringify({ place: "the sofa in her living room, a lamp on", wearing: "a grey cardigan over a white tee, jeans", kept_on: "", happening: "She sits turned toward the camera, a parcel in her lap.", mood: "warm", state: "dressed" });
      },
    });
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    const r1 = await say(a.id, s.id, LINES[0]);
    await stepInTrack(t.db, s.id);
    const scene = (await rows(`select id, owner_id, place, roleplay, intensity, hard_nos, tracker from adult_step_in_scenes where id = $1`, [s.id]))[0] as unknown as Parameters<typeof planStepInPicture>[1];
    const messages = (await rows(`select id, role, kind, text, replaced_by from adult_step_in_messages where scene_id = $1 order by created_at asc, id asc`, [s.id])) as unknown as Parameters<typeof planStepInPicture>[2];
    const character = (await loadCharacter(t.db, WHO))!;
    // The newest reply, which the sheet was read at: the brief is told what the whole scene has them in, and where.
    expect((await planStepInPicture(t.db, scene, messages, messages.find((m) => m.id === r1)!, character)).ok).toBe(true);
    expect(asked[0][1].content).toContain(`The scene's own notes of that moment, from everything said so far: ${NAME} has on ${S1.character}.`);
    expect(asked[0][1].content).toContain(`And by the same notes they are at: ${S1.where}.`);
    // What the viewer has on is never a picture's business: they aren't in it.
    expect(asked[0][1].content).not.toContain(S1.person);
    // An earlier reply is another moment: the sheet says nothing of it.
    expect((await planStepInPicture(t.db, scene, messages, messages.find((m) => m.id === s.opening)!, character)).ok).toBe(true);
    expect(asked[1][1].content).not.toContain("The scene's own notes");
  });

  it("a brief with no sheet is asked exactly what it always was", () => {
    const input = { owner: "o", scene: "s", message: "m", name: "Juniper Vale", pronouns: "she/her", usual: "a green wrap dress", place: "her own home", roleplay: null, turns: [{ who: "character" as const, text: "She set her glass down." }] };
    const plain = stepInBriefMessages(input);
    expect(stepInBriefMessages({ ...input, noted: null })).toEqual(plain);
    expect(JSON.stringify(plain)).not.toContain("own notes");
    const told = stepInBriefMessages({ ...input, noted: { wearing: "a red dress", where: "" } });
    expect(told[0]).toEqual(plain[0]);
    expect(told[1].content).toContain("The scene's own notes of that moment, from everything said so far: Juniper has on a red dress.");
    expect(told[1].content).not.toContain("And by the same notes they are at");
  });
});

describe("the routes, the page and the download", () => {
  it("the sheet is read and corrected by its own route, closed like the rest of Step in", async () => {
    writer();
    const read = reader(S0);
    const a = await admin();
    const s = await start(a.id);
    const path = `/api/admin/after-dark/step-in/${s.id}/tracker`;
    // Step in is admins only until its switch is opened: a subscriber gets the same not-found, as does another admin.
    const sub = await subscriber();
    const other = await admin();
    for (const cookie of [sub.cookie, other.cookie]) {
      expect((await trackerGet(request("GET", path, cookie), ctx(s.id))).status).toBe(404);
      expect((await trackerPut(request("PUT", path, cookie, { you: "a hat" }), ctx(s.id))).status).toBe(404);
    }
    expect(read.asked).toHaveLength(0);
    expect(await stored(s.id)).toBeNull();
    // Opened on a scene whose newest reply hasn't been read: it's read first.
    const got = await trackerGet(request("GET", path, a.cookie), ctx(s.id));
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ tracker: kept(S0) });
    expect(read.asked).toHaveLength(1);
    const put = await trackerPut(request("PUT", path, a.cookie, { you: "a dark coat" }), ctx(s.id));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ tracker: { ...kept(S0), you: "a dark coat" } });
    // A refusal answers with why and the scene as it stands, as a refused line does; an unknown line isn't taken.
    const refused = await trackerPut(request("PUT", path, a.cookie, { them: "my stepsister's jumper" }), ctx(s.id));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: "refused", message: expect.stringContaining("That note crosses one of the lines that never move"), scene: { id: s.id } });
    expect((await trackerPut(request("PUT", path, a.cookie, { mood: "tense" }), ctx(s.id))).status).toBe(422);
    const crisis = await trackerPut(request("PUT", path, a.cookie, { you: "I want to kill myself" }), ctx(s.id));
    expect(crisis.status).toBe(200);
    expect(await crisis.json()).toMatchObject({ error: "paused", crisis_resources: expect.anything(), scene: { paused: true } });
    expect((await (await trackerGet(request("GET", path, a.cookie), ctx(s.id))).json()).tracker).toEqual({ ...kept(S0), you: "a dark coat" });
  });

  it("the scene's menu has the fold, closed until asked for, and never a form", async () => {
    writer();
    const a = await admin();
    const s = await start(a.id);
    signIn(a.id);
    const page = await html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }));
    const menu = page.slice(page.indexOf('<div class="ad-si-menu-items">'));
    expect(menu).toMatch(/<details class="ad-si-memory ad-si-tracker" data-step-in-tracker="closed"><summary>🧭 Where things stand<\/summary>/);
    // Nothing of the sheet is on the page until the fold is opened.
    expect(page).not.toContain("data-tracker-line");
    // The menu sits inside the composer's form: a form of its own, or a submit button, would send the page instead.
    const src = readFileSync("app/after-dark/step-in/[id]/StepInTracker.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/<form\b/);
    expect(src).not.toContain('type="submit"');
    expect(src.match(/<button\b/g)!.length).toBe(src.match(/<button type="button"/g)!.length);
    // It's inside the composer's form, and Enter in a line's box is that line's, never the composer's Send.
    const scene = readFileSync("app/after-dark/step-in/[id]/StepInScene.tsx", "utf8");
    expect(scene.slice(scene.indexOf('className="ad-si-composer"'), scene.lastIndexOf("</form>"))).toContain("<StepInTracker");
    expect(src).toContain("onKeyDown={onKey}");
    expect(src).toContain("e.preventDefault()");
  });

  it("the person's own download has each scene's sheet", async () => {
    writer();
    reader(S0);
    const a = await admin();
    const s = await start(a.id);
    const none = await start(a.id);
    await stepInTrack(t.db, s.id);
    const out = await exportAdultProfile(t.db, a.id);
    expect(out.step_in.find((x) => x.id === s.id)?.where_things_stand).toEqual(kept(S0));
    expect(out.step_in.find((x) => x.id === none.id)?.where_things_stand).toBeNull();
  });
});
