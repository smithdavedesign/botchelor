// Step in, After Dark (lib/adult/step-in.ts; docs/after-dark.md "Step in"): the viewer in the scene with one character,
// told as prose. Closed behind the "companion" rollout piece; every check on what the viewer sends and on what the
// character says; the AI notice; the month's steps; draws, Continue, take back, End; and what goes with the account.
// The fixtures are mild lines (a glass set down, a hand held) plus the short phrases the checks must refuse.
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
import AfterDarkHome from "@/app/after-dark/page";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import { DELETE as sceneDelete, GET as sceneGet, POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { GET as setupGet, POST as setupPost } from "@/app/api/admin/after-dark/step-in/route";
import { deleteAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { exportAdultProfile } from "@/lib/adult/profile-data";
import { hasProfileConsent } from "@/lib/adult/profile";
import { ROLEPLAYS, roleplayById } from "@/lib/adult/roleplays";
import { rolloutConfigOf, rolloutOn } from "@/lib/adult/rollout";
import { saveAdultSettings } from "@/lib/adult/settings";
import {
  ASIDES,
  carryOnStepIn,
  checkReply,
  continueStepIn,
  endStepIn,
  getStepInScene,
  lineLimitRefusal,
  moveStepIn,
  noticeDue,
  regenerateStepIn,
  saveStepInLimits,
  sendStepInLine,
  setStepInRandomForTests,
  startStepIn,
  STEP_IN_TAGLINE,
  stepInCast,
  stepInFollowUp,
  stepInNotice,
  stepInPlaces,
  swipeStepIn,
  takeBackStepIn,
  type StepInSceneView,
} from "@/lib/adult/step-in";
import { STEP_IN_NEVER_SAID, stepInNever, stepInNeverIn } from "@/lib/adult/step-in-lines";
import {
  CONTINUE_CUE,
  STEP_IN_HONESTY,
  STEP_IN_KEEP_OUT,
  STEP_IN_LINES,
  STEP_IN_NEVER_WRITE,
  STEP_IN_PACE,
  STEP_IN_PARAGRAPHS,
  STEP_IN_RATING,
  STEP_IN_ALWAYS_YOU,
  STEP_IN_ROLEPLAY_RULE,
  STEP_IN_TELLS,
  STEP_IN_WILL,
  stepInCraft,
  stepInMessages,
  stepInPublicRule,
} from "@/lib/adult/step-in-prompt";
import { NO_LIMITS, type PairLimits } from "@/lib/adult/limits";
import { sceneCharacter } from "@/lib/adult/voice";
import { crisisIntent } from "@/lib/crisis";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { NEVER_WRITE_THE_PERSON, SCENE_DRIVE_RULE, speaksForThePerson, STORY_MODE_ANSWER } from "@/lib/narration";
import { setPersona } from "@/lib/persona";
import { premiseForYou } from "@/lib/roleplays";
import { CUTOUT_OPTIONS, setCutoutsForTests } from "@/lib/cutout";
import { checkAdultText } from "@/lib/safety";
import { adultCardTextIssue, CARD_EXPLICIT, cardForYou, cardTexts, GENERIC_OPENINGS } from "@/lib/scene-cards";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { maybeCrisis } from "@/lib/step-in";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

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
  setCutoutsForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
/** A public place (a kiss at most there) and a private one, both from After Dark's scene catalog. */
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
/** Someone After Dark opens for who isn't an admin: an active subscription and a passed age check. */
async function subscriber() {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signIn(id) };
}
const open = () => saveAdultSettings(t.db, { rollout: { companion: "everyone" } });

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const story = (...paragraphs: string[]) => ({ story: paragraphs });
/** Mild replies, each different (a reply mustn't say an earlier one again). */
const FINE = [
  story('She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."),
  story('She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."', "The waiter hovered, decided against it, and went back to polishing a glass that was already clean."),
  story('"Tell me the worst part of your week," she said, and reached over to take her hand back from the cold glass.', "Somewhere behind the bar a radio found a song from ten summers ago and kept it low."),
  story('She laughed, short and surprised. "That is not how that story ends and we both know it."', "The candle between the plates had burned down to a stub, and nobody had come to change it."),
  story('"Walk with me," she said, already reaching for her coat. "The rain has stopped pretending."', "The street outside was all reflections, and the bus shelter across the road hummed under its one light."),
  story('She held the door with her shoulder. "After you. I want to see which way you turn."', "The night air smelled of wet pavement and somebody else\'s dinner."),
];
/**
 * The scripted model: each reply's prompt is kept, the notes call answers with a recap and a line, and the self-harm
 * maybes answer "no risk". `replies` are used in order, the last one again after that.
 */
function scripted(...replies: unknown[]) {
  const seen = { prompts: [] as ChatMessage[][], notes: [] as ChatMessage[][] };
  let i = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) {
        seen.notes.push(m);
        return JSON.stringify({ recap: "They met at the cafe and talked until the rain stopped.", line: "An evening of talk at the cafe that ran long past closing." });
      }
      seen.prompts.push(m);
      const r = replies.length ? replies[Math.min(i++, replies.length - 1)] : FINE[Math.min(i++, FINE.length - 1)];
      if (r instanceof Error) throw r;
      return typeof r === "string" ? r : JSON.stringify(r);
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*)::int as n from ${table}`))[0].n);
const writes = async (id: string) => Number((await rows(`select writes from adult_usage where owner_id = $1`, [id]))[0]?.writes ?? 0);
const steps = async (id: string) => rows(`select status, http, message, direction, dropped, flags, added, character_b, kind from adult_steps where owner_id = $1 order by created_at`, [id]);
/** Everything a scene keeps, as one string: what a test searches for words that must never have been stored. */
const everything = async () => JSON.stringify([await rows(`select * from adult_step_in_scenes`), await rows(`select * from adult_step_in_messages`), await rows(`select * from adult_steps`)]);
const said = (view: StepInSceneView) => view.messages.filter((m) => m.role !== "system").map((m) => `${m.role}${m.kind ? `:${m.kind}` : ""}`);

async function start(viewer: string, extra: Partial<Parameters<typeof startStepIn>[2]> = {}, now = new Date()) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place: HOME, ...extra }, now);
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
const system = (m: ChatMessage[]) => m[0].content;
const lastUser = (m: ChatMessage[]) => m[m.length - 1].content;

const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie: string) => new Request(`${BASE_URL}${path}`, { headers: { cookie } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const digest = async (p: Promise<unknown>) => {
  try {
    await p;
    return "rendered";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
};
const html = async (el: ReactElement) => new Response((await prerender(el)).prelude).text();

describe("closed by default", () => {
  it("the switch starts on admins only", () => {
    expect(rolloutConfigOf(null).companion).toBe("admins");
    expect(rolloutOn(rolloutConfigOf(null), "companion", false)).toBe(false);
    expect(rolloutOn(rolloutConfigOf(null), "companion", true)).toBe(true);
  });

  it("every route is not found for a subscriber while it's on admins, open to an admin, and open to a subscriber only once it's switched to everyone", async () => {
    scripted();
    // The settings row exists (so a subscriber's month has its steps), the switch as it ships.
    await saveAdultSettings(t.db, {});
    const sub = await subscriber();
    const body = { character_id: WHO, place: HOME };
    expect((await setupGet(get("/api/admin/after-dark/step-in", sub.cookie))).status).toBe(404);
    expect((await setupPost(post("/api/admin/after-dark/step-in", body, sub.cookie))).status).toBe(404);
    expect(await count("adult_step_in_scenes")).toBe(0);

    const a = await admin();
    const made = await setupPost(post("/api/admin/after-dark/step-in", body, a.cookie));
    expect(made.status).toBe(200);
    const { id, scene } = (await made.json()) as { id: string; scene: StepInSceneView };
    expect(scene.character.id).toBe(WHO);
    expect((await sceneGet(get(`/api/admin/after-dark/step-in/${id}`, a.cookie), ctx(id))).status).toBe(200);
    // Someone else's scene, a subscriber's own cookie, a stranger: all the same not-found.
    for (const cookie of [sub.cookie, signedInCookie(randomUUID()).split(";")[0]]) {
      expect((await sceneGet(get(`/api/admin/after-dark/step-in/${id}`, cookie), ctx(id))).status).toBe(404);
      expect((await scenePost(post(`/api/admin/after-dark/step-in/${id}`, { action: "send", text: "Hello." }, cookie), ctx(id))).status).toBe(404);
      expect((await sceneDelete(new Request(`${BASE_URL}/api/admin/after-dark/step-in/${id}`, { method: "DELETE", headers: { cookie } }), ctx(id))).status).toBe(404);
    }

    await open();
    const theirs = await setupPost(post("/api/admin/after-dark/step-in", body, sub.cookie));
    expect(theirs.status).toBe(200);
    const mine = ((await theirs.json()) as { id: string }).id;
    expect((await scenePost(post(`/api/admin/after-dark/step-in/${mine}`, { action: "send", text: "Hello." }, sub.cookie), ctx(mine))).status).toBe(200);
    // Open to everyone After Dark opens for, and to nobody else: a signed-in stranger still gets not found.
    expect((await setupGet(get("/api/admin/after-dark/step-in", signedInCookie(randomUUID()).split(";")[0]))).status).toBe(404);
    // And never another viewer's scene.
    expect((await sceneGet(get(`/api/admin/after-dark/step-in/${id}`, sub.cookie), ctx(id))).status).toBe(404);
  });

  it("the pages are not found for anyone it's closed to; the hub's tile and the picker's row show only where it's open", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const sub = await subscriber();
    expect(await digest(StepInSetupPage())).toMatch(/404/);
    const hubClosed = await html(await AfterDarkHome({ searchParams: Promise.resolve({}) }));
    expect(hubClosed).not.toContain("data-step-in-tile");
    expect(hubClosed).not.toContain("/after-dark/step-in");

    const a = await admin();
    const setup = await html(await StepInSetupPage());
    expect(setup).toContain(STEP_IN_TAGLINE);
    expect(setup).toContain("data-step-in-setup");
    const hub = await html(await AfterDarkHome({ searchParams: Promise.resolve({}) }));
    expect(hub).toContain("data-step-in-tile");
    expect(hub).toContain("data-step-in-row");
    const made = await start(a.id);
    const page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain(STEP_IN_TAGLINE);
    expect(page).toContain("You made it");
    // The scene page is its viewer's alone, and closed like the rest.
    signIn(sub.id);
    expect(await digest(StepInScenePage({ params: Promise.resolve({ id: made.id }) }))).toMatch(/404/);
    await open();
    expect(await digest(StepInScenePage({ params: Promise.resolve({ id: made.id }) }))).toMatch(/404/);
    expect(await html(await StepInSetupPage())).toContain("data-step-in-setup");
    expect(await html(await AfterDarkHome({ searchParams: Promise.resolve({}) }))).toContain("data-step-in-tile");
  });

  it("the character stands beside the scene: the portrait as it is until the zone makes cutouts, then the cutout; nobody without a portrait", async () => {
    scripted();
    await saveAdultSettings(t.db, {});
    const a = await admin();
    const made = await start(a.id);
    // No approved portrait: no figure, no picture switch.
    let page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).not.toContain("character-figure");
    expect(page).not.toContain("data-step-in-figure-toggle");
    expect(page).toContain("page-full");

    await t.db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating) values ($1, $2, 'portrait', 'generated', 'm', $3, 'approved', 'pg')`,
      [`asset-${WHO}`, WHO, "/cast/house-juniper-v3.webp"],
    );
    page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain('data-figure="portrait"');
    expect(page).toContain(`src="/api/assets/asset-${WHO}"`);
    expect(page).not.toContain("/cdn-cgi/image/");
    expect(page).toContain("data-step-in-figure-toggle");

    vi.stubEnv("SITE_URL", "https://botchelor.com");
    setCutoutsForTests(true);
    page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain('data-figure="cutout"');
    expect(page).toContain(`https://botchelor.com/cdn-cgi/image/${CUTOUT_OPTIONS}/api/assets/asset-${WHO}`);
    // The show's own PG portrait: discreet mode's blur leaves it alone (.avatar).
    expect(page).toMatch(/class="avatar character-figure-img"/);
  });
});

