import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { GET as reelGet } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { CREDIT_COOLDOWN_MS, limitOf, MAX_COOLDOWN_MS, ProviderError, RATE_COOLDOWN_MS, setFallbackClockForTests } from "@/lib/adult/fallback";
import { baselinePrompt, listMedia, makePicture, setMediaFetchForTests } from "@/lib/adult/media";
import { runAdultTool } from "@/lib/adult/mcp";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import { ReplicateError, setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { getAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Falling back to the other media provider (lib/adult/fallback.ts, David 2026-10-22): both providers stubbed, no live calls.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const NOW = Date.parse("2026-10-23T12:00:00.000Z");
let now = NOW;
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  now = NOW;
  setFallbackClockForTests(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReplicateFetchForTests(null);
  setReelFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setFallbackClockForTests(null);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const settings = (body: Record<string, unknown>, cookie: string) => call(settingsPost, "/api/admin/after-dark/settings", body, cookie);
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
/** Both providers set up (Venice the configured one unless said), explicit pictures on, and the output check. */
async function bothSetUp(cookie: string, extra: Record<string, unknown> = {}) {
  await settings({ enabled: true, image_provider: "venice", venice_key: "placeholder-venice", replicate_key: "placeholder-replicate-RPLC", hive_key: "placeholder-hive", ...extra }, cookie);
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const vlmSays = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });
/** Hive: everything passes unless `refuse` answers; records each check and whether it got the bytes. */
function fakeHive(refuse: (vlm: boolean) => unknown = () => null) {
  const checks: { kind: "moderation" | "vlm"; base64: boolean }[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const vlm = String(input) === HIVE_VLM;
    const body = String(init?.body ?? "");
    checks.push({ kind: vlm ? "vlm" : "moderation", base64: body.includes("media_base64") || body.includes("data:") });
    const custom = refuse(vlm);
    if (custom) return Response.json(custom);
    return Response.json(vlm ? vlmSays('{"answer": "ADULTS"}') : CLEAN_MOD);
  });
  return checks;
}
/** Venice's picture endpoint (lib/adult/media.ts): `answer` decides each call; records them. */
function fakeVenicePictures(answer: () => Response) {
  const calls: string[] = [];
  setMediaFetchForTests(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return answer();
  });
  return calls;
}
const venicePng = () => Response.json({ images: [Buffer.from(PNG).toString("base64")] });
/** Replicate: pictures and keyframes finish at once, a video is done on its first poll; `create` can refuse a model. */
function fakeReplicate(opts: { create?: (model: string) => Response | null; poll?: (id: string) => Response | null } = {}) {
  const creates: string[] = [];
  const polls: string[] = [];
  let n = 0;
  setReplicateFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://replicate.delivery/")) return new Response(url.endsWith(".mp4") ? MP4 : PNG, { headers: { "content-type": url.endsWith(".mp4") ? "video/mp4" : "image/png" } });
    const official = url.match(/^https:\/\/api\.replicate\.com\/v1\/models\/([^/]+)\/([^/]+)\/predictions$/);
    if (init?.method === "POST" && (official || url.endsWith("/v1/predictions"))) {
      const body = JSON.parse(String(init.body ?? "{}")) as { version?: string };
      const model = official ? `${official[1]}/${official[2]}` : String(body.version);
      creates.push(model);
      const refused = opts.create?.(model);
      if (refused) return refused;
      const id = `p${++n}`;
      if (model.startsWith("wan-video/")) return Response.json({ id, status: "starting" }, { status: 201 });
      return Response.json({ id, status: "succeeded", output: [`https://replicate.delivery/xe/${id}/out-0.png`] }, { status: 201 });
    }
    const got = url.match(/\/v1\/predictions\/([^/]+)$/);
    if (got) {
      polls.push(got[1]);
      return opts.poll?.(got[1]) ?? Response.json({ id: got[1], status: "succeeded", output: `https://replicate.delivery/xe/${got[1]}/output.mp4` });
    }
    return new Response("unexpected", { status: 500 });
  });
  return { creates, polls };
}
/** Venice's reel endpoints (lib/adult/reels.ts): keyframes, queues, retrieves, speech. */
function fakeVeniceReels(opts: { keyframe?: () => Response; queue?: () => Response } = {}) {
  const seen: string[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    seen.push(path);
    if (path === "/image/multi-edit") return opts.keyframe?.() ?? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/audio/speech") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    if (path === "/video/queue") return opts.queue?.() ?? Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const cooldowns = async () =>
  (await t.db.query<{ provider: string; until: Date | string; status: number }>(`select provider, until, status from adult_media_cooldowns order by provider`)).rows.map((r) => ({
    provider: r.provider,
    ms: new Date(r.until).getTime() - NOW,
    status: r.status,
  }));
const juniper = async () => (await loadCharacter(t.db, JUNIPER))!;
const baseline = async (owner: string) => makePicture(t.db, owner, { prompt: baselinePrompt(await juniper(), owner), kind: "baseline", character_id: JUNIPER });

describe("what counts as a provider being limited", () => {
  it("is a 429, a 402, a 5xx or no answer at all, never a refusal or a bad request", () => {
    expect(limitOf(new ProviderError("Venice 429", 429, 5000))).toEqual({ kind: "rate", status: 429, retryAfterMs: 5000 });
    expect(limitOf(new ReplicateError("Replicate 402: Insufficient credit", 402))).toMatchObject({ kind: "credit", status: 402 });
    expect(limitOf(new ProviderError("Venice 503", 503))).toMatchObject({ kind: "down" });
    expect(limitOf(new ReplicateError("Replicate took longer than 90 s", undefined, null, true))).toMatchObject({ kind: "down" });
    expect(limitOf(new TypeError("fetch failed"))).toMatchObject({ kind: "down" });
    expect(limitOf(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }))).toMatchObject({ kind: "down" });
    for (const s of [400, 401, 403, 404, 422]) expect(limitOf(new ProviderError(`Venice ${s}`, s))).toBeNull();
    expect(limitOf(new Error("Venice flagged the picture as against its terms."))).toBeNull();
    expect(limitOf(new ReplicateError("Replicate: CUDA out of memory"))).toBeNull();
  });
});

