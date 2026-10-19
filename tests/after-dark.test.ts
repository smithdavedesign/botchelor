import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { adultModeEnabled, setAdultModelForTests } from "@/lib/adult/mode";
import { parseSceneLines } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// After dark (lib/adult): admin only, local only, this season's cast only, and nothing it writes reaches the show.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie?: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const get = (a: string, b: string, cookie?: string) => GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${a}&b=${b}`, { headers: cookie ? { cookie } : {} }));
const scripted = (reply: string) => setAdultModelForTests({ complete: async () => reply });

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

describe("the gate", () => {
  it("is off without ADULT_MODE=1, and always off on Vercel", () => {
    expect(adultModeEnabled({ ADULT_MODE: "1" })).toBe(true);
    expect(adultModeEnabled({})).toBe(false);
    expect(adultModeEnabled({ ADULT_MODE: "1", VERCEL: "1" })).toBe(false);
    expect(adultModeEnabled({ ADULT_MODE: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("is not found for a stranger, a non-admin, an old unsigned cookie, and the admin when it's on Vercel", async () => {
    const { id, cookie } = await admin();
    expect((await get(CAST_A, CAST_B)).status).toBe(404);
    expect((await get(CAST_A, CAST_B, signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    expect((await get(CAST_A, CAST_B, `bz_uid=${id}`)).status).toBe(404);
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(200);
    vi.stubEnv("VERCEL", "1");
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(404);
  });

  it("is this season's cast only: anyone's own character, or a character with itself, is not found", async () => {
    const { cookie } = await admin();
    const own = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), newUserCookie())).json();
    expect((await get(CAST_A, own.id, cookie)).status).toBe(404);
    expect((await get(CAST_A, CAST_A, cookie)).status).toBe(404);
  });
});

describe("the two lines that never move", () => {
  it("adult content between adults passes; a minor or a real person never does", () => {
    expect(checkAdultText({ line: "She pulls him onto the bed and they stop talking for a while." }).ok).toBe(true);
    expect(checkAdultText({ line: "She looks like a schoolgirl" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "back when she was fifteen" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "She was fifteen when she first did this." })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "he turned 17 last spring" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "He looks just like Taylor Swift" })).toMatchObject({ ok: false, reason: "real_person" });
    // Times and amounts are not ages.
    expect(checkAdultText({ line: "She was ten minutes late and it was eleven o'clock." }).ok).toBe(true);
    expect(checkAdultText({ line: "They were twelve feet from the door." }).ok).toBe(true);
  });
});

describe("a scene", () => {
  it("writes the next lines on the after-dark model, drops any that cross a line, and keeps them out of the show", async () => {
    const { cookie } = await admin();
    scripted(
      JSON.stringify({
        lines: [
          { who: "a", text: "Your place or mine?" },
          { who: "b", text: "Mine. It's closer." },
          { who: "a", text: "She was fifteen when she first did this." },
        ],
      }),
    );
    const res = await post({ a: CAST_A, b: CAST_B, direction: "they share a cab home" }, cookie);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ added: 2, held: 1 });
    expect(body.scene.lines.map((l: { text: string }) => l.text)).toEqual(["Your place or mine?", "Mine. It's closer."]);
    // Nothing of it in any date, any texts, the characters' memory, or the feed.
    const everywhere = await t.db.query<{ t: string }>(
      `select coalesce((select string_agg(transcript::text, ' ') from episodes), '') ||
              coalesce((select string_agg(text, ' ') from couple_texts), '') ||
              coalesce((select string_agg(m::text, ' ') from character_memory m), '') as t`,
    );
    expect(everywhere.rows[0].t).not.toContain("Your place or mine");
    expect(JSON.stringify(await (await api.feed()).json())).not.toContain("Your place or mine");
  });

  it("refuses a steer that crosses a line, and starts over on request", async () => {
    const { cookie } = await admin();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Hello." }] }));
    expect((await post({ a: CAST_A, b: CAST_B, direction: "make her sixteen" }, cookie)).status).toBe(422);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const reset = await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json();
    expect(reset.scene.lines).toEqual([]);
  });

  it("reads the shapes small local models reply in", () => {
    const names = { a: "Ada Lumen", b: "Bo Quill" };
    const want = [
      { who: "a", text: "Hi." },
      { who: "b", text: "Hello there." },
    ];
    expect(parseSceneLines(JSON.stringify({ lines: [{ who: "a", text: "Hi." }, { who: "b", text: "Hello there." }] }), names)).toEqual(want);
    expect(parseSceneLines('{\n"Ada": "Hi.",\n"Bo": "Hello there."\n}', names)).toEqual(want);
    expect(parseSceneLines("Ada: Hi.\nBo: Hello there.\n(narration)", names)).toEqual(want);
  });
});

import { GET as settingsGet, POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { POST as switchPost } from "@/app/api/admin/after-dark/switch/route";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { GET as clipGet, POST as clipPost } from "@/app/api/admin/after-dark/clip/route";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { listNotifications } from "@/lib/notifications";

const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** A stand-in for fal.ai: pictures come back at once, a clip after one status poll. */
function fakeFal() {
  const seen: string[] = [];
  setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://fal.run/")) return Response.json({ images: [{ url: "https://cdn.fal.test/pic.png" }] });
    if (url.startsWith("https://queue.fal.run/") && init?.method === "POST") return Response.json({ request_id: "req-1" });
    if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    if (url.includes("/requests/req-1")) return Response.json({ video: { url: "https://cdn.fal.test/clip.mp4" } });
    if (url.endsWith(".png")) return new Response(PNG, { headers: { "content-type": "image/png" } });
    if (url.endsWith(".mp4")) return new Response(PNG, { headers: { "content-type": "video/mp4" } });
    return new Response("nope", { status: 404 });
  });
  return seen;
}