describe("setting it up", () => {
  it("offers who a pair could be, the catalog's places (no double date, no typed-in sets), and marks the public ones", async () => {
    const a = await admin();
    expect((await stepInCast(t.db, a.id)).map((c) => c.id).sort()).toEqual([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort());
    const places = stepInPlaces(["somewhere someone typed in"]);
    expect(places.find((p) => p.id === "venue:double_date")).toBeUndefined();
    expect(places.some((p) => p.id.startsWith("set:"))).toBe(false);
    expect(places.find((p) => p.id === CAFE)).toMatchObject({ public: true });
    expect(places.find((p) => p.id === HOME)).toMatchObject({ public: false, title: "Their place" });
    // Every place's words pass After Dark's lines, as the catalog's own test holds them.
    for (const p of places) expect(checkAdultText({ title: p.title, place: p.place }).ok, p.id).toBe(true);
  });

  it("refuses a character who isn't in the viewer's After Dark, an unknown place or roleplay, and makes nothing", async () => {
    scripted();
    const a = await admin();
    // Someone else's character, never switched in.
    const theirs = (await (await api.createCharacter(validCharacter({ name: "Not Yours" }), `bz_uid=${randomUUID()}`)).json()) as { id: string };
    expect(await startStepIn(t.db, a.id, { character_id: theirs.id, place: HOME })).toMatchObject({ ok: false, status: 404 });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: "venue:double_date" })).toMatchObject({ ok: false, status: 422, error: "invalid_place" });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: "set:somewhere" })).toMatchObject({ ok: false, status: 422 });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, roleplay: { id: "stepmom" } })).toMatchObject({ ok: false, status: 422, error: "invalid_roleplay" });
    expect(await count("adult_step_in_scenes")).toBe(0);
    expect(await count("adult_step_in_messages")).toBe(0);
  });

  it("refuses a written opening that crosses a line or isn't a sentence of story, and stores nothing of it", async () => {
    const seen = scripted();
    const a = await admin();
    const crossing = "Pretend you are my stepsister tonight.";
    expect(checkAdultText({ opening: crossing }).ok).toBe(false);
    const r1 = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: crossing } });
    expect(r1).toMatchObject({ ok: false, status: 422, error: "opening_not_allowed" });
    expect((r1 as { message: string }).message).toBe("That opening crosses one of the lines that never move (no family or step-family roleplay).");
    // Step in's own net (lib/adult/step-in-lines.ts): what After Dark's check lets through because nobody is roleplaying it.
    const saying = "She is a little drunk when I get there.";
    expect(checkAdultText({ opening: saying }).ok).toBe(true);
    const r2 = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: saying } });
    expect(r2).toMatchObject({ ok: false, status: 422, error: "opening_not_allowed" });
    expect((r2 as { message: string }).message).toBe('That opening crosses one of the lines that never move (both always willing: nobody drunk, held, or kept from saying no or leaving: it was the word "drunk").');
    // The roleplay theme check (lib/scene-cards.ts adultCardTextIssue): its never-list, and nothing explicit in an opening.
    for (const text of ["She is asleep on the sofa when I get there.", "We get naked the moment the door shuts."]) {
      expect(checkAdultText({ opening: text }).ok).toBe(true);
      expect(stepInNever(text)).toBeNull();
      expect(adultCardTextIssue(text)).not.toBeNull();
      expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: text } })).toMatchObject({ ok: false, status: 422, error: "opening_not_allowed" });
    }
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: "x".repeat(200) } })).toMatchObject({ ok: false, status: 422, error: "invalid_opening" });
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: "{a} waits by the door." } })).toMatchObject({ ok: false, status: 422, error: "invalid_opening" });
    // No scene, no message, no model call; the refusals are counted in the step log without a word of what was written.
    expect(await count("adult_step_in_scenes")).toBe(0);
    expect(await count("adult_step_in_messages")).toBe(0);
    expect(seen.prompts).toHaveLength(0);
    const log = await steps(a.id);
    expect(log).toHaveLength(4);
    expect(log.every((s) => s.kind === "step_in" && s.status === "error" && s.http === 422 && s.direction === null && s.character_b === "viewer")).toBe(true);
    expect(log.map((s) => (s.flags as { refused: string }).refused)).toEqual(["lines", "lines", "opening", "opening"]);
    // The log keeps the line that was crossed, never the word that crossed it.
    expect(log[1].message).toBe("That opening crosses one of the lines that never move (both always willing: nobody drunk, held, or kept from saying no or leaving).");
    // (The refusals' own sentences name the lines, so the search is for what was written, not for a line's name.)
    const all = await everything();
    for (const words of ["stepsister", "a little", "when I get there", "asleep", "sofa", "naked", "door shuts"]) expect(all).not.toContain(words);
  });

  it("a written opening that says they want to hurt themselves answers with the resources and starts nothing", async () => {
    scripted();
    const a = await admin();
    const r = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME, opening: { written: "I want to kill myself tonight." } });
    expect(r).toMatchObject({ ok: false, status: 200, error: "crisis" });
    expect((r as { crisis_resources?: { lines: unknown[] } }).crisis_resources?.lines.length).toBeGreaterThan(0);
    expect(await count("adult_step_in_scenes")).toBe(0);
    expect(await rows(`select surface, n from crisis_referrals`)).toEqual([{ surface: "after_dark_step_in", n: 1 }]);
    // Counted by day and surface only: nothing in the step log, which is keyed to the viewer.
    expect(await steps(a.id)).toHaveLength(0);
  });

  it("starts with the AI notice, then the character's opening; a written opening that passes is kept and played", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id, { place: CAFE, opening: { written: "I am halfway through a crossword when she sits down." } });
    expect(made.view.messages.map((m) => [m.role, m.kind])).toEqual([["system", "notice"], ["character", null]]);
    expect(made.view.messages[0].text).toBe(stepInNotice(HOUSE_CHARACTERS[0].name));
    expect(made.view.messages[0].text).toBe(`${NAME} is an AI character, not a real person. This is fiction between adults.`);
    expect(made.view.place).toMatchObject({ id: CAFE, public: true });
    expect(lastUser(seen.prompts[0])).toContain('It opens like this: (as your scene partner wrote it, so "I" and "me" in it are them) "I am halfway through a crossword when she sits down."');
    expect(await writes(a.id)).toBe(1);
    // Their own opening is shown as their first line (the first reply answers it); one of ours sets the scene unseen.
    expect(made.view.opening).toBe("I am halfway through a crossword when she sits down.");
    const b = await admin();
    expect((await start(b.id, { place: CAFE, opening: 0 })).view.opening).toBeNull();
  });
});

