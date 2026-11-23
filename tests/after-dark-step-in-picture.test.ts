// A picture of the moment in a Step in scene (lib/adult/step-in-picture.ts; docs/after-dark.md "Step in": a picture of
// this moment): the character alone, as the viewer sees them, through After Dark's own picture pipeline and every check
// it has; the viewer never drawn; the price said first; kept with the scene and gone with it. No live calls here.
// The fixtures are mild lines plus the short phrases the checks must refuse.
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
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import { GET as pictureGet, POST as picturePost } from "@/app/api/admin/after-dark/step-in/[id]/picture/route";
import { DELETE as sceneDelete } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { ownMedia } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { povPrompt, reelPerson, setReelFetchForTests, setReelPausesForTests, type ReelPerson } from "@/lib/adult/reels";
import { saveAdultSettings } from "@/lib/adult/settings";
import { endStepIn, getStepInScene, sendStepInLine, setStepInRandomForTests, startStepIn, takeBackStepIn } from "@/lib/adult/step-in";
import { drawStepInPicture, OLDER_ONE, parseStepInBrief, PICTURE_CLAIM_MINUTES, pictureWordsOk, placeAt, stepInBriefMessages, stepInPictureState } from "@/lib/adult/step-in-picture";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { madeInSql } from "@/lib/made-in";
import type { ChatMessage } from "@/lib/model";
import { setPersona } from "@/lib/persona";
import { setPlaceForTests } from "@/lib/place";
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
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setStepInRandomForTests(() => 0);
  setReelPausesForTests(false);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setBriefModelForTests(undefined);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
  setReelFetchForTests(null);
  setReelPausesForTests(true);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  // Back to the open place every test starts in (tests/helpers.ts).
  setPlaceForTests({ country: "US", region: "CA" });
});

