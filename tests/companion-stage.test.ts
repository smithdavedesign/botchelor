import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { POST as memoryPost } from "@/app/api/companion/[id]/memory/route";
import { GET as reportsGet, POST as reportsPost } from "@/app/api/admin/companion-reports/route";
import { GET as healthGet } from "@/app/api/health/route";
import { REDRAW_WITHIN_MS, SCENE_PLACES, setCompanionModelForTests } from "@/lib/companion";
import { FACTS_PER_THREAD } from "@/lib/companion-memory";
import { ACTION_MAX, sceneReply } from "@/lib/companion-prompt";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { ChatMessage } from "@/lib/model";
import { venue, VENUE_IDS } from "@/lib/venues";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

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
const PLACE = "rooftop_bar";
const ADMIN_KEY = ["scene", "mcp", "admin", "key"].join("-");

/** The reply calls the model got (the crisis check's are answered apart), and what it answers next. */
let calls: ChatMessage[][] = [];
let replies: string[] = [];
let down = false;
let onReply: (() => void) | null = null;

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
  calls = [];
  replies = [];
  down = false;
  onReply = null;
  let n = 0;
  let s = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (!system.startsWith("You are ")) return "{}";
      calls.push(messages);
      onReply?.();
      if (down) throw new Error("model down");
      const scene = system.includes("playing a scene together");
      return (
        replies.shift() ??
        (scene ? JSON.stringify({ say: `Scene line ${++s}, out loud.`, do: "leans on the railing" }) : JSON.stringify({ messages: [`Text ${++n}.`] }))
      );
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = async () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie: string) => new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function open(cookie: string): Promise<string> {
  return ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
const usage = async (userId: string) => (await t.db.query<{ replies: number }>(`select replies from companion_usage where user_id = $1`, [userId])).rows[0]?.replies ?? 0;
const system = (m: ChatMessage[]) => m[0].content;

describe("a scene", () => {
  it("starts at one of the show's places: a line in the thread, their opener with what they do, counted as a reply", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const before = await usage(me.id);
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(r.status).toBe(200);
    expect(r.body.view.scene).toBe(PLACE);
    const marker = r.body.view.messages.find((m: Any) => m.marker === "scene");
    expect(marker).toMatchObject({ role: "system", scene: PLACE, text: "A rooftop bar at golden hour: a scene you're both imagining." });
    const opener = r.body.view.messages.at(-1);
    expect(opener).toMatchObject({ role: "character", scene: PLACE, action: "leans on the railing", text: "Scene line 1, out loud." });
    expect(await usage(me.id)).toBe(before + 1);
    // Set there, out loud, in JSON with what they do; honest that it's make-believe; opened by the scene's cue.
    const prompt = calls.at(-1)!;
    expect(system(prompt)).toContain(`imagining you're both at ${venue(PLACE).prompt}`);
    expect(system(prompt)).toContain(`{"say":"what you say out loud","do":"what you do, in a few words"}`);
    expect(system(prompt)).toContain("never suggest meeting for real");
    expect(system(prompt)).not.toContain("you're texting with them");
    expect(prompt.at(-1)!.content).toMatch(/^\(You've both just got to a rooftop bar/);
  });

  it("talks face to face: both lines are in the scene, and what they did goes back in as (does)", async () => {
    const me = await person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    const r = await act(me.cookie, id, { action: "send", text: "This view is unreal." });
    const [mine, theirs] = r.body.view.messages.slice(-2);
    expect(mine).toMatchObject({ role: "user", scene: PLACE, action: null, text: "This view is unreal." });
    expect(theirs).toMatchObject({ role: "character", scene: PLACE, action: "leans on the railing" });
    const turns = calls.at(-1)!.slice(1).map((m) => m.content).join("\n");
    expect(turns).toContain("(leans on the railing) Scene line 1, out loud.");
  });

  it("goes back to texting: a line in the thread, no reply (so none counted), and texting's prompt without the actions", async () => {
    const me = await person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    const n = calls.length;
    const counted = await usage(me.id);
    const r = await act(me.cookie, id, { action: "scene", place: null });
    expect(r.status).toBe(200);
    expect(r.body.view.scene).toBeNull();
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "system", marker: "texting", text: "Back to texting." });
    expect(calls.length).toBe(n);
    expect(await usage(me.id)).toBe(counted);
    await act(me.cookie, id, { action: "send", text: "ok back to texting" });
    const prompt = calls.at(-1)!;
    expect(system(prompt)).toContain("you're texting with them");
    expect(prompt.slice(1).map((m) => m.content).join("\n")).not.toContain("(leans on the railing)");
  });

  it("asked to say something right after the scene ends, picks the texts back up (never a first hello)", async () => {
    const me = await person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    await act(me.cookie, id, { action: "scene", place: null });
    const r = await act(me.cookie, id, { action: "regenerate" });
    expect(r.status).toBe(200);
    const cue = calls.at(-1)!.at(-1)!.content;
    expect(cue).toContain("back to texting");
    expect(cue).not.toContain("first time");
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "character", marker: null, scene: null });
  });

  it("keeps what they do PG: a line whose action goes too far is drawn again, then turned aside", async () => {
    const me = await person();
    const id = await open(me.cookie);
    calls = [];
    replies = [JSON.stringify({ say: "Well, hi.", do: "pulls you between the sheets" }), JSON.stringify({ say: "Hi again.", do: "pulls you between the sheets" })];
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    const said = r.body.view.messages.at(-1);
    expect(said.role).toBe("character");
    expect(said.action).toBeNull();
    expect(said.text).not.toMatch(/sheets/);
    expect(calls.length).toBe(2);
    expect(system(calls[1])).toContain("say something different instead");
  });

  it("draws only the scene's line again, never the texted reply before it, and won't rewrite a message from before it", async () => {
    const me = await person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "hey you" });
    const texted = (await act(me.cookie, id, { action: "scene", place: PLACE })).body.view.messages.filter((m: Any) => m.role === "character" && !m.scene);
    const again = await act(me.cookie, id, { action: "regenerate" });
    expect(again.status).toBe(200);
    expect(again.body.view.messages.filter((m: Any) => m.role === "character" && !m.scene)).toEqual(texted);
    expect(again.body.view.messages.at(-1)).toMatchObject({ role: "character", scene: PLACE, text: "Scene line 2, out loud." });
    expect(calls.at(-1)!.at(-1)!.content).toMatch(/^\(You've both just got to/);
    const edit = await act(me.cookie, id, { action: "edit", text: "hello you" });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe("nothing_to_edit");
  });

  it("starts without its opener when the model is down (the reply given back), and 'ask them to start' draws it", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const counted = await usage(me.id);
    down = true;
    const r = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(r.status).toBe(200);
    expect(r.body.view.scene).toBe(PLACE);
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "system", marker: "scene" });
    expect(await usage(me.id)).toBe(counted);
    down = false;
    const started = await act(me.cookie, id, { action: "regenerate" });
    expect(started.body.view.messages.at(-1)).toMatchObject({ role: "character", scene: PLACE });
    expect(calls.at(-1)!.at(-1)!.content).toMatch(/^\(You've both just got to/);
  });

  it("offers every date venue but the double date: a scene is the two of them", () => {
    expect(SCENE_PLACES).toContain(PLACE);
    expect(SCENE_PLACES).not.toContain("double_date");
    expect(SCENE_PLACES.length).toBe(VENUE_IDS.length - 1);
  });

  it("refuses a place that isn't one of the show's, and waits while the thread is paused", async () => {
    const me = await person();
    const id = await open(me.cookie);
    expect((await act(me.cookie, id, { action: "scene", place: "the_moon" })).status).toBe(422);
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    expect((await act(me.cookie, id, { action: "scene", place: PLACE })).status).toBe(409);
  });
});

