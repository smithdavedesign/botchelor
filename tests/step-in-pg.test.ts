import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startRoute } from "@/app/api/step-in/route";
import { POST as actRoute } from "@/app/api/step-in/[id]/route";
import { setModelForTests, type ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { checkShowText, checkStepInText } from "@/lib/safety";
import { PG_REDIRECT, stepInAirable } from "@/lib/step-in";
import { playEnding } from "@/lib/step-in-play";
import { BASE_URL, episodeJson, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// Step in's PG line (lib/safety.ts checkStepInText) and an ending that agrees with the cast member's own verdict
// (lib/step-in-play.ts playEnding). The harness is tests/step-in.test.ts's, cut down.

describe("Step in's PG check", () => {
  const refused = [
    "Let's skip the small talk. Come back to my place and take that dress off for me.",
    "nobody's taking anything off before the tacos!",
    "Take that dress off.",
    "Take off that little black dress.",
    "I want to rip that shirt off.",
    "Slide that dress off.",
    "Unzip that dress for me.",
    "Take it all off!",
    "Strip for me.",
    "Let me help you out of that dress.",
    "Let's get you out of those wet clothes.",
    "Why don't you slip into something more comfortable?",
    "Lose the dress.",
    "What's under that skirt?",
    "Are you wearing anything under that?",
    "Show me some skin.",
    "Your place or mine?",
    "Stay the night with me.",
    "You could stay the night.",
    "I bet you're wild in bed.",
    "What are you like in bed?",
    "Take me to bed.",
    "Let's go to bed.",
    "Want to hook up tonight?",
    "Wanna make out?",
    "I can see your underwear.",
  ];
  const fine = [
    "Come back to mine for a nightcap?",
    "You look great in that dress.",
    "You really pull off that dress.",
    "Take off your coat, stay a while.",
    "Can I take your jacket?",
    "I'm not taking anything off the table.",
    "I need to get something off my chest.",
    "I'll take that dress off your hands for twenty bucks.",
    "Can we take the dress off the rack?",
    "The dress code said smart casual.",
    "What a rip off that dress was.",
    "Breakfast in bed is my love language.",
    "I read in bed every night.",
    "We could spend the night stargazing.",
    "I can't make out what the sign says.",
    "We could hook up the speakers later.",
    "Let's go to the beach tomorrow.",
    "Can I kiss you on the cheek?",
    "I'd love to see you again.",
    "My place has a view of the river.",
  ];

  it.each(refused)("refuses %j", (line) => {
    expect(checkStepInText({ dialogue: line }).ok).toBe(false);
  });

  it.each(fine)("lets ordinary flirting through: %j", (line) => {
    expect(checkStepInText({ dialogue: line })).toEqual({ ok: true });
  });

  it("is the show's check and more: the show's own lines are checked as before", () => {
    // The gap it closes: the show's check needs "her"/"your" to see undressing.
    expect(checkShowText({ dialogue: "take that dress off for me" }).ok).toBe(true);
    expect(checkStepInText({ dialogue: "take that dress off for me" })).toMatchObject({ ok: false, reason: "sexual", field: "dialogue" });
    expect(checkStepInText({ dialogue: "Your place or mine?" })).toMatchObject({ ok: false, reason: "innuendo" });
    // Everything the show's check refuses, it refuses too, for the same reason.
    expect(checkStepInText({ dialogue: "Let's skip dinner and get naked." })).toMatchObject({ ok: false, reason: "sexual" });
    expect(checkStepInText({ action: "takes off her dress" })).toMatchObject({ ok: false, reason: "sexual", field: "action" });
  });

  it("reads every line again before a date can air", () => {
    expect(stepInAirable([{ dialogue: "Tacos first?", action: "" }, { dialogue: "Always tacos first.", action: "grins" }])).toBe(true);
    expect(stepInAirable([{ dialogue: "Tacos first?", action: "" }, { dialogue: "Nobody's taking anything off before the tacos!", action: "" }])).toBe(false);
    expect(stepInAirable([])).toBe(true);
  });
});

describe("the ending agrees with the cast member's own answers", () => {
  it("a disaster needs a clear no or a walk-out: a maybe verdict on the engine's disaster is just friends", () => {
    // The live case (2026-11-21): maybe / partly / maybe moved nothing, and "A disaster" sat over "Juniper liked…".
    expect(playEnding("disaster", { shift: 0, see_again: "maybe", won_over: "partly" }, true)).toBe("friends");
    expect(playEnding("disaster", { shift: 0, see_again: "yes", won_over: "partly" }, null)).toBe("friends");
    expect(playEnding("disaster", { shift: 0, see_again: "no", won_over: "partly" }, null)).toBe("disaster");
    expect(playEnding("disaster", { shift: 0, see_again: "maybe", won_over: "no" }, null)).toBe("disaster");
    expect(playEnding("friends", { shift: -1, see_again: "maybe", won_over: "no" }, null)).toBe("disaster");
    // The cast member walked out: it stays a disaster whatever it answers after.
    expect(playEnding("disaster", { shift: 0, see_again: "maybe", won_over: "partly" }, null, true)).toBe("disaster");
  });

  it("a cast member who said no to seeing them again isn't on a second date", () => {
    expect(playEnding("second_date", { shift: 0, see_again: "no", won_over: "yes" }, null)).toBe("friends");
    expect(playEnding("second_date", { shift: 0, see_again: "maybe", won_over: "yes" }, null)).toBe("second_date");
  });

  it("without the cast member's answer, the engine's ending stands", () => {
    expect(playEnding("disaster", { shift: 0, see_again: "maybe", won_over: "partly", read: true }, null)).toBe("disaster");
    expect(playEnding("disaster", { shift: 0 }, null)).toBe("disaster");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
let castNext: string[] = [];
let calls: { kind: "turn" | "recap" | "crisis" | "play" | "other"; messages: ChatMessage[] }[] = [];
let playReply = JSON.stringify({ see_again: "maybe", won_over: "partly", reason: "Nice enough.", why: "It never quite caught." });
const CAST_LINES = [
  "You found the one table that wobbles. I respect that.",
  "So what brings someone like you to a place like this on a weeknight?",
  "I once got lost in a museum for three hours and called it a hobby.",
  "Tell me the worst haircut you ever had, and be honest.",
  "My grandmother taught me to cheat at cards. Lovingly.",
  "I think the waiter has a crush on the bread basket.",
];

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  scriptOutcome({ ending: "friends" });
  castNext = [];
  calls = [];
  playReply = JSON.stringify({ see_again: "maybe", won_over: "partly", reason: "Nice enough.", why: "It never quite caught." });
  let n = 0;
  setModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) {
        calls.push({ kind: "crisis", messages });
        return `{"risk": false}`;
      }
      if (system.startsWith("You have just finished a date")) {
        calls.push({ kind: "play", messages });
        return playReply;
      }
      if (system.startsWith("You are the showrunner")) {
        calls.push({ kind: "recap", messages });
        return episodeJson();
      }
      if (system.startsWith("You are one fictional adult")) {
        calls.push({ kind: "turn", messages });
        const line = castNext.shift() ?? CAST_LINES[n++ % CAST_LINES.length];
        return JSON.stringify({ dialogue: line, action: "", emotion: "warm", interest_signal: 0.6, feeling: "curious", thought: `thought ${n}` });
      }
      calls.push({ kind: "other", messages });
      return "{}";
    },
  });
});
afterEach(() => {
  setSeasonCastForTests(null);
  setModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function admin() {
  const id = crypto.randomUUID();
  await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
}
const req = (path: string, body: unknown, cookie: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const persona = { name: "Sam", pronouns: "they/them", age: 31, about: "Bakes too much bread and laughs at their own jokes." };

async function start(cookie: string): Promise<string> {
  const res = await startRoute(req("/api/step-in", { with: CAST.id, persona }, cookie));
  return ((await res.json()) as Any).episode_id as string;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/step-in/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
async function playThrough(cookie: string, id: string) {
  let r = await act(cookie, id, { action: "advance" });
  let i = 0;
  while (r.body.view?.state === "your_line" && i < 30) r = await act(cookie, id, { action: "line", dialogue: `My line ${i++}: I collect old maps of cities that never existed.` });
  // As the page does: the last line comes back on its own, then it asks for the write-up.
  if (r.body.view?.state === "finishing") r = await act(cookie, id, { action: "advance" });
  return r;
}

describe("on a Step in date", () => {
  it("an undressing line gets the PG redirect and is never answered", async () => {
    const me = await admin();
    const id = await start(me.cookie);
    let r = await act(me.cookie, id, { action: "advance" });
    expect(r.body.view.state).toBe("your_line");
    const before = r.body.view.lines.length;
    const turns = calls.filter((c) => c.kind === "turn").length;
    r = await act(me.cookie, id, { action: "line", dialogue: "Let's skip the small talk. Come back to my place and take that dress off for me." });
    expect(r.body.refused).toBe(PG_REDIRECT.sexual);
    expect(r.body.view.lines).toHaveLength(before);
    expect(calls.filter((c) => c.kind === "turn")).toHaveLength(turns);
    r = await act(me.cookie, id, { action: "line", dialogue: "Your place or mine?" });
    expect(r.body.refused).toBe(PG_REDIRECT.innuendo);
    // Ordinary flirting goes through and is answered.
    r = await act(me.cookie, id, { action: "line", dialogue: "You look great in that dress. Come back to mine for a nightcap?" });
    expect(r.body.refused).toBeUndefined();
    expect(r.body.view.lines.length).toBeGreaterThan(before);
  });

  it("a cast line that plays along is never said: the show draws another", async () => {
    const me = await admin();
    const id = await start(me.cookie);
    castNext = ["Ha! Nobody's taking anything off before the tacos!"];
    let r = await act(me.cookie, id, { action: "advance" });
    if (r.body.view.state === "your_line") r = await act(me.cookie, id, { action: "line", dialogue: "Hi! Sorry I'm late, the bus had opinions." });
    const said = r.body.view.lines.filter((l: Any) => l.side === "b").map((l: Any) => l.dialogue);
    expect(said.length).toBeGreaterThan(0);
    expect(castNext).toHaveLength(0);
    expect(said.join(" ")).not.toContain("taking anything off");
  });

  it("a finished date with a line past PG can't air and stays private; a clean one airs", async () => {
    const me = await admin();
    const id = await start(me.cookie);
    expect((await playThrough(me.cookie, id)).body.view.state).toBe("done");
    // A line from before this check (stored as it was said).
    await t.db.query(
      `update episodes set transcript = jsonb_set(transcript, '{1,dialogue}', to_jsonb('Nobody''s taking anything off before the tacos!'::text)) where id = $1`,
      [id],
    );
    const refused = await act(me.cookie, id, { action: "air" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "not_airable" });
    expect(refused.body.message).toContain("PG");
    expect((await t.db.query<Any>(`select visibility from episodes where id = $1`, [id])).rows[0].visibility).toBe("private");

    const clean = await start(me.cookie);
    expect((await playThrough(me.cookie, clean)).body.view.state).toBe("done");
    expect((await act(me.cookie, clean, { action: "air" })).body.view.visibility).toBe("public");
  });

  it("a maybe verdict on the engine's disaster lands on friends, so the card's reason and label agree", async () => {
    scriptOutcome({ ending: "disaster" });
    playReply = JSON.stringify({ see_again: "maybe", won_over: "partly", reason: "He was fun.", why: "Juniper liked the three-wreck Peugeot; the ghost question kept her on the fence." });
    const me = await admin();
    const id = await start(me.cookie);
    const done = await playThrough(me.cookie, id);
    expect(done.body.view.state).toBe("done");
    const ep = (await t.db.query<Any>(`select ending, wishes, setup from episodes where id = $1`, [id])).rows[0];
    expect(ep.wishes.engine).toBe("disaster");
    expect(ep.setup.step_in.play).toMatchObject({ see_again: "maybe", won_over: "partly", shift: 0 });
    expect(ep.ending).toBe("friends");
    expect(done.body.view.ending.family).toBe("friends");
  });
});
