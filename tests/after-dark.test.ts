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
    expect(checkAdultText({ place: "her dorm, she's sixteen" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "I'm only fifteen" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "they're 16" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "She's ten minutes late and he's 34." }).ok).toBe(true);
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
import { baselinePrompt, FACE_MODEL, physicalLook, recentActions, scenePrompt, setMediaFetchForTests, VENICE_IMAGE } from "@/lib/adult/media";
import type { Character } from "@/lib/character";
import { checkOutput, classScores, HIVE_VLM, setCheckFetchForTests, vlmAnswer } from "@/lib/adult/check";
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

/** Hive's replies (V3): moderation with no child, and the VLM saying everyone's an adult; or what a test passes in. */
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: "ADULTS" } }] };
function fakeHive(vlm: unknown = ADULTS, mod: unknown = CLEAN_MOD, fail = false) {
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String((init?.headers as Record<string, string>)?.authorization ?? ""));
    if (fail) return new Response("down", { status: 500 });
    return Response.json(String(input) === HIVE_VLM ? vlm : mod);
  });
  return seen;
}

describe("on the site, from the settings panel", () => {
  afterEach(() => {
    setMediaFetchForTests(null);
    setCheckFetchForTests(null);
  });

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
    expect(r.picture_note).toMatch(/off until the output check is set up/);
    expect(seen.filter((s) => s.includes("fal.run"))).toEqual([]);
    // Why the picture didn't come stays on the scene for the gallery, with where they are and how far it's gone.
    scripted(JSON.stringify({ lines: [{ who: "b", text: "Let's get out of here." }], place: "her flat", stage: 3, explicit: false, picture: null }));
    const again = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    // Unsteered, the stage can't jump: it holds until the stage has had its lines, then moves one at a time.
    expect(again.scene).toMatchObject({ place: "her flat", stage: 0, picture_note: expect.stringMatching(/off until the output check/) });
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    const fresh = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(fresh.scene.lines.length).toBeGreaterThan(0);
  });

  it("makes each character's baseline the first time it turns explicit, a new picture only when they agree, and serves them only to an admin", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive" }, cookie);
    const seen = fakeFal();
    fakeHive();
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

describe("the output check (Hive)", () => {
  afterEach(() => {
    setMediaFetchForTests(null);
    setCheckFetchForTests(null);
  });

  const cases: [string, unknown, unknown, boolean, RegExp][] = [
    ["a child present", ADULTS, { output: [{ classes: [{ class: "no_child_present", value: 0.6 }, { class: "yes_child_present", value: 0.4 }] }] }, false, /moderation: yes_child_present/],
    ["the VLM says a minor", { choices: [{ message: { content: "MINOR" } }] }, CLEAN_MOD, false, /age check: MINOR/],
    ["the VLM is unsure", { choices: [{ message: { content: "Unsure." } }] }, CLEAN_MOD, false, /age check: UNSURE/],
    ["an unreadable reply", {}, CLEAN_MOD, false, /age check: no answer/],
    ["no child scores", ADULTS, { output: [] }, false, /no child scores/],
    ["Hive down", ADULTS, CLEAN_MOD, true, /couldn't run/],
  ];
  for (const [what, vlm, mod, fail, reason] of cases) {
    it(`discards the picture, stores nothing, and logs why: ${what}`, async () => {
      const { cookie } = await admin();
      await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive" }, cookie);
      fakeFal();
      fakeHive(vlm, mod, fail);
      scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
      const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
      expect(r.added).toBe(1);
      expect(r.pictures).toEqual([]);
      expect(r.picture_note).toMatch(/discarded by the output check/);
      expect((await t.db.query(`select 1 from adult_images`)).rows).toHaveLength(0);
      const logged = (await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows;
      expect(logged[0].reason).toMatch(reason);
    });
  }

  it("reads Hive's V3 replies, and sends the one secret key as a Bearer token", async () => {
    expect(classScores(CLEAN_MOD).map((c) => c.cls)).toEqual(["yes_child_present", "no_child_present", "general_nsfw"]);
    expect(vlmAnswer(ADULTS)).toBe("ADULTS");
    expect(vlmAnswer({ choices: [{ message: { content: " adults." } }] })).toBe("ADULTS");
    const seen = fakeHive();
    expect(await checkOutput("placeholder-hive", "https://cdn.fal.test/pic.png")).toEqual({ ok: true });
    expect(seen).toEqual(["Bearer placeholder-hive", "Bearer placeholder-hive"]);
    expect(await checkOutput(null, "https://cdn.fal.test/pic.png")).toMatchObject({ ok: false });
  });

  it("checks a clip's frames with moderation only (its picture already passed the age check)", async () => {
    const seen = fakeHive({});
    expect(await checkOutput("placeholder-hive", "https://cdn.fal.test/clip.mp4", "video")).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
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

import { listNights, overusedWords, parseSceneMeta, sceneMessages } from "@/lib/adult/scenes";
import { lineToTurn, stageFor } from "@/app/after-dark/[a]/[b]/AfterDarkTheater";

describe("the scene prompt", () => {
  it("names the words the scene keeps leaning on (not the characters' names), and asks for actions apart from speech", () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Sure thing, captain. Ada, captain, really ${i}.` }));
    expect(overusedWords(lines, ["Ada Lumen", "Bo Quill"])).toEqual(["captain", "sure", "thing"]);
    const msgs = sceneMessages(null, null, null, lines, null);
    expect(msgs[1].content).toMatch(/Don.t lean on these words again: captain, sure, thing/);
    expect(msgs[1].content).toMatch(/Move the scene forward/);
    expect(msgs[1].content).toMatch(/"action"/);
  });

  it("builds slowly and respects where they are: a cafe is for flirting, going further means leaving first", () => {
    const msgs = sceneMessages(null, null, null, [], null, undefined, { place: "a cafe, where their date was", stage: 0 });
    expect(msgs[0].content).toMatch(/Where they are now: a cafe, where their date was\. How far it's gone: talking and flirting \(stage 1 of 5/);
    expect(msgs[0].content).toMatch(/Tease it out. These lines stay at talking and flirting/);
    expect(sceneMessages(null, null, null, [], null, undefined, { place: "her flat", stage: 1, linesAtStage: 12 })[0].content).toMatch(/Move it on\. .*goes one stage further, to kissing, and no further/);
    expect(msgs[0].content).toMatch(/public place.*at most, kiss.*somewhere private/);
    expect(msgs[1].content).toMatch(/"place"/);
    expect(parseSceneMeta(JSON.stringify({ lines: [], place: "her flat", stage: 3 }))).toMatchObject({ place: "her flat", stage: 2 });
    expect(parseSceneMeta(JSON.stringify({ lines: [], stage: 99 })).stage).toBe(4);
    expect(parseSceneMeta(JSON.stringify({ lines: [] }))).toMatchObject({ place: null, stage: null });
  });

  it("teases it out: a stage holds for its lines, then moves one step at a time; a steer can jump", async () => {
    const { cookie } = await admin();
    const six = (stage: number) => JSON.stringify({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `Line ${i}.` })), place: "the cafe", stage });
    const step = async (stage: number, direction?: string) => {
      scripted(six(stage));
      return (await (await post({ a: CAST_A, b: CAST_B, ...(direction ? { direction } : {}) }, cookie)).json()).scene.stage as number;
    };
    expect(await step(5)).toBe(0);
    expect(await step(5)).toBe(0);
    expect(await step(5)).toBe(1);
    expect(await step(5)).toBe(1);
    expect(await step(5, "They go straight back to hers and into bed.")).toBe(4);
    const msgs = sceneMessages(null, null, null, [], null, undefined, { place: "a cafe", stage: 0, linesAtStage: 0 });
    expect(msgs[0].content).toMatch(/Tease it out/);
    expect(msgs[0].content).toMatch(/still at a cafe\. They don't leave in these first lines/);
  });

  it("files the scene as a saved night on Start over, to play back; only its owner sees it", async () => {
    const { id, cookie } = await admin();
    scripted(JSON.stringify({ lines: [{ who: "a", action: "leans in", text: "Hi." }, { who: "b", text: "Hello." }], place: "the bar", stage: 1 }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const reset = await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json();
    expect(reset.scene.lines).toEqual([]);
    expect(reset.nights).toHaveLength(1);
    expect(reset.nights[0]).toMatchObject({ place: "the bar", lines: [{ who: "a", text: "*leans in* Hi." }, { who: "b", text: "Hello." }] });
    expect(await listNights(t.db, id, CAST_B, CAST_A)).toHaveLength(1);
    expect(await listNights(t.db, crypto.randomUUID(), CAST_A, CAST_B)).toEqual([]);
    // An empty scene isn't filed.
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    expect(await listNights(t.db, id, CAST_A, CAST_B)).toHaveLength(1);
  });

  it("plays a scene line as a date turn on the right set", () => {
    expect(lineToTurn({ who: "a", text: "*leans in* Hi there." })).toMatchObject({ side: "a", action: "leans in", dialogue: "Hi there." });
    expect(lineToTurn({ who: "b", text: "Plain." })).toMatchObject({ action: "", dialogue: "Plain." });
    expect(stageFor(null, "bowling_alley")).toBe("bowling_alley");
    expect(stageFor("bowling alley, lane twelve", "bowling_alley")).toBe("bowling_alley");
    expect(stageFor("his apartment", "bowling_alley")).toBe("elsewhere@his apartment");
    expect(stageFor("a rooftop pool at midnight", "bowling_alley")).toBe("elsewhere@a rooftop pool at midnight");
  });

  it("puts the action before the speech", () => {
    expect(parseSceneLines(JSON.stringify({ lines: [{ who: "a", action: "leans in", text: "Hi." }, { who: "b", action: "", text: "Hello." }] }), { a: "Ada Lumen", b: "Bo Quill" })).toEqual([
      { who: "a", text: "*leans in* Hi." },
      { who: "b", text: "Hello." },
    ]);
  });
});

import { canAfterDark } from "@/lib/adult/entitlement";

describe("who it opens for (canAfterDark)", () => {
  const entitle = (userId: string, status: string, ageChecked: boolean, periodEnd: string | null = null) =>
    t.db.query(`insert into adult_entitlements (user_id, subscription_status, period_end, age_verified_at) values ($1, $2, $3, $4)`, [
      userId,
      status,
      periodEnd,
      ageChecked ? new Date().toISOString() : null,
    ]);

  it("an admin always; anyone else needs an active subscription and a passed age check; signed out never", async () => {
    const { id } = await admin();
    expect(await canAfterDark(t.db, { userId: id, authenticated: true })).toEqual({ ok: true, why: "admin" });
    expect(await canAfterDark(t.db, { userId: id, authenticated: false })).toEqual({ ok: false, why: "signed_out" });
    const u = userIdOf(newUserCookie());
    expect((await canAfterDark(t.db, { userId: u, authenticated: true })).why).toBe("needs_subscription");
    await entitle(u, "active", false);
    expect((await canAfterDark(t.db, { userId: u, authenticated: true })).why).toBe("needs_age_check");
    await t.db.query(`update adult_entitlements set age_verified_at = now() where user_id = $1`, [u]);
    expect(await canAfterDark(t.db, { userId: u, authenticated: true })).toEqual({ ok: true, why: "subscribed" });
    // A lapsed subscription closes it again, and so does a period that ended.
    await t.db.query(`update adult_entitlements set period_end = now() - interval '1 day' where user_id = $1`, [u]);
    expect((await canAfterDark(t.db, { userId: u, authenticated: true })).why).toBe("needs_subscription");
  });

  it("a subscriber gets in, switches only their own characters, and is capped; an admin isn't", async () => {
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD" }, (await admin()).cookie);
    const sub = userIdOf(newUserCookie());
    await entitle(sub, "active", true);
    const cookie = signedIn(sub);
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(200);
    const theirs = await (await api.createCharacter(validCharacter({ name: "Not Yours" }), newUserCookie())).json();
    expect((await call(switchPost, "/api/admin/after-dark/switch", { character_id: theirs.id, on: true }, cookie)).status).toBe(403);
    await t.db.query(`update adult_settings set cap_writes = 1 where id = 1`);
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Hi." }] }));
    expect((await post({ a: CAST_A, b: CAST_B }, cookie)).status).toBe(200);
    const capped = await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toMatch(/this month's 1 scene steps/);
  });

  it("one person's switches don't change anyone else's after dark", async () => {
    const a = await admin();
    const mine = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), `bz_uid=${a.id}`)).json();
    await call(switchPost, "/api/admin/after-dark/switch", { character_id: mine.id, on: true }, a.cookie);
    const sub = userIdOf(newUserCookie());
    await entitle(sub, "active", true);
    expect((await get(mine.id, CAST_A, signedIn(sub))).status).toBe(404);
    expect((await get(mine.id, CAST_A, a.cookie)).status).toBe(200);
  });
});

describe("the picture request", () => {
  afterEach(() => {
    setMediaFetchForTests(null);
    setCheckFetchForTests(null);
  });

  it("asks fal's custom-model endpoint for the photoreal base, steering away from anyone young-looking", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive" }, cookie);
    let sent: Record<string, unknown> | null = null;
    let url = "";
    setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.startsWith("https://fal.run/")) {
        url = u;
        sent = JSON.parse(String(init?.body));
        return Response.json({ images: [{ url: "https://cdn.fal.test/pic.png" }] });
      }
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    });
    fakeHive();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(url).toBe("https://fal.run/fal-ai/lora");
    expect(sent).toMatchObject({ model_name: "SG161222/RealVisXL_V4.0", prompt_weighting: true, negative_prompt: expect.stringMatching(/teen.*minor/) });
  });

  it("a picture of one of them keeps their face (their baseline as the reference); of both, or with no face found, it goes from the words", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive" }, cookie);
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    let faceStatus = 200;
    setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (!u.startsWith("https://fal.run/")) return new Response(PNG, { headers: { "content-type": "image/png" } });
      sent.push({ url: u, body: JSON.parse(String(init?.body)) });
      if (u.endsWith(FACE_MODEL)) return faceStatus === 200 ? Response.json({ image: { url: "https://cdn.fal.test/face.png" } }) : new Response("no face", { status: faceStatus });
      return Response.json({ images: [{ url: "https://cdn.fal.test/pic.png" }] });
    });
    fakeHive();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(sent.map((s) => s.url)).toEqual(["https://fal.run/fal-ai/lora", "https://fal.run/fal-ai/lora"]);

    sent.length = 0;
    scripted(JSON.stringify({ lines: [{ who: "b", action: "pulls him onto the couch", text: "Show me." }], place: "his flat", stage: 5, explicit: true, picture: { of: "a", description: "him on the couch" } }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`https://fal.run/${FACE_MODEL}`);
    expect(sent[0].body).toMatchObject({ face_image_url: expect.stringMatching(/^data:image\/png;base64,/), base_sdxl_model_repo: "SG161222/RealVisXL_V4.0" });
    expect(sent[0].body.prompt).toMatch(/^Explicit, uncensored adult photograph: him on the couch\..*Setting: his flat\. Just now: pulls him onto the couch\./);

    sent.length = 0;
    faceStatus = 422;
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Again." }], explicit: true, picture: { of: "b", description: "her by the window" } }));
    expect((await (await post({ a: CAST_A, b: CAST_B }, cookie)).json()).pictures).toHaveLength(1);
    expect(sent.map((s) => s.url)).toEqual([`https://fal.run/${FACE_MODEL}`, "https://fal.run/fal-ai/lora"]);

    sent.length = 0;
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Both of us." }], explicit: true, picture: { of: "both", description: "the two of them" } }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(sent.map((s) => s.url)).toEqual(["https://fal.run/fal-ai/lora"]);
  });
});

describe("what a picture's prompt knows", () => {
  const sable = { id: "house-sable", name: "Sable Quist", age: 33, pronouns: "she/her", look: { appearance: "mismatched everything, glitter that refuses to wash out, always mid-laugh" } } as unknown as Character;
  const chud = { id: "chud-1", name: "Chud Crusher", age: 30, pronouns: "he/him", look: { appearance: "broad shoulders, buzz cut, a captain's hat" } } as unknown as Character;

  it("uses a house character's physical look over the vibe line, drops clothes once undressed, and never says a name", () => {
    expect(physicalLook(sable)).toMatch(/copper hair/);
    expect(physicalLook(sable)).toMatch(/patterned jacket/);
    expect(physicalLook(sable, true)).not.toMatch(/jacket|laughing/);
    expect(physicalLook(chud)).toBe("broad shoulders, buzz cut, a captain's hat");
    const p = baselinePrompt(sable);
    expect(p).toMatch(/33-year-old adult woman, in her early thirties with light tan skin, .*copper hair.*\. Nude, alone, waist-up, facing the camera/);
    expect(p).not.toMatch(/Sable|Quist/);
  });

  it("puts what the picture shows first, then who, where and what just happened; clothed before they undress", () => {
    const p = scenePrompt(chud, sable, "both", "kissing on the couch.", { place: "his flat", stage: 2, recent: ["pulls her closer"] });
    expect(p).toBe(
      "Candid adult photograph: kissing on the couch. A 30-year-old adult man, broad shoulders, buzz cut, a captain's hat and a 33-year-old adult woman, " +
        physicalLook(sable) +
        ". Setting: his flat. Just now: pulls her closer. Photorealistic. Everyone shown is an adult.",
    );
    expect(recentActions([{ text: "*leans in* Hi." }, { text: "No action." }, { text: "*kicks the door open* Home." }, { text: "*laughs* Ok." }])).toEqual(["kicks the door open", "laughs"]);
  });
});

import { fillerLines, teasersFor } from "@/lib/adult/teaser";

describe("the teaser in the show", () => {
  it("counts only the season's scenes (an admin's), never one person's private scene, and never carries a real line", async () => {
    const { cookie } = await admin();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "The secret line nobody outside should read." }, { who: "b", text: "Agreed." }] }));
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const [t1] = await teasersFor(t.db, { pair: [CAST_B, CAST_A] });
    expect(t1).toMatchObject({ lines: 2, path: expect.stringMatching(/^\/after-dark\//) });
    expect((await teasersFor(t.db, { character: CAST_A })).length).toBe(1);
    // A subscriber's own private scene is never teased.
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines) values ($1, $2, $3, $4, $5::jsonb)`, [
      crypto.randomUUID(),
      sub,
      ...[CAST_A, HOUSE_CHARACTERS[2].id].sort(),
      JSON.stringify([{ who: "a", text: "Mine." }]),
    ]);
    expect((await teasersFor(t.db, { character: HOUSE_CHARACTERS[2].id })).length).toBe(0);
    const filler = fillerLines(3, t1.path).join(" ");
    expect(filler).not.toContain("secret line");
    expect(fillerLines(3, t1.path)).toEqual(fillerLines(3, t1.path));
  });
});

describe("pictures on Venice", () => {
  afterEach(() => {
    setMediaFetchForTests(null);
    setCheckFetchForTests(null);
  });

  it("makes them on Venice with safe mode off, checks the bytes with Hive before storing, and keeps clips to fal pictures", async () => {
    const { cookie } = await admin();
    const saved = await (
      await call(settingsPost, "/api/admin/after-dark/settings", { image_provider: "venice", venice_key: "placeholder-venice-VNCE", hive_key: "placeholder-hive" }, cookie)
    ).json();
    expect(saved.settings).toMatchObject({ image_provider: "venice", venice_image_model: "lustify-v8", venice_last4: "VNCE" });
    let sent: Record<string, unknown> | null = null;
    setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === VENICE_IMAGE) {
        sent = JSON.parse(String(init?.body));
        return Response.json({ id: "x", images: [Buffer.from(PNG).toString("base64")], timing: {} });
      }
      return new Response("unexpected", { status: 500 });
    });
    const bodies: Record<string, unknown>[] = [];
    setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD);
    });
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }));
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.pictures.map((p: { kind: string }) => p.kind)).toEqual(["baseline", "baseline"]);
    expect(sent).toMatchObject({ model: "lustify-v8", safe_mode: false, negative_prompt: expect.stringMatching(/minor/) });
    expect(JSON.stringify(bodies[0])).toContain("media_base64");
    const row = (await t.db.query<{ remote_url: string | null }>(`select remote_url from adult_images limit 1`)).rows[0];
    expect(row.remote_url).toBeNull();
    const clip = await call(clipPost, "/api/admin/after-dark/clip", { image_id: r.pictures[0].id, motion: "" }, cookie);
    expect((await clip.json()).message).toMatch(/made on Venice/);
  });
});

describe("set the scene (1 token)", () => {
  const entitle = (userId: string) =>
    t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [userId]);

  it("jumps the scene to any place; the next lines open on arriving there; an admin doesn't pay", async () => {
    const { cookie } = await admin();
    const moved = await (await post({ a: CAST_A, b: CAST_B, set_scene: "a rooftop pool at midnight" }, cookie)).json();
    expect(moved.scene).toMatchObject({ place: "a rooftop pool at midnight", set_place: "a rooftop pool at midnight", cut_to: "a rooftop pool at midnight" });
    let prompt = "";
    setAdultModelForTests({
      complete: async (msgs: { content: string }[]) => {
        prompt = msgs[0].content;
        return JSON.stringify({ lines: [{ who: "a", text: "How did we get up here?" }], set: "rooftop pool" });
      },
    } as never);
    const next = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(prompt).toMatch(/The scene has just cut to a rooftop pool at midnight: they're there now/);
    expect(next.scene).toMatchObject({ cut_to: null, set_place: "rooftop pool" });
  });

  it("costs a subscriber 1 bought token, refuses without one, and gives it back when the place is refused", async () => {
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD" }, (await admin()).cookie);
    const sub = userIdOf(newUserCookie());
    await entitle(sub);
    const cookie = signedIn(sub);
    const broke = await post({ a: CAST_A, b: CAST_B, set_scene: "a lighthouse" }, cookie);
    expect(broke.status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 2, 'test')`, [crypto.randomUUID(), sub]);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0]?.used ?? 0;
    expect((await post({ a: CAST_A, b: CAST_B, set_scene: "a lighthouse" }, cookie)).status).toBe(200);
    expect(await used()).toBe(1);
    const refused = await post({ a: CAST_A, b: CAST_B, set_scene: "her dorm, she's sixteen" }, cookie);
    expect(refused.status).toBe(422);
    expect(await used()).toBe(1);
  });
});