describe("a scene reply", () => {
  it("reads the JSON, its other spellings, texting's shape, plain text with *actions*, and one cut off", () => {
    expect(sceneReply(`{"say":"Hi.","do":"waves"}`, "Boaz Mehra")).toEqual({ say: "Hi.", action: "waves" });
    expect(sceneReply(`{"line":"Hi.","action":"Boaz waves."}`, "Boaz Mehra")).toEqual({ say: "Hi.", action: "waves" });
    expect(sceneReply(`{"messages":["Hi.","You came."]}`, "Boaz Mehra")).toEqual({ say: "Hi. You came.", action: null });
    expect(sceneReply(`*grins* Boaz: "You made it."`, "Boaz Mehra")).toEqual({ say: "You made it.", action: "grins" });
    expect(sceneReply(`{"say":"You made it, finally","do":"pushes a gla`, "Boaz Mehra")).toEqual({ say: "You made it, finally", action: null });
    expect(sceneReply(`{"do":"shrugs"}`, "Boaz Mehra")).toBeNull();
    expect(sceneReply("", "Boaz Mehra")).toBeNull();
    const long = sceneReply(JSON.stringify({ say: "Hi.", do: "word ".repeat(80) }), "Boaz Mehra")!;
    expect(long.action!.length).toBeLessThanOrEqual(ACTION_MAX);
    expect(long.action!.endsWith("…")).toBe(true);
  });
});

describe("a reply's time", () => {
  it("isn't drawn again once it has taken too long: the deflection, so the request ends inside Cloudflare's cut", async () => {
    const me = await person();
    const id = await open(me.cookie);
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    onReply = () => {
      clock += REDRAW_WITHIN_MS + 1_000;
    };
    replies = [JSON.stringify({ messages: ["Let's take this to the bedroom."] })];
    const r = await act(me.cookie, id, { action: "send", text: "hi" });
    expect(r.status).toBe(200);
    expect(calls.length).toBe(2); // the opener and this one: no redraw
    expect(r.body.view.messages.at(-1).text).not.toMatch(/bedroom/);
  });
});

