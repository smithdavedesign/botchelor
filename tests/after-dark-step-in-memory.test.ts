// Step in's memory (lib/adult/step-in-memory.ts; docs/after-dark.md "Step in": memory): what a character remembers
// about the viewer between scenes. Off until they agree; drawn only from what they wrote, never in a roleplay; every fact
// held to the lines; theirs to see, change and forget; gone when they turn it off; and closed like the rest of Step in.
// The fixtures are mild lines plus the short phrases the checks must refuse.
import { readFileSync } from "node:fs";
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
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import { GET as memoryGet, POST as memoryPost } from "@/app/api/admin/after-dark/step-in/memory/route";
import { deleteAccount } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { deleteAdultProfile, exportAdultProfile } from "@/lib/adult/profile-data";
import { saveAdultSettings } from "@/lib/adult/settings";
import { endStepIn, getStepInScene, sendStepInLine, setStepInRandomForTests, startStepIn, stepInFollowUp, stepInRemember } from "@/lib/adult/step-in";
import { addFact, editFact, FACT_MAX, FACTS_EVERY, FACTS_IN_PROMPT, FACTS_PER_CHARACTER, factOk, factsForPrompt, forgetFacts, listFacts, MEMORY_CONSENT_TEXT, memoryOn, setMemory } from "@/lib/adult/step-in-memory";
import { STEP_IN_REMEMBERS } from "@/lib/adult/step-in-prompt";
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
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
});

