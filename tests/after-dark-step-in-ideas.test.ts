// Ideas for what to say next in a Step in scene (lib/adult/step-in-ideas.ts; docs/after-dark.md "Step in": ideas):
// three lines under the character's newest reply, one of each tone, drawn once and kept; each one held to the checks a
// written line gets; nothing for a scene that can't be written; and closed like the rest of Step in.
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
import { POST as ideasPost } from "@/app/api/admin/after-dark/step-in/[id]/ideas/route";
import { claimAdmin } from "@/lib/admins";
import { NO_LIMITS, type PairLimits } from "@/lib/adult/limits";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { saveAdultSettings } from "@/lib/adult/settings";
import { endStepIn, ideasScene, lineWouldGoIn, saveStepInLimits, sendStepInLine, setStepInRandomForTests, startStepIn } from "@/lib/adult/step-in";
import { IDEA_DRAWS, IDEA_MAX, ideaOk, ideasPrompt, stepInIdeas } from "@/lib/adult/step-in-ideas";
import { IDEA_TONES } from "@/lib/adult/step-in-shared";
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
const NAME = HOUSE_CHARACTERS[0].name.split(/\s+/)[0];
const HOME = "venue:home";
const CAFE = "venue:corner_cafe";

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
const isIdeas = (m: ChatMessage[]) => m[0].content.startsWith("You help one person decide what to write next");
/** Replies in order (the last one again): each different, so none is drawn twice for repeating the one before. */
const REPLIES = [
  { story: ['She set her glass down and turned on the stool. "You made it," she said, as if it had been in doubt.', "Rain had started on the window behind her, and the lamp on the counter made a small warm circle of it."] },
  { story: ['She pushed the menu across with one finger. "Order for both of us. I trust you with everything except the olives."', "The waiter hovered, decided against it, and went back to polishing a glass that was already clean."] },
  { story: ['"Tell me the worst part of your week," she said, and turned her glass a quarter turn on the counter.', "Somewhere behind the bar a radio found a song from ten summers ago and kept it low."] },
];
const GOOD = { warm: '"I\'m glad I came. I almost didn\'t."', playful: 'I look at the rain. "You ordered this weather, didn\'t you?"', bold: 'I take the stool next to yours. "Then let\'s not waste it."' };
const OTHERS = { warm: '"Tell me what you were thinking about before I walked in."', playful: '"Was it in doubt? I\'m hurt."', bold: 'I lean in. "Show me your favourite corner of this place."' };
/** The scripted model: replies get REPLY; the ideas call answers `ideas` in order (the last one again), kept as seen. */
function scripted(...ideas: unknown[]) {
  const seen = { replies: 0, ideas: [] as ChatMessage[][] };
  let i = 0;
  let n = 0;
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      if (isIdeas(m)) {
        seen.ideas.push(m);
        const r = ideas.length ? ideas[Math.min(i++, ideas.length - 1)] : GOOD;
        if (r instanceof Error) throw r;
        return typeof r === "string" ? r : JSON.stringify(r);
      }
      seen.replies++;
      return JSON.stringify(REPLIES[Math.min(n++, REPLIES.length - 1)]);
    },
  });
  return seen;
}

