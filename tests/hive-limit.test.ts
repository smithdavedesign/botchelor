import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { GET as settingsGet, POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { autoPicturesSettled, kickAutoPicture } from "@/lib/adult/auto-pictures";
import { HIVE_RETRIES, HIVE_VLM, PROBE_PNG, setCheckFetchForTests } from "@/lib/adult/check";
import {
  endHivePause,
  HIVE_PAUSE_MS,
  hivePause,
  hivePausedMessage,
  hivePausedReason,
  notDrawnReason,
  pauseClock,
  pauseHive,
  setHivePauseClockForTests,
} from "@/lib/adult/hive-limit";
import { runAdultTool } from "@/lib/adult/mcp";
import { baselinePrompt, makePicture, pollClip, setMediaFetchForTests, startClip } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { reelFailureNote } from "@/lib/adult/reel-failure";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import { setReplicateFetchForTests, setReplicatePausesForTests } from "@/lib/adult/replicate";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { ensureSet, SET_MODEL, setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Hive's daily limit (lib/adult/hive-limit.ts, 2026-10-23): Hive and every provider are stubbed, no live calls here.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
let now = Date.now();
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
  now = Date.now();
  setHivePauseClockForTests(() => now);
});
afterEach(async () => {
  await autoPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReplicateFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setSetsFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
  setHivePauseClockForTests(null);
});

// Rafe (he) and Juniper (she); the pair is stored lower id first.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
/** A subscriber with a passed age check and `tokens` bought tokens. */
async function subscriber(tokens = 20) {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), id, tokens]);
  return { id, cookie: signedIn(id) };
}
const spent = async (userId: string) => (await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [userId])).rows[0]?.used ?? 0;

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.2 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
/** What Hive said all evening on 2026-10-23: no Retry-After, no rate-limit headers. */
const outForTheDay = () => new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 });