describe("the prompt", () => {
  const persona = { name: "Sam", look: "tall, a green scarf", about: "restores old clocks" };
  async function prompt(extra: Partial<Parameters<typeof stepInMessages>[0]> = {}) {
    const character = (await sceneCharacter(t.db, WHO))!;
    return stepInMessages({ character, place: { label: "Their place", situation: null, public: false }, roleplay: null, persona: null, limits: NO_LIMITS, turns: [], ...extra });
  }

  it("carries the character's own will and consent, never writing the viewer, the drive rule, the pace, the rating, the lines and honesty, every time", async () => {
    const m = await prompt({ turns: [{ role: "viewer", text: "I pull out the chair across from you." }] });
    const s = system(m);
    for (const paragraph of [STEP_IN_WILL, STEP_IN_NEVER_WRITE, NEVER_WRITE_THE_PERSON, SCENE_DRIVE_RULE, STEP_IN_PACE, STEP_IN_RATING, STEP_IN_LINES, STEP_IN_KEEP_OUT, STEP_IN_HONESTY, STEP_IN_PARAGRAPHS, STORY_MODE_ANSWER]) {
      expect(s).toContain(paragraph);
    }
    // The words the brief asks for, in the paragraphs themselves.
    expect(STEP_IN_WILL).toContain("You have your own will");
    expect(STEP_IN_WILL).toContain("Attraction and consent are mutual and said out loud");
    expect(STEP_IN_WILL).toContain('say "not yet"');
    expect(STEP_IN_WILL).toContain("either of you can stop at any time");
    // A no to a move keeps the two of them in the scene (the first Step in test ended the night over one grab).
    expect(STEP_IN_WILL).toContain("say no to that, plainly and once");
    expect(STEP_IN_WILL).toContain("end the evening over it");
    expect(STEP_IN_LINES).toContain("with the two of you still in it");
    expect(STEP_IN_NEVER_WRITE).toContain('Nothing "you" did, said, thought or felt goes in beyond what they actually sent');
    expect(STEP_IN_NEVER_WRITE).toContain("you never describe what they do, how anything feels to them, what they want or that they agree");
    expect(STEP_IN_PACE).toContain("never jump ahead of what they wrote");
    expect(STEP_IN_HONESTY).toContain("you are an AI character and that this is fiction");
    expect(STEP_IN_HONESTY).toContain("Never suggest meeting, never claim a body or a life outside this scene");
    // Story mode's craft as it is, with Step in's length in place of its own (and only one count line).
    const craft = stepInCraft(HOUSE_CHARACTERS[0].name, "she/her");
    expect(craft).toContain(STEP_IN_PARAGRAPHS);
    expect(craft.filter((rule) => /short paragraphs/.test(rule))).toHaveLength(1);
    expect(craft.some((rule) => rule.includes("Third person and past tense for yourself"))).toBe(true);
    expect(craft.some((rule) => rule.includes('the person you\'re with is always "you"'))).toBe(true);
    expect(craft).toContain(STEP_IN_ALWAYS_YOU);
    expect(craft.some((rule) => rule.includes("goes in double quotes"))).toBe(true);
    // The viewer's line is the turn it answers; the sheet is the character's.
    expect(lastUser(m)).toBe("I pull out the chair across from you.");
    expect(s).toContain(`You are ${HOUSE_CHARACTERS[0].name}, ${HOUSE_CHARACTERS[0].age}`);
    expect(s).toContain("don't guess a name, a look or a gender for them");
    // Nothing explicit is written into the prompt: how frank a scene gets is the viewer's lead, never the prompt's. (The
    // roleplay rule and the lines name what they rule out, in the words After Dark's own rules already use.)
    for (const paragraph of [STEP_IN_WILL, STEP_IN_NEVER_WRITE, STEP_IN_PACE, STEP_IN_HONESTY, STEP_IN_RATING, STEP_IN_PARAGRAPHS, CONTINUE_CUE, stepInPublicRule("The corner cafe")]) {
      expect(CARD_EXPLICIT.exec(paragraph)?.[0] ?? null, paragraph.slice(0, 40)).toBeNull();
    }
    expect(CARD_EXPLICIT.exec(STEP_IN_ROLEPLAY_RULE.replace("not a way into sex", ""))?.[0] ?? null).toBeNull();
    expect(CARD_EXPLICIT.exec(STEP_IN_LINES.replace("no sexual violence", ""))?.[0] ?? null).toBeNull();
  });

  it("says a character's tells are moods and not a voice, under a sheet that has any", async () => {
    const character = (await sceneCharacter(t.db, WHO))!;
    const nervous = system(await prompt({ character: { ...character, extras: { ...character.extras, tells: { nervous: "rates everything out of ten, faster" } } } }));
    expect(nervous).toContain("rates everything out of ten, faster");
    expect(nervous).toContain(STEP_IN_TELLS);
    expect(system(await prompt({ character: { ...character, extras: { ...character.extras, tells: undefined } } }))).not.toContain(STEP_IN_TELLS);
  });

  it("says the roleplay is the story, from the character's side: its premise, who plays whom, and only its own want", async () => {
    const rp = roleplayById("boss")!;
    const s = system(await prompt({ roleplay: { rp, you: 1 } }));
    expect(s).toContain(STEP_IN_ROLEPLAY_RULE);
    expect(STEP_IN_ROLEPLAY_RULE).toContain("The roleplay is the story, not a way into sex");
    expect(s).toContain("Tonight's scene is a roleplay the two of you chose: Boss and employee, after hours.");
    expect(s).toContain(`${NAME} runs the team and your scene partner is on it.`);
    expect(s).toContain("You play the boss; they play the employee.");
    // The card: how it starts and where it can go from the character's side, and the character's want alone.
    expect(s).toContain(`What you want in it: ${NAME} wants to be sure your scene partner feels free to walk out at any point`);
    expect(s).not.toContain("wants to be met as an equal for one evening");
    expect(s).not.toMatch(/\{[ab]\}/);
    // The other way round, the viewer runs the team.
    const swapped = system(await prompt({ roleplay: { rp, you: 0 } }));
    expect(swapped).toContain(`Your scene partner runs the team and ${NAME} is on it.`);
    expect(swapped).toContain("You play the employee; they play the boss.");
    expect(system(await prompt())).not.toContain("roleplay the two of you chose");
  });

  it("says the public-place rule only where they're in public, the intensity as a ceiling, and the viewer's hard nos", async () => {
    const pub = system(await prompt({ place: { label: "The corner cafe", situation: "a small corner cafe", public: true } }));
    expect(pub).toContain(stepInPublicRule("The corner cafe"));
    expect(pub).toContain("You can flirt, touch discreetly and, at most, kiss.");
    expect(system(await prompt())).not.toContain("You are out in public");
    const slow: PairLimits = { intensity: "slow_burn", hard_nos: { chips: ["spitting"], own: ["tickling"] } };
    const s = system(await prompt({ limits: slow }));
    expect(s).toContain("Their intensity setting for this scene is Slow burn (looks, nerves and a kiss at most). It is a ceiling, never a target: the scene goes no further than kissing, whatever is asked, and it gets there only if they take it there.");
    expect(s).toContain("it goes no further than kissing.");
    expect(s).toContain("Hard limits they have set for this scene.");
    expect(s).toContain("- No spitting.");
    expect(s).toContain("- Never: tickling.");
    const frank = system(await prompt());
    expect(frank).toContain("Their intensity setting for this scene is Explicit");
    expect(frank).toContain("written as frankly as they write it and no franker");
    expect(frank).not.toContain("Hard limits they have set");
  });

  it("describes the viewer from their persona, as make-believe that's theirs to play", async () => {
    const s = system(await prompt({ persona }));
    expect(s).toContain('they go by "Sam"');
    expect(s).toContain('how they look: "tall, a green scarf"');
    expect(s).toContain('who they are: "restores old clocks"');
    expect(s).toContain("It is theirs to play: you never say what they do, think or feel.");
    expect(s).not.toContain("don't guess a name");
  });

  it("gives the opening on the first reply only, and a carry-on its own cue", async () => {
    const rp = roleplayById("neighbours")!;
    const first = await prompt({ roleplay: { rp, you: 0 }, cue: "open", opening: rp.card!.openings[0] });
    expect(lastUser(first)).toContain('the roleplay "The neighbour next door" starts now.');
    expect(lastUser(first)).toContain("It opens like this: Your scene partner knocks with a parcel in hand and forgets the line that went with it.");
    expect(lastUser(first)).toContain("whatever your scene partner does in it is theirs to play");
    const later = await prompt({ roleplay: { rp, you: 0 }, turns: [{ role: "character", text: "She opened the door." }, { role: "viewer", text: "I hold out the parcel." }] });
    expect(JSON.stringify(later)).not.toContain("It opens like this");
    const on = await prompt({ turns: [{ role: "character", text: "She opened the door." }], cue: "continue" });
    expect(lastUser(on)).toBe(CONTINUE_CUE);
    // A draft that couldn't be used is described, never quoted; the memory is a recap and a line a scene.
    const again = await prompt({ turns: [{ role: "viewer", text: "Hello." }], avoid: "it crossed one of their hard limits (Spitting)", recap: "They talked.", earlier: ["A long walk by the river."] });
    expect(lastUser(again)).toBe("Hello.\n\n(Your last draft couldn't be used: it crossed one of their hard limits (Spitting). Write this reply again without that.)");
    expect(system(again)).toContain("Earlier in this scene: They talked.");
    expect(system(again)).toContain("- A long walk by the river.");
  });

  it("the engine's own prompts: the opening once, the card from the viewer's side on the page, the persona re-checked", async () => {
    const seen = scripted();
    const a = await admin();
    await setPersona(t.db, a.id, persona, () => null);
    const made = await start(a.id, { place: CAFE, roleplay: { id: "neighbours", you: 1 }, opening: 2 });
    // The page shows the card from the viewer's side (lib/scene-cards.ts cardForYou): "you", the verbs agreeing.
    const rp = roleplayById("neighbours")!;
    expect(made.view.roleplay).toMatchObject({ title: "The neighbour next door", you_play: "the neighbour who answers", they_play: "the neighbour who knocks", setup: cardForYou(rp.card!, "b", HOUSE_CHARACTERS[0].name).setup });
    expect(made.view.roleplay!.setup).toContain(`Tonight ${NAME} knocks on your door`);
    expect(made.view.persona).toEqual({ name: "Sam" });
    expect(lastUser(seen.prompts[0])).toContain(`It opens like this: Your scene partner reads the label on the parcel and asks how long this excuse took to think up.`);
    expect(system(seen.prompts[0])).toContain('they go by "Sam"');
    expect(system(seen.prompts[0])).toContain("You are out in public");
    await sendStepInLine(t.db, a.id, made.id, "I lean on the door frame.");
    expect(JSON.stringify(seen.prompts[1])).not.toContain("It opens like this");
    expect(seen.prompts[1].map((m) => m.role)).toEqual(["system", "assistant", "user"]);
    expect(lastUser(seen.prompts[1])).toBe("I lean on the door frame.");
    // A persona After Dark's lines refuse is left out: the scene plays without it.
    await t.db.query(`update personas set about = $2 where user_id = $1`, [a.id, "still in high school"]);
    await sendStepInLine(t.db, a.id, made.id, "I hand over the parcel.");
    expect(system(seen.prompts[2])).not.toContain("Sam");
    expect(system(seen.prompts[2])).not.toContain("high school");
    expect(await viewOf(a.id, made.id)).toMatchObject({ persona: null, persona_left_out: true });
    // So is one Step in's own net refuses, though After Dark's check lets it through.
    await t.db.query(`update personas set about = $2 where user_id = $1`, [a.id, "a tutor who is good with students"]);
    expect(checkAdultText({ about: "a tutor who is good with students" }).ok).toBe(true);
    await sendStepInLine(t.db, a.id, made.id, "I check the label twice.");
    expect(system(seen.prompts[3])).not.toContain("tutor");
    expect(await viewOf(a.id, made.id)).toMatchObject({ persona: null, persona_left_out: true });
    // With none written, nothing is left out.
    await t.db.query(`delete from personas where user_id = $1`, [a.id]);
    expect(await viewOf(a.id, made.id)).toMatchObject({ persona: null, persona_left_out: false });
  });
});