describe("a picture when the configured provider is limited", () => {
  it("is made on the other after a 429, recorded as the fallback, still checked by Hive, and the step says so", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie, { openrouter_key: "placeholder-text-ABCD" });
    const venice = fakeVenicePictures(() => new Response("Too many requests", { status: 429 }));
    const replicate = fakeReplicate();
    const checks = fakeHive();
    setAdultModelForTests({ complete: async () => JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: true, picture: null }) });
    const r = await (await call(POST, "/api/admin/after-dark", { a: RAFE, b: JUNIPER }, cookie)).json();
    expect(r.pictures).toHaveLength(2);
    expect(r.pictures.every((p: { provider: string; fell_back: boolean; note: string }) => p.provider === "replicate" && p.fell_back && p.note === "made on Replicate (fallback)")).toBe(true);
    // The first went to Venice (429), the second straight to Replicate: Venice is cooling down.
    expect(venice).toHaveLength(1);
    expect(replicate.creates.filter((m) => m === "qwen/qwen-image")).toHaveLength(2);
    // Whoever made it, the bytes went to Hive before they were kept.
    expect(checks.filter((c) => c.kind === "moderation" && c.base64)).toHaveLength(2);
    expect(checks.filter((c) => c.kind === "vlm")).toHaveLength(2);
    const rows = (await t.db.query<{ provider: string; fell_back: boolean }>(`select provider, fell_back from adult_images where kind = 'baseline'`)).rows;
    expect(rows).toEqual([
      { provider: "replicate", fell_back: true },
      { provider: "replicate", fell_back: true },
    ]);
    const step = (await t.db.query<{ flags: { media_fallback?: { provider: string }[] } }>(`select flags from adult_steps where kind = 'write'`)).rows[0];
    expect(step.flags.media_fallback?.map((m) => m.provider)).toEqual(["replicate", "replicate"]);
    // The gallery carries the note; the usage counts them as any picture.
    const gallery = await listMedia(t.db, [RAFE, JUNIPER]);
    expect(gallery.map((m) => m.note)).toEqual(["made on Replicate (fallback)", "made on Replicate (fallback)"]);
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [id])).rows[0].pictures).toBe(2);
    expect(await cooldowns()).toEqual([{ provider: "venice", ms: RATE_COOLDOWN_MS, status: 429 }]);
  });

  it("honours Retry-After (capped at 15 minutes), skips the cooling one on the next call, and tries it again once it's over", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie);
    fakeHive();
    let veniceAnswer = () => new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    const venice = fakeVenicePictures(() => veniceAnswer());
    const replicate = fakeReplicate();
    expect((await baseline(id)).provider).toBe("replicate");
    expect(await cooldowns()).toEqual([{ provider: "venice", ms: 120_000, status: 429 }]);
    // Within the two minutes: straight to Replicate, Venice isn't asked.
    now = NOW + 60_000;
    expect(await baseline(id)).toMatchObject({ provider: "replicate", fell_back: true });
    expect(venice).toHaveLength(1);
    expect(replicate.creates).toHaveLength(2);
    // Past it: Venice is the one asked again, and makes it.
    now = NOW + 121_000;
    veniceAnswer = venicePng;
    expect(await baseline(id)).toMatchObject({ provider: "venice", fell_back: false, note: null });
    expect(venice).toHaveLength(2);
    expect(replicate.creates).toHaveLength(2);
    // A Retry-After of an hour is held to 15 minutes.
    await t.db.query(`delete from adult_media_cooldowns`);
    now = NOW;
    veniceAnswer = () => new Response("slow down", { status: 429, headers: { "retry-after": "3600" } });
    await baseline(id);
    expect((await cooldowns())[0].ms).toBe(MAX_COOLDOWN_MS);
  });

  it("goes to the other on a 402 and keeps away from the one out of credit for 30 minutes", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie, { media_provider: "replicate" });
    fakeHive();
    const venice = fakeVenicePictures(venicePng);
    const replicate = fakeReplicate({ create: () => Response.json({ title: "Insufficient credit", detail: "You have insufficient credit to run this model." }, { status: 402 }) });
    expect(await baseline(id)).toMatchObject({ provider: "venice", fell_back: true, note: "made on Venice (fallback)" });
    expect(replicate.creates).toEqual(["qwen/qwen-image"]);
    expect(venice).toHaveLength(1);
    expect(await cooldowns()).toEqual([{ provider: "replicate", ms: CREDIT_COOLDOWN_MS, status: 402 }]);
    now = NOW + 29 * 60_000;
    await baseline(id);
    expect(replicate.creates).toHaveLength(1);
  });

  it("doesn't switch on a content refusal or a bad request", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie);
    fakeHive();
    const replicate = fakeReplicate();
    fakeVenicePictures(() => new Response("content policy", { status: 400 }));
    await expect(baseline(id)).rejects.toThrow(/Venice refused the picture \(400\)/);
    fakeVenicePictures(() => Response.json({ images: [] }, { headers: { "x-venice-is-content-violation": "true" } }));
    await expect(baseline(id)).rejects.toThrow(/against its terms/);
    expect(replicate.creates).toEqual([]);
    expect(await cooldowns()).toEqual([]);
  });

  it("doesn't switch when the other has no key, or when the fallback is turned off", async () => {
    const { id, cookie } = await admin();
    await settings({ enabled: true, image_provider: "venice", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
    fakeHive();
    const replicate = fakeReplicate();
    fakeVenicePictures(() => new Response("Too many requests", { status: 429 }));
    await expect(baseline(id)).rejects.toThrow(/Venice refused the picture \(429\)/);
    expect(replicate.creates).toEqual([]);

    // With Replicate's key, but the switch off (on the settings page, or over MCP): no fallback, and no cooldown either.
    await t.db.query(`delete from adult_media_cooldowns`);
    await settings({ replicate_key: "placeholder-replicate-RPLC" }, cookie);
    expect((await runAdultTool(t.db, "after_dark_settings", { media_fallback: false })) as { data: { settings: { media_fallback: boolean } } }).toMatchObject({ data: { settings: { media_fallback: false } } });
    expect((await getAdultSettings(t.db)).media_fallback).toBe(false);
    await expect(baseline(id)).rejects.toThrow(/Venice refused the picture \(429\)/);
    expect(replicate.creates).toEqual([]);
    expect(await cooldowns()).toEqual([]);
    expect((await (await settings({ media_fallback: true }, cookie)).json()).settings.media_fallback).toBe(true);
  });

  it("still discards what the fallback made when Hive refuses it", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie);
    fakeVenicePictures(() => new Response("Too many requests", { status: 429 }));
    fakeReplicate();
    fakeHive((vlm) => (vlm ? vlmSays('{"answer": "MINOR"}') : null));
    await expect(baseline(id)).rejects.toThrow(/discarded by the output check \(age check: MINOR\)/);
    expect((await t.db.query(`select 1 from adult_images`)).rows).toHaveLength(0);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows[0].reason).toMatch(/MINOR/);
  });
});