type HiveCall = "probe" | "moderation" | "vlm";
/** Hive: `answer` decides a call (null: it passes); every call is recorded, the probe told apart by its picture. */
function fakeHive(answer: (kind: HiveCall, n: number) => Response | null = () => null) {
  const calls: HiveCall[] = [];
  const bodies: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const kind: HiveCall = String(input) === HIVE_VLM ? "vlm" : body.includes(PROBE_PNG) ? "probe" : "moderation";
    calls.push(kind);
    bodies.push(body);
    return answer(kind, calls.length - 1) ?? Response.json(kind === "vlm" ? ADULTS : CLEAN_MOD);
  });
  return { calls, bodies };
}
/** Venice's picture endpoint (baselines and scene pictures): every draw recorded. */
function fakeVenicePictures() {
  const drawn: string[] = [];
  setMediaFetchForTests(async (input: RequestInfo | URL) => {
    drawn.push(String(input));
    return Response.json({ images: [Buffer.from(PNG).toString("base64")] });
  });
  return drawn;
}
/** Venice's keyframes, queues and retrieves (reels and clips), recorded. */
function fakeVeniceReels() {
  const seen: string[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    seen.push(path);
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
/** The director (and any other text call): its shot list, and how many times it was asked. */
function director(shots = [{ line: 2 }, { line: 5 }, { line: 9 }]) {
  const asked = { n: 0 };
  setAdultModelForTests({
    complete: async () => {
      asked.n++;
      return JSON.stringify({ shots: shots.map((s) => ({ frame: "", motion: "", ...s })) });
    },
  } as never);
  return asked;
}
const night = Array.from({ length: 12 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage: 2 }));

/** After Dark on with Venice and Hive keys (pictures on Venice), and the admin's settings saved. */
async function setUp(cookie: string, extra: Record<string, unknown> = {}) {
  await call(
    settingsPost,
    "/api/admin/after-dark/settings",
    { enabled: true, image_provider: "venice", openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", reel_shots: 3, reel_tokens: 6, clip_tokens: 3, auto_scene_pictures: false, ...extra },
    cookie,
  );
}
/** Both baselines in, and `cookie`'s scene for the pair with a night of lines. */
async function scene(cookie: string, ownerId: string) {
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const s = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [s.id, JSON.stringify(night)]);
  return s;
}
const juniper = async () => (await loadCharacter(t.db, JUNIPER))!;
const baseline = async (owner: string) => makePicture(t.db, owner, { prompt: baselinePrompt(await juniper(), owner), kind: "baseline", character_id: JUNIPER });
const failure = (p: Promise<unknown>) => p.then(() => null, (err: unknown) => (err instanceof Error ? err.message : String(err)));
const rejections = async () => (await t.db.query<{ kind: string; reason: string }>(`select kind, reason from adult_rejections order by created_at`)).rows;
const UP_FRONT = /^Pictures and videos are paused: the safety check every picture has to pass is over its daily limit\. Try again after \d\d:\d\d UTC \(in about 30 minutes\)\.$/;
const DISCARDED = /^Pictures and videos are paused: the safety check every picture has to pass is over its daily limit, so this one couldn't be checked and wasn't kept\. Try again after \d\d:\d\d UTC \(in about 30 minutes\)\.$/;

describe("a check that ends on Hive's 429", () => {
  it("pauses pictures and videos for half an hour, on every instance; the picture is discarded, logged, and not counted", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "moderation" ? outForTheDay() : null));
    const message = await failure(baseline(id));
    expect(message).toMatch(DISCARDED);
    // The check's own retries (a burst), then nothing more: not even the age check.
    expect(hive.calls).toEqual(Array.from({ length: 1 + HIVE_RETRIES }, () => "moderation"));
    const pause = await hivePause(t.db);
    expect(pause).toMatchObject({ active: true, status: 429, reason: "the check couldn't run (Hive answered 429)" });
    expect(new Date(pause!.until).getTime()).toBe(now + HIVE_PAUSE_MS);
    expect(message).toContain(`Try again after ${pauseClock(pause!.until)}`);
    // The row the providers' cooldowns live in (lib/adult/fallback.ts), so every instance sees it.
    expect((await t.db.query(`select provider from adult_media_cooldowns`)).rows).toEqual([{ provider: "hive" }]);
    expect((await t.db.query(`select 1 from adult_images where kind <> 'baseline' or id not like 'base-%'`)).rows).toHaveLength(0);
    expect(await rejections()).toEqual([{ kind: "baseline", reason: "the check couldn't run (Hive answered 429)" }]);
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [id])).rows[0]?.pictures ?? 0).toBe(0);
  });

  it("but a lone 429 (a burst) is still retried, and pauses nothing", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeVenicePictures();
    const hive = fakeHive((kind, n) => (n === 0 ? outForTheDay() : null));
    const picture = await baseline(id);
    expect(picture.status).toBe("ready");
    expect(hive.calls).toEqual(["moderation", "moderation", "vlm"]);
    expect(await hivePause(t.db)).toBeNull();
  });

  it("a set's own 429 pauses After Dark too: it's the same allowance", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie, { fal_key: "placeholder-fal" });
    setSetsFetchForTests(async (input: RequestInfo | URL) =>
      String(input) === `https://fal.run/${SET_MODEL}` ? Response.json({ images: [{ url: "https://cdn.fal.test/set.jpg" }] }) : new Response(PNG, { headers: { "content-type": "image/jpeg" } }),
    );
    fakeHive((kind) => (kind === "moderation" ? outForTheDay() : null));
    expect(await ensureSet(t.db, "a lighthouse")).toBe("failed");
    expect((await hivePause(t.db))?.active).toBe(true);
    const drawn = fakeVenicePictures();
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(drawn).toEqual([]);
  });
});

