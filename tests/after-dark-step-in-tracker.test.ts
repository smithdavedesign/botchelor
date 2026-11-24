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
  sheetFor,
  sheetLine,
  sheetNow,
  sheetShown,
  TRACKER_FIELD_MAX,
  TRACKER_LINE_CHARS,
  TRACKER_REPLY_CHARS,
  trackerCue,
  type SceneSheet,
  type StoredTracker,
  type TrackerLine,
} from "@/lib/adult/step-in-tracker";
import { BARE_LINE, head, heldThings, parseSheet, personLine, settleSheet, things, trackerMessages, undressSaid, wornAndHeld } from "@/lib/adult/step-in-tracker-read";
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
/**
 * Mild replies, each different (a reply mustn't say an earlier one again). The things the scripted reads below put on
 * the sheet are all said in them (a glass, a cardigan, bare feet, a book, a candle): a read's answer keeps nothing the
 * lines don't mention.
 */
const FINE = [
  story('She set her glass down on the side table and turned on the sofa, barefoot in her grey cardigan. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp made a small warm circle of it."),
  story('She picked her glass up again and tucked her feet under her. "Tell me the worst part of your week," she said.', "The radiator ticked, and somewhere below a door closed."),
  story('"That is not how that story ends and we both know it," she said, laughing, and reached for the book on the armrest.', "The candle on the shelf had burned down to a stub."),
  story('She turned a page without reading it. "Go on, then. I am listening."', "Outside, a bus sighed at the corner and pulled away."),
  story('"Stay where you are," she said, and tipped her head toward the window. "It has given up pretending to be a shower."', "The street outside was all reflections."),
  story('She smiled at that, slow and sideways. "You always do that. Change the subject when you are winning."', "The night air smelled of wet pavement."),
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

/** A sheet as the read answers with it: six lines, a person's clothes apart from their hands. */
type Answer = { where: string; character_wears: string; character_holds: string; person_wears: string; person_holds: string; around: string };
const S0: Answer = { where: "the living room, on the sofa", character_wears: "a grey cardigan, barefoot", character_holds: "", person_wears: "", person_holds: "", around: "a glass on the side table" };
const S1: Answer = { ...S0, character_holds: "a glass", around: "" };
const S2: Answer = { ...S1, around: "a book on the armrest" };
/** What's kept of one of them when the lines bear it out: the four lines of the sheet. */
const kept = (a: Answer): SceneSheet => ({ where: a.where, them: personLine(things(a.character_wears), heldThings(a.character_holds)), you: personLine(things(a.person_wears), heldThings(a.person_holds)), around: a.around });
/** The sheet so far as a read is shown it. */
const shown = (sheet: SceneSheet) => {
  const them = wornAndHeld(sheet.them);
  const you = wornAndHeld(sheet.you);
  return JSON.stringify({ where: sheet.where, character_wears: them.worn.join(", "), character_holds: them.held.join(", "), person_wears: you.worn.join(", "), person_holds: you.held.join(", "), around: things(sheet.around).join("; ") });
};
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
const LINES = ["I sit down next to you.", "I ask about your week.", "I laugh and shake my head.", "I ask what happened next."];
const request = (method: string, path: string, cookie: string, body?: unknown) =>
  new Request(`${BASE_URL}${path}`, { method, headers: { "content-type": "application/json", cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

describe("the sheet's own rules", () => {
  it("a line is one line of plain things: held to its length at a whole thing, and nothing at all when it only says there's nothing", () => {
    expect(sheetLine("  a grey cardigan,\n  jeans  ")).toBe("a grey cardigan, jeans");
    expect(sheetLine('"the kitchen, by the counter"')).toBe("the kitchen, by the counter");
    for (const nothing of ["", "none", "None.", "nothing", "nothing on", "holding nothing", "nothing in hands", "Nothing in her hands.", "hands empty", "empty-handed", "N/A", "unknown", "not stated", "Not mentioned", "-", 7, null, undefined])
      expect(sheetLine(nothing), String(nothing)).toBe("");
    // These do say something: what's still on, and that every piece has come off.
    expect(sheetLine("nothing but a towel")).toBe("nothing but a towel");
    expect(sheetLine(BARE_LINE)).toBe("nothing left on");
    const long = sheetLine(`${"a long wool coat with brass buttons, ".repeat(6)}a scarf`);
    expect(long.length).toBeLessThanOrEqual(TRACKER_FIELD_MAX);
    expect(long.endsWith("brass buttons")).toBe(true);
    expect(sheetLine("x".repeat(400))).toHaveLength(TRACKER_FIELD_MAX);
  });

  it("a read's answer is its six lines (or the sheet's own four) or it isn't one: prose, a reply meant for the writer and a missing line keep nothing", () => {
    expect(parseSheet(JSON.stringify({ changes: ["Juniper: glass, in hand"], ...S1 }))).toEqual({ where: S1.where, themWears: S1.character_wears, themHolds: "a glass", youWears: "", youHolds: "", around: "" });
    // The four lines the sheet is kept in read too (clothes and hands on one line), and words around the JSON don't matter.
    expect(parseSheet(`Here it is:\n${JSON.stringify(kept(S1))}\nDone.`)).toEqual({ where: S1.where, themWears: kept(S1).them, themHolds: "", youWears: "", youHolds: "", around: "" });
    expect(parseSheet("She set her glass down and smiled.")).toBeNull();
    expect(parseSheet(JSON.stringify(FINE[0]))).toBeNull();
    expect(parseSheet(JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." }))).toBeNull();
    expect(parseSheet(JSON.stringify({ where: "the sofa", character_wears: "jeans", person_wears: "" }))).toBeNull();
    expect(parseSheet(JSON.stringify({ where: "the sofa", character_wears: ["jeans"], person_wears: "", around: "" }))).toBeNull();
    expect(parseSheet('{"where": "the sofa", "character_wears": "jea')).toBeNull();
  });

  it("a line's things: split at commas and semicolons, a part that only says how the thing before it is kept with it, hands apart from clothes", () => {
    expect(things("a grey cardigan, jeans; barefoot")).toEqual(["a grey cardigan", "jeans", "barefoot"]);
    expect(things("dark green wool coat, wet from rain")).toEqual(["dark green wool coat wet from rain"]);
    expect(things("wool sweater, nothing in hands")).toEqual(["wool sweater"]);
    expect(things("the living room, on the sofa", true)).toEqual(["the living room", "on the sofa"]);
    expect(wornAndHeld("a grey cardigan, jeans; holding a mug of tea and a parcel")).toEqual({ worn: ["a grey cardigan", "jeans"], held: ["a mug of tea", "a parcel"] });
    expect(wornAndHeld("holding wooden spoon")).toEqual({ worn: [], held: ["wooden spoon"] });
    expect(wornAndHeld("holding nothing")).toEqual({ worn: [], held: [] });
    expect(personLine(["a grey cardigan", "jeans"], ["a glass"])).toBe("a grey cardigan, jeans; holding a glass");
    expect(personLine([], ["a glass"])).toBe("holding a glass");
    expect(personLine(["jeans"], [])).toBe("jeans");
    // A thing is known by its noun, whatever it's made of, wherever it is.
    for (const [thing, known] of [["a small paper parcel tied with string", "parcel"], ["the parcel", "parcel"], ["dark green wool coat wet from rain", "coat"], ["Dark green wool coat (hung on hook by door)", "coat"], ["a glass on the side table", "glass"], ["her glasses", "glass"], ["jeans", "jean"], ["ink stain on thumb", "stain"]] as const)
      expect(head(thing), thing).toBe(known);
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

  it("the read is asked for the changes and then the sheet, starts the character in what they start in, and is never mistaken for the notes", () => {
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
    // With no sheet yet the character is already in what they start in: the answer copies it unless a line changes it.
    expect(user(first)).toContain(`The sheet so far:\n${JSON.stringify({ where: "", character_wears: "a grey cardigan and jeans", character_holds: "", person_wears: "", person_holds: "", around: "" })}`);
    expect(user(first)).toContain("The scene is set at Juniper's own home, the living room and the kitchen.");
    expect(user(first)).toContain("Juniper: She set her glass down.\nThe person: I hang up my coat.\n(The scene moves: the two of them are now at a rooftop bar.)");
    expect(user(first)).toContain("First list what these lines changed, then write the sheet as it stands after them.");
    expect(user(first)).toContain('Reply with a JSON object: {"changes": ["..."], "where": "...", "character_wears": "...", "character_holds": "...", "person_wears": "...", "person_holds": "...", "around": "..."}');
    // The rules the first live reads broke, said outright.
    for (const rule of ["It never empties by itself", '"" when they are empty', "A thing is in one place only", "Handed to someone, it is in their hands from then on", "nobody sitting or standing in it", "never a mark on the skin", 'Never write "nothing", "none" or "unknown"'])
      expect(user(first), rule).toContain(rule);
    const next = trackerMessages({ name: "Juniper", base: kept(S1), seed: { place: "anywhere", wearing: "a ball gown" }, lines: [{ who: "them", text: "x".repeat(2000) }, { who: "character", text: "y".repeat(3000) }] });
    expect(user(next)).toContain(`The sheet so far:\n${shown(kept(S1))}`);
    expect(shown(kept(S1))).toBe(JSON.stringify({ where: S1.where, character_wears: "a grey cardigan, barefoot", character_holds: "a glass", person_wears: "", person_holds: "", around: "" }));
    // The sheet says where they are and what they have on: what they start in isn't said again.
    expect(user(next)).not.toContain("The scene is set at");
    expect(user(next)).not.toContain("ball gown");
    expect(user(next)).toContain(`The person: ${"x".repeat(TRACKER_LINE_CHARS)}\n`);
    expect(user(next)).toContain(`Juniper: ${"y".repeat(TRACKER_REPLY_CHARS)}\n`);
    expect(user(next)).not.toContain("x".repeat(TRACKER_LINE_CHARS + 1));
    expect(user(next)).not.toContain("y".repeat(TRACKER_REPLY_CHARS + 1));
  });

  it("the character is told it from its own side, only the lines there are, in one parenthetical", () => {
    expect(trackerCue({ ...kept(S2), you: "a dark coat" })).toBe(
      "(For continuity, how things stood just before this. Where you both are: the living room, on the sofa. What you have on: a grey cardigan, barefoot; holding a glass. What they have on: a dark coat. Within reach: a book on the armrest. Keep to it: what's listed stays as it is until the story changes it, and nothing listed is somewhere else or back on. Anything not listed that your reply brings in gets a word on where it came from. Don't recite any of it.)",
    );
    // It lists what's been established and never claims to be all there is: the sheet may know one piece of an outfit.
    expect(trackerCue(kept(S2))).not.toMatch(/nothing else is worn/);
    const some = trackerCue({ where: "", them: "a white tee, jeans.", you: "", around: "" })!;
    expect(some).toContain("What you have on: a white tee, jeans. Keep to it");
    for (const left of ["Where you both are", "What they have on", "Within reach"]) expect(some).not.toContain(left);
    expect(trackerCue({ where: "", them: "", you: "", around: "" })).toBeNull();
    expect(trackerCue(null)).toBeNull();
  });
});

describe("the answer, settled: what the first live reads got wrong", () => {
  const SEED = "a soft grey cardigan over a white tee, jeans";
  const line = (who: TrackerLine["who"], text: string): TrackerLine => ({ who, text });
  const EMPTY: Answer = { where: "", character_wears: "", character_holds: "", person_wears: "", person_holds: "", around: "" };
  /** A read's answer settled for a scene with Juniper: on a sheet (`base`), or from what she starts in (`seed`). */
  const settle = (answer: Partial<Answer>, ctx: { base?: SceneSheet; seed?: string | null; lines?: TrackerLine[] } = {}) =>
    settleSheet(parseSheet(JSON.stringify({ ...EMPTY, ...answer }))!, { name: "Juniper", base: ctx.base ?? null, seed: ctx.seed === null ? null : { place: "Juniper's own home", wearing: ctx.seed ?? SEED }, lines: ctx.lines ?? [] });
  const CAME_IN = "I come in wearing my dark green wool coat, wet from the rain, and hang it on the hook by the door. I hand you a small paper parcel tied with string.";

  it("what the character has on starts as what they start in: \"nothing on\" is never a state", () => {
    const opening = [line("character", 'She looked up from the stove as you came in. "There you are," she said.')];
    for (const said of ["nothing on", "nothing", "none", "not stated", "unknown", "n/a", "naked", "wearing nothing", ""]) expect(settle({ where: "the kitchen", character_wears: said }, { lines: opening }).them, said).toBe(SEED);
    // With nothing to start from the line stays empty: it never says they have nothing on.
    expect(settle({ character_wears: "nothing on" }, { seed: null, lines: opening }).them).toBe("");
    // And a sheet that says what they have on keeps it, with what was in their hands.
    const base = { where: "the kitchen", them: "a green dress; holding a glass", you: "", around: "" };
    expect(settle({ where: "the kitchen", character_wears: "nothing on", character_holds: "nothing" }, { base, lines: [line("them", "I ask about your day."), line("character", '"Long," she said.')] })).toEqual(base);
    // What they start in gives way to the first clothes the lines name; something that only goes with an outfit is added to it.
    expect(settle({ character_wears: "an oversized sweater" }, { lines: [line("character", "She pushed up the sleeves of her oversized sweater.")] }).them).toBe("an oversized sweater");
    expect(settle({ character_wears: "barefoot" }, { lines: [line("character", "She padded over barefoot.")] }).them).toBe(`${SEED}, barefoot`);
  });

  it("undressed is only what the lines plainly say, said as what's off and what's on", () => {
    const dressed = { where: "the bedroom", them: "a green dress", you: "", around: "" };
    const undressing = [line("character", "She pulled the dress over her head and let it fall to the floor.")];
    expect(settle({ where: "the bedroom", character_wears: "naked", around: "a green dress on the floor" }, { base: dressed, lines: undressing })).toEqual({ where: "the bedroom", them: BARE_LINE, you: "", around: "a green dress on the floor" });
    // Said by the read with nowhere for the dress: it's still accounted for.
    expect(settle({ where: "the bedroom", character_wears: "nothing on" }, { base: dressed, lines: undressing })).toEqual({ where: "the bedroom", them: BARE_LINE, you: "", around: "a green dress (taken off)" });
    // The same answers after lines that undress nobody: she's still in the dress.
    for (const said of ["naked", "nothing on", "topless"]) expect(settle({ where: "the bedroom", character_wears: said }, { base: dressed, lines: [line("character", "She lifted the wooden spoon out of the pot and tasted it.")] }).them, said).toBe("a green dress");
    expect(undressSaid("She lifted the wooden spoon out of the pot.", ["a wool sweater"])).toBe(false);
    expect(undressSaid("She pulled her sweater over her head.", ["a wool sweater"])).toBe(true);
    // A piece taken off and put somewhere, which the read missed: the lines move it.
    const layered = { where: "the living room", them: "a grey cardigan, a white tee, jeans", you: "", around: "" };
    expect(settle({ where: "the living room", character_wears: "a grey cardigan, a white tee, jeans" }, { base: layered, lines: [line("character", 'She shrugged her cardigan off and draped it over the arm of the sofa. "It is warm in here," she said.')] })).toEqual({
      where: "the living room",
      them: "a white tee, jeans",
      you: "",
      around: "a grey cardigan over the arm of the sofa",
    });
  });

  it("clothes stay when the read answers with hands, and what's held is added only when something is", () => {
    const base = { where: "the kitchen", them: "a wool sweater, jeans", you: "", around: "" };
    const stirring = [line("character", "She stirred the pot and looked up.")];
    for (const wears of ["holding nothing", "wool sweater, nothing in hands", "nothing in hands", "empty-handed"]) expect(settle({ where: "the kitchen", character_wears: wears }, { base, lines: stirring }).them, wears).toBe("a wool sweater, jeans");
    expect(settle({ where: "the kitchen", character_wears: "a wool sweater, jeans", character_holds: "hands empty" }, { base, lines: stirring }).them).toBe("a wool sweater, jeans");
    const spoon = [line("character", "She lifted the wooden spoon out of the pot and held it out to you.")];
    expect(settle({ where: "the kitchen", character_wears: "holding wooden spoon" }, { base, lines: spoon }).them).toBe("a wool sweater, jeans; holding wooden spoon");
    expect(settle({ where: "the kitchen", character_wears: "a wool sweater, jeans", character_holds: "a wooden spoon" }, { base, lines: spoon }).them).toBe("a wool sweater, jeans; holding a wooden spoon");
  });

  it("the exchange itself: a coat hung up and a parcel handed over end up where the lines put them, whatever the read answers", () => {
    const lines = [line("them", CAME_IN), line("character", 'She turned from the stove, wiping her hands on a cloth. "You are soaked," she said. "Sit, sit."')];
    const right = { where: "the kitchen", them: `${SEED}; holding a small paper parcel tied with string`, you: "", around: "dark green wool coat wet from rain on the hook by the door" };
    // What one live read answered: nothing on her, nothing in her hands, the coat still on the viewer, people in "where".
    expect(settle({ where: "Juniper's kitchen, person sitting at table, Juniper leaning against counter", character_wears: "nothing on", character_holds: "holding nothing", person_wears: "dark green wool coat, wet from rain" }, { lines })).toEqual(right);
    // What the other answered: the coat listed as worn, with where it hangs.
    expect(settle({ where: "the kitchen", character_wears: SEED, person_wears: "Dark green wool coat (hung on hook by door)" }, { lines })).toEqual({ ...right, around: "Dark green wool coat hung on hook by door" });
    // A read that never noticed the coat or the parcel: the viewer's own words put them where they are.
    expect(settle({ where: "the kitchen", character_wears: SEED }, { lines })).toEqual({ ...right, around: "dark green wool coat on the hook by the door" });
    // And a right answer comes through as it was written.
    const good = { where: "the kitchen, by the stove", character_wears: SEED, character_holds: "a small paper parcel tied with string", around: "a dark green wool coat on the hook by the door" };
    expect(settle(good, { lines })).toEqual({ where: "the kitchen, by the stove", them: right.them, you: "", around: good.around });
  });

  it("a thing moves when a line moves it, and one that no line mentions is exactly where it was", () => {
    const held = { where: "the kitchen", them: `${SEED}; holding a small paper parcel tied with string`, you: "", around: "dark green wool coat on the hook by the door" };
    const same = { where: "the kitchen", character_wears: SEED, character_holds: "a small paper parcel tied with string", around: "dark green wool coat on the hook by the door" };
    // The reply puts the parcel down and the read changes nothing: the line moves it.
    expect(settle(same, { base: held, lines: [line("them", "I ask what is in it."), line("character", "She set the parcel on the windowsill and reached for the kettle.")] })).toEqual({
      where: "the kitchen",
      them: SEED,
      you: "",
      around: "a small paper parcel tied with string on the windowsill; dark green wool coat on the hook by the door",
    });
    // The read drops the parcel and the coat, or moves them, and no line mentions either: both are where they were.
    const quiet = [line("them", "I sit down."), line("character", '"Tea first," she said.')];
    expect(settle({ where: "the kitchen", character_wears: SEED }, { base: held, lines: quiet })).toEqual(held);
    expect(settle({ where: "the kitchen", character_wears: SEED, person_wears: "a dark green wool coat", around: "a small paper parcel on the table" }, { base: held, lines: quiet })).toEqual(held);
    // Picked up again by the lines: in hand, and no longer where it was (whether or not the read took it off the sill).
    const down = { where: "the kitchen", them: SEED, you: "", around: "a small paper parcel tied with string on the windowsill" };
    const picks = [line("character", "She picked the parcel up and turned it over.")];
    expect(settle({ where: "the kitchen", character_wears: SEED, character_holds: "the parcel", around: "a small paper parcel tied with string on the windowsill" }, { base: down, lines: picks })).toEqual({ where: "the kitchen", them: `${SEED}; holding the parcel`, you: "", around: "" });
    expect(settle({ where: "the kitchen", character_wears: SEED, around: "a small paper parcel tied with string on the windowsill" }, { base: down, lines: picks })).toEqual({ where: "the kitchen", them: `${SEED}; holding a small paper parcel tied with string`, you: "", around: "" });
    // What's said isn't done: a thing only moves when the telling moves it.
    const coat = { where: "the hall", them: SEED, you: "a dark green wool coat", around: "" };
    expect(settle({ where: "the hall", character_wears: SEED, person_wears: "a dark green wool coat" }, { base: coat, lines: [line("character", '"Put your coat on the chair," she said, without looking up.')] })).toEqual(coat);
    expect(settle({ where: "the hall", character_wears: SEED, person_wears: "a dark green wool coat" }, { base: coat, lines: [line("character", "She took your coat and hung it on the chair.")] })).toEqual({ ...coat, you: "", around: "a dark green wool coat on the chair" });
    // Nor is a hand on a knee a thing put down, or a look a thing handed over.
    expect(settle({ where: "the hall", character_wears: SEED, person_wears: "a dark green wool coat" }, { base: coat, lines: [line("them", "I put my hand on your knee and give you a look."), line("character", "She put her hand on your shoulder and left it there.")] })).toEqual(coat);
    // Still worn: left on, tucked in, or put back on over something else.
    const worn = { where: "the bedroom", them: "a white shirt, jeans, stockings", you: "", around: "" };
    for (const told of ["She left her stockings on as she crossed the room.", "She tucked her shirt into her jeans and turned round.", "She put her shirt back on over her vest and did up one button."])
      expect(settle({ where: "the bedroom", character_wears: "a white shirt, jeans, stockings" }, { base: worn, lines: [line("character", told)] }), told).toEqual(worn);
    // After the scene moves, what's in a hand goes along and what was around them doesn't.
    expect(settle({ where: "a rooftop bar", character_wears: SEED }, { base: held, lines: [line("moved", "a rooftop bar"), line("character", '"Better," she said, looking out over the roofs.')] })).toEqual({ where: "a rooftop bar", them: held.them, you: "", around: "" });
  });

  it("where is the place and the spot in it, with nobody in it", () => {
    const at = (where: string, ctx: Parameters<typeof settle>[1] = {}) => settle({ where, character_wears: SEED }, ctx).where;
    expect(at("Juniper's kitchen, person sitting at table, Juniper leaning against counter")).toBe("the kitchen");
    expect(at("the living room, on the sofa")).toBe("the living room, on the sofa");
    expect(at("the sofa in her living room")).toBe("the sofa in the living room");
    // Nothing usable: where they were stands, unless the scene has just moved.
    const base = { where: "the kitchen, by the counter", them: SEED, you: "", around: "" };
    expect(at("the two of them standing close together", { base })).toBe("the kitchen, by the counter");
    expect(at("unknown", { base })).toBe("the kitchen, by the counter");
    expect(at("both sitting at the bar", { base, lines: [line("moved", "a rooftop bar")] })).toBe("");
  });

  it("only clothes and what's in their hands: never a mark on the skin, a name, or a thing no line mentions", () => {
    // A mark on the skin isn't worn; a ring is.
    expect(settle({ character_wears: SEED, person_wears: "ink stain on thumb" }, { lines: [line("them", "I rub at the ink stain on my thumb.")] }).you).toBe("");
    expect(settle({ character_wears: SEED, person_wears: "a ring on the thumb, jeans" }, { lines: [line("them", "I twist the ring on my thumb and smooth my jeans.")] }).you).toBe("a ring on the thumb, jeans");
    // What the viewer has on comes only from their own lines.
    expect(settle({ character_wears: SEED, person_wears: "a red scarf" }, { lines: [line("character", '"Is that a red scarf?" she asked.')] }).you).toBe("");
    // No names in a line, and nobody's "her".
    expect(settle({ character_wears: SEED, character_holds: "Juniper's mug of tea", around: "her phone on the counter" }, { lines: [line("character", "She wrapped both hands round her mug of tea. Her phone buzzed on the counter.")] })).toMatchObject({
      them: `${SEED}; holding mug of tea`,
      around: "the phone on the counter",
    });
    // A thing "around" that says whose hand it's in is in that hand.
    expect(settle({ character_wears: SEED, around: "a mug in Juniper's hands; a spoon in the person's hand" }, { lines: [line("character", "She passed you a spoon and kept the mug.")] })).toMatchObject({ them: `${SEED}; holding a mug`, you: "holding a spoon", around: "" });
    // Nothing the lines don't mention gets on: not a guess, and not the things in the example the read is shown.
    expect(settle({ character_wears: SEED, character_holds: "a glass of wine", around: "an umbrella in the stand by the door; a bottle of wine on the counter" }, { lines: [line("character", '"Sit," she said.')] })).toMatchObject({ them: SEED, around: "" });
  });

  it("through a scene: a read that answers the way the live ones did is still kept right", async () => {
    writer();
    reader(S0, { where: `${NAME}'s living room, person sitting on sofa`, character_wears: "nothing on", character_holds: "holding nothing", person_wears: "dark green wool coat, wet from rain", person_holds: "", around: "" }, S0);
    const a = await admin();
    const s = await start(a.id);
    await stepInTrack(t.db, s.id);
    await say(a.id, s.id, CAME_IN);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    // Her clothes stay, the parcel is in her hands with the glass the reply has her pick up, the coat is on its hook,
    // and "where" is a place.
    const after = { where: "the living room", them: "a grey cardigan, barefoot; holding a small paper parcel tied with string, a glass", you: "", around: "dark green wool coat wet from rain on the hook by the door" };
    expect((await stored(s.id))?.sheet).toEqual(after);
    // The next read forgets all of it (it answers with the opening's sheet) and no line since mentions any of it.
    await say(a.id, s.id, LINES[3]);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect((await stored(s.id))?.sheet).toEqual({ ...after, where: S0.where });
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
    // No sheet yet: the character is already in what they start in, and the read is told where the scene is set.
    expect(user(read.asked[0])).toMatch(/The sheet so far:\n\{"where":"","character_wears":"[^"]+","character_holds":"","person_wears":"","person_holds":"","around":""\}/);
    expect(user(read.asked[0])).toContain(`The scene is set at ${NAME}'s own home, the living room and the kitchen.`);
    expect(user(read.asked[0])).toContain(`${NAME}: She set her glass down on the side table and turned on the sofa`);
    // One exchange on: the sheet so far, and only what's been said since it was read.
    const r1 = await say(a.id, s.id, LINES[0]);
    expect(await stepInFollowUp(t.db, s.id)).toBe(false);
    expect(await stored(s.id)).toEqual({ upto: r1, sheet: kept(S1), before: { upto: s.opening, sheet: kept(S0) }, reads: 2, cost: 0 });
    const asked = user(read.asked[1]);
    expect(asked).toContain(`The sheet so far:\n${shown(kept(S0))}`);
    expect(asked).not.toContain("The scene is set at");
    expect(asked).toContain(`The person: ${LINES[0]}\n${NAME}: She picked her glass up again and tucked her feet under her.`);
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

  it("STEP_IN_TRACKER=0 stops the reads and stops the sheet being said, and leaves what's kept where it is", async () => {
    const wrote = writer();
    const read = reader(S0, S1);
    const a = await admin();
    const s = await start(a.id);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    vi.stubEnv("STEP_IN_TRACKER", "0");
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
    reader(S0, { ...S1, where: "the school hall", character_holds: "her sister's glass" });
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    const r1 = await say(a.id, s.id, LINES[0]);
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    // The two lines the narrator's guard refuses stay as they were; the rest is the new read's (the glass left the table).
    expect(await stored(s.id)).toMatchObject({ upto: r1, sheet: { where: S0.where, them: kept(S0).them, you: "", around: "" } });
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
    reader(S1, S2);
    const a = await admin();
    const s = await start(a.id);
    // No sheet yet: the prompt is what it always was.
    await say(a.id, s.id, LINES[0]);
    const plain = wrote.prompts.at(-1)!;
    expect(lastUser(plain)).toBe(LINES[0]);
    // (This first read is shown the opening and the exchange together: the glass put down, then picked up again.)
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect((await stored(s.id))?.sheet).toEqual(kept(S1));
    await say(a.id, s.id, LINES[1]);
    const told = wrote.prompts.at(-1)!;
    expect(lastUser(told)).toBe(`${LINES[1]}\n\n${trackerCue(kept(S1))}`);
    // Not a word of it above the last turn: the system prompt is the same to the byte, and so is every turn before.
    expect(system(told)).toBe(system(plain));
    expect(told.slice(0, plain.length)).toEqual(plain);
    expect(JSON.stringify(told.slice(0, -1))).not.toContain("For continuity");
    // The reply after that is told the newer sheet, and the turn that carried the older one is plain again.
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    await say(a.id, s.id, LINES[2]);
    const after = wrote.prompts.at(-1)!;
    expect(lastUser(after)).toBe(`${LINES[2]}\n\n${trackerCue(kept(S2))}`);
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
    // (The read answers with the glass in her hand; this draw never has her pick it up, so it's still on the table.)
    expect(await stored(s.id)).toMatchObject({ upto: r1b, sheet: { ...kept(S0), around: "a book on the armrest; a glass on the side table" }, before: { upto: s.opening, sheet: kept(S0) } });
    expect(user(read.asked[2])).toContain(`The sheet so far:\n${shown(kept(S0))}`);
    expect(user(read.asked[2])).toContain(`The person: ${LINES[0]}`);
    // Flipped back to the first draw: the kept sheet was read at the other one, so the panel reads this one first.
    expect((await swipeStepIn(t.db, a.id, s.id, "prev")).ok).toBe(true);
    expect(sheetFor(await stored(s.id), new Set([s.opening, r1]))).toEqual({ upto: s.opening, sheet: kept(S0) });
    // (The reader answers with the book again, which this draw never mentions: it isn't kept.)
    expect(await getStepInTracker(t.db, a.id, s.id)).toEqual({ ok: true, tracker: kept(S1) });
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
    const read = reader(S0, S1, { ...S2, where: "a table by the window", around: "a candle on the shelf" });
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
    expect(user(read.asked[2])).toContain(`The sheet so far:\n${shown(kept(S1))}`);
    expect(await getStepInTracker(t.db, a.id, s.id)).toMatchObject({ tracker: { where: "a table by the window", them: kept(S1).them, around: "a candle on the shelf" } });
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
    // The next read starts from their sheet, and an answer that goes back to the old clothes (which no line since has
    // mentioned) doesn't undo it.
    expect(await stepInTrack(t.db, s.id)).toBe(true);
    expect(user(read.asked.at(-1)!)).toContain('"character_wears":"a green jumper, jeans"');
    expect((await stored(s.id))?.sheet.them).toBe("a green jumper, jeans");
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
    expect(await saveStepInTracker(t.db, a.id, s.id, { you: "a dark coat" })).toMatchObject({ ok: true });
    const scene = (await rows(`select id, owner_id, place, roleplay, intensity, hard_nos, tracker from adult_step_in_scenes where id = $1`, [s.id]))[0] as unknown as Parameters<typeof planStepInPicture>[1];
    const messages = (await rows(`select id, role, kind, text, replaced_by from adult_step_in_messages where scene_id = $1 order by created_at asc, id asc`, [s.id])) as unknown as Parameters<typeof planStepInPicture>[2];
    const character = (await loadCharacter(t.db, WHO))!;
    // The newest reply, which the sheet was read at: the brief is told what the whole scene has them in, and where.
    expect((await planStepInPicture(t.db, scene, messages, messages.find((m) => m.id === r1)!, character)).ok).toBe(true);
    expect(asked[0][1].content).toContain(`The scene's own notes of that moment, from everything said so far: ${NAME} has on ${kept(S1).them}.`);
    expect(asked[0][1].content).toContain(`And by the same notes they are at: ${S1.where}.`);
    // What the viewer has on is never a picture's business: they aren't in it.
    expect(asked[0][1].content).not.toContain("a dark coat");
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
