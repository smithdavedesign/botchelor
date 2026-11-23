// "↻ Again…" in a Step in scene (lib/adult/step-in.ts regenerateStepIn's `direction`; lib/adult/step-in-shared.ts
// REDRAW_PRESETS; docs/after-dark.md "This reply again, with one change"). David, 2026-11-23: '"Another reply, but
// slower / more teasing": a direction on a redraw'. The newest reply is drawn again with one change asked for: a
// preset of ours, a few words of the viewer's own, or both. Their words are held to what a line of theirs is before
// anything is drawn and are never kept; the reply it makes is still one reply, checked like any other.
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
import { POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HARD_NO_IDS, NO_LIMITS, type PairLimits } from "@/lib/adult/limits";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { saveAdultSettings } from "@/lib/adult/settings";
import { stageShown } from "@/lib/adult/stage-floor";
import { endStepIn, getStepInScene, lineLimitRefusal, regenerateStepIn, saveStepInLimits, sendStepInLine, setStepInRandomForTests, startStepIn, swipeStepIn, type StepInSceneView } from "@/lib/adult/step-in";
import { stepInNever } from "@/lib/adult/step-in-lines";
import { CONTINUE_CUE, redrawCue, STEP_IN_TALK, stepInMessages, TALK_CUE } from "@/lib/adult/step-in-prompt";
import { REDRAW_PRESET_IDS, REDRAW_PRESETS, REDRAW_TEXT_MAX, type RedrawDirection } from "@/lib/adult/step-in-shared";
import { sceneCharacter } from "@/lib/adult/voice";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { checkAdultText } from "@/lib/safety";
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
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const HOME = "venue:home";
const LINE = "I sit down across from you.";

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

const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const isTalk = (m: ChatMessage[]) => m[0].content.includes(STEP_IN_TALK);
const story = (...paragraphs: string[]) => ({ story: paragraphs });
/** Mild replies, each different (a reply mustn't say an earlier one again). */
const FINE = [
  story('She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."),
  story('She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."', "The waiter hovered, decided against it, and went back to polishing a glass that was already clean."),
  story('"Tell me the worst part of your week," she said, and reached over to take her hand back from the cold glass.', "Somewhere behind the bar a radio found a song from ten summers ago and kept it low."),
  story('She laughed, short and surprised. "That is not how that story ends and we both know it."', "The candle between the plates had burned down to a stub, and nobody had come to change it."),
  story('"Walk with me," she said, already reaching for her coat. "The rain has stopped pretending."', "The street outside was all reflections, and the bus shelter across the road hummed under its one light."),
  story('She held the door with her shoulder. "After you. I want to see which way you turn."', "The night air smelled of wet pavement and somebody else's dinner."),
];
const SAID = ["Stay a while. I just put the kettle on.", "Sit. Tell me one true thing about today.", "Come here."];
/**
 * The scripted model: prose prompts get the mild replies in order and Talk's prompts the spoken ones, each kept; the
 * notes call answers with a recap, the self-harm maybes with "no risk". `replies`: prose replies to use instead.
 */
function scripted(...replies: unknown[]) {
  const seen = { prompts: [] as ChatMessage[][], talked: [] as ChatMessage[][] };
  let i = 0;
  let j = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      if (isTalk(m)) {
        seen.talked.push(m);
        return JSON.stringify({ say: SAID[Math.min(j++, SAID.length - 1)] });
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
const replies = async (id: string) => Number((await rows(`select step_in from adult_usage where owner_id = $1`, [id]))[0]?.step_in ?? 0);
const steps = async (id: string) => rows(`select status, http, message, flags from adult_steps where owner_id = $1 order by created_at`, [id]);
/** Everything a scene keeps, as one string: what a test searches for words that must never have been stored. */
const everything = async () => JSON.stringify([await rows(`select * from adult_step_in_scenes`), await rows(`select * from adult_step_in_messages`), await rows(`select * from adult_steps`)]);
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
const system = (m: ChatMessage[]) => m[0].content;
const lastUser = (m: ChatMessage[]) => m[m.length - 1].content;
/** A running scene: the character's opening, one line of the viewer's, and the reply to it. */
async function scene(viewer: string) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place: HOME });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  const sent = await sendStepInLine(t.db, viewer, r.id, LINE);
  if (!sent.ok) throw new Error(`send failed: ${sent.status} ${sent.message}`);
  return { id: r.id, reply: sent.view.messages.at(-1)! };
}
const again = (viewer: string, id: string, direction: RedrawDirection) => regenerateStepIn(t.db, viewer, id, new Date(), { direction });
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const preset = (id: (typeof REDRAW_PRESET_IDS)[number]) => REDRAW_PRESETS.find((p) => p.id === id)!;