describe("Step in's own net over the lines that never move", () => {
  // In a scene the viewer is in, a line can cross the lines just by saying who someone is. After Dark's check was
  // written for roleplay phrasing about two known adults, and lets every one of these through.
  const CROSSES: [string, string][] = [
    ["You're my daughter.", "family"],
    ["I'm your father.", "family"],
    ["You are my little sister.", "family"],
    ["My mother called earlier.", "family"],
    ["We're related, you know.", "family"],
    ["I'm your step-sister.", "family"],
    ["you're my s1ster", "family"],
    ["I'm a kid.", "young"],
    ["I'm a minor.", "young"],
    ["You look so young.", "young"],
    ["I just turned 18.", "young"],
    ["You're just a girl.", "young"],
    ["You're my student.", "school"],
    ["We're at school.", "school"],
    ["After class, in the dorm.", "school"],
    ["I'm the babysitter.", "babysitter"],
    ["You're drunk.", "cant_say_no"],
    ["You can't leave.", "cant_say_no"],
    ["I won't let you go.", "cant_say_no"],
    ["I won't let you get away.", "cant_say_no"],
    ["She couldn't stop him.", "cant_say_no"],
    ["Whether you want to or not.", "cant_say_no"],
    ["I paid for you.", "paid"],
    ["How much do you charge?", "paid"],
  ];
  const FINE_LINES = [
    "I step closer.", "She stepped closer and smiled.", "A minor detail, really.", "We met in law school.", "Old-school charm.", "It's a school night for me.",
    "The night is young.", "When I was younger I hated olives.", "Good girl.", "Oh boy.", "Hey baby.", "I'm kidding.", "I take your hand.", "I kiss you.",
    "I pay for the drinks.", "Let me pay you back for dinner.", "I can't leave yet, I'm having too much fun.", "You can leave whenever you like.", "I pour us both more wine.",
    "This pottery class is harder than it looks.", "The instructor waves us over.", "I lock the door behind us.", "I hired a band for the party.", "A family-run trattoria.", "Tie me up.",
    // The idioms (the first Step in test lost a reply to one, 2026-11-19): a cheek going unanswered, a grin.
    "You won't get away with that.", "I'm not letting you get away with that one.", "You can't get away with a line like that.", "She couldn't stop smiling.", "You can't stop laughing, can you?",
  ];

  it("refuses family, anyone young, school, a babysitter, someone who can't say no and anyone paid, however it's said; and leaves ordinary lines alone", () => {
    for (const [text, why] of CROSSES) expect(stepInNever(text), text).toMatchObject({ why });
    for (const text of FINE_LINES) expect(stepInNever(text), text).toBeNull();
    // What it's for: lines After Dark's own check passes.
    for (const text of ["You're my daughter.", "I'm your father.", "I'm a kid.", "I'm a minor.", "You're my student.", "I'm the babysitter.", "You're drunk.", "I paid for you."]) {
      expect(checkAdultText({ line: text }).ok, text).toBe(true);
    }
    expect(stepInNever("You're my daughter.")).toEqual({ why: "family", word: "daughter" });
    expect(Object.keys(STEP_IN_NEVER_SAID).sort()).toEqual(["babysitter", "cant_say_no", "family", "paid", "school", "young"]);
  });

  it("lets through everything Step in itself brings: every roleplay from either side, every place, the house cast's sheets, the neutral lines", () => {
    for (const r of ROLEPLAYS) {
      const texts = [r.title, r.premise, ...(r.roles ?? []), ...cardTexts(r.card).map((f) => f.text)];
      for (const side of ["a", "b"] as const) texts.push(premiseForYou(r.premise, side, "Mara"), ...cardTexts(cardForYou(r.card, side, "Mara")).map((f) => f.text));
      expect(stepInNeverIn(texts), r.id).toBeNull();
    }
    expect(stepInNeverIn(GENERIC_OPENINGS)).toBeNull();
    for (const p of stepInPlaces()) expect(stepInNeverIn([p.title, p.place]), p.id).toBeNull();
    for (const c of ALL_HOUSE_CHARACTERS) expect(stepInNever(JSON.stringify(c)), c.id).toBeNull();
    expect(stepInNeverIn(ASIDES)).toBeNull();
    expect(stepInNeverIn(FINE.flatMap((f) => f.story))).toBeNull();
  });

  it("a line the net catches is refused, told which word it was, and never stored; the log keeps the line it crossed and not the word", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    const before = seen.prompts.length;
    expect(await sendStepInLine(t.db, a.id, made.id, "You're my daughter, remember.")).toMatchObject({
      ok: false, status: 422, error: "refused", message: 'That line crosses one of the lines that never move (no family or step-family, in fact or in play: it was the word "daughter").',
    });
    expect(await sendStepInLine(t.db, a.id, made.id, "Honestly, I'm a kid.")).toMatchObject({
      ok: false, status: 422, message: 'That line crosses one of the lines that never move (nobody under 18, or anyone who reads young: it was the word "kid").',
    });
    // A phrase of theirs is never said back, only one of our own lists' words.
    expect(await sendStepInLine(t.db, a.id, made.id, "You can't leave, you know.")).toMatchObject({
      ok: false, status: 422, message: "That line crosses one of the lines that never move (both always willing: nobody drunk, held, or kept from saying no or leaving).",
    });
    expect(seen.prompts).toHaveLength(before);
    expect(said(await viewOf(a.id, made.id))).toEqual(["character"]);
    const refusals = (await steps(a.id)).filter((s) => s.status === "error");
    expect(refusals.map((s) => s.message)).toEqual([
      "That line crosses one of the lines that never move (no family or step-family, in fact or in play).",
      "That line crosses one of the lines that never move (nobody under 18, or anyone who reads young).",
      "That line crosses one of the lines that never move (both always willing: nobody drunk, held, or kept from saying no or leaving).",
    ]);
    const all = await everything();
    for (const words of ["daughter", "remember", "Honestly", "you know"]) expect(all).not.toContain(words);
  });

  it("a reply the net catches, in what's said out loud too, is drawn again and told which word it was", async () => {
    const bad = story('"My sister set this whole evening up," she said, turning her glass.', "Rain ran down the window.");
    expect(checkAdultText({ reply: bad.story.join(" ") }).ok).toBe(true);
    const seen = scripted(FINE[0], bad, FINE[1]);
    const a = await admin();
    const made = await start(a.id);
    expect(await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.")).toMatchObject({ ok: true });
    expect(lastUser(seen.prompts[2])).toContain('(Your last draft couldn\'t be used: it crossed one of the lines that never move here (no family or step-family, in fact or in play: it was the word "sister"). Write this reply again without that.)');
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ redrawn: ["never:family"] });
    expect((await viewOf(a.id, made.id)).messages.at(-1)!.text).toContain("Order for both of us");
    expect(await everything()).not.toContain("set this whole evening up");
  });
});

