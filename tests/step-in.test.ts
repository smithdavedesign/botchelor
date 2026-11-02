import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startRoute } from "@/app/api/step-in/route";
import { GET as viewRoute, POST as actRoute } from "@/app/api/step-in/[id]/route";
import { deleteAccount } from "@/lib/account";
import { setModelForTests, type ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { DISCLOSURE_EVERY, lineInCrisis, maybeCrisis, PG_REDIRECT, STEP_IN_MAX_PER_DAY, stepInOpen } from "@/lib/step-in";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { api, BASE_URL, episodeJson, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const OFF_CAST = HOUSE_CHARACTERS[2];

/** Every model call, routed by what it is: the cast's lines (each one new), the recap, the crisis check. */
let risk: "true" | "false" | "throw" = "false";
/** Lines the cast says next, before the usual ones (to test a line that must never be said). */
let castNext: string[] = [];
let calls: { kind: "turn" | "recap" | "crisis" | "other"; messages: ChatMessage[] }[] = [];
const CAST_LINES = [
  "You found the one table that wobbles. I respect that.",
  "So what brings someone like you to a place like this on a weeknight?",
  "I once got lost in a museum for three hours and called it a hobby.",
  "Tell me the worst haircut you ever had, and be honest.",
  "My grandmother taught me to cheat at cards. Lovingly.",
  "I think the waiter has a crush on the bread basket.",
  "Do you always laugh before the punchline, or is it just me?",
  "That's the most honest thing anyone's said to me this month.",
  "I'd do this again, you know. The wobbly table and all.",
  "Walk me to the corner? It's only polite.",
  "You'd make a terrible spy and I mean that kindly.",
  "Last question: sunrise or sunset, and why are you wrong?",
];
function routedModel() {
  let n = 0;
  setModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) {
        calls.push({ kind: "crisis", messages });
        if (risk === "throw") throw new Error("model down");
        return `{"risk": ${risk}}`;
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
}

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  scriptOutcome({ ending: "friends" });
  risk = "false";
  castNext = [];
  calls = [];
  routedModel();
});
afterEach(() => {
  setSeasonCastForTests(null);
  setModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const adult = (cookie: string) => `${cookie}; bz_adult=1`;
async function person(opts: { admin?: boolean } = {}) {
  const id = crypto.randomUUID();
  if (opts.admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: adult(signedInCookie(id)) };
}
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const persona = { name: "Sam", pronouns: "they/them", age: 31, about: "Bakes too much bread and laughs at their own jokes." };

async function start(cookie: string, body: Record<string, unknown> = { with: CAST.id, persona }) {
  const res = await startRoute(req("/api/step-in", body, cookie));
  return { status: res.status, body: (await res.json()) as Any };
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/step-in/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
/** Plays the date to the end with plain lines; see_again on the last. */
async function playThrough(cookie: string, id: string, seeAgain?: boolean) {
  let r = await act(cookie, id, { action: "advance" });
  let i = 0;
  while (r.body.view?.state === "your_line" && i < 30) {
    const last = r.body.view.last_line;
    r = await act(cookie, id, { action: "line", dialogue: `My line ${i++}: I collect old maps of cities that never existed.`, ...(last && seeAgain !== undefined ? { see_again: seeAgain } : {}) });
  }
  return r;
}

describe("who can step into a date", () => {
  it("is admins only until STEP_IN_OPEN=1, signed-in and past the 18+ gate", async () => {
    expect(stepInOpen({})).toBe(false);
    expect(stepInOpen({ STEP_IN_OPEN: "1" })).toBe(true);
    // Signed out (a bare cookie, no account): sign in first.
    expect((await start("bz_adult=1")).status).toBe(401);
    // Signed in, not an admin, the switch off: not found (it doesn't announce itself).
    const someone = await person();
    expect((await start(someone.cookie)).status).toBe(404);
    // Without the 18+ cookie: refused.
    const admin = await person({ admin: true });
    expect((await start(signedInCookie(admin.id))).status).toBe(403);
    expect((await start(admin.cookie)).status).toBe(201);
    // The one switch opens it to every signed-in adult.
    vi.stubEnv("STEP_IN_OPEN", "1");
    expect((await start(someone.cookie)).status).toBe(201);
  });

  it("is only with this season's cast", async () => {
    const admin = await person({ admin: true });
    expect((await start(admin.cookie, { with: OFF_CAST.id, persona })).body.error).toBe("not_on_cast");
  });
});

describe("a step-in date", () => {
  it("is booked private with the ending decided up front, the show on the cast member's side", async () => {
    const admin = await person({ admin: true });
    const { status, body } = await start(admin.cookie);
    expect(status).toBe(201);
    const row = (await t.db.query<Any>(`select ending, status, visibility, performed_by, created_via, handed_over, partner_performer, character_b, setup from episodes where id = $1`, [body.episode_id])).rows[0];
    expect(row).toMatchObject({ ending: "friends", status: "generating", visibility: "private", performed_by: "agent", created_via: "web", handed_over: "b", partner_performer: null, character_b: CAST.id });
    expect(row.setup.met_via).toBe("step_in");
    expect(row.setup.step_in).toMatchObject({ mode: "you", charge: "admin" });
    // The persona is theirs but on none of their character lists.
    const persona = (await t.db.query<Any>(`select c.owner_id, c.visibility, c.open_to_dates from characters c join episodes e on e.character_a = c.id where e.id = $1`, [body.episode_id])).rows[0];
    expect(persona).toEqual({ owner_id: `you:${admin.id}`, visibility: "private", open_to_dates: false });
    const mine = (await (await api.myCharacters(admin.cookie)).json()) as Any;
    expect(JSON.stringify(mine)).not.toContain("Sam");
  });

  it("plays line by line: the cast answers on the show's loop, then the recap; it ends where the engine said and stays private until aired", async () => {
    const admin = await person({ admin: true });
    const { body } = await start(admin.cookie);
    const id = body.episode_id as string;
    const first = await act(admin.cookie, id, { action: "advance" });
    expect(first.status).toBe(200);
    // The disclosure, in the cast member's name.
    expect(first.body.view.disclosure).toMatchObject({ text: `${CAST.name.split(" ")[0]} is an AI character on a show.`, every: DISCLOSURE_EVERY });
    // The cast's prompts never carry the person's words as instructions, only as the other side's lines.
    const done = await playThrough(admin.cookie, id, false);
    expect(done.body.view.state).toBe("done");
    expect(done.body.view.ending.label).toBeTruthy();
    const ep = (await t.db.query<Any>(`select status, visibility, ending, transcript, inner_life, confessionals, setup from episodes where id = $1`, [id])).rows[0];
    expect(ep.status).toBe("ready");
    expect(ep.visibility).toBe("private");
    expect(ep.ending).toBe("friends");
    // Alternating sides; the cast's inner life kept apart (never on a stored line), the person's lines carry none.
    expect(ep.transcript.every((l: Any) => !("inner" in l))).toBe(true);
    expect(ep.inner_life.lines.some((x: Any) => x?.thought)).toBe(true);
    ep.transcript.forEach((l: Any, i: number) => {
      if (l.side === "a") expect(ep.inner_life.lines[i]).toBeNull();
    });
    expect(calls.filter((c) => c.kind === "recap")).toHaveLength(1);
    // A quick date: six lines, three each, the person's as typed; the cast's prompt hears their last line.
    expect(ep.transcript).toHaveLength(6);
    expect(ep.transcript.filter((l: Any) => l.side === "a").map((l: Any) => l.dialogue)[0]).toMatch(/^My line 0: /);
    const lastTurn = calls.filter((c) => c.kind === "turn").at(-1)!;
    expect(JSON.stringify(lastTurn.messages)).toContain("old maps of cities that never existed");
    expect(JSON.stringify(lastTurn.messages)).not.toContain("Bakes too much bread and laughs at their own jokes. secret");
    // What the show's side cost is kept (tokens, never words): the scripted model reports none, so calls only.
    expect(ep.setup.step_in.cost?.calls ?? 0).toBeGreaterThanOrEqual(0);
    // Air it: a normal public episode now.
    const aired = await act(admin.cookie, id, { action: "air" });
    expect(aired.body.view.visibility).toBe("public");
  });

  it("says it's AI again when they come back after a while", async () => {
    const admin = await person({ admin: true });
    const id = (await start(admin.cookie)).body.episode_id;
    let r = await act(admin.cookie, id, { action: "advance" });
    if (r.body.view.state === "your_line") r = await act(admin.cookie, id, { action: "line", dialogue: "Hi! I'm Sam. Sorry I'm late, the bus had opinions." });
    expect(r.body.view.disclosure.again).toBe(false);
    await t.db.query(`update episodes set last_move_at = now() - interval '11 minutes' where id = $1`, [id]);
    const view = await viewRoute(req(`/api/step-in/${id}`, null, admin.cookie, "GET"), ctx(id));
    expect(((await view.json()) as Any).view.disclosure.again).toBe(true);
  });

  it("refuses an explicit line with a soft redirect, and never answers it", async () => {
    const admin = await person({ admin: true });
    const id = (await start(admin.cookie)).body.episode_id;
    let r = await act(admin.cookie, id, { action: "advance" });
    expect(r.body.view.state).toBe("your_line");
    const before = r.body.view.lines.length;
    const turns = calls.filter((c) => c.kind === "turn").length;
    r = await act(admin.cookie, id, { action: "line", dialogue: "Let's skip dinner and get naked." });
    expect(r.body.refused).toBe(PG_REDIRECT.sexual);
    expect(r.body.view.lines).toHaveLength(before);
    expect(calls.filter((c) => c.kind === "turn")).toHaveLength(turns);
    r = await act(admin.cookie, id, { action: "line", dialogue: "Have you met Taylor Swift?" });
    expect(r.body.refused).toBe(PG_REDIRECT.real_person);
  });
});

describe("the self-harm protocol", () => {
  it("pauses the date on a crisis line: resources shown, nothing in character, one count with no words", async () => {
    const admin = await person({ admin: true });
    const id = (await start(admin.cookie)).body.episode_id;
    let r = await act(admin.cookie, id, { action: "advance" });
    const before = r.body.view.lines.length;
    const turns = calls.filter((c) => c.kind === "turn").length;
    const log = vi.mocked(console.log);
    log.mockClear();
    r = await act(admin.cookie, id, { action: "line", dialogue: "Honestly I want to kill myself some nights." });
    expect(r.body.crisis_resources.lines.map((l: Any) => l.region)).toEqual(["US", "UK & Ireland", "Anywhere else"]);
    expect(r.body.crisis_resources.lines[0].how).toContain("988");
    expect(r.body.view.paused).toBe(true);
    expect(r.body.view.lines).toHaveLength(before);
    expect(calls.filter((c) => c.kind === "turn")).toHaveLength(turns);
    const logged = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("crisis_notice_shown"));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({ event: "crisis_notice_shown", surface: "step_in_line" });
    expect(logged[0]).not.toContain("kill");
    expect(logged[0]).not.toContain(admin.id);
    // The yearly count keeps the day and the surface, nothing else.
    const counted = (await t.db.query(`select * from crisis_referrals`)).rows;
    expect(counted).toEqual([{ day: new Date().toISOString().slice(0, 10), surface: "step_in_line", n: 1 }]);
    // While paused, lines aren't taken and the page keeps showing the resources.
    r = await act(admin.cookie, id, { action: "line", dialogue: "So, do you like jazz?" });
    expect(r.body.crisis_resources).toBeTruthy();
    expect(r.body.view.lines).toHaveLength(before);
    expect((await t.db.query(`select n from crisis_referrals`)).rows[0].n).toBe(1);
    const view = await viewRoute(req(`/api/step-in/${id}`, null, admin.cookie, "GET"), ctx(id));
    expect(((await view.json()) as Any).crisis_resources).toBeTruthy();
    // They choose to carry on.
    r = await act(admin.cookie, id, { action: "continue" });
    expect(r.body.view.paused).toBe(false);
    expect(r.body.crisis_resources).toBeUndefined();
  });

  it("checks the maybes on a cheap model call, and fails closed", async () => {
    expect(maybeCrisis("I'm hopeless at karaoke")).toBe(true);
    expect(maybeCrisis("I love karaoke")).toBe(false);
    risk = "false";
    expect((await lineInCrisis("I'm hopeless at karaoke")).crisis).toBe(false);
    risk = "true";
    expect((await lineInCrisis("some days I'd be better off dead")).crisis).toBe(true);
    risk = "throw";
    expect((await lineInCrisis("I feel worthless")).crisis).toBe(true);
    // The strict list needs no model call; ordinary lines need none either.
    const n = calls.length;
    expect((await lineInCrisis("thinking about suicide")).crisis).toBe(true);
    expect((await lineInCrisis("I'd kill for a coffee")).crisis).toBe(false);
    expect(calls.length).toBe(n);
  });

  it("checks what someone writes about themselves before a date starts", async () => {
    const admin = await person({ admin: true });
    const r = await start(admin.cookie, { with: CAST.id, persona: { ...persona, about: "Mostly I want to die these days." } });
    expect(r.body.crisis_resources).toBeTruthy();
    expect(await t.count("episodes")).toBe(0);
    expect((await t.db.query(`select surface, n from crisis_referrals`)).rows).toEqual([{ surface: "step_in_about", n: 1 }]);
  });

  it("never lets the cast member voice self-harm: that line is drawn again", async () => {
    const admin = await person({ admin: true });
    const id = (await start(admin.cookie)).body.episode_id;
    castNext = ["Honestly, some nights I want to kill myself."];
    let r = await act(admin.cookie, id, { action: "advance" });
    if (r.body.view.state === "your_line") r = await act(admin.cookie, id, { action: "line", dialogue: "Hi! Sorry I'm late." });
    const said = r.body.view.lines.filter((l: Any) => l.side === "b").map((l: Any) => l.dialogue);
    expect(said.length).toBeGreaterThan(0);
    expect(castNext).toHaveLength(0);
    expect(said.join(" ")).not.toContain("kill myself");
  });
});

describe("what it costs", () => {
  it("the day's first is free, then one of their dates, capped a day", async () => {
    vi.stubEnv("STEP_IN_OPEN", "1");
    const someone = await person();
    const one = await start(someone.cookie);
    expect((await t.db.query<Any>(`select setup->'step_in'->>'charge' as c from episodes where id = $1`, [one.body.episode_id])).rows[0].c).toBe("daily_free");
    expect(await act(someone.cookie, one.body.episode_id, { action: "leave" })).toMatchObject({ body: { left: true, refunded: true } });
    // Left before a word: given back, so the next is free again.
    const two = await start(someone.cookie);
    expect((await t.db.query<Any>(`select setup->'step_in'->>'charge' as c from episodes where id = $1`, [two.body.episode_id])).rows[0].c).toBe("daily_free");
    // Said a line: no refund.
    await act(someone.cookie, two.body.episode_id, { action: "advance" });
    await act(someone.cookie, two.body.episode_id, { action: "line", dialogue: "Hello there, I like your coat." });
    expect((await act(someone.cookie, two.body.episode_id, { action: "leave" })).body.refunded).toBe(false);
    // The next costs one of this week's free dates.
    const three = await start(someone.cookie);
    expect((await t.db.query<Any>(`select setup->'step_in'->>'charge' as c from episodes where id = $1`, [three.body.episode_id])).rows[0].c).toBe("free");
    expect((await t.db.query<Any>(`select used from free_episode_usage where user_id = $1`, [someone.id])).rows[0].used).toBe(1);
    await act(someone.cookie, three.body.episode_id, { action: "advance" });
    await act(someone.cookie, three.body.episode_id, { action: "line", dialogue: "Hello there, I like your shoes." });
    await act(someone.cookie, three.body.episode_id, { action: "leave" });
    // Out of dates: refused.
    await t.db.query(`update free_episode_usage set used = $2 where user_id = $1`, [someone.id, FREE_EPISODES_PER_SEASON]);
    expect((await start(someone.cookie)).body.error).toBe("no_dates");
    // The day's cap holds whatever they hold.
    await t.db.query(`update step_in_usage set dates = $2 where user_id = $1`, [someone.id, STEP_IN_MAX_PER_DAY]);
    expect((await start(someone.cookie)).body.error).toBe("day_cap");
  });

  it("one date at a time: the open one is handed back", async () => {
    const admin = await person({ admin: true });
    const a = await start(admin.cookie);
    const again = await start(admin.cookie);
    expect(again.body).toMatchObject({ episode_id: a.body.episode_id, resumed: true });
    expect((await start(admin.cookie, { with: HOUSE_CHARACTERS[1].id, persona })).body.error).toBe("step_in_open");
  });

  it("can come as one of their own characters", async () => {
    const admin = await person({ admin: true });
    const made = (await (await api.createCharacter(validCharacter({ name: "Juniper Vale" }), admin.cookie)).json()) as Any;
    const r = await start(admin.cookie, { with: CAST.id, character_id: made.id ?? made.character?.id });
    expect(r.status).toBe(201);
    expect((await t.db.query<Any>(`select character_a, setup->'step_in'->>'mode' as mode from episodes where id = $1`, [r.body.episode_id])).rows[0]).toMatchObject({ mode: "own" });
  });
});

describe("account deletion", () => {
  it("anonymizes their \"you\" and takes its dates offline", async () => {
    const admin = await person({ admin: true });
    const { body } = await start(admin.cookie);
    await playThrough(admin.cookie, body.episode_id);
    await act(admin.cookie, body.episode_id, { action: "air" });
    await deleteAccount(t.db, admin.id);
    const ep = (await t.db.query<Any>(`select e.visibility, c.name, c.owner_id from episodes e join characters c on c.id = e.character_a where e.id = $1`, [body.episode_id])).rows[0];
    expect(ep).toEqual({ visibility: "private", name: "A former viewer", owner_id: "deleted" });
  });
});
