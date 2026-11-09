import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { DELETE as deleteRoute, GET as viewRoute, POST as actRoute } from "@/app/api/companion/[id]/route";
import { GET as voiceRoute } from "@/app/api/companion/[id]/voice/[messageId]/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { setCompanionModelForTests } from "@/lib/companion";
import { COMPANION_EXTRAS, extraPrice } from "@/lib/companion-shared";
import { extraState, takeExtra } from "@/lib/companion-extras";
import { signedVoiceUrl, voiceLinkValid } from "@/lib/companion-voice";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { grantPlan } from "@/lib/paid-plans";
import { sayable, setVoiceFetchForTests, voiceFor } from "@/lib/voice";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Companions P3, voice notes (lib/companion-voice.ts): no live calls here.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2]);
let asked: Any[] = [];
let voiceDown = false;
let replies: string[] = [];

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  asked = [];
  voiceDown = false;
  replies = [];
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are ")) return JSON.stringify({ messages: [replies.shift() ?? "Tell me *grins* more about it."] });
      return "{}";
    },
  });
  setVoiceFetchForTests(async (input, init) => {
    expect(String(input)).toBe("https://api.venice.ai/api/v1/audio/speech");
    asked.push(JSON.parse(String(init?.body)));
    return voiceDown ? new Response("upstream down", { status: 400 }) : new Response(MP3, { headers: { "content-type": "audio/mpeg" } });
  });
  await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setVoiceFetchForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = async (opts: { admin?: boolean } = {}) => {
  const id = crypto.randomUUID();
  if (opts.admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const tokens = (userId: string, n: number) =>
  t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), userId, n]);
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function thread(cookie: string): Promise<{ id: string; reply: string }> {
  const res = await openRoute(req("/api/companion", { character_id: CAST.id }, cookie));
  const id = ((await res.json()) as Any).thread_id as string;
  const view = ((await (await viewRoute(req(`/api/companion/${id}`, null, cookie, "GET"), ctx(id))).json()) as Any).view;
  return { id, reply: view.messages.findLast((m: Any) => m.role === "character").id };
}
async function voice(cookie: string, id: string, messageId: string, buy?: boolean) {
  const res = await actRoute(req(`/api/companion/${id}`, { action: "voice", message_id: messageId, ...(buy === undefined ? {} : { buy }) }, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
const spent = async (userId: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [userId])).rows[0]?.used ?? 0;
const credits = async (userId: string) => (await t.db.query<{ credits: number }>(`select credits from companion_credits where user_id = $1 and kind = 'voice'`, [userId])).rows[0]?.credits ?? 0;

describe("voice notes", () => {
  it("shares one voice kit: the character's own Kokoro voice, actions left out", () => {
    expect(sayable("Tell me *grins* more about it.")).toBe("Tell me more about it.");
    expect(voiceFor(CAST)).toMatch(/^a[fm]_/);
  });

  it("shows the price before anything's made, and takes a token for a bundle only when asked to", async () => {
    const me = await person();
    const { id, reply } = await thread(me.cookie);
    // The page's state: no plan, no credits, so the button says the price.
    const s = await extraState(t.db, me.id, "voice");
    expect(extraPrice("voice", s)).toBe(`1 token for ${COMPANION_EXTRAS.voice.bundle}`);
    // Without buy: refused with the price, nothing made.
    const priced = await voice(me.cookie, id, reply);
    expect(priced.status).toBe(402);
    expect(priced.body).toMatchObject({ error: "price", price: { tokens: 1, bundle: COMPANION_EXTRAS.voice.bundle } });
    expect(asked).toHaveLength(0);
    // With buy but no tokens: refused, nothing spent.
    const broke = await voice(me.cookie, id, reply, true);
    expect(broke.status).toBe(402);
    expect(broke.body.error).toBe("needs_tokens");
    expect(asked).toHaveLength(0);
    // With a token: the bundle is bought, this one taken from it.
    await tokens(me.id, 1);
    const made = await voice(me.cookie, id, reply, true);
    expect(made.status).toBe(200);
    expect(made.body.voice.url).toBe(`/api/companion/${id}/voice/${reply}`);
    expect(asked).toEqual([{ model: "tts-kokoro", input: "Tell me more about it.", voice: voiceFor(CAST), response_format: "mp3" }]);
    expect(await spent(me.id)).toBe(1);
    expect(await credits(me.id)).toBe(COMPANION_EXTRAS.voice.bundle - 1);
    expect(made.body.view.messages.find((m: Any) => m.id === reply).voice).toBe(made.body.voice.url);
    expect(made.body.extras.voice.credits).toBe(COMPANION_EXTRAS.voice.bundle - 1);
    // Asking again is free: it's kept.
    const again = await voice(me.cookie, id, reply, true);
    expect(again.body.voice.cached).toBe(true);
    expect(asked).toHaveLength(1);
    expect(await credits(me.id)).toBe(COMPANION_EXTRAS.voice.bundle - 1);
  });

  it("never pays twice for the same words: another reply that says them points at the same file", async () => {
    const me = await person();
    await tokens(me.id, 1);
    replies = ["Same words.", "Same words."];
    const { id } = await thread(me.cookie);
    await actRoute(req(`/api/companion/${id}`, { action: "send", text: "hi" }, me.cookie), ctx(id));
    const view = ((await (await viewRoute(req(`/api/companion/${id}`, null, me.cookie, "GET"), ctx(id))).json()) as Any).view;
    const mine = view.messages.filter((m: Any) => m.role === "character" && m.text === "Same words.");
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const first = await voice(me.cookie, id, mine[0].id, true);
    expect(first.status).toBe(200);
    const other = (await t.db.query<{ id: string }>(`insert into companion_messages (id, thread_id, role, text) values ($1, $2, 'character', 'Same words.') returning id`, [crypto.randomUUID(), id])).rows[0].id;
    const second = await voice(me.cookie, id, other, true);
    expect(second.body.voice.cached).toBe(true);
    expect(asked).toHaveLength(1);
    expect(await credits(me.id)).toBe(COMPANION_EXTRAS.voice.bundle - 1);
  });

  it("the plan includes 30 a month, counted per person; then the price", async () => {
    const me = await person();
    await grantPlan(t.db, me.id, "companion", "initial", { subscriptionId: "sub_v" });
    const { id, reply } = await thread(me.cookie);
    expect(extraPrice("voice", await extraState(t.db, me.id, "voice"))).toBe("");
    const made = await voice(me.cookie, id, reply);
    expect(made.status).toBe(200);
    expect(made.body.extras.voice.included_left).toBe(COMPANION_EXTRAS.voice.included - 1);
    expect(await spent(me.id)).toBe(0);
    // The month's included ones used up: the price again, never a silent charge.
    const month = `${new Date().toISOString().slice(0, 7)}-01`;
    await t.db.query(`update companion_extras_usage set used = $3 where user_id = $1 and month = $2`, [me.id, month, COMPANION_EXTRAS.voice.included]);
    const ticket = await takeExtra(t.db, me.id, "voice");
    expect(ticket).toMatchObject({ ok: false, error: "price" });
  });

  it("gives everything back when the voice fails, the token for a bundle bought for it too", async () => {
    const me = await person();
    await tokens(me.id, 1);
    const { id, reply } = await thread(me.cookie);
    voiceDown = true;
    const r = await voice(me.cookie, id, reply, true);
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/Nothing was taken/);
    expect(await spent(me.id)).toBe(0);
    expect(await credits(me.id)).toBe(0);
    // With credits already: the one taken comes back.
    voiceDown = false;
    await voice(me.cookie, id, reply, true);
    const other = (await t.db.query<{ id: string }>(`insert into companion_messages (id, thread_id, role, text) values ($1, $2, 'character', 'Something new to say.') returning id`, [crypto.randomUUID(), id])).rows[0].id;
    voiceDown = true;
    await voice(me.cookie, id, other, true);
    expect(await credits(me.id)).toBe(COMPANION_EXTRAS.voice.bundle - 1);
    expect(await spent(me.id)).toBe(1);
  });

  it("guests get none (sign in first); a paused thread and the person's own lines are refused", async () => {
    const me = await person();
    const { id, reply } = await thread(me.cookie);
    // No account: asked to sign in, nothing made.
    const anon = await actRoute(req(`/api/companion/${id}`, { action: "voice", message_id: reply }, "bz_adult=1"), ctx(id));
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as Any).error).toBe("sign_in");
    const mineLine = (await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and role = 'user' limit 1`, [id])).rows[0];
    if (mineLine) expect((await voice(me.cookie, id, mineLine.id, true)).status).toBe(404);
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    await tokens(me.id, 1);
    expect((await voice(me.cookie, id, reply, true)).status).toBe(409);
    expect(asked).toHaveLength(0);
    expect(await spent(me.id)).toBe(0);
  });

  it("plays only to the thread's owner, or by a signed link; deleting the thread takes the file", async () => {
    const me = await person({ admin: true });
    const { id, reply } = await thread(me.cookie);
    const made = await voice(me.cookie, id, reply);
    expect(made.status).toBe(200);
    expect(await spent(me.id)).toBe(0);
    const play = (cookie?: string, q = "") => voiceRoute(req(`/api/companion/${id}/voice/${reply}${q}`, null, cookie, "GET"), { params: Promise.resolve({ id, messageId: reply }) });
    const mine = await play(me.cookie);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("audio/mpeg");
    expect(mine.headers.get("x-ai-generated")).toBe("true");
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(MP3);
    const stranger = await person();
    expect((await play(stranger.cookie)).status).toBe(404);
    expect((await play()).status).toBe(404);
    const link = signedVoiceUrl(id, reply, BASE_URL)!;
    const q = link.slice(link.indexOf("?"));
    expect((await play(undefined, q)).status).toBe(200);
    const u = new URL(link);
    expect(voiceLinkValid(id, "someone-else", u.searchParams.get("until"), u.searchParams.get("sig"))).toBe(false);
    expect((await t.db.query(`select 1 from companion_voice`)).rows).toHaveLength(1);
    const del = await deleteRoute(req(`/api/companion/${id}`, null, me.cookie, "DELETE"), ctx(id));
    expect(del.status).toBe(200);
    expect((await t.db.query(`select 1 from companion_voice`)).rows).toHaveLength(0);
  });

  it("over MCP: an agent's voice note is free, a signed link, and read carries it", async () => {
    const ADMIN_KEY = ["voice", "mcp", "admin", "key"].join("-");
    vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
    const rpc = async (method: string, params: Any = {}, c: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, c);
    const c0: McpContext = { adminKey: ADMIN_KEY };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "voice-test" } }, c0);
    const c: McpContext = { sessionId: c0.issuedSessionId, adminKey: ADMIN_KEY };
    const call = async (args: Any) => (await rpc("tools/call", { name: "companion", arguments: args }, c)).result;
    const opened = (await call({ action: "open", character_id: CAST.id })).structuredContent;
    const said = opened.reply.at(-1);
    const v = await call({ action: "voice", thread_id: opened.thread_id, message_id: said.id });
    expect(v.isError).toBeUndefined();
    expect(v.structuredContent.voice).toMatch(new RegExp(`/api/companion/${opened.thread_id}/voice/${said.id}\\?until=\\d+&sig=`));
    const read = (await call({ action: "read", thread_id: opened.thread_id })).structuredContent;
    expect(read.messages.find((m: Any) => m.id === said.id).voice).toMatch(/sig=/);
    expect((await call({ action: "voice", thread_id: opened.thread_id })).isError).toBe(true);
  });
});