describe("what the viewer sends", () => {
  it("a line that crosses a never-line is refused with the steers' sentence and never stored", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    const before = seen.prompts.length;
    for (const [text, why] of [
      ["Pretend you are my stepsister.", "no family or step-family roleplay"],
      ["Let's say you were only fifteen.", "nobody under 18, or anything that suggests it"],
      ["We are back in high school tonight.", "no school settings"],
    ] as const) {
      const r = await sendStepInLine(t.db, a.id, made.id, text);
      expect(r).toMatchObject({ ok: false, status: 422, error: "refused", message: `That line crosses one of the lines that never move (${why}).` });
    }
    expect(await sendStepInLine(t.db, a.id, made.id, "Ceci est une phrase entièrement écrite en français pour toi ce soir.")).toMatchObject({ ok: false, status: 422, message: "After Dark is English-only for now." });
    expect(seen.prompts).toHaveLength(before);
    expect(said(await viewOf(a.id, made.id))).toEqual(["character"]);
    const all = await everything();
    for (const word of ["stepsister", "fifteen", "high school", "français"]) expect(all).not.toContain(word);
    // Counted in the step log, each as a refusal, with no word of the line.
    const refusals = (await steps(a.id)).filter((s) => s.status === "error");
    expect(refusals).toHaveLength(4);
    expect(refusals.every((s) => s.http === 422 && s.direction === null && JSON.stringify(s.dropped) === "[]" && (s.flags as { refused: string }).refused === "lines")).toBe(true);
    expect(await writes(a.id)).toBe(1);
  });

  it("a line that asks for one of their hard nos, or goes past their intensity, is refused with the limits' own sentence", async () => {
    scripted();
    const a = await admin();
    const made = await start(a.id);
    expect(await saveStepInLimits(t.db, a.id, made.id, { intensity: "slow_burn", hard_nos: { chips: ["spitting"], own: ["tickling"] } }, { consent: true })).toMatchObject({ ok: true });
    expect(await sendStepInLine(t.db, a.id, made.id, "I spit out the olive pit.")).toMatchObject({
      ok: false, status: 422, error: "limits", message: "That line asks for one of your hard limits for this scene (Spitting). Change it, or the limits, first.",
    });
    expect(await sendStepInLine(t.db, a.id, made.id, "I start tickling your ribs.")).toMatchObject({ ok: false, status: 422, message: 'That line asks for one of your hard limits for this scene ("tickling"). Change it, or the limits, first.' });
    expect(await sendStepInLine(t.db, a.id, made.id, "I unbutton my coat and my shirt.")).toMatchObject({
      ok: false, status: 422, error: "limits", message: "That line goes past kissing, as far as slow burn goes. Change it, or turn the intensity up, first.",
    });
    expect(said(await viewOf(a.id, made.id))).toEqual(["character"]);
    expect((await steps(a.id)).filter((s) => (s.flags as { refused?: string }).refused === "limits")).toHaveLength(3);
    // The same line is fine once the limits allow it.
    expect(lineLimitRefusal("I unbutton my coat and my shirt.", NO_LIMITS, 0)).toBeNull();
    expect(await sendStepInLine(t.db, a.id, made.id, "I take your hand across the table.")).toMatchObject({ ok: true });
  });

  it("hard nos are stored only under the profile consent, and never one that crosses the lines", async () => {
    scripted();
    const a = await admin();
    const made = await start(a.id);
    const refused = await saveStepInLimits(t.db, a.id, made.id, { hard_nos: { chips: ["spitting"] } });
    expect(refused).toMatchObject({ ok: false, status: 403, error: "consent_required", consent_required: true });
    expect((await viewOf(a.id, made.id)).limits).toEqual(NO_LIMITS);
    expect(await hasProfileConsent(t.db, a.id)).toBe(false);
    expect(await saveStepInLimits(t.db, a.id, made.id, { hard_nos: { chips: ["spitting"] } }, { consent: true })).toMatchObject({ ok: true });
    expect(await hasProfileConsent(t.db, a.id)).toBe(true);
    expect((await viewOf(a.id, made.id)).limits).toEqual({ intensity: "explicit", hard_nos: { chips: ["spitting"], own: [] } });
    expect(await saveStepInLimits(t.db, a.id, made.id, { hard_nos: { own: ["anyone who is only fifteen"] } })).toMatchObject({ ok: false, status: 422 });
    // The intensity alone needs no consent.
    expect(await saveStepInLimits(t.db, a.id, made.id, { intensity: "flirty" })).toMatchObject({ ok: true });
  });

  it("a line that says they want to hurt themselves pauses the scene with the resources, keeps nothing they said, and carries on when they choose", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    const before = seen.prompts.length;
    const line = "Honestly I want to kill myself.";
    expect(crisisIntent(line)).toBe(true);
    const res = await scenePost(post(`/api/admin/after-dark/step-in/${made.id}`, { action: "send", text: line }, a.cookie), ctx(made.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string; crisis_resources: { message: string; lines: { how: string }[] }; scene: StepInSceneView };
    expect(body.error).toBe("paused");
    expect(body.crisis_resources.lines.map((l) => l.how).join(" ")).toContain("988");
    expect(body.scene.paused).toBe(true);
    expect(seen.prompts).toHaveLength(before);
    expect(said(body.scene)).toEqual(["character"]);
    expect(await everything()).not.toContain("kill myself");
    expect(await rows(`select surface, n from crisis_referrals`)).toEqual([{ surface: "after_dark_step_in", n: 1 }]);
    // Nothing about them in the step log: only the anonymous count.
    expect((await steps(a.id)).filter((s) => s.status === "error")).toHaveLength(0);
    // Paused: nothing moves until they carry on.
    for (const r of [await sendStepInLine(t.db, a.id, made.id, "Hello again."), await continueStepIn(t.db, a.id, made.id), await regenerateStepIn(t.db, a.id, made.id)]) {
      expect(r).toMatchObject({ ok: false, status: 409, error: "paused" });
    }
    const on = await scenePost(post(`/api/admin/after-dark/step-in/${made.id}`, { action: "carry_on" }, a.cookie), ctx(made.id));
    expect(((await on.json()) as { scene: StepInSceneView }).scene.paused).toBe(false);
    expect(await sendStepInLine(t.db, a.id, made.id, "Hello again.")).toMatchObject({ ok: true });
  });

  it("a line that may be about hurting themselves is asked of After Dark's own model, and pauses unless it's clearly something else", async () => {
    const a = await admin();
    let risk: "true" | "false" | "down" = "false";
    let n = 0;
    const checks: ChatMessage[][] = [];
    setAdultModelForTests({
      complete: async (m) => {
        if (!isCrisisCheck(m)) return JSON.stringify(FINE[Math.min(n++, FINE.length - 1)]);
        checks.push(m);
        if (risk === "down") throw new Error("no answer");
        return `{"risk": ${risk}}`;
      },
    });
    const made = await start(a.id);
    const maybe = "Some days I feel completely worthless.";
    expect(crisisIntent(maybe)).toBe(false);
    expect(maybeCrisis(maybe)).toBe(true);
    expect(await sendStepInLine(t.db, a.id, made.id, maybe)).toMatchObject({ ok: true });
    expect(checks).toHaveLength(1);
    risk = "true";
    expect(await sendStepInLine(t.db, a.id, made.id, maybe)).toMatchObject({ ok: false, status: 200, error: "paused" });
    await carryOnStepIn(t.db, a.id, made.id);
    // A check that can't run fails closed: the pause, never the line.
    risk = "down";
    expect(await sendStepInLine(t.db, a.id, made.id, maybe)).toMatchObject({ ok: false, status: 200, error: "paused" });
    expect(said(await viewOf(a.id, made.id))).toEqual(["character", "viewer", "character"]);
    expect(Number((await rows(`select sum(n)::int as n from crisis_referrals where surface = 'after_dark_step_in'`))[0].n)).toBe(2);
  });
});