describe("the directions offered", () => {
  it("are six, each a chip's word and a sentence for the writer that changes how the reply is told, never how far it goes", () => {
    expect(REDRAW_PRESETS.map((p) => p.id)).toEqual(["slower", "teasing", "bolder", "softer", "shorter", "talk"]);
    expect(REDRAW_PRESET_IDS).toEqual(REDRAW_PRESETS.map((p) => p.id));
    // The strictest limits a scene can have: every hard no there is, and the mildest intensity.
    const strictest = { intensity: "slow_burn", hard_nos: { chips: [...HARD_NO_IDS], own: [] } } as PairLimits;
    for (const p of REDRAW_PRESETS) {
      expect(p.label.length, p.id).toBeLessThanOrEqual(14);
      for (const ask of [p.ask, p.spoken]) {
        expect(ask, p.id).not.toMatch(/[{}"\n]/);
        expect(ask.length, p.id).toBeLessThan(140);
        // Nothing in it is an act, a line that never moves, or more than the mildest scene allows.
        expect(checkAdultText({ direction: ask }).ok, p.id).toBe(true);
        expect(stepInNever(ask), p.id).toBeNull();
        expect(stageShown(ask) ?? 0, p.id).toBe(0);
        expect(lineLimitRefusal(ask, strictest, 0), p.id).toBeNull();
      }
    }
    // "Bolder" takes the lead inside how far they've gone: it says so itself.
    for (const ask of [preset("bolder").ask, preset("bolder").spoken]) expect(ask).toContain("inside how far they have already taken things");
  });

  it("the writer is told once, after what the reply answers, that every rule above still holds", async () => {
    scripted();
    const character = (await sceneCharacter(t.db, WHO))!;
    const base = { character, place: { label: "your place", situation: null, public: false }, roleplay: null, persona: null, limits: NO_LIMITS, turns: [{ role: "viewer" as const, text: LINE }] };
    const cue = redrawCue(preset("slower").ask);
    expect(cue).toBe(
      `(They asked you to write that reply again with one change: ${preset("slower").ask}. Write it that way. Everything above still holds: their limits and how far they have taken things, the pace, and never writing what they do, say, think or feel.)`,
    );
    const plain = stepInMessages(base);
    expect(JSON.stringify(plain)).not.toContain("write that reply again");
    const directed = stepInMessages({ ...base, direction: preset("slower").ask });
    expect(lastUser(directed)).toBe(`${LINE}\n\n${cue}`);
    expect(JSON.stringify(directed).split("write that reply again")).toHaveLength(2);
    // The rules it mustn't outrank are untouched, and a draft that couldn't be used is still said last.
    expect(system(directed)).toBe(system(plain));
    expect(lastUser(stepInMessages({ ...base, direction: preset("slower").ask, avoid: "it was too long" }))).toBe(`${LINE}\n\n${cue}\n\n(Your last draft couldn't be used: it was too long. Write this reply again without that.)`);
    // After a carry-on, and for a reply said out loud, it follows that cue.
    expect(lastUser(stepInMessages({ ...base, turns: [{ role: "character" as const, text: "She waited." }], cue: "continue", direction: "x" }))).toBe(`${CONTINUE_CUE}\n\n${redrawCue("x")}`);
    expect(lastUser(stepInMessages({ ...base, form: "talk", direction: "x" }))).toBe(`${LINE}\n\n${TALK_CUE}\n\n${redrawCue("x")}`);
  });
});

describe("this reply again, with one change", () => {
  it("draws the newest reply again that way, once: the same line answered, the first draw kept to flip to, one reply counted, and only the direction's name in the log", async () => {
    const seen = scripted();
    const a = await admin();
    const s = await scene(a.id);
    const before = { prompts: seen.prompts.length, replies: await replies(a.id) };
    const r = await again(a.id, s.id, { preset: "slower" });
    expect(r.ok).toBe(true);
    expect(seen.prompts).toHaveLength(before.prompts + 1);
    // What it answers is the same line, then the change, said once; and what the first draw said, to be different from.
    expect(lastUser(seen.prompts.at(-1)!)).toBe(`${LINE}\n\n${redrawCue(preset("slower").ask)}`);
    expect(system(seen.prompts.at(-1)!)).toContain("You wrote this reply once already; write a different one");
    expect(await replies(a.id)).toBe(before.replies + 1);
    let view = await viewOf(a.id, s.id);
    expect(view.draws).toEqual({ count: 2, showing: 2 });
    expect(view.messages.at(-1)!.id).not.toBe(s.reply.id);
    view = ((await swipeStepIn(t.db, a.id, s.id, "prev")) as { view: StepInSceneView }).view;
    expect(view.messages.at(-1)!).toMatchObject({ id: s.reply.id, text: s.reply.text });
    expect((await steps(a.id)).at(-1)).toMatchObject({ status: "ok", flags: { action: "regenerate", direction: "slower" } });
    // Only that draw: the next reply is told nothing of it, and a redraw with no direction is as it always was.
    expect(await swipeStepIn(t.db, a.id, s.id, "next")).toMatchObject({ ok: true });
    await sendStepInLine(t.db, a.id, s.id, "I pour us both a glass.");
    expect(JSON.stringify(seen.prompts.at(-1))).not.toContain("write that reply again");
    await regenerateStepIn(t.db, a.id, s.id);
    expect(lastUser(seen.prompts.at(-1)!)).toBe("I pour us both a glass.");
    expect((await steps(a.id)).at(-1)!.flags).not.toHaveProperty("direction");
  });

  it("takes a few words of the viewer's own, on one line and as theirs; with a chip too, both are said; the words are never kept", async () => {
    const seen = scripted();
    const a = await admin();
    const s = await scene(a.id);
    expect((await again(a.id, s.id, { text: '  more eye contact,\n and her "real" laugh  ' })).ok).toBe(true);
    expect(lastUser(seen.prompts.at(-1)!)).toBe(`${LINE}\n\n${redrawCue(`in their own words, "more eye contact, and her 'real' laugh"`)}`);
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ direction: "own" });
    expect((await again(a.id, s.id, { preset: "teasing", text: "she keeps her coat on" })).ok).toBe(true);
    expect(lastUser(seen.prompts.at(-1)!)).toBe(`${LINE}\n\n${redrawCue(`${preset("teasing").ask}; and in their own words, "she keeps her coat on"`)}`);
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ direction: "teasing+own" });
    expect((await viewOf(a.id, s.id)).draws).toEqual({ count: 3, showing: 3 });
    const all = await everything();
    for (const words of ["eye contact", "real' laugh", "keeps her coat on"]) expect(all).not.toContain(words);
  });

  it("their own words are held to what a line of theirs is: the lines that never move, their hard nos and intensity, and the length; nothing is drawn, counted or kept", async () => {
    const seen = scripted();
    const a = await admin();
    const s = await scene(a.id);
    expect(await saveStepInLimits(t.db, a.id, s.id, { intensity: "slow_burn", hard_nos: { chips: ["spitting"], own: ["tickling"] } }, { consent: true })).toMatchObject({ ok: true });
    const before = { prompts: seen.prompts.length, replies: await replies(a.id), steps: (await steps(a.id)).length };
    for (const [text, message] of [
      ["as if she were only fifteen", "That direction crosses one of the lines that never move (nobody under 18, or anything that suggests it)."],
      ["like she is my stepsister", "That direction crosses one of the lines that never move (no family or step-family roleplay)."],
      ["she spits the olive pit at me", "That direction asks for one of your hard limits for this scene (Spitting). Change it, or the limits, first."],
      ["with tickling", 'That direction asks for one of your hard limits for this scene ("tickling"). Change it, or the limits, first.'],
      ["she unbuttons her shirt", "That direction goes past kissing, as far as slow burn goes. Change it, or turn the intensity up, first."],
    ] as const) {
      expect(await again(a.id, s.id, { preset: "bolder", text }), text).toMatchObject({ ok: false, status: 422, message });
    }
    expect(await again(a.id, s.id, { text: "x".repeat(REDRAW_TEXT_MAX + 1) })).toMatchObject({ ok: false, status: 422, error: "invalid_direction" });
    expect(await again(a.id, s.id, { text: "more {a} and {b}" })).toMatchObject({ ok: false, status: 422, error: "invalid_direction" });
    expect(await again(a.id, s.id, { preset: "louder" as never })).toMatchObject({ ok: false, status: 422, error: "invalid_direction" });
    expect(seen.prompts).toHaveLength(before.prompts);
    expect(await replies(a.id)).toBe(before.replies);
    expect((await viewOf(a.id, s.id)).draws).toBeNull();
    // Counted as refusals by their kind, with no word of the direction and no name for it.
    const refusals = (await steps(a.id)).slice(before.steps);
    expect(refusals.map((r) => (r.flags as { refused: string }).refused)).toEqual(["lines", "lines", "limits", "limits", "limits"]);
    expect(refusals.every((r) => r.status === "error" && r.http === 422 && !("direction" in (r.flags as object)))).toBe(true);
    const all = await everything();
    for (const words of ["fifteen", "stepsister", "olive pit", "with tickling", "unbuttons"]) expect(all).not.toContain(words);
    // Exactly at the length, and mild: drawn.
    const longest = "more of her dry humour, and the way she looks at me over the rim of her glass before she answers, unhurried, amused, in no rush at all tonight".slice(0, REDRAW_TEXT_MAX);
    expect(longest).toHaveLength(REDRAW_TEXT_MAX);
    expect((await again(a.id, s.id, { text: longest })).ok).toBe(true);
  });

  it("their own words are read for the self-harm check first: the scene pauses with the resources, and nothing is drawn or kept", async () => {
    const seen = scripted();
    const a = await admin();
    const s = await scene(a.id);
    const before = { prompts: seen.prompts.length, replies: await replies(a.id) };
    const r = await again(a.id, s.id, { preset: "softer", text: "like I want to kill myself" });
    expect(r).toMatchObject({ ok: false, status: 200, error: "paused" });
    expect((r as { crisis_resources?: { lines: unknown[] } }).crisis_resources?.lines.length).toBeGreaterThan(0);
    expect(seen.prompts).toHaveLength(before.prompts);
    expect(await replies(a.id)).toBe(before.replies);
    expect((await viewOf(a.id, s.id)).paused).toBe(true);
    expect(await everything()).not.toContain("kill myself");
    // Paused: a chip alone is refused like any other move, until they carry on.
    expect(await again(a.id, s.id, { preset: "slower" })).toMatchObject({ ok: false, status: 409, error: "paused" });
  });

  it("a reply said out loud is drawn again as one, told the change the spoken way", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME });
    if (!made.ok) throw new Error("no scene");
    await sendStepInLine(t.db, a.id, made.id, LINE, new Date(), { talk: true });
    expect((await viewOf(a.id, made.id)).messages.at(-1)).toMatchObject({ kind: "talk", text: `"${SAID[0]}"` });
    expect((await again(a.id, made.id, { preset: "shorter" })).ok).toBe(true);
    expect(seen.talked).toHaveLength(2);
    expect(lastUser(seen.talked.at(-1)!)).toBe(`${LINE}\n\n${TALK_CUE}\n\n${redrawCue("shorter: one short sentence")}`);
    expect((await viewOf(a.id, made.id)).messages.at(-1)).toMatchObject({ kind: "talk", text: `"${SAID[1]}"` });
    expect((await steps(a.id)).at(-1)!.flags).toMatchObject({ action: "regenerate", direction: "shorter", talk: true });
  });

  it("with no reply to draw again there's nothing to change: the reply that's due is drawn, and the direction is left out", async () => {
    // The model is down for the reply to their line: the line is kept, and nothing answers it yet.
    const seen = scripted(FINE[0], new Error("down"), FINE[1]);
    const a = await admin();
    const made = await startStepIn(t.db, a.id, { character_id: WHO, place: HOME });
    if (!made.ok) throw new Error("no scene");
    expect(await sendStepInLine(t.db, a.id, made.id, LINE)).toMatchObject({ ok: true, replied: false });
    expect((await again(a.id, made.id, { preset: "bolder", text: "she leans in" })).ok).toBe(true);
    expect(lastUser(seen.prompts.at(-1)!)).toBe(LINE);
    expect((await steps(a.id)).at(-1)!.flags).not.toHaveProperty("direction");
    expect((await viewOf(a.id, made.id)).draws).toBeNull();
  });

  it("is one reply like any other: refused at the month's cap, and in a scene that has ended", async () => {
    scripted();
    await saveAdultSettings(t.db, { caps: { step_in: 2 }, rollout: { companion: "everyone" } });
    const sub = randomUUID();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const s = await scene(sub);
    expect(await again(sub, s.id, { preset: "slower" })).toMatchObject({ ok: false, status: 429, error: "capped", message: "You've used this month's 2 Step in replies. They reset on the 1st." });
    const a = await admin();
    const theirs = await scene(a.id);
    await endStepIn(t.db, a.id, theirs.id);
    expect(await again(a.id, theirs.id, { preset: "slower" })).toMatchObject({ ok: false, status: 409, error: "ended" });
  });
});