describe("videos when a provider is limited", () => {
  async function pairReady(cookie: string, ownerId: string) {
    for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
    }
    const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
    const scene = (await res.json()).scene as { id: string; a: { id: string }; b: { id: string } };
    const lines = Array.from({ length: 8 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `*leans closer* Line number ${i} is said quite softly here.`, stage: 0 }));
    await t.db.query(`update adult_scenes set lines = $2::jsonb, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [scene.id, JSON.stringify(lines)]);
    return scene;
  }
  const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;

  it("keeps collecting a running video where it started, and starts a new clip on the other", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie, { openrouter_key: "placeholder-text-ABCD" });
    const scene = await pairReady(cookie, id);
    fakeHive();
    // Venice is cooling down (a 429 a minute ago), with a shot already queued there.
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status) values ('venice', $1, 429)`, [new Date(NOW + 120_000).toISOString()]);
    const running = [{ line: 0, who: "a", text: "Hello", motion: "they lean in", status: "queued", queue_id: "venice-q1", model: "wan-3-0-image-to-video", media_id: "base-juniper" }];
    await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind) values ('running', $1, $2, $3, 'making', 0, $4::jsonb, 'clip')`, [
      id,
      scene.a.id,
      scene.b.id,
      JSON.stringify(running),
    ]);
    const venice = fakeVeniceReels();
    const replicate = fakeReplicate();
    const collected = await advance("running", cookie);
    expect(collected.shots[0]).toMatchObject({ status: "ready" });
    expect(collected.shots[0].provider).toBeUndefined();
    expect(venice).toContain("/video/retrieve");
    expect(replicate.creates).toEqual([]);
    expect(replicate.polls).toEqual([]);
    expect((await t.db.query<{ provider: string }>(`select provider from adult_images where kind = 'video'`)).rows[0].provider).toBe("venice");

    // A new clip: its keyframe and its video go to Replicate while Venice cools down.
    venice.length = 0;
    const made = await (await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "close" }, cookie)).json();
    expect(made.reel.shots[0]).toMatchObject({ status: "queued", provider: "replicate", frame_provider: "replicate", fell_back: true });
    expect(replicate.creates).toEqual(["qwen/qwen-image-edit-2511", "wan-video/wan-2.2-i2v-fast"]);
    expect(venice).toEqual([]);
    const row = (await t.db.query<{ provider: string; fell_back: boolean }>(`select provider, fell_back from adult_reels where id = $1`, [made.reel.id])).rows[0];
    expect(row).toEqual({ provider: "replicate", fell_back: true });
    expect((await t.db.query<{ provider: string; fell_back: boolean }>(`select provider, fell_back from adult_images where kind = 'frame'`)).rows[0]).toEqual({ provider: "replicate", fell_back: true });
  });

  it("never moves a shot already running on Replicate when Replicate starts refusing: it's asked again there", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie, { openrouter_key: "placeholder-text-ABCD", media_provider: "replicate" });
    const scene = await pairReady(cookie, id);
    fakeHive();
    const running = [{ line: 0, who: "a", text: "", motion: "they lean in", status: "queued", queue_id: "rep-1", model: "wan-video/wan-2.2-i2v-fast", media_id: "base-juniper", provider: "replicate" }];
    await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, kind) values ('running', $1, $2, $3, 'making', 0, $4::jsonb, 'clip')`, [
      id,
      scene.a.id,
      scene.b.id,
      JSON.stringify(running),
    ]);
    const venice = fakeVeniceReels();
    let limited = true;
    const replicate = fakeReplicate({ poll: () => (limited ? new Response("rate limited", { status: 429 }) : null) });
    const first = await advance("running", cookie);
    expect(first.shots[0]).toMatchObject({ status: "queued", provider: "replicate", queue_id: "rep-1" });
    expect(venice).toEqual([]);
    limited = false;
    const second = await advance("running", cookie);
    expect(second.shots[0]).toMatchObject({ status: "ready", provider: "replicate" });
    expect(replicate.polls).toEqual(["rep-1", "rep-1"]);
    expect(venice).toEqual([]);
  });

  it("queues a new shot's video on the other provider when the configured one is out of credit", async () => {
    const { id, cookie } = await admin();
    await bothSetUp(cookie, { openrouter_key: "placeholder-text-ABCD" });
    await pairReady(cookie, id);
    fakeHive();
    const venice = fakeVeniceReels({ queue: () => Response.json({ error: "insufficient balance" }, { status: 402 }) });
    const replicate = fakeReplicate();
    const made = await (await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "close" }, cookie)).json();
    // The keyframe on Venice (it answered), the video on Replicate.
    expect(made.reel.shots[0]).toMatchObject({ status: "queued", provider: "replicate", frame_provider: "venice", fell_back: true });
    expect(venice.filter((p) => p === "/image/multi-edit")).toHaveLength(1);
    expect(venice.filter((p) => p === "/video/queue")).toHaveLength(1);
    expect(replicate.creates).toEqual(["wan-video/wan-2.2-i2v-fast"]);
    expect(await cooldowns()).toEqual([{ provider: "venice", ms: CREDIT_COOLDOWN_MS, status: 402 }]);
  });
});