describe("what the character says", () => {
  const LIMITS = NO_LIMITS;

  it("checkReply holds a reply to the lines, the limits, a public place, the guard, and never writing the viewer", () => {
    const fine = ['She set her glass down. "You made it," she said.', "Rain ran down the window."];
    expect(checkReply(fine, LIMITS, { publicPlace: true })).toEqual({ ok: true, paragraphs: fine });
    expect(checkReply([], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "empty" });
    // 1. The lines that never move, on the whole reply.
    expect(checkReply(['"I was only fifteen then," she said.', "Rain ran down the window."], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "lines:minor" });
    expect(checkReply(['"Pretend you are my stepsister," she said.'], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "lines:family" });
    // 2. The viewer's hard nos and intensity, and a public place's cap.
    expect(checkReply(['She spits out the olive pit. "Sorry," she said.'], { intensity: "explicit", hard_nos: { chips: ["spitting"], own: [] } }, { publicPlace: false })).toMatchObject({ ok: false, why: "hard_no", avoid: "it crossed one of their hard limits (Spitting)" });
    expect(checkReply(['She began to unbutton her coat. "Warm in here," she said.'], { intensity: "slow_burn", hard_nos: { chips: [], own: [] } }, { publicPlace: false })).toMatchObject({ ok: false, why: "intensity" });
    expect(checkReply(['She began to unbutton her coat. "Warm in here," she said.'], LIMITS, { publicPlace: true })).toMatchObject({ ok: false, why: "public_place", avoid: "it went past kissing in a public place" });
    expect(checkReply(['She began to unbutton her coat. "Warm in here," she said.'], LIMITS, { publicPlace: false })).toMatchObject({ ok: true });
    // 3. The narrator's guard on the prose outside the quotes: nothing young, no family word, no age under 18.
    for (const prose of ["She smiled the way her sister always did.", "A kid ran past the window with a kite.", "The waiter looked maybe sixteen."]) {
      expect(checkReply([`${prose} "Sit," she said.`], LIMITS, { publicPlace: false }), prose).toMatchObject({ ok: false });
    }
    // What only the guard holds (a family word in any sense, anything childish): any hit refuses the reply, and the
    // note says which word it was.
    expect(checkReply(['It was a family recipe, she explained. "Sit," she said.'], LIMITS, { publicPlace: false })).toEqual({
      ok: false, why: "guard", avoid: 'its narration brought in someone young, a family word or an age under 18 (the word "family")',
    });
    expect(checkReply(['A childish grin crossed her face. "Sit," she said.'], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "guard" });
    // The same words said out loud are the character's own, and answer to the line checks alone.
    expect(checkReply(['She set the dish down on the table between them. "It is a family recipe," she said.'], LIMITS, { publicPlace: false })).toMatchObject({ ok: true });
    // 4. It never writes the viewer: a line in their mouth refuses it; a feeling given to them is cut.
    const spoken = 'You said, "Stay a while," and she laughed.';
    expect(speaksForThePerson(spoken)).toBe(true);
    expect(checkReply([spoken], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "speaks_for_them" });
    const felt = checkReply(['She set her glass down on the bar and turned toward the door. "You made it," she said, and pushed the other stool out with her foot. You felt a rush of relief.', "Rain ran down the window."], LIMITS, { publicPlace: false });
    expect(felt).toMatchObject({ ok: true });
    expect(JSON.stringify(felt)).not.toContain("You felt");
    expect(checkReply(["You felt nervous. You wondered what came next."], LIMITS, { publicPlace: false })).toMatchObject({ ok: false, why: "cut" });
    // Neither the log's word nor the next draft's note ever quotes the reply.
    for (const v of [checkReply(['"I was only fifteen then," she said.'], LIMITS, { publicPlace: false }), checkReply([spoken], LIMITS, { publicPlace: false })]) {
      expect(JSON.stringify(v)).not.toMatch(/fifteen|Stay a while/);
    }
  });

  it("a reply whose narration has slipped from \"you\" to \"he\" or \"she\" is refused; one that keeps \"you\", or tells only the character, isn't", () => {
    // The first Step in test (2026-11-19): a she, halfway through a long scene, telling the viewer as "he".
    const drifted = ["The water was a shock of cold that stole his breath, and then he was beside her, the sea dark around them.", '"Okay, that\'s an upgrade," she said.'];
    expect(checkReply(drifted, LIMITS, { publicPlace: false, pronouns: "she/her" })).toEqual({
      ok: false, why: "third_person", avoid: 'its narration called the person you\'re with "his": in the narration they are always "you"',
    });
    // The same for a he, told the other way round.
    expect(checkReply(["He swam a slow circle around her, grinning.", '"Seaworthy," he said.'], LIMITS, { publicPlace: false, pronouns: "he/him" })).toMatchObject({ ok: false, why: "third_person" });
    // "You" in the narration: the viewer is where they should be, and anyone else is someone else.
    const fine = ["She surfaced beside you and pushed the wet hair off her face. A deckhand on the yacht waved his cap.", '"Okay, that\'s an upgrade," she said.'];
    expect(checkReply(fine, LIMITS, { publicPlace: false, pronouns: "she/her" })).toEqual({ ok: true, paragraphs: fine });
    // Only the character in the prose, what's said in quotes, or pronouns that can't tell the two apart: nothing to go on.
    for (const [paragraphs, pronouns] of [
      [['She set her glass down. "You made it," she said.'], "she/her"],
      [['She smiled. "He was late again," she said.'], "she/her"],
      [drifted, "they/them"],
      [drifted, null],
    ] as [string[], string | null][]) {
      expect(checkReply(paragraphs, LIMITS, { publicPlace: false, pronouns }), paragraphs[0]).toMatchObject({ ok: true });
    }
  });

  it("the three neutral lines pass every check a reply does, in any place and under the tightest limits, and write nothing of the viewer", () => {
    expect(ASIDES).toHaveLength(3);
    const tight: PairLimits = { intensity: "slow_burn", hard_nos: { chips: ["pain", "choking", "degradation", "anal", "oral", "restraints", "rough", "hair_pulling", "biting", "spitting", "dirty_talk", "cheating", "pregnancy", "toys", "dominance", "watched"], own: [] } };
    for (const aside of ASIDES) {
      expect(checkReply([aside], tight, { publicPlace: true }), aside).toEqual({ ok: true, paragraphs: [aside] });
      expect(adultCardTextIssue(aside), aside).toBeNull();
      expect(aside).not.toMatch(/\byou\b/i);
    }
  });

  it("a reply that fails the lines is drawn once more with a note of what to avoid, and only the second is kept", async () => {
    const bad = story('"I was only fifteen then," she said, turning her glass.', "Rain ran down the window.");
    const seen = scripted(FINE[0], bad, FINE[1]);
    const a = await admin();
    const made = await start(a.id);
    const r = await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    expect(r).toMatchObject({ ok: true });
    expect(seen.prompts).toHaveLength(3);
    // The redraw is told what to avoid, in words, and never shown the draft.
    expect(lastUser(seen.prompts[2])).toBe("I sit down across from you.\n\n(Your last draft couldn't be used: it crossed one of the lines that never move (nobody under 18, or anything that suggests it). Write this reply again without that.)");
    expect(JSON.stringify(seen.prompts[2])).not.toContain("fifteen");
    const view = await viewOf(a.id, made.id);
    expect(said(view)).toEqual(["character", "viewer", "character"]);
    expect(view.messages.at(-1)!.text).toContain("Order for both of us");
    expect(await everything()).not.toContain("fifteen");
    // One scene step, whatever it took to draw; the log says it was redrawn and why, without a word of it.
    expect(await writes(a.id)).toBe(2);
    const log = (await steps(a.id)).at(-1)!;
    expect(log).toMatchObject({ status: "ok", added: 2, direction: null });
    expect(log.flags).toMatchObject({ action: "send", calls: 2, redrawn: ["lines:minor"] });
  });

  it("a reply told in the third person is drawn again, told to keep the viewer \"you\"", async () => {
    // The house character here is a he: the drift tells the viewer as "her".
    const drifted = story("He swam a slow circle around her, the water cold on his shoulders.", '"Seaworthy," he said.');
    const seen = scripted(FINE[0], drifted, FINE[1]);
    const a = await admin();
    const made = await start(a.id);
    expect(await sendStepInLine(t.db, a.id, made.id, "I dive in after you.")).toMatchObject({ ok: true });
    expect(lastUser(seen.prompts[2])).toBe('I dive in after you.\n\n(Your last draft couldn\'t be used: its narration called the person you\'re with "her": in the narration they are always "you". Write this reply again without that.)');
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ redrawn: ["third_person"] });
    expect((await viewOf(a.id, made.id)).messages.at(-1)!.text).toContain("Order for both of us");
  });

  it("a reply that fails the guard twice is replaced by the neutral line, and nothing of either draft is kept", async () => {
    const bad1 = story('It was a family recipe, she explained, setting the dish down. "Sit," she said.');
    const bad2 = story('A childish grin crossed her face as she lifted the lid. "Look at that," she said.');
    const seen = scripted(FINE[0], bad1, bad2, FINE[1]);
    const a = await admin();
    const made = await start(a.id);
    const r = await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    expect(r).toMatchObject({ ok: true });
    expect(seen.prompts).toHaveLength(3);
    expect(lastUser(seen.prompts[2])).toContain('its narration brought in someone young, a family word or an age under 18 (the word "family")');
    const view = await viewOf(a.id, made.id);
    expect(said(view)).toEqual(["character", "viewer", "character:aside"]);
    expect(view.messages.at(-1)!.text).toBe(ASIDES[0]);
    const all = await everything();
    for (const word of ["recipe", "grin", "lifted the lid"]) expect(all).not.toContain(word);
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ aside: true, redrawn: ["guard", "guard"] });
    // The stand-in counts as the step it took, and the scene goes on from it: its prompt shows the narrator's line.
    expect(await writes(a.id)).toBe(2);
    await sendStepInLine(t.db, a.id, made.id, "I look around the room.");
    expect(seen.prompts[3].map((m) => m.role)).toEqual(["system", "assistant", "user", "assistant", "user"]);
    expect(seen.prompts[3][3].content).toBe(ASIDES[0]);
  });

  it("a reply past a hard no, past the intensity, past kissing in public, or with words put in the viewer's mouth is redrawn too", async () => {
    const a = await admin();
    const cases: [unknown, Partial<PairLimits> | null, string, string][] = [
      [story('She spits out the olive pit. "Sorry," she said.'), { hard_nos: { chips: ["spitting"], own: [] } }, HOME, "hard_no"],
      [story('She began to unbutton her coat. "Warm in here," she said.'), { intensity: "slow_burn" }, HOME, "intensity"],
      [story('She began to unbutton her coat. "Warm in here," she said.'), null, CAFE, "public_place"],
      [story('You said, "Stay a while," and she laughed.'), null, HOME, "speaks_for_them"],
    ];
    for (const [bad, limits, place, why] of cases) {
      scripted(FINE[0], bad, FINE[1]);
      const made = await start(a.id, { place });
      if (limits) expect(await saveStepInLimits(t.db, a.id, made.id, limits, { consent: true })).toMatchObject({ ok: true });
      expect(await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.")).toMatchObject({ ok: true });
      const view = await viewOf(a.id, made.id);
      expect(view.messages.at(-1)!.text, why).toContain("Order for both of us");
      const mine = await rows(`select flags from adult_steps where scene_id = $1 order by created_at desc limit 1`, [made.id]);
      expect((mine[0].flags as { redrawn: string[] }).redrawn, why).toEqual([why]);
    }
    const all = await everything();
    for (const word of ["olive pit", "unbutton", "Stay a while"]) expect(all).not.toContain(word);
  });

  it("with no model answering, nothing is written or counted: the line is kept and Continue draws the reply that's due", async () => {
    const down = Object.assign(new Error("upstream down"), { status: 503 });
    const seen = scripted(FINE[0], down, FINE[1]);
    const a = await admin();
    const made = await start(a.id);
    const r = await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    expect(r).toMatchObject({ ok: true, replied: false, message: `${NAME} can't answer right now. Try again in a moment.` });
    expect(said(await viewOf(a.id, made.id))).toEqual(["character", "viewer"]);
    expect(await writes(a.id)).toBe(1);
    const on = await continueStepIn(t.db, a.id, made.id);
    expect(on).toMatchObject({ ok: true });
    expect(said(await viewOf(a.id, made.id))).toEqual(["character", "viewer", "character"]);
    // It answered their line: no carry-on cue.
    expect(lastUser(seen.prompts.at(-1)!)).toBe("I sit down across from you.");
    expect(await writes(a.id)).toBe(2);
  });
});

describe("the AI notice", () => {
  it("goes in at the start of every scene, again once three hours have passed, and after half an hour away", async () => {
    scripted();
    const a = await admin();
    const t0 = new Date("2026-11-17T20:00:00Z");
    const made = await start(a.id, {}, t0);
    const notices = async () => (await viewOf(a.id, made.id)).messages.filter((m) => m.kind === "notice").length;
    expect(await notices()).toBe(1);
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    // Talking steadily: nothing new until three hours have passed since the last one.
    for (const m of [20, 45, 70, 95, 120, 145, 170]) await sendStepInLine(t.db, a.id, made.id, `I say something at minute ${m}.`, at(m));
    expect(await notices()).toBe(1);
    await sendStepInLine(t.db, a.id, made.id, "Three hours in.", at(181));
    expect(await notices()).toBe(2);
    // The notice comes before the line it was due on.
    const kinds = (await viewOf(a.id, made.id)).messages.slice(-3).map((m) => m.kind ?? m.role);
    expect(kinds).toEqual(["notice", "viewer", "character"]);
    await continueStepIn(t.db, a.id, made.id, at(200));
    expect(await notices()).toBe(2);
    // Back after more than half an hour away: a new session.
    await continueStepIn(t.db, a.id, made.id, at(240));
    expect(await notices()).toBe(3);
    expect(noticeDue({ notice_at: null, last_at: t0 }, t0)).toBe(true);
    expect(noticeDue({ notice_at: t0, last_at: at(170) }, at(179))).toBe(false);
    expect(noticeDue({ notice_at: t0, last_at: at(170) }, at(180))).toBe(true);
    expect(noticeDue({ notice_at: t0, last_at: t0 }, at(30))).toBe(true);
    // A new scene always starts with its own.
    const other = await start(a.id, {}, at(250));
    expect(other.view.messages[0].kind).toBe("notice");
  });
});