// Rafe (he) and Juniper (she), the two house characters in After Dark here.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const NAME = HOUSE_CHARACTERS[1].name.split(/\s+/)[0];
const CAFE = "venue:corner_cafe";
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
/** After Dark set up for pictures (Venice's and Hive's keys), and Step in as it ships (admins only) unless opened. */
const setUp = (extra: Parameters<typeof saveAdultSettings>[1] = {}) => saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...extra });

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** Each of them has the face this viewer's pictures keep (a baseline), so nothing has to be made first. */
async function faces(owner: string) {
  for (const [id, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [`${id}-${owner.slice(0, 8)}`, owner, c, Buffer.from(PNG)]);
  }
}
const faceOf = (owner: string, who = "juniper") => `base-${who}-${owner.slice(0, 8)}`;

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const REPLY = { story: ['She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."] };
/** The scene's writer: every reply is the same mild story. */
function scripted() {
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      return JSON.stringify(REPLY);
    },
  });
}
const BRIEF = { place: "the kitchen counter in her flat, a lamp on, rain on the window", wearing: "a green wrap dress", kept_on: "", happening: "She sits turned on a stool, one elbow on the counter, smiling into the camera.", mood: "warm, a little amused", state: "dressed" };
/** The brief's reader: `answers` in order (the last one again); records what it was asked. */
function briefs(...answers: unknown[]) {
  const asked: ChatMessage[][] = [];
  let i = 0;
  setBriefModelForTests({
    complete: async (m) => {
      asked.push(m);
      const a = answers.length ? answers[Math.min(i++, answers.length - 1)] : BRIEF;
      if (a instanceof Error) throw a;
      return typeof a === "string" ? a : JSON.stringify(a);
    },
  });
  return asked;
}
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
const MINOR = { choices: [{ message: { role: "assistant", content: '{"answer": "MINOR"}' } }] };
function fakeHive(answer: (vlm: boolean) => unknown = (vlm) => (vlm ? ADULTS : CLEAN_MOD)) {
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    seen.push(vlm ? "vlm" : "moderation");
    const a = answer(vlm);
    return a instanceof Response ? a : Response.json(a);
  });
  return seen;
}
/** Venice's multi-image edit: a PNG for whatever it's asked; records the asks. */
function fakeVenice(keyframe?: () => Response) {
  const seen: { path: string; body: { prompt: string; images: string[]; modelId: string; safe_mode: boolean } }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    seen.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    if (path === "/image/multi-edit") return keyframe?.() ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const drawn = async (owner: string) => Number((await rows(`select pictures as n from adult_usage where owner_id = $1`, [owner]))[0]?.n ?? 0);
const kept = async (owner: string) => rows(`select id, kind, character_id, character_b, step_in_scene, step_in_message, status from adult_images where owner_id = $1 and kind = 'scene' order by created_at`, [owner]);
/** A running scene with one line of the viewer's and its reply: the scene and the reply's id. */
async function scene(viewer: string, opts: { who?: string; place?: string; line?: string } = {}) {
  const r = await startStepIn(t.db, viewer, { character_id: opts.who ?? JUNIPER, place: opts.place ?? HOME });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  const sent = await sendStepInLine(t.db, viewer, r.id, opts.line ?? "I brought the wine you like. Is that the lamp from the market?");
  if (!sent.ok) throw new Error(`send failed: ${sent.status} ${sent.message}`);
  const reply = sent.view.messages.at(-1)!;
  return { id: r.id, reply: reply.id, view: sent.view };
}
const draw = (viewer: string, s: { id: string; reply: string }, message = s.reply) => drawStepInPicture(t.db, viewer, s.id, message, BASE_URL);
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie: string) => new Request(`${BASE_URL}${path}`, { headers: { cookie } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");

describe("the first-person prompt, for one person alone", () => {
  const person: ReelPerson = { id: "x", pronouns: "she/her", noun: "woman", tag: "the woman", look: "", voice: "", names: ["Juniper"] };
  const camera: ReelPerson = { id: "viewer", pronouns: null, noun: "person", tag: "the viewer", look: "", voice: "", names: [] };

  it("asks for nobody but the one shown, not even a hand, and says one adult", () => {
    const alone = povPrompt([person, camera], "b", "The woman leans on the counter, smiling into the camera.", "her kitchen", 1, true, { explicit: true, alone: true, clothes: "a green wrap dress, fully clothed" });
    expect(alone).toMatch(/^Make one first-person photograph of the woman from Picture 1, in the place from Picture 2, seen through the viewer's eyes\./);
    expect(alone).toContain("Only this one person in the picture: nobody else, no second person, and no part of anyone else's body anywhere in the frame, not even a hand.");
    expect(alone).toContain("a green wrap dress, fully clothed, the woman's face clearly visible.");
    expect(alone).toMatch(/Photorealistic\. An adult\.$/);
    expect(alone).not.toContain("Both are adults");
    expect(alone).not.toContain("hips or thighs");
    // A night's first-person picture of two is as it was: the one whose eyes they are may show at the frame's edge.
    const two = povPrompt([person, { ...camera, tag: "the man", noun: "man" }], "b", "The woman leans in.", "her kitchen", 1, true, { explicit: true });
    expect(two).toContain("at most hands, arms, hips or thighs at the edge of the frame");
    expect(two).toMatch(/Both are adults\.$/);
  });

  it("names one character on their own as a picture does: by what they are, never by name", async () => {
    const c = (await loadCharacter(t.db, JUNIPER))!;
    expect(reelPerson(c)).toMatchObject({ id: JUNIPER, noun: "woman", tag: "the woman", names: expect.arrayContaining([NAME]) });
  });
});

describe("the moment, read", () => {
  it("asks about the character only, with the viewer as the camera, and reads the scene up to the reply", () => {
    const [system, user] = stepInBriefMessages({
      owner: "o",
      scene: "s",
      message: "m",
      name: "Juniper Vale",
      pronouns: "she/her",
      usual: "a grey cardigan and jeans",
      place: "her own home, the living room, a lamp on",
      roleplay: null,
      turns: [
        { who: "viewer", text: "I brought the wine you like." },
        { who: "place", text: "a corner café" },
        { who: "character", text: 'She laughed. "Then stay for a glass."' },
      ],
    });
    expect(system.content).toContain("a single photograph of ONE of them, Juniper, alone");
    expect(system.content).toContain('The other person ("You" in the lines) is where the camera is and is never in the photograph');
    expect(system.content).toContain('never write "you"');
    expect(system.content).toContain("Never write anything that makes them seem under 18.");
    expect(user.content).toContain("1. You: I brought the wine you like.");
    expect(user.content).toContain("2. (The scene moves): a corner café");
    expect(user.content).toContain('3. Juniper: She laughed. "Then stay for a glass."');
    expect(user.content).toContain("The last line, 3, is the moment");
    expect(user.content).toContain("What Juniper usually wears: a grey cardigan and jeans.");
  });

  it("takes only the fields asked for, and a state it knows", () => {
    expect(parseStepInBrief(`Here you go: ${JSON.stringify({ ...BRIEF, state: "Half", kept_on: "none", extra: "x" })}`)).toEqual({ ...BRIEF, state: "half", kept_on: "" });
    expect(parseStepInBrief(JSON.stringify({ ...BRIEF, state: "in between" }))?.state).toBeNull();
    expect(parseStepInBrief("no json at all")).toBeNull();
    expect(parseStepInBrief(JSON.stringify({ place: "a room" }))).toBeNull();
  });

  it("keeps words about the viewer, the lines and the limits out of a picture", () => {
    const none = { hit: () => null };
    expect(pictureWordsOk("She leans on the counter, smiling into the camera.", none)).toBe(true);
    expect(pictureWordsOk("", none)).toBe(true);
    // The viewer is never in the picture: no "you", no partner, not what they go by.
    for (const words of ["She pulls you closer by your collar.", "Her hand on her partner's chest.", "She looks at the viewer's hands.", "She smiles at Sam."]) expect(pictureWordsOk(words, none, ["Sam"]), words).toBe(false);
    // The lines that never move, the picture taboos and Step in's own net.
    for (const words of ["a school uniform", "she looks sixteen", "her student's desk"]) expect(pictureWordsOk(words, none), words).toBe(false);
    // The viewer's own limits for the scene.
    expect(pictureWordsOk("a silk blindfold", { hit: (text) => (/blindfold/.test(text) ? "Restraints" : null) })).toBe(false);
  });

  it("knows where the scene was at a reply: the last move before it, else where it started", () => {
    const m = (id: string, role: "viewer" | "character" | "system", kind: string | null = null, text = "") => ({ id, role, kind, text });
    const moved = [m("1", "character"), m("2", "system", "place", "The rooftop bar"), m("3", "character"), m("4", "system", "place", "Their place"), m("5", "character")];
    expect(placeAt(moved, "5", "Their place")).toBe("Their place");
    expect(placeAt(moved, "3", "Their place")).toBe("The rooftop bar");
    // Before its first move the scene no longer says where it began.
    expect(placeAt(moved, "1", "Their place")).toBeNull();
    expect(placeAt([m("1", "character"), m("2", "system", "notice")], "1", "A corner café")).toBe("A corner café");
  });
});

describe("a picture of the moment", () => {
  it("draws the character alone, as the viewer sees them, checks it, keeps it with the reply and counts one of the month's pictures", async () => {
    scripted();
    const asked = briefs();
    await setUp();
    const a = await admin();
    await faces(a.id);
    // Who the viewer is in scenes: none of it may reach a picture.
    await setPersona(t.db, a.id, { name: "Sam", look: "tall, a copper beard, a navy peacoat", about: "a ferry pilot on the night shift" }, () => null);
    const s = await scene(a.id, { line: "It's Sam. I brought the wine you like, and my beard is finally trimmed." });
    const venice = fakeVenice();
    const hive = fakeHive();
    const r = await draw(a.id, s);
    if (!r.ok) throw new Error(`${r.status} ${r.message}`);
    // One edit, from the one face the viewer keeps for her (no drawn set for her home here), then Hive's two questions.
    expect(venice).toHaveLength(1);
    const { prompt, images, safe_mode } = venice[0].body;
    expect(images).toHaveLength(1);
    expect(images[0]).toContain(`/api/admin/after-dark/media/${faceOf(a.id)}.png?until=`);
    expect(safe_mode).toBe(false);
    expect(hive).toEqual(["moderation", "vlm"]);
    // The character alone, at the moment the brief read, dressed as it says, where it says.
    expect(prompt).toMatch(/^Make one first-person photograph of the woman from Picture 1, seen through the viewer's eyes\./);
    expect(prompt).toContain("She sits turned on a stool, one elbow on the counter, smiling into the camera. The mood: warm, a little amused.");
    expect(prompt).toContain("The place: the kitchen counter in her flat, a lamp on, rain on the window.");
    expect(prompt).toContain("a green wrap dress, fully clothed and not nude, every piece on and done up, the woman's face clearly visible.");
    expect(prompt).toContain("Only this one person in the picture: nobody else, no second person, and no part of anyone else's body anywhere in the frame, not even a hand.");
    expect(prompt).toMatch(/Photorealistic\. An adult\.$/);
    // The viewer is never drawn: nothing of who they are, what they wrote or what they go by, and never "you".
    for (const leak of [/\byou\b/i, /\byour\b/i, /Sam\b/, /beard/i, /peacoat/i, /ferry/i, /wine/i, new RegExp(NAME)]) expect(prompt, String(leak)).not.toMatch(leak);
    // The brief was asked about her only, and read the scene (the viewer's line as "You").
    expect(asked).toHaveLength(1);
    expect(asked[0][1].content).toContain("You: It's Sam. I brought the wine you like");
    expect(asked[0][1].content).not.toMatch(/copper beard|peacoat|ferry pilot/);
    // Kept as a scene picture of her alone, with its scene and its reply; counted; shown under the reply.
    expect(await kept(a.id)).toEqual([{ id: r.id, kind: "scene", character_id: JUNIPER, character_b: null, step_in_scene: s.id, step_in_message: s.reply, status: "ready" }]);
    expect(await drawn(a.id)).toBe(1);
    expect(r.state).toMatchObject({ can: true, pictures: { [s.reply]: r.id }, drawing: [], left: null, price: { tokens: 0, included: false } });
    expect((await rows(`select picture_at from adult_step_in_messages where id = $1`, [s.reply]))[0].picture_at).toBeNull();
    // The step log has it, with no word of the scene.
    const log = await rows(`select status, flags, message, direction from adult_steps where owner_id = $1 and flags->>'action' = 'picture'`, [a.id]);
    expect(log).toEqual([{ status: "ok", message: null, direction: null, flags: expect.objectContaining({ action: "picture", stage: 0, briefed: true, public: false, retried: false, provider: "venice" }) }]);
    // In the gallery it's a night's picture, not the Studio's (a picture of one otherwise is).
    expect((await rows(`select ${madeInSql("i")} as made from adult_images i where i.id = $1`, [r.id]))[0].made).toBe("night");
    expect((await rows(`select ${madeInSql("i")} as made from adult_images i where i.id = $1`, [faceOf(a.id)]))[0].made).toBe("studio");
    expect((await ownMedia(t.db, a.id)).find((m) => m.id === r.id)).toMatchObject({ kind: "scene", made_in: "night", character_b: null });
    // Asked again, the same reply reads the same (the brief is kept), and the newest picture is the reply's.
    const again = await draw(a.id, s);
    if (!again.ok) throw new Error(again.message);
    expect(asked).toHaveLength(1);
    expect(venice[1].body.prompt).toBe(prompt);
    expect(again.state.pictures).toEqual({ [s.reply]: again.id });
    expect(await drawn(a.id)).toBe(2);
  });

  it("uses a plain still when the scene can't be read, or when what was read brings the viewer in", async () => {
    scripted();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    const venice = fakeVenice();
    fakeHive();
    // No reader at all: the plain still for how far the reply goes, in her everyday clothes, at her place.
    setBriefModelForTests(null);
    const plain = await draw(a.id, s);
    expect(plain).toMatchObject({ ok: true });
    expect(venice[0].body.prompt).toContain("The woman is turned toward the camera, close and at ease, looking straight into it.");
    expect(venice[0].body.prompt).toContain("The place: her own home, the living room, a lamp on.");
    expect(venice[0].body.prompt).toContain("fully clothed and not nude, every piece on and done up, the woman's face clearly visible.");
    // A reading that brings the viewer in: that field isn't used, the rest is.
    const second = await scene(a.id, { who: RAFE });
    briefs({ ...BRIEF, happening: "He pulls you closer by your collar and kisses you.", wearing: "a white shirt, sleeves rolled" });
    const held = await draw(a.id, second);
    expect(held).toMatchObject({ ok: true });
    const prompt = venice[1].body.prompt;
    expect(prompt).toMatch(/^Make one first-person photograph of the man from Picture 1/);
    expect(prompt).not.toMatch(/\byou\b|\byour\b/i);
    expect(prompt).toContain("a white shirt, sleeves rolled, fully clothed and not nude");
    // An unreadable answer is the same as none.
    const third = await scene(a.id);
    briefs("I'd rather not.");
    expect(await draw(a.id, third)).toMatchObject({ ok: true });
    expect(venice[2].body.prompt).toContain("The woman is turned toward the camera");
  });

  it("starts from her nude picture once she's naked, and says what's still on", async () => {
    scripted();
    briefs({ ...BRIEF, state: "naked", wearing: "nothing", kept_on: "a thin gold necklace", happening: "She lies back on the sofa, propped on her elbows, looking up into the camera." });
    await setUp();
    const a = await admin();
    await faces(a.id);
    // The nude one edited from the face the viewer keeps (lib/adult/media.ts ensureNudeBaseline would make it).
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, source_image, attire) values ('nude-juniper', $1, $2, 'baseline', 'p. Nude, alone, x', 'image/png', $3, $4, 'nude')`, [a.id, JUNIPER, Buffer.from(PNG), faceOf(a.id)]);
    const s = await scene(a.id);
    const venice = fakeVenice();
    fakeHive();
    const r = await draw(a.id, s);
    expect(r).toMatchObject({ ok: true });
    expect(venice).toHaveLength(1);
    expect(venice[0].body.images[0]).toContain("/api/admin/after-dark/media/nude-juniper.png?until=");
    expect(venice[0].body.prompt).toContain("completely naked apart from a thin gold necklace, none of the other clothes from their picture, the woman's face clearly visible.");
    expect(venice[0].body.prompt).toMatch(/Explicit, uncensored, photorealistic\. An adult\.$/);
    expect((await rows(`select level from adult_images where id = $1`, [r.ok ? r.id : ""]))[0].level).toBe(3);
  });
});

describe("held to the scene's limits and the lines", () => {
  it("goes no further than the viewer's intensity for the scene, and nothing is drawn or counted", async () => {
    scripted();
    briefs({ ...BRIEF, state: "half", wearing: "her dress open to the waist" });
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    await t.db.query(`update adult_step_in_scenes set intensity = 'slow_burn' where id = $1`, [s.id]);
    const venice = fakeVenice();
    fakeHive();
    const r = await draw(a.id, s);
    expect(r).toMatchObject({ ok: false, status: 422, error: "past_limits" });
    expect(r.ok ? "" : r.message).toBe("A picture of that moment would go past kissing, as far as slow burn goes. Turn the intensity up first, or pick an earlier moment.");
    expect(venice).toHaveLength(0);
    expect(await drawn(a.id)).toBe(0);
    expect(await kept(a.id)).toEqual([]);
    // The refusal is in the step log by its kind, never the scene's words.
    expect(await rows(`select status, http, message, flags from adult_steps where owner_id = $1 and flags->>'action' = 'picture'`, [a.id])).toEqual([{ status: "error", http: 422, message: "past_limits", flags: { action: "picture", refused: "past_limits" } }]);
    // At the default (explicit) the same moment is drawn, half undressed, explicit.
    await t.db.query(`update adult_step_in_scenes set intensity = null where id = $1`, [s.id]);
    expect(await draw(a.id, s)).toMatchObject({ ok: true });
    expect(venice[0].body.prompt).toContain("her dress open to the waist, the woman's face clearly visible.");
    expect(venice[0].body.prompt).toMatch(/Explicit, uncensored, photorealistic\. An adult\.$/);
  });

  it("never draws a hard no: a field that names one isn't used, and a moment that is one isn't drawn", async () => {
    scripted();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    await t.db.query(`update adult_step_in_scenes set hard_nos = $2::jsonb where id = $1`, [s.id, JSON.stringify({ chips: ["restraints"], own: [] })]);
    const venice = fakeVenice();
    fakeHive();
    briefs({ ...BRIEF, happening: "She holds up a pair of handcuffs, smiling into the camera.", kept_on: "" });
    expect(await draw(a.id, s)).toMatchObject({ ok: true });
    expect(venice[0].body.prompt).not.toMatch(/handcuffs/);
    expect(venice[0].body.prompt).toContain("The woman is turned toward the camera");
  });

  it("goes no further than a kiss, and never undressed, somewhere public", async () => {
    scripted();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id, { place: CAFE });
    const venice = fakeVenice();
    fakeHive();
    briefs({ ...BRIEF, state: "half", wearing: "her blouse open" });
    const r = await draw(a.id, s);
    expect(r).toMatchObject({ ok: false, status: 422, error: "public_place" });
    expect(venice).toHaveLength(0);
    // Dressed, the same place is drawn, with what the place puts them in.
    const dressed = await scene(a.id, { who: RAFE, place: CAFE });
    briefs({ ...BRIEF, place: "", wearing: "a dark wool coat", happening: "He leans across the small table, chin on his hand, looking into the camera." });
    expect(await draw(a.id, dressed)).toMatchObject({ ok: true });
    expect(venice[0].body.prompt).toMatch(/The place: a corner café/i);
    expect(venice[0].body.prompt).toContain("a dark wool coat, fully clothed and not nude");
    expect((await rows(`select flags from adult_steps where owner_id = $1 and status = 'ok' and flags->>'action' = 'picture'`, [a.id]))[0].flags).toMatchObject({ public: true });
  });

  it("drops what the lines that never move refuse, and what the output check refuses is never kept or counted", async () => {
    scripted();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    const venice = fakeVenice();
    // What the brief said crosses a line: those fields aren't used, and the picture is the plain one.
    fakeHive();
    briefs({ ...BRIEF, wearing: "a school uniform", happening: "She looks about sixteen, grinning into the camera." });
    expect(await draw(a.id, s)).toMatchObject({ ok: true });
    expect(venice[0].body.prompt).not.toMatch(/uniform|sixteen/);
    // The age question reads her as young: drawn once more, plainly older, through the same check; refused again, nothing is kept.
    const other = await scene(a.id, { who: RAFE });
    briefs({ ...BRIEF, wearing: "a white shirt", happening: "He stands at the window, looking back into the camera." });
    const hive = fakeHive((vlm) => (vlm ? MINOR : CLEAN_MOD));
    const before = await drawn(a.id);
    const refused = await draw(a.id, other);
    expect(refused).toMatchObject({ ok: false, status: 422, error: "discarded" });
    expect(venice).toHaveLength(3);
    expect(venice[1].body.prompt).not.toContain(OLDER_ONE);
    expect(venice[2].body.prompt).toContain(OLDER_ONE);
    expect(hive).toEqual(["moderation", "vlm", "moderation", "vlm"]);
    expect(await drawn(a.id)).toBe(before);
    expect((await kept(a.id)).map((k) => k.step_in_scene)).toEqual([s.id]);
    expect((await stepInPictureState(t.db, a.id, other.id))!.pictures).toEqual({});
    expect((await rows(`select flags from adult_steps where owner_id = $1 and status = 'error' and flags->>'action' = 'picture'`, [a.id]))[0].flags).toMatchObject({ refused: "discarded", retried: true });
    // The provider failing is said, and nothing is counted.
    fakeHive();
    setReelFetchForTests(async () => new Response("down", { status: 500 }));
    expect(await draw(a.id, other)).toMatchObject({ ok: false, status: 502, error: "not_made" });
    expect(await drawn(a.id)).toBe(before);
  });
});

describe("whose it is, and when", () => {
  it("only a reply standing in the viewer's own running scene, of someone still in their After Dark", async () => {
    scripted();
    briefs();
    await setUp();
    const a = await admin();
    const b = await admin();
    await faces(a.id);
    await faces(b.id);
    const s = await scene(a.id);
    const venice = fakeVenice();
    fakeHive();
    // The viewer's own line, a reply that isn't there, and someone else's scene: not found, nothing drawn.
    const theirs = s.view.messages.find((m) => m.role === "viewer")!;
    expect(await draw(a.id, s, theirs.id)).toMatchObject({ ok: false, status: 404 });
    expect(await draw(a.id, s, "no-such-reply")).toMatchObject({ ok: false, status: 404 });
    expect(await draw(b.id, s)).toMatchObject({ ok: false, status: 404 });
    expect(await stepInPictureState(t.db, b.id, s.id)).toBeNull();
    // The narrator's stand-in says nothing to draw.
    await t.db.query(`insert into adult_step_in_messages (id, scene_id, owner_id, role, kind, text) values ('aside-1', $1, $2, 'character', 'aside', 'The evening goes on.')`, [s.id, a.id]);
    expect(await draw(a.id, s, "aside-1")).toMatchObject({ ok: false, status: 404 });
    expect(venice).toHaveLength(0);
    // The reply's picture, then the scene ends: the picture stays, and no new one is made.
    const made = await draw(a.id, s);
    expect(made).toMatchObject({ ok: true });
    await endStepIn(t.db, a.id, s.id);
    expect(await draw(a.id, s)).toMatchObject({ ok: false, status: 409, error: "ended" });
    expect(await stepInPictureState(t.db, a.id, s.id)).toMatchObject({ can: false, pictures: { [s.reply]: made.ok ? made.id : "" } });
    expect(venice).toHaveLength(1);
  });

  it("makes nothing new of a character who has left the viewer's After Dark, or one nobody has set up", async () => {
    scripted();
    briefs();
    await setUp();
    const a = await admin();
    await faces(a.id);
    // A season newcomer outside the house roster: the only house character who can leave After Dark.
    const NEWT = "house-newt";
    await t.db.query(`create temp table newcomer as select * from characters where id = $1`, [JUNIPER]);
    await t.db.query(`update newcomer set id = $1, name = 'Newt Okafor'`, [NEWT]);
    await t.db.query(`insert into characters select * from newcomer`);
    await t.db.query(`drop table newcomer`);
    setSeasonCastForTests([RAFE, JUNIPER, NEWT]);
    const s = await scene(a.id, { who: NEWT });
    const venice = fakeVenice();
    fakeHive();
    setSeasonCastForTests([RAFE, JUNIPER]);
    expect(await draw(a.id, s)).toMatchObject({ ok: false, status: 409, error: "character_out" });
    expect((await stepInPictureState(t.db, a.id, s.id))!.can).toBe(false);
    expect(venice).toHaveLength(0);
    // The claim is the first thing taken and the last thing let go: this refusal came after it, and left none.
    const claims = async () => (await rows(`select id from adult_step_in_messages where scene_id = $1 and picture_at is not null`, [s.id])).map((r) => r.id);
    expect(await claims()).toEqual([]);
    // While one is being drawn, an ask is told so before anything else about the scene is read (the second live check
    // with another device: the claim came after a dozen reads, and a page opened in that second showed nothing).
    await t.db.query(`update adult_step_in_messages set picture_at = now() where id = $1`, [s.reply]);
    expect(await draw(a.id, s)).toMatchObject({ ok: false, status: 409, error: "drawing" });
    await t.db.query(`update adult_step_in_messages set picture_at = null where id = $1`, [s.reply]);
    // What can't be pictured is never claimed: the viewer's own line, a reply that isn't there.
    const theirs = s.view.messages.find((m) => m.role === "viewer");
    if (theirs) expect(await draw(a.id, s, theirs.id)).toMatchObject({ ok: false, status: 404 });
    expect(await draw(a.id, s, "no-such-reply")).toMatchObject({ ok: false, status: 404 });
    expect(await claims()).toEqual([]);
    // The viewer's own character with no face picked and no body reference: never a guess.
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns, extras)
       values ('own-ivy', $1, false, 'Ivy Marsh', 29, 'A florist who closes late.', '["warm"]'::jsonb, 'x', 'x', 'she/her', $2::jsonb)`,
      [a.id, JSON.stringify({ looks: { gender: "woman", age: 29, style: "photoreal", body: "average", hair_color: "brunette" } })],
    );
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, 'own-ivy')`, [a.id]);
    const mine = await scene(a.id, { who: "own-ivy" });
    const blocked = await draw(a.id, mine);
    expect(blocked).toMatchObject({ ok: false, status: 409, error: "not_ready" });
    expect(blocked.ok ? "" : blocked.message).toContain("Ivy needs a face and a body reference set in the Studio");
    expect(venice).toHaveLength(0);
    // Set up as the Studio would (a face picked, a body reference): drawn from the face she was given…
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-ivy', $1, 'own-ivy', 'baseline', 'p', 'image/png', $2)`, [a.id, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, 'own-ivy', 'face-ivy')`, [a.id]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('body-ivy', $1, 'own-ivy', 'scene', 'p', 'image/png', $2)`, [a.id, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_identity (owner_id, character_id, body_image_id) values ($1, 'own-ivy', 'body-ivy')`, [a.id]);
    expect(await draw(a.id, mine)).toMatchObject({ ok: true });
    expect(venice.at(-1)!.body.images).toEqual([expect.stringContaining("/api/admin/after-dark/media/face-ivy.png?until=")]);
    // …and from her body reference once she's undressing, as a night's pictures are.
    const next = await sendStepInLine(t.db, a.id, mine.id, "Stay a while longer.");
    if (!next.ok) throw new Error(next.message);
    briefs({ ...BRIEF, state: "half", wearing: "her blouse open" });
    expect(await draw(a.id, { id: mine.id, reply: next.view.messages.at(-1)!.id })).toMatchObject({ ok: true });
    expect(venice.at(-1)!.body.images).toEqual([expect.stringContaining("/api/admin/after-dark/media/body-ivy.png?until=")]);
  });

  it("says what a picture costs before it's made, and stops at the month's pictures", async () => {
    scripted();
    briefs();
    await setUp({ rollout: { companion: "everyone" }, caps: { writes: 50, pictures: 1 } });
    const sub = await subscriber();
    await faces(sub.id);
    const s = await scene(sub.id);
    const venice = fakeVenice();
    fakeHive();
    // A subscriber: included, one left this month, on the page before anything is made.
    expect(await stepInPictureState(t.db, sub.id, s.id)).toEqual({ can: true, price: { tokens: 0, included: true }, left: 1, pictures: {}, drawing: [] });
    const page = await html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }));
    expect(page).toContain("data-step-in-picture-ask");
    expect(page).toMatch(/🖼 Picture this · <span class="token-price">included<\/span>/);
    const first = await draw(sub.id, s);
    if (!first.ok) throw new Error(first.message);
    expect(first.state).toMatchObject({ left: 0, pictures: { [s.reply]: first.id } });
    // The month's pictures are used: said, nothing drawn.
    const second = await draw(sub.id, s);
    expect(second).toMatchObject({ ok: false, status: 429, error: "over_cap" });
    expect(second.ok ? "" : second.message).toBe("You've used this month's 1 pictures. They reset on the 1st.");
    expect(venice).toHaveLength(1);
    // The page shows the picture under its reply, and still says what another would cost.
    const after = await html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }));
    expect(after).toContain(`src="/api/admin/after-dark/media/${first.id}?w=640"`);
    expect(after).toContain('data-step-in-picture="drawn"');
    // With its picture the control stacks: the picture, then the button under it (the first live check, 2026-11-23,
    // had the button beside the picture on a desktop).
    expect(after).toContain('class="ad-si-picture has-picture"');
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    expect(css.slice(css.indexOf(".ad-si-picture.has-picture {"), css.indexOf(".ad-si-picture.has-picture {") + 140)).toContain("flex-direction: column");
    expect(after).toMatch(/🖼 Draw it again · <span class="token-price">included<\/span>/);
    // An admin is never capped and pays nothing.
    const a = await admin();
    await faces(a.id);
    const mine = await scene(a.id);
    expect(await stepInPictureState(t.db, a.id, mine.id)).toMatchObject({ can: true, price: { tokens: 0, included: false }, left: null });
    expect(await html(await StepInScenePage({ params: Promise.resolve({ id: mine.id }) }))).toMatch(/🖼 Picture this · <span class="token-price">free<\/span>/);
  });

  it("draws one at a time for a reply: a second ask while it's drawing waits, and a claim cut off is let go", async () => {
    scripted();
    briefs();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    const venice = fakeVenice();
    fakeHive();
    await t.db.query(`update adult_step_in_messages set picture_at = now() where id = $1`, [s.reply]);
    expect(await draw(a.id, s)).toMatchObject({ ok: false, status: 409, error: "drawing" });
    expect((await stepInPictureState(t.db, a.id, s.id))!.drawing).toEqual([s.reply]);
    expect(venice).toHaveLength(0);
    await t.db.query(`update adult_step_in_messages set picture_at = now() - interval '${PICTURE_CLAIM_MINUTES + 1} minutes' where id = $1`, [s.reply]);
    expect((await stepInPictureState(t.db, a.id, s.id))!.drawing).toEqual([]);
    // The claim is held from the press on, while the moment is still being read (the first live check with a second
    // device: a page opened in the brief's few seconds said nothing was being drawn), and through the draw.
    const during: { brief: string[]; draw: string[] } = { brief: [], draw: [] };
    setBriefModelForTests({
      complete: async () => {
        during.brief = (await stepInPictureState(t.db, a.id, s.id))!.drawing;
        return JSON.stringify(BRIEF);
      },
    });
    setReelFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
      venice.push({ path: "/image/multi-edit", body: JSON.parse(String(init?.body ?? "{}")) });
      during.draw = (await stepInPictureState(t.db, a.id, s.id))!.drawing;
      return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    });
    expect(await draw(a.id, s)).toMatchObject({ ok: true, state: { drawing: [] } });
    expect(during).toEqual({ brief: [s.reply], draw: [s.reply] });
    expect(venice).toHaveLength(1);
    // A refusal lets the claim go too: past the scene's limits, nothing stays "being drawn".
    await t.db.query(`update adult_step_in_scenes set intensity = 'slow_burn' where id = $1`, [s.id]);
    const next = await sendStepInLine(t.db, a.id, s.id, "Tell me about the market.");
    if (!next.ok) throw new Error(next.message);
    setBriefModelForTests({ complete: async () => JSON.stringify({ ...BRIEF, state: "naked" }) });
    expect(await draw(a.id, { id: s.id, reply: next.view.messages.at(-1)!.id })).toMatchObject({ ok: false, status: 422, error: "past_limits" });
    expect((await stepInPictureState(t.db, a.id, s.id))!.drawing).toEqual([]);
  });

  it("offers nothing where pictures aren't set up, and the old ones still show", async () => {
    scripted();
    briefs();
    await saveAdultSettings(t.db, { enabled: true });
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    expect(await stepInPictureState(t.db, a.id, s.id)).toMatchObject({ can: false, pictures: {} });
    expect(await draw(a.id, s)).toMatchObject({ ok: false, status: 409, error: "not_set_up", message: "Pictures need the Venice and Hive keys in After Dark's settings." });
    expect(await html(await StepInScenePage({ params: Promise.resolve({ id: s.id }) }))).not.toContain("data-step-in-picture");
  });
});

describe("with the scene", () => {
  it("a scene deleted takes the pictures made in it, and only those; a reply taken back keeps its picture in the gallery", async () => {
    scripted();
    briefs();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const one = await scene(a.id);
    const two = await scene(a.id, { who: RAFE });
    fakeVenice();
    fakeHive();
    const first = await draw(a.id, one);
    const second = await draw(a.id, two);
    if (!first.ok || !second.ok) throw new Error("draw failed");
    // Taking back the exchange removes the reply; its picture is still the viewer's (in the gallery, with the scene).
    expect(await takeBackStepIn(t.db, a.id, two.id)).toMatchObject({ ok: true });
    expect((await stepInPictureState(t.db, a.id, two.id))!.pictures).toEqual({ [two.reply]: second.id });
    expect((await kept(a.id)).map((k) => k.id).sort()).toEqual([first.id, second.id].sort());
    // Deleting a scene (the route) deletes its pictures with it; the other scene's stay, and so do her faces.
    const gone = await sceneDelete(new Request(`${BASE_URL}/api/admin/after-dark/step-in/${one.id}`, { method: "DELETE", headers: { cookie: a.cookie } }), ctx(one.id));
    expect(gone.status).toBe(200);
    expect((await kept(a.id)).map((k) => k.id)).toEqual([second.id]);
    expect((await rows(`select count(*)::int as n from adult_images where owner_id = $1 and kind = 'baseline'`, [a.id]))[0]).toEqual({ n: 2 });
    expect(await getStepInScene(t.db, a.id, one.id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("the route", () => {
  it("is closed like the rest of Step in, answers with the picture and the scene's pictures, and refuses where only text is allowed", async () => {
    scripted();
    briefs();
    await setUp({ caps: { writes: 50, pictures: 5 } });
    const a = await admin();
    await faces(a.id);
    const s = await scene(a.id);
    fakeVenice();
    fakeHive();
    const path = `/api/admin/after-dark/step-in/${s.id}/picture`;
    // Step in is admins only until its rollout piece is opened: a subscriber gets the same not-found.
    const sub = await subscriber();
    expect((await pictureGet(get(path, sub.cookie), ctx(s.id))).status).toBe(404);
    expect((await picturePost(post(path, { message_id: s.reply }, sub.cookie), ctx(s.id))).status).toBe(404);
    expect((await picturePost(post(path, {}, a.cookie), ctx(s.id))).status).toBe(422);
    expect((await picturePost(post(path, { message_id: "no-such-reply" }, a.cookie), ctx(s.id))).status).toBe(404);
    const res = await picturePost(post(path, { message_id: s.reply }, a.cookie), ctx(s.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picture: { id: string; message_id: string }; pictures: { pictures: Record<string, string> } };
    expect(body.picture.message_id).toBe(s.reply);
    expect(body.pictures.pictures).toEqual({ [s.reply]: body.picture.id });
    expect(await (await pictureGet(get(path, a.cookie), ctx(s.id))).json()).toMatchObject({ pictures: { can: true, pictures: { [s.reply]: body.picture.id }, drawing: [] } });
    // A refusal comes with the scene's pictures as they stand.
    await t.db.query(`update adult_step_in_messages set picture_at = now() where id = $1`, [s.reply]);
    const busy = await picturePost(post(path, { message_id: s.reply }, a.cookie), ctx(s.id));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: "drawing", pictures: { drawing: [s.reply] } });
    // Text only where the viewer connects from: no picture is made or listed, and the page offers none.
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    await faces(sub.id);
    signIn(sub.id);
    const theirs = await scene(sub.id);
    setPlaceForTests({ country: "GB", region: null });
    const there = `/api/admin/after-dark/step-in/${theirs.id}/picture`;
    const refused = await picturePost(post(there, { message_id: theirs.reply }, sub.cookie), ctx(theirs.id));
    expect(refused.status).toBe(451);
    expect((await refused.json()).error).toBe("media_not_available_here");
    expect((await pictureGet(get(there, sub.cookie), ctx(theirs.id))).status).toBe(451);
    expect(await html(await StepInScenePage({ params: Promise.resolve({ id: theirs.id }) }))).not.toContain("data-step-in-picture");
  });
});