describe("while Hive is paused", () => {
  it("a baseline is refused before anything is drawn: no provider or Hive call, the time it's back, and a log row", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    const until = await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    const message = await failure(baseline(id));
    expect(message).toMatch(UP_FRONT);
    expect(message).toContain(`Try again after ${pauseClock(until)} (in about 30 minutes).`);
    expect(drawn).toEqual([]);
    expect(hive.calls).toEqual([]);
    expect(await rejections()).toEqual([{ kind: "baseline", reason: notDrawnReason(until) }]);
    // The admin's MCP tool says the same, as it is.
    const viaMcp = await runAdultTool(t.db, "after_dark_baseline", { character_id: JUNIPER });
    expect(viaMcp).toEqual({ error: message });
    expect(drawn).toEqual([]);
  });

  it("a menu picture, a video and a clip are refused up front: nothing drawn, no director, no tokens", async () => {
    const { cookie: adminCookie } = await admin();
    await setUp(adminCookie);
    const sub = await subscriber();
    await scene(sub.cookie, sub.id);
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const venice = fakeVeniceReels();
    const pictures = fakeVenicePictures();
    const hive = fakeHive();
    const asked = director();
    const tries = [
      await call(picturesPost, "/api/admin/after-dark/pictures", { a: RAFE, b: JUNIPER, act: "kiss", outfit: "tonight", framing: "medium", place: "her bedroom" }, sub.cookie),
      await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, sub.cookie),
      await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, here: true }, sub.cookie),
      await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, act: "kiss" }, sub.cookie),
    ];
    for (const res of tries) {
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("hive_paused");
      expect(body.message).toMatch(UP_FRONT);
    }
    expect(venice).toEqual([]);
    expect(pictures).toEqual([]);
    expect(hive.calls).toEqual([]);
    expect(asked.n).toBe(0);
    expect(await spent(sub.id)).toBe(0);
    expect((await t.db.query(`select 1 from adult_reels`)).rows).toHaveLength(0);
    expect((await rejections()).map((r) => r.kind)).toEqual(["scene", "reel", "reel", "reel"]);
  });

  it("an automatic picture isn't claimed or drawn; the first step after the pause draws it, probing Hive first", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie, { auto_scene_pictures: true });
    const s = await scene(cookie, id);
    const [a, b] = await Promise.all([loadCharacter(t.db, RAFE), loadCharacter(t.db, JUNIPER)]);
    const at = { id: s.id, chapter: 1, place: "her bedroom", set_place: null, stage: 2, lines: night };
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    expect(await kickAutoPicture(t.db, id, at, a, b)).toBe(false);
    expect((await t.db.query<{ auto_pictures: string[] }>(`select auto_pictures from adult_scenes where id = $1`, [s.id])).rows[0].auto_pictures).toEqual([]);
    expect(drawn).toEqual([]);
    expect(hive.calls).toEqual([]);
    now += HIVE_PAUSE_MS + 1;
    expect(await kickAutoPicture(t.db, id, at, a, b)).toBe(true);
    await autoPicturesSettled();
    expect(hive.calls).toEqual(["probe", "moderation", "vlm"]);
    expect(drawn).toHaveLength(1);
    expect((await t.db.query(`select 1 from adult_images where kind = 'scene'`)).rows).toHaveLength(1);
    expect(await hivePause(t.db)).toBeNull();
  });

  it("a video being made waits: nothing fetched or sent to Hive, its shots say until when, and they're collected after", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await scene(cookie, id);
    const venice = fakeVeniceReels();
    const hive = fakeHive();
    director();
    const started = (await (await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, cookie)).json()).reel as Reel;
    expect(started.shots.map((s) => s.status)).toEqual(["queued", "queued", "queued"]);
    const until = await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const [fetched, sent] = [venice.length, hive.calls.length];
    const advance = async () => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${started.id}`, { headers: { cookie } }))).json()).reel as Reel;
    const waiting = await advance();
    expect(venice).toHaveLength(fetched);
    expect(hive.calls).toHaveLength(sent);
    expect(waiting.status).toBe("making");
    expect(waiting.shots.every((s) => s.status === "queued" && s.retry_at === until && s.reason === hivePausedReason(until))).toBe(true);
    // Over: the wait each shot was given has passed too, and the next polls collect them.
    now += HIVE_PAUSE_MS + 1;
    await t.db.query(`update adult_reels set shots = (select jsonb_agg(x - 'retry_at') from jsonb_array_elements(shots) x) where id = $1`, [started.id]);
    await advance();
    const done = await advance();
    expect(done.status).toBe("ready");
    expect(done.shots.every((s) => s.status === "ready")).toBe(true);
    expect(await hivePause(t.db)).toBeNull();
  });

  it("a fal clip isn't started, and one already at fal waits there unchecked", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie, { fal_key: "placeholder-fal" });
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, remote_url) values ('pic', $1, $2, 'scene', 'p', 'image/png', $3, 'https://cdn.fal.test/pic.png')`, [id, JUNIPER, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status, request_id) values ('clip', $1, $2, 'video', 'p', 'video/mp4', 'pending', 'req-1')`, [id, JUNIPER]);
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const fal = fakeVenicePictures();
    const hive = fakeHive();
    expect(await failure(startClip(t.db, id, "pic", "a slow turn"))).toMatch(UP_FRONT);
    expect(await pollClip(t.db, "clip", id)).toBe("pending");
    expect(fal).toEqual([]);
    expect(hive.calls).toEqual([]);
  });

  it("a set isn't drawn, and is due again once the pause is over", async () => {
    const { cookie } = await admin();
    await setUp(cookie, { fal_key: "placeholder-fal" });
    const until = await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    let fal = 0;
    setSetsFetchForTests(async () => {
      fal++;
      return new Response("?", { status: 500 });
    });
    const hive = fakeHive();
    expect(await ensureSet(t.db, "a lighthouse")).toBe("failed");
    expect(fal).toBe(0);
    expect(hive.calls).toEqual([]);
    const row = (await t.db.query<{ retry_at: Date | string; attempts: number }>(`select retry_at, attempts from place_sets`)).rows[0];
    expect(row.attempts).toBe(0);
    expect(Math.abs(new Date(row.retry_at).getTime() - new Date(until).getTime())).toBeLessThan(60_000);
  });

  it("a pause still running is never cut short", async () => {
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    await endHivePause(t.db);
    expect((await hivePause(t.db))?.active).toBe(true);
  });
});

describe("the probe, once the pause has run out", () => {
  it("asks Hive once, with a plain picture of our own: a 429 means another half hour, and nothing is drawn", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    now += HIVE_PAUSE_MS + 1;
    const drawn = fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "probe" ? outForTheDay() : null));
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(hive.calls).toEqual(["probe"]);
    expect(drawn).toEqual([]);
    expect(JSON.parse(hive.bodies[0])).toEqual({ input: [{ media_base64: PROBE_PNG }], processing_mode: "sync_with_fallback" });
    expect(Buffer.from(PROBE_PNG, "base64").subarray(0, 8)).toEqual(Buffer.from(PNG));
    const pause = await hivePause(t.db);
    expect(pause).toMatchObject({ active: true, reason: "the probe: Hive answered 429" });
    expect(new Date(pause!.until).getTime()).toBe(now + HIVE_PAUSE_MS);
    expect((await rejections()).at(-1)).toEqual({ kind: "baseline", reason: notDrawnReason(pause!.until) });
  });

  it("an answer ends the pause, and the picture is drawn, checked and kept", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    now += HIVE_PAUSE_MS + 1;
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    expect((await baseline(id)).status).toBe("ready");
    expect(hive.calls).toEqual(["probe", "moderation", "vlm"]);
    expect(drawn).toHaveLength(1);
    expect(await hivePause(t.db)).toBeNull();
  });

  it("an answer that isn't a 429 says nothing about the limit: the draw goes ahead, and its own check ends the pause", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    now += HIVE_PAUSE_MS + 1;
    fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "probe" ? new Response("down", { status: 503 }) : null));
    expect((await baseline(id)).status).toBe("ready");
    expect(hive.calls).toEqual(["probe", "moderation", "vlm"]);
    expect(await hivePause(t.db)).toBeNull();
  });
});

describe("a video whose first keyframe finds Hive out", () => {
  it("sends nothing more to Hive: the other keyframes aren't checked or kept, no video starts, and the tokens come back", async () => {
    const { cookie: adminCookie } = await admin();
    await setUp(adminCookie);
    const sub = await subscriber();
    await scene(sub.cookie, sub.id);
    const venice = fakeVeniceReels();
    const hive = fakeHive((kind) => (kind !== "probe" ? outForTheDay() : null));
    director();
    const res = await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, sub.cookie);
    const reel = (await res.json()).reel as Reel;
    // One check (a keyframe's is the age question), with its retries; no second try after a pause, and nothing for the
    // other two keyframes.
    expect(hive.calls).toEqual(Array.from({ length: 1 + HIVE_RETRIES }, () => "vlm"));
    expect(venice.filter((p) => p === "/image/multi-edit")).toHaveLength(3);
    expect(venice.filter((p) => p === "/video/queue")).toHaveLength(0);
    expect(reel.status).toBe("failed");
    const until = (await hivePause(t.db))!.until;
    expect(reel.shots.every((s) => s.status === "failed" && s.reason === hivePausedReason(until))).toBe(true);
    expect(reelFailureNote(reel.shots)).toBe(
      `The safety check every picture has to pass is over its daily limit, so its shots couldn't be checked and weren't kept. Try again after ${pauseClock(until)}.`,
    );
    expect((await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows).toHaveLength(0);
    expect(await spent(sub.id)).toBe(0);
    expect((await rejections()).map((r) => r.reason)).toEqual([
      "keyframe: the check couldn't run (Hive answered 429)",
      `keyframe: ${hivePausedReason(until)}`,
      `keyframe: ${hivePausedReason(until)}`,
    ]);
  });
});

describe("what the admin sees", () => {
  it("the pause beside the providers' cooldowns, in after_dark_settings and the settings page's API", async () => {
    const { cookie } = await admin();
    await setUp(cookie);
    const until = await pauseHive(t.db, "the check couldn't run (Hive answered 429)");
    const venice = new Date(now + 60_000).toISOString();
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status, reason) values ('venice', $1, 429, 'Venice 429')`, [venice]);
    const expected = [
      { what: "Venice", until: venice, active: true, status: 429, reason: "Venice 429" },
      { what: "Hive (the safety check)", until, active: true, status: 429, reason: "the check couldn't run (Hive answered 429)" },
    ];
    const read = await runAdultTool(t.db, "after_dark_settings", {});
    expect("data" in read && read.data.pauses).toEqual(expected);
    const page = await (await settingsGet(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { headers: { cookie } }))).json();
    expect(page.pauses).toEqual(expected);
  });
});

describe("what the page says", () => {
  it("until when, in UTC, and about how long", () => {
    const at = Date.parse("2026-10-23T21:15:00.000Z");
    const until = new Date(at + HIVE_PAUSE_MS).toISOString();
    expect(hivePausedMessage(until, { now: at })).toBe(
      "Pictures and videos are paused: the safety check every picture has to pass is over its daily limit. Try again after 21:45 UTC (in about 30 minutes).",
    );
    expect(hivePausedMessage(until, { now: at + HIVE_PAUSE_MS - 30_000, discarded: true })).toBe(
      "Pictures and videos are paused: the safety check every picture has to pass is over its daily limit, so this one couldn't be checked and wasn't kept. Try again after 21:45 UTC (in about a minute).",
    );
    expect(hivePausedReason(until)).toBe("the check couldn't run (Hive is over its daily limit, paused until 21:45 UTC)");
    expect(notDrawnReason(until)).toBe("not drawn: Hive is over its daily limit, paused until 21:45 UTC");
  });
});