describe("#1122: a write in flight is on the scene", () => {
  it("the scene says how long its lines have been writing while they are, and not once they're in (or the mark is stale)", async () => {
    const { id, cookie } = await admin();
    await settings({ enabled: true, openrouter_key: "placeholder-text-ABCD" }, cookie);
    const { openScene, WRITING_STALE_MS } = await import("@/lib/adult/scenes");
    let during: number | undefined | null = null;
    setAdultModelForTests({
      complete: async () => {
        during = (await openScene(t.db, id, RAFE, JUNIPER))?.writing_for;
        return JSON.stringify({ lines: [{ who: "a", text: "Come here." }], explicit: false, picture: null });
      },
    });
    // The very first Start: no scene row yet, and the mark still lands.
    const r = await (await call(POST, "/api/admin/after-dark", { a: RAFE, b: JUNIPER }, cookie)).json();
    expect(r.scene?.lines?.length ?? 0).toBeGreaterThan(0);
    expect(typeof during).toBe("number");
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeUndefined();
    // A mark left by a request that died long ago doesn't hold the page.
    await t.db.query(`update adult_scenes set writing_since = now() - make_interval(secs => $1) where owner_id = $2`, [WRITING_STALE_MS / 1000 + 60, id]);
    expect((await openScene(t.db, id, RAFE, JUNIPER))?.writing_for).toBeUndefined();
  });
});