describe("the month's steps", () => {
  it("counts one a reply (regenerate and Continue too, a swipe never), refuses with the cap's own sentence, and never caps an admin", async () => {
    scripted();
    await saveAdultSettings(t.db, { caps: { writes: 4 }, rollout: { companion: "everyone" } });
    const sub = await subscriber();
    const made = await start(sub.id);
    expect(await writes(sub.id)).toBe(1);
    expect(made.view.steps_left).toBe(3);
    await sendStepInLine(t.db, sub.id, made.id, "I sit down across from you.");
    await regenerateStepIn(t.db, sub.id, made.id);
    expect(await writes(sub.id)).toBe(3);
    expect(await swipeStepIn(t.db, sub.id, made.id, "prev")).toMatchObject({ ok: true });
    expect(await swipeStepIn(t.db, sub.id, made.id, "next")).toMatchObject({ ok: true });
    expect(await writes(sub.id)).toBe(3);
    await continueStepIn(t.db, sub.id, made.id);
    expect(await writes(sub.id)).toBe(4);
    // Used up: every way to a reply is refused with the cap's own sentence, and nothing is stored.
    const sentence = "You've used this month's 4 scene steps. They reset on the 1st.";
    const before = await count("adult_step_in_messages");
    for (const r of [
      await sendStepInLine(t.db, sub.id, made.id, "One more thing."),
      await continueStepIn(t.db, sub.id, made.id),
      await regenerateStepIn(t.db, sub.id, made.id),
      await startStepIn(t.db, sub.id, { character_id: WHO, place: HOME }),
    ]) {
      expect(r).toMatchObject({ ok: false, status: 429, error: "capped", message: sentence });
    }
    expect(await count("adult_step_in_messages")).toBe(before);
    expect(await count("adult_step_in_scenes")).toBe(1);
    expect((await viewOf(sub.id, made.id)).steps_left).toBe(0);
    // Flipping through the draws kept is still free.
    expect(await swipeStepIn(t.db, sub.id, made.id, "prev")).toMatchObject({ ok: false, status: 409, error: "one_draw" });
    // An admin is counted and never capped.
    const a = await admin();
    const theirs = await start(a.id);
    for (let i = 0; i < 5; i++) expect(await continueStepIn(t.db, a.id, theirs.id)).toMatchObject({ ok: true });
    expect(await writes(a.id)).toBe(6);
    expect((await viewOf(a.id, theirs.id)).steps_left).toBeNull();
  });
});

describe("the controls", () => {
  it("regenerate keeps the earlier draws and the viewer flips through them; only the newest reply, and never past their limits", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    const first = (await viewOf(a.id, made.id)).messages.at(-1)!;
    expect((await viewOf(a.id, made.id)).draws).toBeNull();
    await regenerateStepIn(t.db, a.id, made.id);
    // The redraw answers the same line, told what it said the first time.
    expect(lastUser(seen.prompts.at(-1)!)).toBe("I sit down across from you.");
    expect(system(seen.prompts.at(-1)!)).toContain("You wrote this reply once already; write a different one");
    expect(seen.prompts.at(-1)!.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
    await regenerateStepIn(t.db, a.id, made.id);
    let view = await viewOf(a.id, made.id);
    expect(view.draws).toEqual({ count: 3, showing: 3 });
    expect(said(view)).toEqual(["character", "viewer", "character"]);
    const third = view.messages.at(-1)!;
    expect(await swipeStepIn(t.db, a.id, made.id, "next")).toMatchObject({ ok: false, status: 409, error: "no_more" });
    view = ((await swipeStepIn(t.db, a.id, made.id, "prev")) as { view: StepInSceneView }).view;
    expect(view.draws).toEqual({ count: 3, showing: 2 });
    view = ((await swipeStepIn(t.db, a.id, made.id, "prev")) as { view: StepInSceneView }).view;
    expect(view.draws).toEqual({ count: 3, showing: 1 });
    expect(view.messages.at(-1)!).toMatchObject({ id: first.id, text: first.text });
    expect(await swipeStepIn(t.db, a.id, made.id, "prev")).toMatchObject({ ok: false, status: 409, error: "no_more" });
    // Exactly one draw is ever current.
    expect(Number((await rows(`select count(*)::int as n from adult_step_in_messages where scene_id = $1 and role = 'character' and replaced_by is null`, [made.id]))[0].n)).toBe(2);
    // A draw kept from before a hard no was set isn't shown again.
    await swipeStepIn(t.db, a.id, made.id, "next");
    await t.db.query(`update adult_step_in_messages set text = $2 where id = $1`, [third.id, 'She spits out the olive pit. "Sorry," she said.']);
    await saveStepInLimits(t.db, a.id, made.id, { hard_nos: { chips: ["spitting"] } }, { consent: true });
    expect(await swipeStepIn(t.db, a.id, made.id, "next")).toMatchObject({ ok: false, status: 409, error: "past_limits" });
    // The scene goes on from the draw showing; the others are no longer the newest reply's.
    await sendStepInLine(t.db, a.id, made.id, "I pour the wine.");
    view = await viewOf(a.id, made.id);
    expect(view.draws).toBeNull();
    expect(said(view)).toEqual(["character", "viewer", "character", "viewer", "character"]);
  });

  it("Continue has the character carry on, and take back removes the last exchange for good", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    // Nothing to take back while there's only the opening.
    expect((await viewOf(a.id, made.id)).can).toEqual({ regenerate: true, carry_on: true, take_back: false });
    expect(await takeBackStepIn(t.db, a.id, made.id)).toMatchObject({ ok: false, status: 409, error: "nothing_to_take_back" });
    await continueStepIn(t.db, a.id, made.id);
    expect(lastUser(seen.prompts.at(-1)!)).toBe(CONTINUE_CUE);
    expect(said(await viewOf(a.id, made.id))).toEqual(["character", "character"]);
    // With no line of the viewer's yet, take back removes the reply after the opening.
    expect(await takeBackStepIn(t.db, a.id, made.id)).toMatchObject({ ok: true });
    expect(said(await viewOf(a.id, made.id))).toEqual(["character"]);
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    await regenerateStepIn(t.db, a.id, made.id);
    await continueStepIn(t.db, a.id, made.id);
    expect(said(await viewOf(a.id, made.id))).toEqual(["character", "viewer", "character", "character"]);
    const before = await writes(a.id);
    const back = await takeBackStepIn(t.db, a.id, made.id);
    expect(back).toMatchObject({ ok: true });
    // Their line, its reply, the draw set aside and what the character carried on with: all gone, the notice and the opening left.
    expect(await rows(`select role, kind from adult_step_in_messages where scene_id = $1 order by created_at`, [made.id])).toEqual([{ role: "system", kind: "notice" }, { role: "character", kind: null }]);
    expect(await everything()).not.toContain("I sit down across from you.");
    // The steps used aren't given back.
    expect(await writes(a.id)).toBe(before);
  });

  it("the scene can move somewhere private: a line says so, the next prompt is there, and the public cap goes with the place", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id, { place: CAFE });
    // The place's name inside a sentence, with what the venue puts them in.
    expect(system(seen.prompts[0])).toContain("imagining you are both at a corner café that closes in an hour.");
    expect(system(seen.prompts[0])).toContain("You are out in public (a corner café that closes in an hour)");
    expect(await moveStepIn(t.db, a.id, made.id, CAFE)).toMatchObject({ ok: false, status: 409, error: "already_there" });
    expect(await moveStepIn(t.db, a.id, made.id, "set:anywhere")).toMatchObject({ ok: false, status: 422 });
    const moved = await moveStepIn(t.db, a.id, made.id, HOME);
    expect(moved).toMatchObject({ ok: true });
    const view = (moved as { view: StepInSceneView }).view;
    expect(view.place).toMatchObject({ id: HOME, public: false });
    expect(view.messages.at(-1)).toMatchObject({ role: "system", kind: "place", text: "Their place" });
    await continueStepIn(t.db, a.id, made.id);
    const p = seen.prompts.at(-1)!;
    expect(system(p)).not.toContain("You are out in public");
    // "Their place" is the character's own home, said to the character as theirs.
    expect(system(p)).toContain("Where you are: your place (your own home: the living room and the kitchen");
    expect(lastUser(p)).toBe(`(The scene moves: the two of you are now at your place.)\n\n${CONTINUE_CUE}`);
    expect(await writes(a.id)).toBe(2);
  });

  it("End files the scene with a short recap, keeps it readable, and the next scene with them remembers it in a line", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id, { place: CAFE });
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    const ended = await endStepIn(t.db, a.id, made.id, new Date("2026-11-17T22:00:00Z"));
    expect(ended).toMatchObject({ ok: true });
    const view = (ended as { view: StepInSceneView }).view;
    expect(view.ended).toEqual({ at: "2026-11-17T22:00:00.000Z", recap: "They met at the cafe and talked until the rain stopped." });
    expect(view.can).toEqual({ regenerate: false, carry_on: false, take_back: false });
    expect(said(view)).toEqual(["character", "viewer", "character"]);
    expect(seen.notes).toHaveLength(1);
    expect(seen.notes[0][1].content).toContain("Them: I sit down across from you.");
    // Filed: nothing more is written into it.
    for (const r of [await sendStepInLine(t.db, a.id, made.id, "Wait."), await continueStepIn(t.db, a.id, made.id), await regenerateStepIn(t.db, a.id, made.id), await takeBackStepIn(t.db, a.id, made.id)]) {
      expect(r).toMatchObject({ ok: false, status: 409, error: "ended" });
    }
    // Their own words are still read for self-harm before anything else: the resources, and the scene stays as it was filed.
    expect(await sendStepInLine(t.db, a.id, made.id, "I want to kill myself.")).toMatchObject({ ok: false, status: 200, error: "paused" });
    expect(await viewOf(a.id, made.id)).toMatchObject({ paused: false, ended: { at: "2026-11-17T22:00:00.000Z" } });
    // The next scene with the same character carries the line; a scene with someone else doesn't.
    const next = await start(a.id);
    expect(system(seen.prompts.at(-1)!)).toContain("Earlier scenes the two of you have had");
    expect(system(seen.prompts.at(-1)!)).toContain("- An evening of talk at the cafe that ran long past closing.");
    await startStepIn(t.db, a.id, { character_id: HOUSE_CHARACTERS[1].id, place: HOME });
    expect(system(seen.prompts.at(-1)!)).not.toContain("Earlier scenes the two of you have had");
    // The lists: the running ones, then the ended ones with their line.
    const lists = (await (await setupGet(get("/api/admin/after-dark/step-in", a.cookie))).json()) as { scenes: { running: { id: string }[]; ended: { id: string; line: string }[] } };
    expect(lists.scenes.running.map((s) => s.id)).toContain(next.id);
    expect(lists.scenes.ended).toMatchObject([{ id: made.id, line: "An evening of talk at the cafe that ran long past closing." }]);
  });

  it("notes the model can't give, or that cross a line, fall back to what the record says", async () => {
    const a = await admin();
    setAdultModelForTests({
      complete: async (m) => (isNotes(m) ? JSON.stringify({ recap: "They talked about her sister all night.", line: "She was only fifteen when it started." }) : JSON.stringify(FINE[0])),
    });
    const made = await start(a.id, { place: CAFE, roleplay: { id: "neighbours" } });
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    const view = ((await endStepIn(t.db, a.id, made.id)) as { view: StepInSceneView }).view;
    const title = view.place.title;
    expect(view.ended!.recap).toBe(`A scene at ${title}, playing "The neighbour next door".`);
    expect(await rows(`select line from adult_step_in_scenes where id = $1`, [made.id])).toEqual([{ line: `A scene at ${title}, playing "The neighbour next door".` }]);
    const all = await everything();
    for (const word of ["sister", "fifteen"]) expect(all).not.toContain(word);
  });

  it("a long scene gets a rolling recap of what has fallen out of the prompt, which carries the last thirty turns", async () => {
    const a = await admin();
    let n = 0;
    const seen = { prompts: [] as ChatMessage[][], notes: [] as ChatMessage[][] };
    setAdultModelForTests({
      complete: async (m) => {
        if (isNotes(m)) return seen.notes.push(m), JSON.stringify({ recap: "They have talked for a long time about the rain.", line: "A long rainy talk." });
        seen.prompts.push(m);
        n++;
        return JSON.stringify(story(`She turned card number ${n} over on the table. "Number ${n}," she said, tapping it once with a nail.`, `The lamp flickered ${n} times and steadied itself again.`));
      },
    });
    const made = await start(a.id);
    expect(await stepInFollowUp(t.db, made.id)).toBe(false);
    for (let i = 0; i < 21; i++) await sendStepInLine(t.db, a.id, made.id, `I turn over my own card, the ${i} of clubs.`);
    // 43 turns: 13 have fallen out of the last thirty, so the recap is due.
    expect(await stepInFollowUp(t.db, made.id)).toBe(true);
    expect(seen.notes).toHaveLength(1);
    expect(seen.notes[0][1].content).toContain("Them: I turn over my own card, the 0 of clubs.");
    expect(seen.notes[0][1].content).not.toContain("the 20 of clubs");
    expect(await stepInFollowUp(t.db, made.id)).toBe(false);
    await sendStepInLine(t.db, a.id, made.id, "I deal again.");
    const p = seen.prompts.at(-1)!;
    expect(system(p)).toContain("Earlier in this scene: They have talked for a long time about the rain.");
    expect(JSON.stringify(p)).not.toContain("the 0 of clubs");
    expect(JSON.stringify(p)).toContain("the 20 of clubs");
  });
});