const WHO = HOUSE_CHARACTERS[0].id;
const OTHER = HOUSE_CHARACTERS[1].id;
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
const isFacts = (m: ChatMessage[]) => m[0].content.startsWith("You keep a short list of lasting facts about one person");
const REPLIES = [
  { story: ['She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."] },
  { story: ['She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."', "The waiter hovered, decided against it, and went back to polishing a glass that was already clean."] },
  { story: ['"Tell me the worst part of your week," she said, and reached over to take her hand back from the cold glass.', "Somewhere behind the bar a radio found a song from ten summers ago and kept it low."] },
  { story: ['She laughed, short and surprised. "That is not how that story ends and we both know it."', "The candle between the plates had burned down to a stub, and nobody had come to change it."] },
  { story: ['"Walk with me," she said, already reaching for her coat. "The rain has stopped pretending."', "The street outside was all reflections, and the bus shelter across the road hummed under its one light."] },
  { story: ['She held the door with her shoulder. "After you. I want to see which way you turn."', "The night air smelled of wet pavement and somebody else's dinner."] },
  { story: ['"Left, then," she said, falling in beside. "I had you down as someone who goes left."', "A tram went by with nobody on it, lit like a shop window."] },
  { story: ['She stopped at the corner. "This is where I usually say goodnight. I am not saying it yet."', "Above them a window opened and somebody shook a tablecloth into the dark."] },
  { story: ['"Tell me one true thing before the light changes," she said.', "The crossing counted down in red, unhurried."] },
];
/** The scripted model: replies in order, the notes call, and the facts call answering `facts` (kept as seen). */
function scripted(facts: unknown = { facts: [] }) {
  const seen = { replies: [] as ChatMessage[][], facts: [] as ChatMessage[][] };
  let i = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      if (isFacts(m)) {
        seen.facts.push(m);
        return typeof facts === "string" ? facts : JSON.stringify(facts);
      }
      seen.replies.push(m);
      return JSON.stringify(REPLIES[Math.min(i++, REPLIES.length - 1)]);
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
async function start(viewer: string, extra: Partial<Parameters<typeof startStepIn>[2]> = {}) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place: HOME, ...extra });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
const viewOf = async (viewer: string, id: string) => {
  const r = await getStepInScene(t.db, viewer, id);
  if (!r.ok) throw new Error("no scene");
  return r.view;
};
/** The viewer's lines: what a draw reads. Mild, each different. */
const LINES = ["I'm Sam, by the way.", "I fix bicycles for a living.", "I like it when you ask first.", "My shop is by the canal.", "I don't drink, but I'll sit with you.", "Call me early, never late.", "I take the long way home."];
async function say(viewer: string, id: string, n: number, from = 0) {
  for (const line of LINES.slice(from, from + n)) {
    const r = await sendStepInLine(t.db, viewer, id, line);
    if (!r.ok) throw new Error(`send failed: ${r.message}`);
  }
}
const post = (body: unknown, cookie: string) => new Request(`${BASE_URL}/api/admin/after-dark/step-in/memory`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const get = (character: string, cookie: string) => new Request(`${BASE_URL}/api/admin/after-dark/step-in/memory?character=${character}`, { headers: { cookie } });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const texts = async (viewer: string, character = WHO) => (await listFacts(t.db, viewer, character)).map((f) => f.text);

describe("off until they turn it on", () => {
  it("keeps nothing, draws nothing and tells the character nothing while it's off; on only with the consent ticked", async () => {
    const seen = scripted({ facts: ["They go by Sam."] });
    const a = await admin();
    const made = await start(a.id);
    expect(await memoryOn(t.db, a.id)).toBe(false);
    expect((await viewOf(a.id, made.id)).memory).toEqual({ on: false, facts: 0 });
    await say(a.id, made.id, FACTS_EVERY);
    expect(await stepInFollowUp(t.db, made.id)).toBe(false);
    expect(seen.facts).toHaveLength(0);
    expect(await rows(`select 1 from adult_step_in_facts`)).toHaveLength(0);
    expect(seen.replies.every((m) => !m[0].content.includes(STEP_IN_REMEMBERS))).toBe(true);
    // Adding one by hand needs it on too.
    expect(await addFact(t.db, a.id, WHO, "They go by Sam.")).toMatchObject({ ok: false, status: 409, error: "memory_off" });
    // The switch: nothing without the box ticked, and the refusal says the words they'd be agreeing to.
    const refused = await setMemory(t.db, a.id, true);
    expect(refused).toMatchObject({ ok: false, status: 403, consent_required: true });
    expect((refused as { message: string }).message).toContain(MEMORY_CONSENT_TEXT);
    expect(await memoryOn(t.db, a.id)).toBe(false);
    expect(await setMemory(t.db, a.id, true, { consent: true })).toEqual({ ok: true, on: true, forgotten: 0 });
    expect(await memoryOn(t.db, a.id)).toBe(true);
    expect((await viewOf(a.id, made.id)).memory).toEqual({ on: true, facts: 0 });
  });
});

describe("what's drawn", () => {
  it("comes only from what the viewer wrote, once enough of it is new; every fact is held to the lines; nothing twice", async () => {
    const seen = scripted({
      facts: [
        "They go by Sam.",
        "They fix bicycles for a living.",
        "They said their sister lives nearby.", // a family word: Step in's own net
        "Sam is a nice name.", // not about them as "They"
        "They go by Sam.", // twice
        "They want to hurt themselves.", // nothing like this is ever kept
        42,
      ],
    });
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    const made = await start(a.id);
    await say(a.id, made.id, FACTS_EVERY - 1);
    await stepInFollowUp(t.db, made.id);
    // Not enough new lines yet: no call.
    expect(seen.facts).toHaveLength(0);
    await say(a.id, made.id, 1, FACTS_EVERY - 1);
    await stepInFollowUp(t.db, made.id);
    expect(seen.facts).toHaveLength(1);
    expect((await texts(a.id)).sort()).toEqual(["They fix bicycles for a living.", "They go by Sam."]);
    // The call read the viewer's own lines and none of the character's.
    const asked = seen.facts[0][1].content;
    for (const line of LINES.slice(0, FACTS_EVERY)) expect(asked).toContain(line);
    expect(asked).not.toContain("You made it");
    expect(asked).not.toContain("olives");
    // Read once: the same lines aren't read again, and what's known goes with the next ask.
    await stepInFollowUp(t.db, made.id);
    expect(seen.facts).toHaveLength(1);
    expect((await viewOf(a.id, made.id)).memory).toEqual({ on: true, facts: 2 });
    // The next scene with them: ending this one reads whatever is new, however little.
    await say(a.id, made.id, 1, FACTS_EVERY);
    await endStepIn(t.db, a.id, made.id);
    expect(await stepInRemember(t.db, made.id, { atEnd: true })).toBe(0);
    expect(seen.facts).toHaveLength(1);
    await t.db.query(`update adult_step_in_scenes set facts_upto = facts_upto - interval '1 hour' where id = $1`, [made.id]);
    await stepInRemember(t.db, made.id, { atEnd: true });
    expect(seen.facts).toHaveLength(2);
    expect(seen.facts[1][1].content).toContain("Already known:\n- ");
  });

  it("never draws from a roleplay: what they say there is their role, not their life", async () => {
    const seen = scripted({ facts: ["They are a hotel guest with the wrong key."] });
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    const made = await start(a.id, { roleplay: { id: "hotel-mixup", you: 0 } });
    await say(a.id, made.id, FACTS_EVERY);
    await stepInFollowUp(t.db, made.id);
    expect(seen.facts).toHaveLength(0);
    expect(await texts(a.id)).toEqual([]);
  });

  it("an answer that can't be read keeps nothing and moves on", async () => {
    scripted("not json at all");
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    const made = await start(a.id);
    await say(a.id, made.id, FACTS_EVERY);
    expect(await stepInRemember(t.db, made.id)).toBe(0);
    expect(await texts(a.id)).toEqual([]);
  });
});

describe("what the character is told", () => {
  it("carries a few of this character's facts about this viewer, pinned first, and never anyone else's", async () => {
    const seen = scripted();
    const a = await admin();
    const b = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    await setMemory(t.db, b.id, true, { consent: true });
    expect(await addFact(t.db, a.id, WHO, "They go by Sam.")).toMatchObject({ ok: true, fact: { pinned: true, yours: true } });
    await addFact(t.db, a.id, OTHER, "They told someone else a different thing.");
    await addFact(t.db, b.id, WHO, "They are another viewer entirely.");
    signIn(a.id);
    const made = await start(a.id);
    const system = seen.replies.at(-1)![0].content;
    expect(system).toContain(STEP_IN_REMEMBERS);
    expect(system).toContain("- They go by Sam.");
    expect(system).not.toContain("different thing");
    expect(system).not.toContain("another viewer");
    // No more than a prompt's share, the pinned ones first.
    for (let i = 0; i < FACTS_IN_PROMPT + 3; i++) await t.db.query(`insert into adult_step_in_facts (id, owner_id, character_id, text) values ($1, $2, $3, $4)`, [randomUUID(), a.id, WHO, `They mentioned thing number ${i}.`]);
    const used = await factsForPrompt(t.db, a.id, WHO);
    expect(used).toHaveLength(FACTS_IN_PROMPT);
    expect(used[0]).toBe("They go by Sam.");
    // One kept before a check got stricter never reaches a prompt: read again as it's used.
    await t.db.query(`update adult_step_in_facts set text = 'They said their sister lives nearby.' where owner_id = $1 and text = 'They go by Sam.'`, [a.id]);
    expect(await factsForPrompt(t.db, a.id, WHO)).not.toContain("They said their sister lives nearby.");
    expect(made.id).toBeTruthy();
  });
});

describe("theirs to see and change", () => {
  it("adds, rewrites, pins and forgets; holds their own words to the same lines; and stops at what a character keeps", async () => {
    scripted();
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    const added = await addFact(t.db, a.id, WHO, `  They   like long walks.  `);
    expect(added).toMatchObject({ ok: true, fact: { text: "They like long walks.", pinned: true, yours: true } });
    expect(await addFact(t.db, a.id, WHO, "they like long walks")).toMatchObject({ ok: false, status: 409, error: "known" });
    expect(await addFact(t.db, a.id, WHO, "   ")).toMatchObject({ ok: false, status: 400 });
    expect(await addFact(t.db, a.id, WHO, "My sister introduced us.")).toMatchObject({ ok: false, status: 422, error: "refused" });
    expect(await addFact(t.db, a.id, WHO, "I want to kill myself.")).toMatchObject({ ok: false, error: "crisis", crisis_resources: expect.any(Object) });
    // Said the way a fact is written, it's the same answer: the resources, never the lines' message.
    expect(await addFact(t.db, a.id, WHO, "They want to hurt themselves.")).toMatchObject({ ok: false, error: "crisis", crisis_resources: expect.any(Object) });
    expect(await addFact(t.db, a.id, WHO, "x".repeat(FACT_MAX + 50))).toMatchObject({ ok: true, fact: { text: "x".repeat(FACT_MAX) } });
    expect(factOk("They like being asked first.")).toBe(true);
    expect(factOk("They are seventeen.")).toBe(false);
    // Nothing about hurting themselves is a thing to remember, however a note would put it.
    for (const note of ["They want to hurt themselves.", "They talked about suicide.", "They said they want to die.", "They have thought about ending their life."]) expect(factOk(note), note).toBe(false);
    const id = (added as { fact: { id: string } }).fact.id;
    expect(await editFact(t.db, a.id, id, { text: "They like long walks by the canal." })).toMatchObject({ ok: true, fact: { text: "They like long walks by the canal.", yours: true } });
    expect(await editFact(t.db, a.id, id, { pinned: false })).toMatchObject({ ok: true, fact: { pinned: false } });
    expect(await editFact(t.db, a.id, id, { text: "They met my daughter." })).toMatchObject({ ok: false, status: 422 });
    // Never another viewer's.
    const b = await admin();
    expect(await editFact(t.db, b.id, id, { text: "Changed by someone else." })).toMatchObject({ ok: false, status: 404 });
    expect(await forgetFacts(t.db, b.id, WHO, id)).toBe(0);
    expect(await forgetFacts(t.db, a.id, WHO, id)).toBe(1);
    // Full: the least used one the viewer didn't write or pin makes room; with only their own left, it says so.
    await forgetFacts(t.db, a.id, WHO);
    for (let i = 0; i < FACTS_PER_CHARACTER; i++) await t.db.query(`insert into adult_step_in_facts (id, owner_id, character_id, text, uses) values ($1, $2, $3, $4, $5)`, [`f${i}`, a.id, WHO, `They mentioned thing number ${i}.`, i]);
    expect(await addFact(t.db, a.id, WHO, "They keep a spare key under the mat.")).toMatchObject({ ok: true });
    expect(await rows(`select 1 from adult_step_in_facts where id = 'f0'`)).toHaveLength(0);
    expect(await rows(`select 1 from adult_step_in_facts where owner_id = $1 and character_id = $2`, [a.id, WHO])).toHaveLength(FACTS_PER_CHARACTER);
    await t.db.query(`update adult_step_in_facts set edited = true where owner_id = $1`, [a.id]);
    expect(await addFact(t.db, a.id, WHO, "They have one more thing to say.")).toMatchObject({ ok: false, status: 409, error: "full" });
  });

  it("turning it off deletes everything, with every character, and the character is told nothing after", async () => {
    const seen = scripted();
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    await addFact(t.db, a.id, WHO, "They go by Sam.");
    await addFact(t.db, a.id, OTHER, "They fix bicycles.");
    expect(await setMemory(t.db, a.id, false)).toEqual({ ok: true, on: false, forgotten: 2 });
    expect(await rows(`select 1 from adult_step_in_facts where owner_id = $1`, [a.id])).toHaveLength(0);
    expect(await memoryOn(t.db, a.id)).toBe(false);
    await start(a.id);
    expect(seen.replies.at(-1)![0].content).not.toContain(STEP_IN_REMEMBERS);
    // On again asks for the consent again.
    expect(await setMemory(t.db, a.id, true)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the route and the page", () => {
  it("is closed like the rest of Step in; the switch, the facts and the changes all go through it; the scene's menu has the panel", async () => {
    scripted();
    const sub = await subscriber();
    expect((await memoryGet(get(WHO, sub.cookie))).status).toBe(404);
    expect((await memoryPost(post({ action: "on", consent: true }, sub.cookie))).status).toBe(404);
    const a = await admin();
    const made = await start(a.id);
    let page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain('data-step-in-memory="off"');
    const first = (await (await memoryGet(get(WHO, a.cookie))).json()) as { on: boolean; consent_text: string; facts: unknown[] };
    expect(first).toMatchObject({ on: false, consent_text: MEMORY_CONSENT_TEXT, facts: [] });
    // On needs the tick in the request itself.
    expect((await memoryPost(post({ action: "on" }, a.cookie))).status).toBe(422);
    expect((await memoryPost(post({ action: "on", consent: true }, a.cookie))).status).toBe(200);
    const added = await memoryPost(post({ action: "add", character_id: WHO, text: "They go by Sam." }, a.cookie));
    expect(added.status).toBe(200);
    const { facts } = (await added.json()) as { facts: { id: string; text: string }[] };
    expect(facts.map((f) => f.text)).toEqual(["They go by Sam."]);
    expect((await memoryPost(post({ action: "add", character_id: WHO, text: "My sister says hi." }, a.cookie))).status).toBe(422);
    expect(await (await memoryPost(post({ action: "edit", character_id: WHO, fact_id: facts[0].id, text: "They go by Sam, never Samuel." }, a.cookie))).json()).toMatchObject({ facts: [{ text: "They go by Sam, never Samuel." }] });
    // Someone not in their After Dark has no memory to ask about.
    expect((await memoryGet(get("nobody-at-all", a.cookie))).status).toBe(404);
    expect((await memoryPost(post({ action: "add", character_id: "nobody-at-all", text: "They go by Sam." }, a.cookie))).status).toBe(404);
    page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain('data-step-in-memory="on"');
    expect(page).toContain(`What ${NAME} remembers (1)`);
    expect(await (await memoryPost(post({ action: "forget", character_id: WHO, fact_id: facts[0].id }, a.cookie))).json()).toMatchObject({ on: true, facts: [] });
    expect(await (await memoryPost(post({ action: "off" }, a.cookie))).json()).toMatchObject({ on: false });
  });
});

describe("the panel in the scene's menu", () => {
  it("has no form of its own: the menu sits inside the composer's form, where a form's Add would send the page instead", () => {
    // The first live check (2026-11-23): Add was a submit button in a form inside the composer's form. The browser
    // reloaded the page and nothing was kept.
    for (const file of ["app/after-dark/step-in/[id]/StepInMemory.tsx", "app/after-dark/[a]/[b]/Limits.tsx"]) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, file).not.toMatch(/<form\b/);
      expect(src, file).not.toContain('type="submit"');
    }
    // The composer's form is the one they're inside.
    const scene = readFileSync("app/after-dark/step-in/[id]/StepInScene.tsx", "utf8");
    const form = scene.slice(scene.indexOf('className="ad-si-composer"'), scene.lastIndexOf("</form>"));
    expect(form).toContain("<StepInMemory");
    expect(form).toContain("<Limits");
    // Enter in the panel's boxes is the panel's, never the composer's Send.
    const panel = readFileSync("app/after-dark/step-in/[id]/StepInMemory.tsx", "utf8");
    expect(panel.match(/onKeyDown=\{onEnter\(/g)?.length).toBe(2);
    expect(panel).toContain("e.preventDefault()");
  });
});

describe("the menu the panel sits in", () => {
  it("is one column that can't grow past its box, and no taller than the room above the composer", () => {
    // The first live check (2026-11-23): the menu's column took its widest item's width, so the menu scrolled sideways
    // and the panel's Add was out of view; and at 70vh its top went under the page's header.
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    const rule = css.slice(css.indexOf(".ad-si-menu-items {"), css.indexOf("}", css.indexOf(".ad-si-menu-items {")));
    expect(rule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(rule).toContain("max-height: min(70vh, 30rem);");
    expect(rule).toContain("overflow-y: auto;");
  });
});

describe("with the account", () => {
  it("is in After Dark's download, goes with its Delete it, and goes with the account", async () => {
    scripted();
    const a = await admin();
    await setMemory(t.db, a.id, true, { consent: true });
    await addFact(t.db, a.id, WHO, "They go by Sam.");
    const out = await exportAdultProfile(t.db, a.id);
    expect(out.memory.on_since).toBeTruthy();
    expect(out.memory.consent_text).toBe(MEMORY_CONSENT_TEXT);
    expect(out.memory.facts).toEqual([expect.objectContaining({ character_id: WHO, text: "They go by Sam.", pinned: true, yours: true })]);
    await deleteAdultProfile(t.db, a.id);
    expect(await rows(`select 1 from adult_step_in_facts where owner_id = $1`, [a.id])).toHaveLength(0);
    expect(await memoryOn(t.db, a.id)).toBe(false);
    expect((await exportAdultProfile(t.db, a.id)).memory).toMatchObject({ on_since: null, facts: [] });
    // And with the account itself.
    await setMemory(t.db, a.id, true, { consent: true });
    await addFact(t.db, a.id, WHO, "They go by Sam.");
    await deleteAccount(t.db, a.id);
    expect(await rows(`select 1 from adult_step_in_facts where owner_id = $1`, [a.id])).toHaveLength(0);
    expect(await rows(`select 1 from adult_prefs where user_id = $1`, [a.id])).toHaveLength(0);
  });
});
