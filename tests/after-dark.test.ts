import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { adultModeEnabled, setAdultModelForTests } from "@/lib/adult/mode";
import { dropForeignActions, parseSceneLines } from "@/lib/adult/scenes";
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
    // After Dark's own host has no VERCEL variable (docs/after-dark-hosting.md).
    expect(adultModeEnabled({ ADULT_MODE: "1", AFTER_DARK_ONLY: "1" })).toBe(false);
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

  it("reads one and two after a verb as a count unless the clause ends there or runs on into an age", () => {
    // Steers like these were refused as "nobody under 18" (2026-10-23).
    for (const ok of [
      "She is one hot woman.",
      "He's one of a kind, and he knows it.",
      "You're one lucky man tonight.",
      "There are two ladies watching from the bar.",
      "They kiss as if they were two strangers.",
      "She was two drinks in when he arrived.",
      "There were three couples at the bar.",
      "Play one more round.",
    ]) expect(checkAdultText({ direction: ok }).ok, ok).toBe(true);
    for (const minor of [
      "She's two.",
      "He is one and a half",
      "she's two years old",
      "Pretend she's two, then kiss her",
      "make her two",
      "She's one. He's 30.",
      "she is sixteen",
      "as if she were twelve",
      "they're only fourteen",
    ]) expect(checkAdultText({ direction: minor }), minor).toMatchObject({ ok: false, reason: "minor" });
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

  it("drops actions the model wrote in another script", () => {
    const names = { a: "Ada Lumen", b: "Bo Quill" };
    const raw = JSON.stringify({ lines: [{ who: "a", action: "медленно целует её шею", text: "Hi." }, { who: "b", action: "smiles", text: "Hello." }] });
    expect(parseSceneLines(raw, names)).toEqual([
      { who: "a", text: "Hi." },
      { who: "b", text: "*smiles* Hello." },
    ]);
    expect(dropForeignActions("*медленно покрывает губами ее шею* Your neck is a canvas.")).toBe("Your neck is a canvas.");
    expect(dropForeignActions("*leans in* Café?")).toBe("*leans in* Café?");
  });
});