describe("on the site, from the settings panel", () => {
  afterEach(() => setMediaFetchForTests(null));

  it("the settings are an admin's only; keys come back as their last four; it opens on Vercel once on with a key", async () => {
    vi.stubEnv("ADULT_MODE", "");
    vi.stubEnv("VERCEL", "1");
    const { cookie } = await admin();
    expect((await settingsGet(new Request(`${BASE_URL}/api/admin/after-dark/settings`))).status).toBe(404);
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(404);
    const saved = await (await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", fal_key: "placeholder-media-WXYZ" }, cookie)).json();
    expect(saved.settings).toMatchObject({ enabled: true, openrouter_last4: "ABCD", fal_last4: "WXYZ" });
    expect(JSON.stringify(saved)).not.toContain("placeholder");
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(200);
  });

  it("an admin switches their own character in, never someone else's", async () => {
    const { id, cookie } = await admin();
    const mineCookie = signedIn(id);
    const mine = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), `bz_uid=${id}`)).json();
    const theirs = await (await api.createCharacter(validCharacter({ name: "Not Yours" }), newUserCookie())).json();
    expect((await get(mine.id, CAST_A, cookie)).status).toBe(404);
    expect((await call(switchPost, "/api/admin/after-dark/switch", { character_id: mine.id, on: true }, mineCookie)).status).toBe(200);
    expect((await get(mine.id, CAST_A, cookie)).status).toBe(200);
    expect((await call(switchPost, "/api/admin/after-dark/switch", { character_id: theirs.id, on: true }, cookie)).status).toBe(403);
  });

  it("makes no picture or clip until the output check exists: the scene still writes, and says why", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ" }, cookie);
    const seen = fakeFal();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: { of: "both", description: "the two of them" } }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.added).toBe(1);
    expect(r.pictures).toEqual([]);
    expect(r.picture_note).toMatch(/off until every image is checked/);
    expect(seen.filter((s) => s.includes("fal.run"))).toEqual([]);
  });

  it.skip("(once the output check exists) makes each character's baseline the first time it turns explicit, a new picture only when they agree, and serves them only to an admin", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ" }, cookie);
    const seen = fakeFal();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }, { who: "b", text: "Make me." }], explicit: true, picture: null }));
    const first = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(first.pictures.map((p: { kind: string }) => p.kind)).toEqual(["baseline", "baseline"]);
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Again." }], explicit: true, picture: { of: "both", description: "the two of them on the sofa" } }));
    const second = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(second.pictures.map((p: { kind: string }) => p.kind)).toEqual(["scene"]);
    expect(seen.filter((s) => s.startsWith("POST https://fal.run/"))).toHaveLength(3);
    const pic = second.pictures[0].id as string;
    const media = (c?: string) => mediaGet(new Request(`${BASE_URL}/api/admin/after-dark/media/${pic}`, { headers: c ? { cookie: c } : {} }), { params: Promise.resolve({ id: pic }) });
    expect((await media(cookie)).status).toBe(200);
    expect((await media()).status).toBe(404);
    // A clip from that picture: started on fal's queue, then stored once it's done.
    const clip = await (await call(clipPost, "/api/admin/after-dark/clip", { image_id: pic, motion: "a slow turn" }, cookie)).json();
    expect(clip.clip.status).toBe("pending");
    const polled = await (await clipGet(new Request(`${BASE_URL}/api/admin/after-dark/clip?id=${clip.clip.id}`, { headers: { cookie } }))).json();
    expect(polled.status).toBe("ready");
  });
});