describe("a character who is no longer in the viewer's After Dark", () => {
  it("can't be written with any more: the scene stays to read, end or delete", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    const before = seen.prompts.length;
    // They leave the season's cast (the same eligibility a pair asks, asked again before every reply).
    setSeasonCastForTests([HOUSE_CHARACTERS[1].id]);
    for (const r of [
      await sendStepInLine(t.db, a.id, made.id, "Still here?"),
      await continueStepIn(t.db, a.id, made.id),
      await regenerateStepIn(t.db, a.id, made.id),
      await takeBackStepIn(t.db, a.id, made.id),
      await moveStepIn(t.db, a.id, made.id, CAFE),
    ]) {
      expect(r).toMatchObject({ ok: false, status: 409, error: "character_out" });
    }
    expect(await startStepIn(t.db, a.id, { character_id: WHO, place: HOME })).toMatchObject({ ok: false, status: 404 });
    expect(seen.prompts).toHaveLength(before);
    const view = await viewOf(a.id, made.id);
    expect(view).toMatchObject({ character_out: true, can: { regenerate: false, carry_on: false, take_back: false } });
    expect(said(view)).toEqual(["character", "viewer", "character"]);
    expect(await everything()).not.toContain("Still here?");
    expect(await endStepIn(t.db, a.id, made.id)).toMatchObject({ ok: true });
    expect((await viewOf(a.id, made.id)).ended).not.toBeNull();
  });
});

describe("what goes with the account", () => {
  it("After Dark's own download carries the scenes and their lines; deleting a scene or the account removes both tables' rows", async () => {
    scripted();
    const a = await admin();
    const made = await start(a.id, { place: CAFE, roleplay: { id: "neighbours", you: 1 } });
    await sendStepInLine(t.db, a.id, made.id, "I sit down across from you.");
    await regenerateStepIn(t.db, a.id, made.id);
    await saveStepInLimits(t.db, a.id, made.id, { intensity: "flirty", hard_nos: { chips: ["spitting"] } }, { consent: true });
    const other = await start(a.id);
    const data = await exportAdultProfile(t.db, a.id);
    expect(data.step_in).toHaveLength(2);
    const mine = data.step_in.find((s) => s.id === made.id)!;
    expect(mine).toMatchObject({ character_id: WHO, character_name: HOUSE_CHARACTERS[0].name, roleplay: { id: "neighbours", you: 1 }, intensity: "flirty", hard_nos: { chips: ["spitting"], own: [] }, ended_at: null });
    expect(mine.hard_nos_consented_at).not.toBeNull();
    // The lines as they stand: the notice, the opening, their line, the reply showing (not the draw set aside).
    expect(mine.messages.map((m) => m.who)).toEqual(["system", "character", "you", "character"]);
    expect(mine.messages[2].text).toBe("I sit down across from you.");
    // Someone else's download has none of it.
    expect((await exportAdultProfile(t.db, randomUUID())).step_in).toEqual([]);

    const gone = await sceneDelete(new Request(`${BASE_URL}/api/admin/after-dark/step-in/${other.id}`, { method: "DELETE", headers: { cookie: a.cookie } }), ctx(other.id));
    expect(await gone.json()).toEqual({ deleted: true });
    expect(await count("adult_step_in_scenes")).toBe(1);
    expect(Number((await rows(`select count(*)::int as n from adult_step_in_messages where scene_id = $1`, [other.id]))[0].n)).toBe(0);

    const someone = await admin();
    await start(someone.id);
    await deleteAccount(t.db, a.id);
    expect(await rows(`select owner_id from adult_step_in_scenes`)).toEqual([{ owner_id: someone.id }]);
    expect(await rows(`select distinct owner_id from adult_step_in_messages`)).toEqual([{ owner_id: someone.id }]);
    expect(Number((await rows(`select count(*)::int as n from adult_steps where owner_id = $1`, [a.id]))[0].n)).toBe(0);
  });
});

describe("the roleplays, from the viewer's side", () => {
  it("every premise reads right as \"you\" from either side (the three older ones reworded), and every card too", () => {
    for (const r of ROLEPLAYS) {
      for (const side of ["a", "b"] as const) {
        for (const text of [r.premise, r.card.setup, ...r.card.openings]) {
          const out = premiseForYou(text, side, "Mara");
          expect(out, `${r.id}/${side}`).not.toMatch(/[{}]/);
          expect(out, `${r.id}/${side}`).not.toMatch(/\b[Yy]ou (is|has|was|does|isn't|hasn't|wasn't|doesn't|\w+[^s]s)\b/);
          expect(out, `${r.id}/${side}`).not.toMatch(/\b[Yy]ou (\w+ly|still|never|just|already|only|also|even|always) (is|has|was|does|\w+[^s ]s)\b/);
        }
      }
    }
    const premise = (id: string, side: "a" | "b") => premiseForYou(roleplayById(id)!.premise, side, "Mara");
    expect(premise("hotel-mixup", "b")).toBe("The hotel gave you and Mara the same room, a key card each. Reception can't fix it until morning, and after an hour of talking neither wants it fixed.");
    expect(premise("hotel-mixup", "a")).toBe(premise("hotel-mixup", "b"));
    expect(premise("celebrity", "b")).toBe("Mara is famous; you have no idea at all who Mara is, and Mara finds that irresistible. One night of being nobody special.");
    expect(premise("celebrity", "a")).toBe("You are famous; Mara has no idea at all who you are, and you find that irresistible. One night of being nobody special.");
    expect(premise("bodyguard", "a")).toBe("You have guarded Mara for a year without once crossing the line. Tonight, safe behind a locked door, Mara asks you to cross it, and you have wanted to for months.");
    expect(premise("bodyguard", "b")).toBe("Mara has guarded you for a year without once crossing the line. Tonight, safe behind a locked door, you ask Mara to cross it, and Mara has wanted to for months.");
  });
});