describe("the route and the page", () => {
  it("the scene's regenerate move takes a direction: one of ours, up to 120 characters of theirs, and nothing else", async () => {
    const seen = scripted();
    const a = await admin();
    const s = await scene(a.id);
    const path = `/api/admin/after-dark/step-in/${s.id}`;
    const move = (body: unknown) => scenePost(post(path, body, a.cookie), ctx(s.id));
    for (const bad of [{ preset: "louder" }, { text: "x".repeat(REDRAW_TEXT_MAX + 1) }, { preset: "slower", words: "more" }, "slower"]) {
      expect((await move({ action: "regenerate", direction: bad })).status, JSON.stringify(bad).slice(0, 40)).toBe(422);
    }
    expect((await viewOf(a.id, s.id)).draws).toBeNull();
    const res = await move({ action: "regenerate", direction: { preset: "teasing", text: "she keeps her coat on" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scene: StepInSceneView }).scene.draws).toEqual({ count: 2, showing: 2 });
    expect(lastUser(seen.prompts.at(-1)!)).toContain(preset("teasing").ask);
    // A refused direction answers with the scene as it stands and why, as a refused line does.
    const refused = await move({ action: "regenerate", direction: { text: "as if she were only fifteen" } });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: "refused", message: expect.stringContaining("That direction crosses one of the lines that never move"), scene: { draws: { count: 2, showing: 2 } } });
    // Without one it's the blind redraw it always was.
    expect((await move({ action: "regenerate" })).status).toBe(200);
    expect(lastUser(seen.prompts.at(-1)!)).toBe(LINE);
  });

  it("the page offers it on the newest reply of a running scene, closed until asked for, and never as a form", async () => {
    scripted(FINE[0], FINE[1], new Error("down"));
    const a = await admin();
    const s = await scene(a.id);
    signIn(a.id);
    const page = async (id: string) => html(await StepInScenePage({ params: Promise.resolve({ id }) }));
    const live = await page(s.id);
    expect(live).toMatch(/<button type="button" class="button-ghost small" aria-expanded="false" aria-controls="ad-si-again" data-step-in-again-open="true">↻ Again…<\/button>/);
    expect(live.match(/data-step-in-again-open/g)).toHaveLength(1);
    // Its chips and its box come when it's opened.
    expect(live).not.toContain('data-step-in-again="true"');
    // The viewer wrote last and nothing has answered: there's no reply to draw again.
    expect(await sendStepInLine(t.db, a.id, s.id, "I pour us both a glass.")).toMatchObject({ ok: true, replied: false });
    expect(await page(s.id)).not.toContain("data-step-in-again-open");
    await endStepIn(t.db, a.id, s.id);
    expect(await page(s.id)).not.toContain("data-step-in-again-open");
    // In the page's source: every control a plain button, the box an input with an Enter handler, no form of its own,
    // a chip for every direction, and its row held to the scene's column.
    const src = readFileSync("app/after-dark/step-in/[id]/StepInScene.tsx", "utf8");
    const panel = src.slice(src.indexOf('<div className="ad-si-again"'), src.indexOf("{/* Something to say first"));
    expect(panel).toContain("REDRAW_PRESETS.filter(");
    expect(panel).not.toContain("<form");
    expect(panel).not.toContain('type="submit"');
    expect(panel.match(/<button\b/g)).toHaveLength(2);
    expect(panel.match(/<button\b[^>]*type="button"/g)).toHaveLength(2);
    expect(panel).toContain("e.preventDefault();");
    expect(panel).toContain("maxLength={REDRAW_TEXT_MAX}");
    expect(src.match(/<form\b/g)).toHaveLength(1);
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    expect(css).toMatch(/\.ad-si-under,\n\.ad-si-again,\n\.ad-si-starters,/);
  });
});