describe("over MCP", () => {
  // Made up per run, so nothing in the repo looks like a stored password.
  const ADMIN_KEY = crypto.randomUUID();
  const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext) => (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx))!;

  it("lists after dark's tools only to a call with the admin key, and treats them as unknown for everyone else", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
    const names = async (ctx: McpContext) => ((await rpc("tools/list", {}, ctx)).result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(await names({})).not.toContain("after_dark_write");
    expect(await names({})).toContain("request_after_dark");
    expect(await names({ adminKey: "wrong" })).not.toContain("after_dark_write");
    expect(await names({ adminKey: ADMIN_KEY })).toContain("after_dark_write");
    const stranger = await rpc("tools/call", { name: "after_dark_pairs", arguments: {} }, {});
    expect((stranger.error as { message?: string } | undefined)?.message).toMatch(/unknown tool/);
  });

  it("an admin's agent writes a scene; another agent can only ask, and the admins are told", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
    const { id } = await admin();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Hello again." }] }));
    const wrote = await rpc("tools/call", { name: "after_dark_write", arguments: { a: CAST_A, b: CAST_B } }, { adminKey: ADMIN_KEY });
    expect((wrote.result as { structuredContent?: { added?: number } }).structuredContent?.added ?? JSON.stringify(wrote.result)).toBeTruthy();
    const asked = await rpc("tools/call", { name: "request_after_dark", arguments: { reason: "I'm an agent and I'd like in." } }, {});
    expect(JSON.stringify(asked.result)).toMatch(/Sent to the admins/);
    expect((await t.db.query(`select 1 from adult_access_requests`)).rows).toHaveLength(1);
    expect((await listNotifications(t.db, id))[0]).toMatchObject({ kind: "after_dark_request" });
  });
});

describe("the model call", () => {
  it("asks for a bounded reply, so a small OpenRouter key isn't refused for the model's whole maximum", async () => {
    const { cookie } = await admin();
    let seen: { maxTokens?: number } | undefined;
    setAdultModelForTests({ complete: async (_m, o) => ((seen = o), JSON.stringify({ lines: [{ who: "a", text: "Hi." }] })) });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(seen?.maxTokens).toBe(1200);
  });
});

describe("settings over MCP", () => {
  it("an admin's agent reads and changes the models, never the keys", async () => {
    const key = crypto.randomUUID();
    vi.stubEnv("FRONTIER_PASSWORD", key);
    const run = async (args: Record<string, unknown>) =>
      ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "after_dark_settings", arguments: args } }, { adminKey: key }))!.result as {
        structuredContent: { settings: Record<string, unknown> };
      }).structuredContent.settings;
    expect((await run({ text_model: "sao10k/l3.3-euryale-70b" })).text_model).toBe("sao10k/l3.3-euryale-70b");
    expect(JSON.stringify(await run({}))).not.toMatch(/ciphertext|nonce/);
    const stranger = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "after_dark_settings", arguments: {} } }, {});
    expect((stranger!.error as { message?: string } | undefined)?.message).toMatch(/unknown tool/);
  });
});

import { overusedWords, sceneMessages } from "@/lib/adult/scenes";

describe("the scene prompt", () => {
  it("names the words the scene keeps leaning on (not the characters' names), and asks for actions apart from speech", () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Sure thing, captain. Ada, captain, really ${i}.` }));
    expect(overusedWords(lines, ["Ada Lumen", "Bo Quill"])).toEqual(["captain", "sure", "thing"]);
    const msgs = sceneMessages(null, null, null, lines, null);
    expect(msgs[1].content).toMatch(/Don.t lean on these words again: captain, sure, thing/);
    expect(msgs[1].content).toMatch(/Move the scene forward/);
    expect(msgs[1].content).toMatch(/"action"/);
  });

  it("puts the action before the speech", () => {
    expect(parseSceneLines(JSON.stringify({ lines: [{ who: "a", action: "leans in", text: "Hi." }, { who: "b", action: "", text: "Hello." }] }), { a: "Ada Lumen", b: "Bo Quill" })).toEqual([
      { who: "a", text: "*leans in* Hi." },
      { who: "b", text: "Hello." },
    ]);
  });
});