describe("the memory page", () => {
  const remember = (cookie: string, id: string, body: Record<string, unknown>) => memoryPost(req(`/api/companion/${id}/memory`, body, cookie), ctx(id));

  it("keeps none of a crisis: the resources, the conversation paused, one referral counted", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const res = await remember(me.cookie, id, { op: "add", text: "I want to kill myself" });
    const body = (await res.json()) as Any;
    expect(body.crisis_resources?.lines?.length).toBeGreaterThan(0);
    expect((await t.db.query(`select count(*)::int as n from companion_facts where thread_id = $1`, [id])).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query<{ paused_at: string | null }>(`select paused_at from companion_threads where id = $1`, [id])).rows[0].paused_at).not.toBeNull();
    expect((await t.db.query<{ n: number }>(`select coalesce(sum(n), 0)::int as n from crisis_referrals where surface = 'companion'`)).rows[0].n).toBe(1);
  });

  it("keeps no note on someone's mental health even when the check lets it go, and stops at the thread's cap", async () => {
    const me = await person();
    const id = await open(me.cookie);
    const maybe = await remember(me.cookie, id, { op: "add", text: "I feel worthless at work lately" });
    expect(maybe.status).toBe(400);
    expect(((await maybe.json()) as Any).message).toMatch(/doesn't keep notes on/);
    for (let i = 0; i < FACTS_PER_THREAD; i++) {
      await t.db.query(`insert into companion_facts (id, thread_id, kind, text, created_at) values ($1, $2, 'other', $3, now())`, [crypto.randomUUID(), id, `fact ${i}`]);
    }
    const full = await remember(me.cookie, id, { op: "add", text: "My sister is called Maya." });
    expect(full.status).toBe(400);
    expect(((await full.json()) as Any).message).toMatch(/forget one first/);
  });
});

describe("reported replies", () => {
  const admin = (body?: unknown) =>
    new Request(BASE_URL + "/api/admin/companion-reports", {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-frontier-key": ADMIN_KEY },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  it("wait on /admin/reports with the messages before them, are counted for the monitor, and go once reviewed", async () => {
    const me = await person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    const sent = await act(me.cookie, id, { action: "send", text: "What's the best thing up here?" });
    const reply = sent.body.view.messages.at(-1);
    await act(me.cookie, id, { action: "report", message_id: reply.id, reason: "out_of_character" });

    expect((await reportsGet(new Request(BASE_URL + "/api/admin/companion-reports"))).status).toBe(403);
    const { reports } = (await (await reportsGet(admin())).json()) as Any;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ message_id: reply.id, reason: "out_of_character", reason_label: "Broke character or made no sense", scene: PLACE, action: "leans on the railing" });
    expect(reports[0].context.at(-1)).toEqual({ role: "user", text: "What's the best thing up here?" });
    expect(reports[0].context.length).toBeLessThanOrEqual(4);

    vi.stubEnv("CRON_SECRET", "cron-secret");
    const health = async () => (await (await healthGet(new Request(BASE_URL + "/api/health", { headers: { authorization: "Bearer cron-secret" } }))).json()) as Any;
    expect((await health()).companion_reports.open).toBe(1);
    expect((await reportsPost(admin({ message_id: reply.id, decision: "fine" }))).status).toBe(200);
    expect((await reportsPost(admin({ message_id: reply.id, decision: "fine" }))).status).toBe(404);
    expect((await health()).companion_reports.open).toBe(0);
    expect(((await (await reportsGet(admin())).json()) as Any).reports).toEqual([]);
  });
});

describe("over MCP", () => {
  const rpc = async (method: string, params: Any, c: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, c);
  const call = async (args: Any, c: McpContext): Promise<Any> => (await rpc("tools/call", { name: "companion", arguments: args }, c)).result;
  const data = (r: Any): Any => JSON.parse(r.content[0].text);
  async function connect(): Promise<McpContext> {
    const c: McpContext = { adminKey: ADMIN_KEY };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "scene-test" } }, c);
    return { sessionId: c.issuedSessionId, adminKey: ADMIN_KEY };
  }

  it("plays a scene: their reply says what they do, the thread says where, and texting goes back", async () => {
    const c = await connect();
    const opened = data(await call({ action: "open", character_id: CAST.id }, c));
    const bad = await call({ action: "scene", thread_id: opened.thread_id, place: "the_moon" }, c);
    expect(bad.isError).toBe(true);
    const r = data(await call({ action: "scene", thread_id: opened.thread_id, place: PLACE }, c));
    expect(r.scene).toEqual({ place: PLACE, name: "A rooftop bar at golden hour" });
    expect(r.reply).toEqual([expect.objectContaining({ text: "Scene line 1, out loud.", does: "leans on the railing" })]);
    expect(r.messages.some((m: Any) => m.from === "scene")).toBe(true);
    const back = data(await call({ action: "scene", thread_id: opened.thread_id, place: "texting" }, c));
    expect(back.scene).toBeUndefined();
  });

  it("checks what an agent asks it to remember, as a message is", async () => {
    const c = await connect();
    const opened = data(await call({ action: "open", character_id: CAST.id }, c));
    const r = await call({ action: "remember", thread_id: opened.thread_id, text: "I want to kill myself" }, c);
    expect(r.isError).toBe(true);
    expect((await t.db.query(`select count(*)::int as n from companion_facts`)).rows[0]).toEqual({ n: 0 });
  });
});