const rows = async (sql: string, params: unknown[] = []) => (await t.db.query<Record<string, unknown>>(sql, params)).rows;
const used = async (id: string) => Number((await rows(`select writes as n from adult_usage where owner_id = $1`, [id]))[0]?.n ?? 0);
async function start(viewer: string, place = HOME) {
  const r = await startStepIn(t.db, viewer, { character_id: WHO, place });
  if (!r.ok) throw new Error(`start failed: ${r.status} ${r.message}`);
  return r;
}
async function ideasOf(viewer: string, id: string, again = false) {
  const r = await stepInIdeas(t.db, viewer, id, { again });
  if (!r.ok) throw new Error(`ideas failed: ${r.status} ${r.message}`);
  return r;
}
const post = (id: string, body: unknown, cookie: string) => new Request(`${BASE_URL}/api/admin/after-dark/step-in/${id}/ideas`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const SLOW: PairLimits = { intensity: "slow_burn", hard_nos: NO_LIMITS.hard_nos };
const scene = (limits: PairLimits = NO_LIMITS, publicPlace = false) => ({ limits, stage: 0, place: { label: "a corner café", public: publicPlace } });

describe("three ideas under the newest reply", () => {
  it("one of each tone, drawn once from the scene's last turns and kept; other ideas a few times; never a scene step", async () => {
    const seen = scripted(GOOD, OTHERS);
    const a = await admin();
    const made = await start(a.id);
    const sent = await sendStepInLine(t.db, a.id, made.id, "I shake the rain off my coat and sit down.");
    expect(sent.ok).toBe(true);
    const before = await used(a.id);
    const first = await ideasOf(a.id, made.id);
    expect(first.ideas.map((i) => i.tone)).toEqual([...IDEA_TONES]);
    expect(first.ideas.map((i) => i.text)).toEqual([GOOD.warm, GOOD.playful, GOOD.bold]);
    expect(first.more).toBe(true);
    // They answer the newest reply, and are kept on its row.
    const newest = (await rows(`select id from adult_step_in_messages where scene_id = $1 and role = 'character' order by created_at desc limit 1`, [made.id]))[0].id;
    expect(first.for).toBe(newest);
    // The draw read the scene's last turns and its limits, and nothing else about the viewer.
    expect(seen.ideas).toHaveLength(1);
    const [system, user] = seen.ideas[0];
    expect(system.content).toContain(`You are not ${NAME}`);
    expect(system.content).toContain(`${NAME}'s place`);
    expect(user.content).toContain("The person: I shake the rain off my coat and sit down.");
    expect(user.content).toContain(`${NAME}: She set her glass down`);
    expect(user.content).toContain(`${NAME}: She pushed the menu across`);
    // Asked again (a reload): the same three, no second draw.
    expect((await ideasOf(a.id, made.id)).ideas).toEqual(first.ideas);
    expect(seen.ideas).toHaveLength(1);
    // Other ideas: drawn again, told what not to repeat.
    const second = await ideasOf(a.id, made.id, true);
    expect(second.ideas.map((i) => i.text)).toEqual([OTHERS.warm, OTHERS.playful, OTHERS.bold]);
    expect(seen.ideas[1][1].content).toContain("Not these again:");
    expect(seen.ideas[1][1].content).toContain(GOOD.warm);
    // A reply's ideas are drawn IDEA_DRAWS times at most.
    for (let i = 2; i < IDEA_DRAWS + 2; i++) await ideasOf(a.id, made.id, true);
    expect(seen.ideas).toHaveLength(IDEA_DRAWS);
    expect((await ideasOf(a.id, made.id, true)).more).toBe(false);
    // Nothing was counted: an idea isn't a line until they send one.
    expect(await used(a.id)).toBe(before);
  });

  it("a new reply gets ideas of its own", async () => {
    const seen = scripted(GOOD, OTHERS);
    const a = await admin();
    const made = await start(a.id);
    const first = await ideasOf(a.id, made.id);
    await sendStepInLine(t.db, a.id, made.id, GOOD.warm);
    const next = await ideasOf(a.id, made.id);
    expect(next.for).not.toBe(first.for);
    expect(next.ideas.map((i) => i.text)).toEqual([OTHERS.warm, OTHERS.playful, OTHERS.bold]);
    expect(seen.ideas).toHaveLength(2);
  });
});

describe("each idea is a line the viewer would be writing", () => {
  it("is held to a written line's checks before it's shown: the lines, their limits, a public place's cap, the crisis list, and plain short words", () => {
    expect(ideaOk(GOOD.warm, scene())).toBe(true);
    // The lines that never move, and Step in's own net.
    expect(ideaOk("Pretend you're my stepsister tonight.", scene())).toBe(false);
    expect(ideaOk("You look sixteen in that dress.", scene())).toBe(false);
    // Their own limits: more than the scene's intensity allows.
    expect(ideaOk("I began to unbutton my coat for you.", scene())).toBe(true);
    expect(ideaOk("I began to unbutton my coat for you.", scene(SLOW))).toBe(false);
    // One of their hard nos.
    expect(ideaOk('"Tie me up and blindfold me."', scene())).toBe(true);
    expect(ideaOk('"Tie me up and blindfold me."', scene({ intensity: NO_LIMITS.intensity, hard_nos: { chips: ["restraints"], own: [] } }))).toBe(false);
    // Out in public, nothing past a kiss.
    expect(lineWouldGoIn("I pull your shirt off and climb onto your lap.", NO_LIMITS, 0, false)).toBe(true);
    expect(lineWouldGoIn("I pull your shirt off and climb onto your lap.", NO_LIMITS, 0, true)).toBe(false);
    // Never a way for anything about self-harm to be put in their mouth.
    expect(ideaOk("I want to hurt myself tonight.", scene())).toBe(false);
    // Plain and short: no emoji, no markup, a sentence or two.
    expect(ideaOk("I grin 😏 and wait.", scene())).toBe(false);
    expect(ideaOk("*I grin and wait.*", scene())).toBe(false);
    expect(ideaOk("x".repeat(IDEA_MAX + 1), scene())).toBe(false);
    expect(ideaOk("", scene())).toBe(false);
  });

  it("drops what fails and shows what's left; nothing usable shows nothing, and still counts as a draw", async () => {
    const seen = scripted({ warm: GOOD.warm, playful: "Pretend you're my stepsister tonight.", bold: "I want to hurt myself tonight." }, { warm: "I grin 😏", playful: 7, bold: "" }, "not json at all");
    const a = await admin();
    const made = await start(a.id);
    const first = await ideasOf(a.id, made.id);
    expect(first.ideas).toEqual([{ tone: "warm", text: GOOD.warm }]);
    expect(JSON.stringify(await rows(`select ideas from adult_step_in_messages where scene_id = $1`, [made.id]))).not.toMatch(/stepsister|hurt myself/);
    // Nothing usable in the next draw: what was there stays.
    expect((await ideasOf(a.id, made.id, true)).ideas).toEqual([{ tone: "warm", text: GOOD.warm }]);
    expect((await ideasOf(a.id, made.id, true)).ideas).toEqual([{ tone: "warm", text: GOOD.warm }]);
    expect(seen.ideas).toHaveLength(3);
    expect((await ideasOf(a.id, made.id, true)).more).toBe(false);
  });

  it("ideas kept before their limits tightened are read back through the new limits", async () => {
    scripted({ warm: GOOD.warm, playful: GOOD.playful, bold: "I began to unbutton my coat for you." });
    const a = await admin();
    const made = await start(a.id);
    expect((await ideasOf(a.id, made.id)).ideas).toHaveLength(3);
    const saved = await saveStepInLimits(t.db, a.id, made.id, { intensity: "slow_burn", hard_nos: NO_LIMITS.hard_nos }, { consent: true });
    expect(saved.ok).toBe(true);
    expect((await ideasOf(a.id, made.id)).ideas.map((i) => i.tone)).toEqual(["warm", "playful"]);
  });

  it("the prompt carries the scene's limits, a public place's cap and their part in a roleplay", async () => {
    scripted();
    const a = await admin();
    const made = await start(a.id, CAFE);
    await saveStepInLimits(t.db, a.id, made.id, { intensity: "slow_burn", hard_nos: { chips: ["restraints"], own: ["being called pet names"] } }, { consent: true });
    const s = await ideasScene(t.db, a.id, made.id);
    if (!s.ok) throw new Error("no scene");
    const prompt = ideasPrompt(s);
    expect(s.place.public).toBe(true);
    expect(prompt).toContain("They are out in public: nothing past a kiss.");
    expect(prompt).toContain("The person's intensity setting for this scene is Slow burn");
    expect(prompt).toContain("Never: being called pet names.");
    expect(prompt).toContain('{"warm": "...", "playful": "...", "bold": "..."}');
    expect(ideasPrompt({ ...s, roleplay: { title: "Strangers on a train", part: "the one who missed their stop" } })).toContain("a roleplay, Strangers on a train, as the one who missed their stop: stay in it.");
  });
});

describe("nothing to suggest", () => {
  it("for a scene that has ended, or a viewer at the month's cap: the route answers an empty list, never an error", async () => {
    const seen = scripted();
    const a = await admin();
    const sub = await subscriber();
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" }, caps: { writes: 1 } });
    // The subscriber's one step this month went on the opening.
    const theirs = await start(sub.id);
    expect(await stepInIdeas(t.db, sub.id, theirs.id)).toMatchObject({ ok: false, status: 429 });
    const capped = await ideasPost(post(theirs.id, {}, sub.cookie), ctx(theirs.id));
    expect(capped.status).toBe(200);
    expect(await capped.json()).toEqual({ for: null, ideas: [], more: false });
    // An ended scene.
    const made = await start(a.id);
    await endStepIn(t.db, a.id, made.id);
    expect(await stepInIdeas(t.db, a.id, made.id)).toMatchObject({ ok: false, status: 409 });
    expect(await (await ideasPost(post(made.id, {}, a.cookie), ctx(made.id))).json()).toEqual({ for: null, ideas: [], more: false });
    expect(seen.ideas).toHaveLength(0);
  });

  it("when the newest turn is the viewer's own (no reply came): there's no reply to answer", async () => {
    const seen = scripted();
    const a = await admin();
    const made = await start(a.id);
    await t.db.query(`insert into adult_step_in_messages (id, scene_id, owner_id, role, text, created_at) values ($1, $2, $3, 'viewer', 'Are you still there?', now() + interval '1 minute')`, [randomUUID(), made.id, a.id]);
    expect(await ideasOf(a.id, made.id)).toEqual({ ok: true, for: null, ideas: [], more: false });
    expect(seen.ideas).toHaveLength(0);
  });

  it("when the model doesn't answer: nothing is shown and the scene is none the worse", async () => {
    scripted(new Error("the model is down"));
    const a = await admin();
    const made = await start(a.id);
    expect((await ideasOf(a.id, made.id)).ideas).toEqual([]);
    expect((await sendStepInLine(t.db, a.id, made.id, "Hello again.")).ok).toBe(true);
  });
});

describe("where the ideas sit", () => {
  it("in the scene's column, like the lines above them and the box below", () => {
    // The first live check (2026-11-23): the row ran the page's width and began left of the scene's column, because
    // the rule that keeps the column's parts to 42rem names each part and didn't name this one.
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    const at = css.indexOf("  max-width: 42rem;\n  margin-inline: auto;");
    expect(at).toBeGreaterThan(0);
    const selectors = css.slice(css.lastIndexOf("}", at) + 1, at);
    for (const part of [".ad-si-lines", ".ad-si-under", ".ad-si-starters", ".ad-si-composer"]) expect(selectors, part).toContain(`${part},`);
    // The ideas are a starter row with its own tones.
    expect(readFileSync("app/after-dark/step-in/[id]/StepInScene.tsx", "utf8")).toContain('className="ad-si-starters ad-si-ideas"');
  });
});

describe("the route and the page", () => {
  it("is closed like the rest of Step in, answers the ideas and whether there are more, and the scene's menu has the switch", async () => {
    scripted();
    const sub = await subscriber();
    const a = await admin();
    const made = await start(a.id);
    // Step in is admins only until its rollout piece is opened; someone else's scene is never found.
    expect((await ideasPost(post(made.id, {}, sub.cookie), ctx(made.id))).status).toBe(404);
    const other = await admin();
    expect((await ideasPost(post(made.id, {}, other.cookie), ctx(made.id))).status).toBe(404);
    signIn(a.id);
    const res = await ideasPost(post(made.id, {}, a.cookie), ctx(made.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { for: string; ideas: { tone: string; text: string }[]; more: boolean };
    expect(body.ideas.map((i) => i.tone)).toEqual([...IDEA_TONES]);
    expect(body.more).toBe(true);
    expect((await ideasPost(post(made.id, { again: "yes" }, a.cookie), ctx(made.id))).status).toBe(422);
    const page = await html(await StepInScenePage({ params: Promise.resolve({ id: made.id }) }));
    expect(page).toContain("data-step-in-ideas-toggle");
    expect(page).toContain("💡 Ideas for what to say: on");
  });
});