import { GET as settingsGet, POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { POST as switchPost } from "@/app/api/admin/after-dark/switch/route";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { GET as clipGet, POST as clipPost } from "@/app/api/admin/after-dark/clip/route";
import { baselinePrompt, FACE_MODEL, physicalLook, recentActions, scenePrompt, setMediaFetchForTests, VENICE_IMAGE } from "@/lib/adult/media";
import type { Character } from "@/lib/character";
import { checkOutput, classScores, HIVE_VLM, setCheckFetchForTests, vlmAnswer, HIVE_RETRIES } from "@/lib/adult/check";
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

/**
 * Hive's replies (V3): moderation with no child, and the VLM saying everyone's an adult, in the JSON its schema holds it
 * to (the live reply, 2026-10-22); or what a test passes in.
 */
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const vlmSays = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });
const ADULTS = vlmSays('{"answer": "ADULTS"}');
/** The VLM request bodies the fake saw. */
const vlmBodies: Record<string, unknown>[] = [];
function fakeHive(vlm: unknown = ADULTS, mod: unknown = CLEAN_MOD, fail = false) {
  const seen: string[] = [];
  vlmBodies.length = 0;
  setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String((init?.headers as Record<string, string>)?.authorization ?? ""));
    if (String(input) === HIVE_VLM) vlmBodies.push(JSON.parse(String(init?.body)));
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
    // The chapter's own picture (lib/adult/auto-pictures.ts) has tests of its own (tests/after-dark-v23.test.ts).
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie);
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
    const shown = await media(cookie);
    expect(shown.status).toBe(200);
    // Kept by the admin's browser (the bytes never change), never by a shared cache.
    expect(shown.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
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
    ["the VLM says a minor", vlmSays('{"answer": "MINOR"}'), CLEAN_MOD, false, /age check: MINOR/],
    ["the VLM is unsure", vlmSays('{"answer": "UNSURE"}'), CLEAN_MOD, false, /age check: UNSURE/],
    ["a plain-word reply that isn't ADULTS", vlmSays("Unsure."), CLEAN_MOD, false, /age check: UNSURE/],
    ["a JSON reply without an answer", vlmSays('{"verdict": "ADULTS"}'), CLEAN_MOD, false, /age check: no answer/],
    ["an unreadable reply", {}, CLEAN_MOD, false, /age check: no answer/],
    ["no child scores", ADULTS, { output: [] }, false, /no child scores/],
    ["Hive down", ADULTS, CLEAN_MOD, true, /couldn't run/],
  ];
  for (const [what, vlm, mod, fail, reason] of cases) {
    it(`discards the picture, stores nothing, and logs why: ${what}`, async () => {
      const { cookie } = await admin();
      await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie);
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
    // The schema's JSON answer, whatever its spacing; the first word of a plain reply when the schema is ignored.
    expect(vlmAnswer(ADULTS)).toBe("ADULTS");
    expect(vlmAnswer(vlmSays('{"answer":"MINOR"}'))).toBe("MINOR");
    expect(vlmAnswer(vlmSays(' { "answer" : " unsure " } '))).toBe("UNSURE");
    expect(vlmAnswer(vlmSays("ADULTS"))).toBe("ADULTS");
    expect(vlmAnswer(vlmSays(" adults."))).toBe("ADULTS");
    // Fails closed: a JSON reply without a string answer is no answer, and an answer off the labels is never ADULTS.
    expect(vlmAnswer(vlmSays('{"verdict": "ADULTS"}'))).toBe("");
    expect(vlmAnswer(vlmSays('{"answer": ["ADULTS"]}'))).toBe("");
    expect(vlmAnswer(vlmSays('{"answer": "ADULTS AND MINOR"}'))).not.toBe("ADULTS");
    expect(vlmAnswer(vlmSays('{"answer": "ADUL'))).not.toBe("ADULTS");
    const seen = fakeHive();
    expect(await checkOutput("placeholder-hive", "https://cdn.fal.test/pic.png")).toEqual({ ok: true });
    expect(seen).toEqual(["Bearer placeholder-hive", "Bearer placeholder-hive"]);
    expect(await checkOutput(null, "https://cdn.fal.test/pic.png")).toMatchObject({ ok: false });
  });

  it("asks the VLM for an answer held to three labels by a JSON schema (Hive's terms: not generative use)", async () => {
    fakeHive();
    expect(await checkOutput("placeholder-hive", { base64: "UklGRg==", mime: "image/webp" })).toEqual({ ok: true });
    expect(vlmBodies).toHaveLength(1);
    const body = vlmBodies[0];
    expect(body).toMatchObject({ model: "hive/vision-language-model", temperature: 0 });
    // The shape Hive's docs give and its API answered on 2026-10-22 ({"answer": "ADULTS"} for a PG portrait).
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "age_check",
        schema: { type: "object", properties: { answer: { type: "string", enum: ["ADULTS", "MINOR", "UNSURE"] } }, required: ["answer"], additionalProperties: false },
        strict: true,
      },
    });
    expect(JSON.stringify(body.messages)).toContain("data:image/webp;base64,UklGRg==");
    // Room for the whole JSON answer: a cut-off reply would refuse a good picture.
    expect(body.max_tokens).toBeGreaterThanOrEqual(16);
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
    // Unlisted until After Dark opens to people (directories read the list), but anyone can still call it by name.
    expect(await names({})).not.toContain("request_after_dark");
    expect(await names({ adminKey: ADMIN_KEY })).toContain("request_after_dark");
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
    expect(seen?.maxTokens).toBe(1600);
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
    // Where the media is made (#698): only the two providers there are.
    expect((await run({ media_provider: "replicate" })).media_provider).toBe("replicate");
    expect((await run({ media_provider: "fal" })).media_provider).toBe("replicate");
    expect((await run({ media_provider: "venice" })).media_provider).toBe("venice");
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

  it("teases it out: a stage holds for its lines, then moves one step at a time; a direct steer can jump", async () => {
    const { cookie } = await admin();
    // A new line each time: a phrase said a fourth time loses its sentence in prompt v2.1 (lib/adult/quality.ts WORN_AT).
    let n = 0;
    const six = (stage: number) => JSON.stringify({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `Line ${n++}.` })), place: "the cafe", stage });
    const step = async (stage: number, direction?: string) => {
      scripted(six(stage));
      return (await (await post({ a: CAST_A, b: CAST_B, ...(direction ? { direction, steer_mode: "direct" } : {}) }, cookie)).json()).scene.stage as number;
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

  it("stamps each line with the stage it was written at, and the page gets it (David, 2026-10-21: the label said 'sex' at hello)", async () => {
    const { cookie } = await admin();
    const six = (stage: number) => JSON.stringify({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `Stamp ${stage}${i}.` })), place: "the cafe", stage });
    const step = async (stage: number, direction?: string) => {
      scripted(six(stage));
      return (await (await post({ a: CAST_A, b: CAST_B, ...(direction ? { direction, steer_mode: "direct" } : {}) }, cookie)).json()).scene;
    };
    await step(1);
    const scene = await step(5, "They go straight back to hers and into bed.");
    expect(scene.lines.slice(0, 6).every((l: { stage?: number }) => l.stage === 0)).toBe(true);
    // The steered batch's lines show nothing explicit, so they keep the stage until its last line, which carries the
    // scene's (the stage floor, lib/adult/stage-floor.ts, only raises a claim the words outrun).
    expect(scene.lines.slice(6, -1).every((l: { stage?: number }) => l.stage === 0)).toBe(true);
    expect(scene.lines.at(-1).stage).toBe(4);
    expect(scene.stage).toBe(4);
    // Still no private notes on the page.
    expect(scene.lines.every((l: Record<string, unknown>) => !("why" in l) && !("memory" in l))).toBe(true);
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
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie);
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
    await call(settingsPost, "/api/admin/after-dark/settings", { fal_key: "placeholder-media-WXYZ", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie);
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

  const star = (looks: Record<string, unknown>) =>
    ({ id: "star-1", name: "Star", age: 25, pronouns: "she/her", ownerId: "owner-1", look: { appearance: "Latina, long wavy blonde hair" }, extras: { looks } }) as unknown as Character;
  const picked = { gender: "woman", ethnicity: "latina", hair_style: "wavy", hair_color: "blonde", eyes: "green", body: "curvy", breasts: "large", outfit: "swim" };

  it("draws a looks-builder character from every pick, and her baseline in the outfit she picked", () => {
    const p = baselinePrompt(star(picked), "owner-1");
    expect(p).toMatch(/^Uncensored adult photograph, a 25-year-old adult woman, Latina, .*blonde.*, .*green eyes, a curvy hourglass figure with full hips, a large full bust\. Wearing a one-piece swimsuit, alone, waist-up/);
    expect(p).not.toMatch(/Nude|Star/);
    // The After Dark outfit wins over the show's, and Nude (or no outfit) is a nude baseline.
    expect(baselinePrompt(star({ ...picked, after_dark: { outfit: "bikini", butt: "large" } }), "owner-1")).toMatch(/a large full round butt\. Wearing a tiny string bikini/);
    expect(baselinePrompt(star({ ...picked, after_dark: { outfit: "nude" } }), "owner-1")).toMatch(/^Explicit, uncensored adult photograph, .*\. Nude, alone/);
    expect(baselinePrompt(star({ ...picked, outfit: undefined }), "owner-1")).toMatch(/\. Nude, alone/);
  });

  it("keeps the private After Dark picks to the owner's pictures, and the outfit until they undress", () => {
    const s = star({ ...picked, after_dark: { outfit: "lingerie", butt: "small" } });
    const other = baselinePrompt(s, "someone-else");
    expect(other).not.toMatch(/butt|lingerie/);
    expect(other).toMatch(/Wearing a one-piece swimsuit/);
    expect(scenePrompt(chud, s, "b", "by the pool", { place: "the pool", stage: 1, recent: [] }, "owner-1")).toMatch(/a small pert butt, wearing black lace lingerie\. Setting/);
    expect(scenePrompt(chud, s, "b", "in bed", { place: "his flat", stage: 4, explicit: true, recent: [] }, "owner-1")).not.toMatch(/wearing|lingerie/);
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

  it("draws a new portrait over the admin MCP tool, keeps the old one beside it, and refuses anyone outside After Dark", async () => {
    const { cookie } = await admin();
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, image_provider: "venice", venice_key: "placeholder-venice-VNCE", hive_key: "placeholder-hive" }, cookie);
    setMediaFetchForTests(async (input: RequestInfo | URL) =>
      String(input) === VENICE_IMAGE ? Response.json({ id: "x", images: [Buffer.from(PNG).toString("base64")], timing: {} }) : new Response("unexpected", { status: 500 }),
    );
    setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD));
    const key = crypto.randomUUID();
    vi.stubEnv("FRONTIER_PASSWORD", key);
    const tool = async (args: Record<string, unknown>) =>
      JSON.stringify(await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "after_dark_baseline", arguments: args } }, { adminKey: key }));
    expect(await tool({ character_id: CAST_A })).toMatch(/"kind":"baseline"/);
    expect(await tool({ character_id: CAST_A })).toMatch(/"kind":"baseline"/);
    // Both kept: the newest is the face later pictures and videos keep, the older one stays to compare.
    expect((await t.db.query(`select 1 from adult_images where character_id = $1 and kind = 'baseline' and status = 'ready'`, [CAST_A])).rows).toHaveLength(2);
    expect(await tool({ character_id: HOUSE_CHARACTERS[2].id })).toMatch(/Pick a character who is in after dark/);
  });

  it("makes them on Venice with safe mode off, checks the bytes with Hive before storing, and keeps clips to fal pictures", async () => {
    const { cookie } = await admin();
    const saved = await (
      await call(settingsPost, "/api/admin/after-dark/settings", { image_provider: "venice", venice_key: "placeholder-venice-VNCE", hive_key: "placeholder-hive", auto_scene_pictures: false }, cookie)
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
    // "rooftop pool" is the same place reworded: the set they cut to stays (lib/adult/continuity.ts).
    expect(next.scene).toMatchObject({ cut_to: null, set_place: "a rooftop pool at midnight" });
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

import { DELETE as reelDelete, GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import {
  busyMessage,
  feature,
  keyframePrompt,
  pickShots,
  placesOf,
  placeWords,
  reelCast,
  setReelFetchForTests,
  setReelPausesForTests,
  shotPrompt,
  spoken,
  voiceFor,
  withoutNames,
  type Reel,
} from "@/lib/adult/reels";
import { reelFailureNote } from "@/lib/adult/reel-failure";
import { mediaLinkValid, signedMediaUrl } from "@/lib/adult/media";
import { loadCharacter } from "@/lib/character";
import { normalizeScene } from "@/lib/venues";

describe("the video of the night", () => {
  beforeEach(() => setReelPausesForTests(false));
  afterEach(() => {
    setReelFetchForTests(null);
    setReelPausesForTests(true);
    setCheckFetchForTests(null);
  });

  const night = Array.from({ length: 12 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} says something rather vivid here.` }));
  async function ready(cookie: string, ownerId: string, lines: unknown[] = night) {
    await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", reel_shots: 3, auto_scene_pictures: false }, cookie);
    // Each one's own baseline (a reel makes one first for a character with none): the faces every keyframe keeps.
    for (const [pid, c] of [["base-a", CAST_A], ["base-b", CAST_B]]) {
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
    }
    const scene = (await (await get(CAST_A, CAST_B, cookie)).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(lines)]);
    return scene as { id: string; a: { id: string }; b: { id: string } };
  }
  /** Venice: keyframes, voices, queues, and a shot that's done on the first retrieve. Records what was asked. */
  function fakeVenice(opts: { keyframe?: () => Response } = {}) {
    const seen: { path: string; body: Record<string, unknown> }[] = [];
    let q = 0;
    setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("https://api.venice.ai/api/v1", "");
      const body = JSON.parse(String(init?.body ?? "{}"));
      seen.push({ path, body });
      if (path === "/image/multi-edit") return opts.keyframe?.() ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
      if (path === "/audio/speech") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
      if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
      if (path === "/video/retrieve") return new Response(new Uint8Array([0, 0, 0, 24]), { headers: { "content-type": "video/mp4" } });
      return new Response("?", { status: 500 });
    });
    return seen;
  }
  const make = (cookie: string, body: Record<string, unknown> = {}) => call(reelPost, "/api/admin/after-dark/reel", { a: CAST_A, b: CAST_B, ...body }, cookie);
  const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;
  const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];
  const threeShots = (shots = [{ line: 2 }, { line: 5 }, { line: 9 }]) => scripted(JSON.stringify({ shots: shots.map((s) => ({ frame: "", motion: "", ...s })) }));

  it("films the two of them together: every shot starts from a keyframe of both, made from their own two baselines (David, 2026-10-22)", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    const other = HOUSE_CHARACTERS[2].id;
    // Pictures with someone else in them, and another partner's baseline: never part of this pair's video.
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data) values ('other-pair', $1, $2, $3, 'scene', 'p', 'image/png', $4), ('other-solo', $1, $2, null, 'baseline', 'p', 'image/png', $4), ('a-scene', $1, $5, null, 'scene', 'p', 'image/png', $4)`,
      [id, other, CAST_B, Buffer.from(PNG), CAST_A],
    );
    const seen = fakeVenice();
    fakeHive();
    scripted(
      JSON.stringify({
        shots: [
          { line: 9, frame: "On the bed, Juniper on top of Rafe, both nude. Close shot.", motion: "She rolls her hips; Rafe grips her waist." },
          { line: 2, frame: "By the door, kissing, both dressed. Wide shot.", motion: "He pulls her closer." },
          { line: 5, frame: "", motion: "" },
        ],
      }),
    );
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started).toMatchObject({ status: "making", tokens: 0 });
    expect(started.shots.map((s) => s.line)).toEqual([2, 5, 9]);
    // One keyframe a shot, from the two of them only: the first picture is the scene's first character's baseline.
    const edits = seen.filter((s) => s.path === "/image/multi-edit");
    expect(edits).toHaveLength(3);
    const firstBase = scene.a.id === CAST_A ? "base-a" : "base-b";
    const secondBase = firstBase === "base-a" ? "base-b" : "base-a";
    for (const e of edits) {
      expect(e.body).toMatchObject({ modelId: "qwen-edit-uncensored", safe_mode: false });
      expect((e.body.images as string[]).map(mediaOf)).toEqual([firstBase, secondBase]);
      expect(e.body.prompt).toMatch(/^Make one photograph of the (man|woman) from Picture 1 and the (man|woman) from Picture 2 together\./);
      // Their faces and bodies from their portraits, never their portraits' clothes (Lexi's lingerie stayed on, 2026-10-22).
      expect(e.body.prompt).toContain("Keep each of them as in their own picture, the same face, hair, skin tone and body, but not their clothes:");
      // A name never reaches a picture model (it can pull a real person's face).
      expect(e.body.prompt).not.toMatch(/Rafe|Juniper|Calloway|Vale/);
      expect(String(e.body.prompt).length).toBeLessThanOrEqual(1500);
    }
    expect(edits.map((e) => String(e.body.prompt)).find((p) => p.includes("On the bed"))).toContain("the woman on top of the man");
    // A shot the director left blank gets a still from how far the night had gone, dressed before undressing.
    expect(edits.some((e) => /standing close together, facing each other, both dressed/.test(String(e.body.prompt)) && /not nude/.test(String(e.body.prompt)))).toBe(true);
    // Each keyframe passed the check and is kept, out of the gallery, as its video's start.
    const frames = (await t.db.query<{ id: string; character_id: string; character_b: string }>(`select id, character_id, character_b from adult_images where kind = 'frame'`)).rows;
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => [f.character_id, f.character_b].sort().join() === [CAST_A, CAST_B].sort().join())).toBe(true);
    const queued = seen.filter((s) => s.path === "/video/queue");
    expect(queued.map((q) => mediaOf(q.body.image_url)).sort()).toEqual(frames.map((f) => f.id).sort());
    for (const q of queued) {
      // By default Wan 3.0 says the line itself (David's pick), with both of them kept in one continuous shot.
      expect(q.body).toMatchObject({ model: "wan-3-0-image-to-video", audio: true, aspect_ratio: "adaptive" });
      expect(q.body.audio_url).toBeUndefined();
      expect(q.body.prompt).toMatch(/Two people only: the (man|woman) and the (man|woman), exactly as in the picture/);
      expect(q.body.prompt).toContain("One continuous shot, the camera steady: no cuts, nobody else comes in.");
      expect(q.body.negative_prompt).toMatch(/a third person.*scene cut/);
      expect(q.body.prompt).not.toMatch(/Rafe|Juniper/);
    }
    expect(String(queued.find((q) => String(q.body.prompt).includes("rolls her hips"))!.body.prompt)).toContain("She rolls her hips; the man grips her waist.");
    expect(String(queued.find((q) => String(q.body.prompt).includes("Line number 2"))!.body.prompt)).toMatch(/says: "Line number 2 says something rather vivid here\."$/);
    expect(seen.some((s) => s.path === "/audio/speech")).toBe(false);
    // Two shots per poll (Hive rate-limits a burst), then the last one; each video row names its keyframe.
    expect((await advance(started.id, cookie)).shots.filter((s) => s.status === "ready")).toHaveLength(2);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots.every((s) => s.status === "ready" && s.media_id)).toBe(true);
    const videos = (await t.db.query<{ source_image: string }>(`select source_image from adult_images where kind = 'video'`)).rows;
    expect(videos.map((v) => v.source_image).sort()).toEqual(frames.map((f) => f.id).sort());
    const gallery = (await (await get(CAST_A, CAST_B, cookie)).json()).gallery as { id: string; kind: string }[];
    expect(gallery.some((g) => g.kind === "frame")).toBe(false);
  });

  it("sets each shot where its line was said: the night's drawn set as a third picture, and no names in the place", async () => {
    const { id, cookie } = await admin();
    const lines = night.map((l, i) => ({ ...l, stage: i < 5 ? 2 : 4, ...(i === 4 ? { moved_to: "Juniper's bedroom" } : {}) }));
    const scene = await ready(cookie, id, lines);
    await t.db.query(`update adult_scenes set place = $2, set_place = $2, place_history = $3::jsonb, stage = 4 where id = $1`, [
      scene.id,
      "Juniper's bedroom",
      JSON.stringify([
        { place: "outside the bar", set: "street", home: null, chapter: 1 },
        { place: "Juniper's bedroom", set: "Juniper's bedroom", home: null, chapter: 1 },
      ]),
    ]);
    await t.db.query(`insert into place_sets (normalized, label, status, mime, data) values ($1, $2, 'ready', 'image/jpeg', $3)`, [normalizeScene("Juniper's bedroom"), "Juniper's bedroom", Buffer.from([0xff, 0xd8, 0xff])]);
    const seen = fakeVenice();
    fakeHive();
    threeShots([{ line: 2 }, { line: 6 }, { line: 9 }]);
    expect((await make(cookie)).status).toBe(200);
    const edits = seen.filter((s) => s.path === "/image/multi-edit").map((e) => ({ images: e.body.images as string[], prompt: String(e.body.prompt) }));
    // Line 2 was on the street (before line 4 agreed to go): no set drawn there, the two baselines only.
    const street = edits.find((e) => e.prompt.includes("The place: street."))!;
    expect(street.images).toHaveLength(2);
    expect(street.prompt).toContain("but not their clothes: they're dressed as the moment says, not nude: both fully clothed, shirts and tops on and done up.");
    expect(street.prompt).not.toContain("Explicit");
    // Lines 6 and 9 were in her bedroom: its set is the third picture, and the place has no name in it.
    const bedroom = edits.filter((e) => e.prompt.includes("The place: her bedroom."));
    expect(bedroom).toHaveLength(2);
    for (const e of bedroom) {
      expect(e.images[2]).toMatch(/^data:image\/jpeg;base64,/);
      expect(e.prompt).toContain("together, in the place from Picture 3.");
      expect(e.prompt).toContain("Keep the place, its furniture and its light from Picture 3.");
      expect(e.prompt).toContain("but not their clothes: both are nude unless the moment says otherwise.");
      expect(e.prompt).toContain("Explicit, uncensored, photorealistic.");
    }
  });

  it("throws away a keyframe the check refuses: never stored, logged, and no video made from it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    let ages = 0;
    setCheckFetchForTests(async (input: RequestInfo | URL) =>
      Response.json(String(input) === HIVE_VLM ? (ages++ === 0 ? { choices: [{ message: { content: "MINOR" } }] } : ADULTS) : CLEAN_MOD),
    );
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.shots.map((s) => s.status)).toEqual(["discarded", "queued", "queued"]);
    expect(started.shots[0].reason).toMatch(/age check: MINOR/);
    expect(started.shots[0].media_id).toBeUndefined();
    expect((await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows).toHaveLength(2);
    expect(seen.filter((s) => s.path === "/video/queue")).toHaveLength(2);
    const logged = (await t.db.query<{ reason: string }>(`select reason from adult_rejections where kind = 'reel'`)).rows;
    expect(logged.map((r) => r.reason)).toEqual([expect.stringMatching(/^keyframe: age check: MINOR/)]);
  });

  it("asks Hive once more when it couldn't check a keyframe, then drops that shot", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    let calls = 0;
    // The first keyframe: Hive down through both of its checks, each asked HIVE_RETRIES more times (lib/adult/check.ts):
    // 2 × (1 + HIVE_RETRIES) failed answers. The others: fine. (A 429 that outlasts the retries is Hive's daily limit
    // instead, and pauses everything: tests/hive-limit.test.ts.)
    const busy = 2 * (1 + HIVE_RETRIES);
    setCheckFetchForTests(async (input: RequestInfo | URL) => (calls++ < busy ? new Response("down", { status: 503 }) : Response.json(String(input) === HIVE_VLM ? ADULTS : CLEAN_MOD)));
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.shots.map((s) => s.status)).toEqual(["failed", "queued", "queued"]);
    expect(started.shots[0].reason).toMatch(/the check couldn't run/);
    expect((await t.db.query(`select 1 from adult_rejections`)).rows).toHaveLength(0);
  });

  it("says why when Venice can't draw the keyframes, and gives the tokens back", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice({ keyframe: () => new Response(JSON.stringify({ error: "Insufficient USD or Diem balance to complete request." }), { status: 402 }) });
    fakeHive();
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.status).toBe("failed");
    expect(started.shots.every((s) => s.status === "failed" && /^Venice 402/.test(s.reason ?? ""))).toBe(true);
    expect(reelFailureNote(started.shots)).toMatch(/out of credits/);
    expect(seen.some((s) => s.path === "/video/queue")).toBe(false);
  });

  it("lip-syncs our stock voice when the model takes audio in, and says which of them is speaking", async () => {
    const { id, cookie } = await admin();
    const scene = await ready(cookie, id);
    await call(settingsPost, "/api/admin/after-dark/settings", { reel_model: "wan-2.6-image-to-video" }, cookie);
    const seen = fakeVenice();
    fakeHive();
    threeShots();
    await make(cookie);
    const queued = seen.filter((s) => s.path === "/video/queue");
    expect(queued).toHaveLength(3);
    expect(queued[0].body).toMatchObject({ model: "wan-2.6-image-to-video", audio_url: expect.stringMatching(/^data:audio\/mpeg;base64,/) });
    expect(queued[0].body.audio).toBeUndefined();
    expect(queued[0].body.prompt).toMatch(/The (man|woman) is the one speaking, lips moving with the words\.$/);
    const speech = seen.filter((s) => s.path === "/audio/speech");
    expect(speech[0].body.input).toBe("Line number 2 says something rather vivid here.");
    // Line 2 is the scene's first character's: their voice, the same every time.
    expect(speech[0].body.voice).toBe(voiceFor((await loadCharacter(t.db, scene.a.id))!));
  });

  it("costs a subscriber the reel's price, gives back the share of discarded shots, and waits when Hive is busy", async () => {
    const { id: adminId, cookie: adminCookie } = await admin();
    await ready(adminCookie, adminId);
    await call(settingsPost, "/api/admin/after-dark/settings", { reel_tokens: 15 }, adminCookie);
    const sub = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [sub]);
    const cookie = signedIn(sub);
    const scene = (await (await get(CAST_A, CAST_B, cookie)).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(night)]);
    fakeVenice();
    fakeHive();
    scripted("not json");
    expect((await make(cookie)).status).toBe(402);
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 20, 'test')`, [crypto.randomUUID(), sub]);
    const used = async () => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [sub])).rows[0]?.used ?? 0;
    const started = (await (await make(cookie)).json()).reel as Reel;
    expect(started.tokens).toBe(15);
    expect(await used()).toBe(15);
    expect((await make(cookie)).status).toBe(409);
    // Hive busy (down for a while): nothing discarded, and that shot waits before it's sent again (nothing more goes to
    // Hive this poll). Its daily limit (a 429 that outlasts the retries) pauses every shot instead: tests/hive-limit.test.ts.
    let hiveCalls = 0;
    setCheckFetchForTests(async () => {
      hiveCalls++;
      return new Response("busy", { status: 503 });
    });
    const waiting = await advance(started.id, cookie);
    expect(waiting.shots.every((s) => s.status === "queued")).toBe(true);
    expect(waiting.shots.filter((s) => s.retry_at)).toHaveLength(1);
    // Each poll tries the next shot; once all three are waiting, a poll sends nothing to Hive at all.
    expect((await advance(started.id, cookie)).shots.filter((s) => s.retry_at)).toHaveLength(2);
    expect((await advance(started.id, cookie)).shots.filter((s) => s.retry_at)).toHaveLength(3);
    const calls = hiveCalls;
    await advance(started.id, cookie);
    expect(hiveCalls).toBe(calls);
    // The wait is over.
    await t.db.query(`update adult_reels set shots = (select jsonb_agg(x - 'retry_at') from jsonb_array_elements(shots) x) where id = $1`, [started.id]);
    // Then one shot shows a child signal: discarded, never stored; the other two come through.
    let n = 0;
    setCheckFetchForTests(async () => Response.json(n++ === 0 ? { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] } : CLEAN_MOD));
    await advance(started.id, cookie);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots.map((s) => s.status)).toEqual(["discarded", "ready", "ready"]);
    expect(await used()).toBe(10);
  });

  it("gives up on shots still unchecked after hours, so a stuck video stops blocking new ones", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    setCheckFetchForTests(async () => new Response("busy", { status: 503 }));
    await advance(started.id, cookie);
    expect((await make(cookie)).status).toBe(409);
    await t.db.query(`update adult_reels set created_at = now() - interval '4 hours' where id = $1`, [started.id]);
    const settled = await advance(started.id, cookie);
    expect(settled.status).toBe("failed");
    expect(settled.shots.every((s) => s.status === "failed")).toBe(true);
    fakeHive();
    threeShots();
    expect((await make(cookie)).status).toBe(200);
  });

  it("fails a shot whose start was cut off before its video was queued, so the reel settles", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    const shots = [
      { line: 2, who: "a", text: "x", motion: "", status: "queued" },
      { line: 5, who: "b", text: "y", motion: "", status: "queued", queue_id: "q9", model: "wan-3-0-image-to-video", media_id: "f1" },
    ];
    await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, created_at) values ('r-cut', $1, $2, $3, 'making', 0, $4::jsonb, now() - interval '5 minutes')`, [
      id,
      ...[CAST_A, CAST_B].sort(),
      JSON.stringify(shots),
    ]);
    fakeHive();
    // Still within its start's time: left alone.
    expect((await advance("r-cut", cookie)).shots[0].status).toBe("queued");
    await t.db.query(`update adult_reels set created_at = now() - interval '11 minutes' where id = 'r-cut'`);
    const settled = await advance("r-cut", cookie);
    expect(settled.shots.map((s) => [s.status, s.reason ?? null])).toEqual([
      ["failed", "never started"],
      ["ready", null],
    ]);
    expect(settled.status).toBe("ready");
  });

  it("says which video is in the way and how far along it is, calls it stuck after 30 minutes, and lets the owner stop it (David, 2026-10-21)", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    threeShots();
    const started = (await (await make(cookie)).json()).reel as Reel;
    const refused = await make(cookie);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.busy).toMatchObject({ id: started.id, done: 0, shots: 3, stalled: false });
    expect([body.busy.a, body.busy.b].sort()).toEqual([CAST_A, CAST_B].sort());
    expect(body.message).toMatch(/is still being made \(0 of 3 shots, started just now\)\. One video at a time/);
    await t.db.query(`update adult_reels set created_at = now() - interval '40 minutes' where id = $1`, [started.id]);
    const stuck = await (await make(cookie)).json();
    expect(stuck.busy.stalled).toBe(true);
    expect(stuck.message).toMatch(/started 40 min ago\)\. That's much longer than usual, so it looks stuck: stop it/);
    // Only the owner can stop it; then the slot is free.
    const del = (rid: string, c: string) => reelDelete(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${rid}`, { method: "DELETE", headers: { cookie: c } }));
    const other = await admin();
    expect((await del(started.id, other.cookie)).status).toBe(404);
    const stopped = (await (await del(started.id, cookie)).json()).reel as Reel;
    expect(stopped.status).toBe("failed");
    expect(stopped.shots.every((s) => s.status === "failed" && s.reason === "stopped")).toBe(true);
    threeShots();
    expect((await make(cookie)).status).toBe(200);
  });

  it("films a saved night only for its own pair", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const [a, b] = [CAST_A, CAST_B].sort();
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage) values ('n1', $1, $2, $3, $4::jsonb, 'the kitchen', 4)`, [id, a, b, JSON.stringify(night)]);
    const seen = fakeVenice();
    fakeHive();
    threeShots();
    expect((await make(cookie, { night_id: "n1" })).status).toBe(200);
    expect(String(seen.find((s) => s.path === "/image/multi-edit")!.body.prompt)).toContain("The place: the kitchen.");
    // Another pair's night, asked for as this pair's: not found (its lines' "a" and "b" are other people).
    const [x, y] = [CAST_A, HOUSE_CHARACTERS[2].id].sort();
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, stage) values ('n2', $1, $2, $3, $4::jsonb, 4)`, [id, x, y, JSON.stringify(night)]);
    expect((await make(cookie, { night_id: "n2" })).status).toBe(404);
  });

  it("words the refusal by age", () => {
    const r = { id: "r", a: "x", b: "y", names: ["Ada", "Bo"] as [string, string], done: 2, shots: 6, minutes: 150, stalled: true };
    expect(busyMessage(r)).toBe("A video of Ada and Bo is still being made (2 of 6 shots, started 3 hours ago). That's much longer than usual, so it looks stuck: stop it to get its tokens back, then make a new one.");
    expect(busyMessage({ ...r, minutes: 4, stalled: false })).toMatch(/started 4 min ago\)\. One video at a time, and they usually take a few minutes\.$/);
  });

  it("asks the director for both of them in every frame, and falls back to a still and the line's own action", async () => {
    const [ca, cb] = await Promise.all([loadCharacter(t.db, CAST_A), loadCharacter(t.db, CAST_B)]);
    const cast = reelCast(ca!, cb!);
    let asked = "";
    setAdultModelForTests({ complete: async (msgs) => ((asked = msgs.map((m) => m.content).join("\n")), "not json") });
    const picks = await pickShots(t.db, night, 4, cast, night.map(() => "the kitchen"), night.map(() => 2));
    expect(asked).toContain("Every shot shows the two of them together in one frame, doing what the script has them doing at that line");
    expect(asked).toContain("named only like this, never by name");
    // Lying down from a wide angle came out tangled, a face hidden (the first live reel): from the side, faces to camera.
    expect(asked).toContain("lying down, a medium shot from the side with both faces toward the camera, never from above");
    expect(asked).toContain(`0 | ${cast[0].tag} | the kitchen | kissing | (leans closer) Line number 0`);
    expect(asked).not.toMatch(/Rafe|Juniper/);
    expect(picks).toHaveLength(4);
    expect(picks[0].line).toBe(0);
    expect(picks[picks.length - 1].line).toBe(11);
    expect(picks[0].frame).toBe(`${cast[0].tag[0].toUpperCase()}${cast[0].tag.slice(1)} and ${cast[1].tag}, kissing, their arms around each other, both dressed. Medium shot, both faces visible.`);
    expect(picks[0].motion).toBe(`${cast[0].tag[0].toUpperCase()}${cast[0].tag.slice(1)} leans closer, and the other answers it.`);
    expect(spoken("*whispers* " + "word ".repeat(40)).speech.split(" ")).toHaveLength(24);
  });

  it("names them by how they look, never by name: by their hair when both are women or both men", async () => {
    const [rafe, juniper, marisol, dex] = await Promise.all(["house-rafe", "house-juniper", "house-marisol", "house-dex"].map((x) => loadCharacter(t.db, x)));
    expect(reelCast(rafe!, juniper!).map((p) => p.tag)).toEqual(["the man", "the woman"]);
    expect(reelCast(juniper!, marisol!).map((p) => p.tag)).toEqual(["the woman with long auburn hair", "the woman with a sleek black bob"]);
    expect(feature("in his early forties with dark brown skin, close-cropped hair greying at the temples")).toBe("close-cropped hair");
    expect(feature("Caucasian, a short chin-length golden blonde bob, bright clear blue eyes")).toBe("a short chin-length golden blonde bob");
    expect(feature("heavyset in his early forties with dark brown skin")).toBe("dark brown skin");
    const pair = reelCast(dex!, juniper!);
    expect(pair[0].names).toEqual(["Dex", "Okafor"]);
    expect(withoutNames("Dex's hands on Juniper's hips, Okafor grinning", pair)).toBe("the man's hands on the woman's hips, the man grinning");
    expect(placeWords("Junipers bedroom", pair)).toBe("her bedroom");
    expect(placeWords("Dex's studio", pair)).toBe("his studio");
    // Capitalised only: a name that's also a word stays a word.
    expect(placeWords("the rose garden", [{ ...pair[1], names: ["Rose"] }])).toBe("the rose garden");
    // The same words for both (twins): first and second.
    const twin = (id: string) => ({ ...marisol!, id, look: { ...marisol!.look, appearance: "a sleek black bob", physical: null } });
    expect(reelCast(twin("t1"), twin("t2")).map((p) => p.tag)).toEqual(["the first woman", "the second woman"]);
  });

  it("knows where each line was said, from where the night began and the lines that agreed to go", () => {
    const lines = [{ who: "a" as const, text: "a" }, { who: "b" as const, text: "b", moved_to: "his studio" }, { who: "a" as const, text: "c" }];
    const history = [
      { place: "the bar", set: "bar", home: null, chapter: 1 },
      { place: "his studio", set: "his studio", home: null, chapter: 1 },
    ];
    expect(placesOf(lines, { place: "his studio", set: "his studio", history, date: null, stage: 0 })).toEqual(["bar", "bar", "his studio"]);
    // No moves tonight: where they are now.
    expect(placesOf([lines[0], lines[2]], { place: "the roof", set: null, history, date: null, stage: 0 })).toEqual(["the roof", "the roof"]);
  });

  it("keeps a keyframe's prompt within the edit model's limit, and the shot's prompt saying who speaks", async () => {
    const [ca, cb] = await Promise.all([loadCharacter(t.db, CAST_A), loadCharacter(t.db, CAST_B)]);
    const cast = reelCast(ca!, cb!);
    const long = keyframePrompt(cast, "word ".repeat(600), "the kitchen", 4, true);
    expect(long.length).toBeLessThanOrEqual(1500);
    expect(long).toMatch(/The place: the kitchen\. Keep each of them as in their own picture.*Both are adults\.$/);
    // Undressing: half undressed and explicit; before it, dressed and not.
    expect(keyframePrompt(cast, "x", null, 3, false)).toMatch(/they're half undressed, as the moment says\..*Explicit, uncensored, photorealistic\./);
    expect(keyframePrompt(cast, "x", null, 1, false)).toMatch(/they're dressed as the moment says, not nude: both fully clothed, shirts and tops on and done up\..*Photorealistic\. Both are adults\.$/);
    const s = { who: "b" as const, text: "Come here.", motion: "They kiss." };
    expect(shotPrompt(cast, s, false)).toMatch(new RegExp(`^They kiss\\. Two people only: .* ${cast[1].tag[0].toUpperCase()}${cast[1].tag.slice(1)}, in a [a-z ,']+voice, says: "Come here\\."$`));
    expect(shotPrompt(cast, s, true)).toMatch(/is the one speaking, lips moving with the words\.$/);
  });

  it("lets a provider fetch a picture for minutes by a signed link, never a clip, never after it expires", async () => {
    const url = signedMediaUrl("pic-1", "https://botchelor.com", 1_000);
    const q = new URL(url).searchParams;
    expect(mediaLinkValid("pic-1", q.get("until"), q.get("sig"), 2_000)).toBe(true);
    expect(mediaLinkValid("pic-2", q.get("until"), q.get("sig"), 2_000)).toBe(false);
    expect(mediaLinkValid("pic-1", q.get("until"), q.get("sig"), 1_000 + 31 * 60 * 1000)).toBe(false);
    const { id } = await admin();
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, data) values ('pic-1', $1, 'scene', 'p', 'image/png', $2), ('vid-1', $1, 'video', 'p', 'video/mp4', $2)`, [id, Buffer.from(PNG)]);
    const fetchAs = async (mid: string) => {
      const u = new URL(signedMediaUrl(mid, BASE_URL));
      return (await mediaGet(new Request(u.toString()), { params: Promise.resolve({ id: mid }) })).status;
    };
    expect(await fetchAs("pic-1")).toBe(200);
    expect(await fetchAs("vid-1")).toBe(404);
  });
});

import { CHAPTER_LINES } from "@/lib/adult/scenes";

describe("chapters: a long night runs on, and remembers how it began", () => {
  it("files a full chapter as a saved night, recaps it, carries the last lines over, and the next prompt holds the recap", async () => {
    const { cookie } = await admin();
    const scene = (await (await get(CAST_A, CAST_B, cookie)).json()).scene;
    const full = Array.from({ length: CHAPTER_LINES - 6 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Line ${i}.` }));
    await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, stage_from = 100 where id = $1`, [scene.id, JSON.stringify(full)]);
    let prompts: string[] = [];
    let beat = 0;
    setAdultModelForTests({
      complete: async (msgs: { content: string }[]) => {
        prompts.push(msgs.map((m) => m.content).join("\n"));
        if (/running recap/.test(msgs[0].content)) return JSON.stringify({ recap: "They met at the bar, went back to hers, and he keeps calling her 'trouble'." });
        // A new line each call: a phrase said a fourth time tonight loses its sentence in prompt v2.1.
        return JSON.stringify({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `Beat${beat++}.` })) });
      },
    } as never);
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.scene).toMatchObject({ chapter: 2, lines: [], recap: expect.stringContaining("trouble") });
    expect(r.scene.prev_tail).toHaveLength(12);
    expect(r.scene.stage_from).toBe(100 - CHAPTER_LINES);
    const nights = (await t.db.query<{ chapter: number; n: number; recap: string }>(`select chapter, jsonb_array_length(lines) as n, recap from adult_nights`)).rows;
    expect(nights).toEqual([{ chapter: 1, n: CHAPTER_LINES, recap: expect.stringContaining("trouble") }]);
    prompts = [];
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(prompts[0]).toMatch(/Earlier tonight[^\n]*\nThey met at the bar/);
    expect(prompts[0]).toContain("Beat5.");
    expect(prompts[0]).not.toMatch(/The scene opens exactly where the date ended/);
    // Start over files chapter 2 and begins a new night at chapter 1 with no recap.
    const reset = await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json();
    expect(reset.scene).toMatchObject({ chapter: 1, recap: null, prev_tail: [] });
    expect(reset.nights.map((n: { chapter: number }) => n.chapter)).toEqual([2, 1]);
  });
});

import { afterDarkNote, FALLBACK_NOTE } from "@/lib/adult/memory";
import { assembleDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { remembered } from "@/lib/memory";

describe("what After Dark leaves behind (PG only)", () => {
  const night = Array.from({ length: 10 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Line ${i}.` }));
  it("files a night and keeps one show-safe note per character; an explicit note is replaced with the plain fallback", async () => {
    const { cookie } = await admin();
    const scene = (await (await get(CAST_A, CAST_B, cookie)).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(night)]);
    scripted(JSON.stringify({ a: "You and Bo ended up back at his place after the bowling; you're closer now, and you still can't stop grinning about the shoe rental.", b: "You and Ada had sex all night." }));
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    const [aId, bId] = [scene.a.id, scene.b.id];
    expect(await afterDarkNote(t.db, aId, bId)).toMatch(/closer now/);
    const bNote = await afterDarkNote(t.db, bId, aId);
    expect(bNote).toBe(FALLBACK_NOTE(scene.a.name.split(" ")[0]));
    expect(bNote).not.toMatch(/sex/);
  });

  it("goes into the pair's memory for their next date, and marks the date for 🌙", () => {
    const sheet = (name: string) => ({ name, age: 33, bio: "A bio.", traits: ["warm", "bold", "dry"], want: "someone kind", dealbreaker: "liars", house: false });
    const built = assembleDate({
      episodeId: "e-ad",
      a: { id: "ca", sheet: sheet("Ada Lumen") },
      b: { id: "cb", sheet: sheet("Bo Quill") },
      req: DEFAULT_DATE_REQUEST,
      seed: 3,
      soulA: null,
      soulB: null,
      memoryA: null,
      memoryB: null,
      history: undefined,
      afterDark: { a: "You and Bo spent the night at his place; you're closer now.", b: null },
    } as never);
    expect(built.setup.after_dark).toBe(true);
    const [ca, cb] = built.characters as unknown as [{ pair?: Record<string, unknown> }, { pair?: Record<string, unknown> }];
    expect(remembered(ca as never, "cb")).toMatchObject({ what_happened_after_your_last_date: expect.stringMatching(/closer now/) });
    expect(cb.pair?.what_happened_after_your_last_date).toBeUndefined();
  });
});

describe("the steer: a nudge by default, direct on request", () => {
  it("a nudge is worked toward at the scene's own pace; direct does it now and can skip ahead", async () => {
    const { cookie } = await admin();
    let prompt = "";
    setAdultModelForTests({
      complete: async (msgs: { content: string }[]) => {
        prompt = msgs[1].content;
        return JSON.stringify({ lines: [{ who: "a", text: "Hi." }], stage: 5 });
      },
    } as never);
    const nudged = await (await post({ a: CAST_A, b: CAST_B, direction: "they go back to hers" }, cookie)).json();
    expect(prompt).toMatch(/Lean the scene gently this way, at its own pace/);
    expect(nudged.scene.stage).toBe(0);
    const direct = await (await post({ a: CAST_A, b: CAST_B, direction: "they go straight to bed", steer_mode: "direct" }, cookie)).json();
    expect(prompt).toMatch(/Steer the scene this way, now: they go straight to bed\. Act it out in their own words/);
    expect(direct.scene.stage).toBe(4);
  });
});
