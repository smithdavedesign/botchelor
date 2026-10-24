import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import SceneWriter from "@/app/after-dark/[a]/[b]/SceneWriter";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { GET as settingsGet, POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { autoPicturesSettled, kickAutoPicture } from "@/lib/adult/auto-pictures";
import { HIVE_RETRIES, HIVE_VLM, PROBE_PNG, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import {
  closeHiveBreaker,
  HIVE_PAUSE_FIRST_MS,
  HIVE_PAUSE_MAX_MS,
  HIVE_PROBE_LEASE_MS,
  hiveGate,
  hiveNotice,
  hivePause,
  hivePauseMs,
  hivePausedMessage,
  hivePausedReason,
  hiveState,
  notDrawnReason,
  pauseClock,
  pauseHive,
  recordHiveFailure,
  setHivePauseClockForTests,
} from "@/lib/adult/hive-limit";
import { hiveNoticeText } from "@/lib/adult/hive-notice";
import { runAdultTool } from "@/lib/adult/mcp";
import { baselinePrompt, ensureBaseline, makePicture, pollClip, setMediaFetchForTests, startClip } from "@/lib/adult/media";
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

// Hive's circuit breaker (lib/adult/hive-limit.ts, 2026-10-23): Hive and every provider are stubbed, no live calls here.
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
  // hive()'s waits between its own retries: none here.
  setCheckSleepForTests(async () => {});
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
  setCheckSleepForTests(null);
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
/** What Hive said all evening on 2026-10-23, even to one request at a time: no Retry-After, no rate-limit headers. */
const outForTheDay = () => new Response(JSON.stringify({ status_code: 429, message: "Too Many Requests" }), { status: 429 });

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
const ABOUT = String.raw`\(about (\d+ minutes|a minute)\)`;
const UP_FRONT = new RegExp(String.raw`^Hive \(the safety check\) has hit its limit, so nothing is drawn until it answers again ${ABOUT}\. Your tokens are untouched\.$`);
const DISCARDED = new RegExp(String.raw`^Hive \(the safety check\) has hit its limit, so this one couldn't be checked and wasn't kept, and nothing more is drawn until it answers again ${ABOUT}\.$`);
const COULDNT_RUN_429 = "the check couldn't run (Hive answered 429: Too Many Requests)";
const MIN = 60_000;
const untilIn = (until: string | null | undefined) => (until ? new Date(until).getTime() - now : null);

describe("the breaker opens after two checks in a row couldn't run", () => {
  it("one alone is a blip: the picture is discarded and logged with Hive's own words, and nothing is paused", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    const drawn = fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "moderation" ? outForTheDay() : null));
    expect(await failure(baseline(id))).toBe(`The picture was discarded by the output check (${COULDNT_RUN_429}).`);
    // The check's own retries, then nothing more: not even the age check.
    expect(hive.calls).toEqual(Array.from({ length: 1 + HIVE_RETRIES }, () => "moderation"));
    expect(drawn).toHaveLength(1);
    expect(await hivePause(t.db)).toBeNull();
    expect(await hiveState(t.db)).toMatchObject({ state: "failing", failures: 1, status: 429, last_error: COULDNT_RUN_429 });
    expect(await rejections()).toEqual([{ kind: "baseline", reason: COULDNT_RUN_429 }]);
  });

  it("the second opens it for 5 minutes: that picture is discarded with the pause's message, and the next draws nothing", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    const drawn = fakeVenicePictures();
    fakeHive((kind) => (kind === "moderation" ? outForTheDay() : null));
    await failure(baseline(id));
    const message = await failure(baseline(id));
    expect(message).toMatch(DISCARDED);
    expect(message).toContain("(about 5 minutes)");
    expect(drawn).toHaveLength(2);
    const pause = await hivePause(t.db);
    expect(pause).toMatchObject({ active: true, status: 429, failures: 2, reason: COULDNT_RUN_429 });
    expect(untilIn(pause!.until)).toBe(HIVE_PAUSE_FIRST_MS);
    // The row the providers' cooldowns live in (lib/adult/fallback.ts), so every instance sees it.
    expect((await t.db.query(`select provider, failures from adult_media_cooldowns`)).rows).toEqual([{ provider: "hive", failures: 2 }]);
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(drawn).toHaveLength(2);
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [id])).rows[0]?.pictures ?? 0).toBe(0);
  });

  it("a 5xx and an unreachable Hive count too; the reason keeps what happened", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeVenicePictures();
    fakeHive((kind, n) => {
      if (kind !== "moderation") return null;
      if (n <= HIVE_RETRIES) return new Response("upstream down", { status: 503 });
      throw new TypeError("fetch failed");
    });
    await failure(baseline(id));
    expect(await failure(baseline(id))).toMatch(DISCARDED);
    expect(await hivePause(t.db)).toMatchObject({ active: true, status: null, failures: 2, reason: "the check couldn't run (Hive couldn't be reached (fetch failed))" });
    expect((await rejections()).map((r) => r.reason)).toEqual([
      "the check couldn't run (Hive answered 503: upstream down)",
      "the check couldn't run (Hive couldn't be reached (fetch failed))",
    ]);
  });

  it("a check Hive answers in between resets the count, and a lone 429 (a burst) is still just retried", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeVenicePictures();
    let out = true;
    const hive = fakeHive((kind) => (out && kind === "moderation" ? outForTheDay() : null));
    await failure(baseline(id));
    out = false;
    expect((await baseline(id)).status).toBe("ready");
    expect(await hiveState(t.db)).toMatchObject({ state: "ok", failures: 0 });
    out = true;
    await failure(baseline(id));
    expect(await hivePause(t.db)).toBeNull();
    // A burst: one 429, then an answer, within one check.
    out = false;
    hive.calls.length = 0;
    fakeHive((kind, n) => (n === 0 ? outForTheDay() : null));
    expect((await baseline(id)).status).toBe("ready");
    expect(await hiveState(t.db)).toMatchObject({ state: "ok" });
  });

  it("a set's check counts toward the same breaker: it's the same Hive", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie, { fal_key: "placeholder-fal" });
    setSetsFetchForTests(async (input: RequestInfo | URL) =>
      String(input) === `https://fal.run/${SET_MODEL}` ? Response.json({ images: [{ url: "https://cdn.fal.test/set.jpg" }] }) : new Response(PNG, { headers: { "content-type": "image/jpeg" } }),
    );
    fakeHive((kind) => (kind === "moderation" ? outForTheDay() : null));
    expect(await ensureSet(t.db, "a lighthouse")).toBe("failed");
    const drawn = fakeVenicePictures();
    await failure(baseline(id));
    expect((await hivePause(t.db))?.active).toBe(true);
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(drawn).toHaveLength(1);
  });

  it("is shared through the database: failures on two instances add up, and a pause written elsewhere refuses here", async () => {
    // Two instances, each with one failure: the row is the count, not either instance's memory.
    expect(await recordHiveFailure(t.db, "instance A: Hive answered 429", 429)).toBeNull();
    expect(untilIn(await recordHiveFailure(t.db, "instance B: Hive answered 429", 429))).toBe(HIVE_PAUSE_FIRST_MS);
    await closeHiveBreaker(t.db);
    // A pause another instance wrote, straight into the table.
    const until = new Date(now + 7 * MIN).toISOString();
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status, reason, failures) values ('hive', $1, 429, 'elsewhere', 2)`, [until]);
    const hive = fakeHive();
    expect(await hiveGate(t.db, "placeholder-hive")).toMatchObject({ ok: false, until, reason: notDrawnReason(until, "elsewhere") });
    expect(hive.calls).toEqual([]);
  });
});

describe("the pause", () => {
  it("is 5 minutes, doubling with each further failure up to 60; Retry-After instead when Hive sends it, capped at 60", () => {
    expect([2, 3, 4, 5, 6, 7, 12].map((f) => hivePauseMs(f) / MIN)).toEqual([5, 10, 20, 40, 60, 60, 60]);
    expect(hivePauseMs(2, 90_000)).toBe(90_000);
    expect(hivePauseMs(5, 90_000)).toBe(90_000);
    expect(hivePauseMs(2, 3 * 60 * MIN)).toBe(HIVE_PAUSE_MAX_MS);
  });

  it("doubles in the database as failures go on, each after the last pause ended", async () => {
    const pauses: (number | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const until = await recordHiveFailure(t.db, "Hive answered 429", 429);
      pauses.push(until ? untilIn(until)! / MIN : null);
      if (until) now = new Date(until).getTime() + 1;
    }
    expect(pauses).toEqual([null, 5, 10, 20, 40, 60, 60]);
  });

  it("honours Hive's Retry-After, capped at 60 minutes", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeVenicePictures();
    let wait = "900";
    fakeHive((kind) => (kind === "moderation" ? new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429, headers: { "retry-after": wait } }) : null));
    await failure(baseline(id));
    expect(await failure(baseline(id))).toContain("(about 15 minutes)");
    expect(untilIn((await hivePause(t.db))!.until)).toBe(15 * MIN);
    await closeHiveBreaker(t.db);
    wait = "7200";
    await failure(baseline(id));
    await failure(baseline(id));
    expect(untilIn((await hivePause(t.db))!.until)).toBe(HIVE_PAUSE_MAX_MS);
  });
});

describe("while Hive is paused", () => {
  it("a baseline is refused before anything is drawn: no provider or Hive call, how long, and a log row with Hive's words", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    const until = await pauseHive(t.db, COULDNT_RUN_429);
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    const message = await failure(baseline(id));
    expect(message).toMatch(UP_FRONT);
    expect(message).toBe("Hive (the safety check) has hit its limit, so nothing is drawn until it answers again (about 5 minutes). Your tokens are untouched.");
    // ensureBaseline (a video's and a menu picture's first step) is makePicture underneath: the same refusal.
    expect(await failure(ensureBaseline(t.db, id, await juniper()))).toBe(message);
    expect(drawn).toEqual([]);
    expect(hive.calls).toEqual([]);
    expect(await rejections()).toEqual([
      { kind: "baseline", reason: notDrawnReason(until, COULDNT_RUN_429) },
      { kind: "baseline", reason: notDrawnReason(until, COULDNT_RUN_429) },
    ]);
    expect(notDrawnReason(until, COULDNT_RUN_429)).toBe(`not drawn: Hive is paused until ${pauseClock(until)} (last: Hive answered 429: Too Many Requests)`);
    // The admin's MCP tool says the same, as it is.
    const viaMcp = await runAdultTool(t.db, "after_dark_baseline", { character_id: JUNIPER });
    expect(viaMcp).toEqual({ error: message });
    expect(drawn).toEqual([]);
  });

  it("a menu picture, a video and a clip are refused up front with a 503: nothing drawn, no director, no tokens ever spent", async () => {
    const { cookie: adminCookie } = await admin();
    await setUp(adminCookie);
    const sub = await subscriber();
    await scene(sub.cookie, sub.id);
    await pauseHive(t.db, COULDNT_RUN_429);
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
    // Not spent and refunded: never spent. Spending writes this row (lib/allowance.ts spendBoughtTokens).
    expect((await t.db.query(`select 1 from pack_episode_usage where user_id = $1`, [sub.id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_reels`)).rows).toHaveLength(0);
    expect((await rejections()).map((r) => r.kind)).toEqual(["scene", "reel", "reel", "reel"]);
  });

  it("an automatic picture isn't claimed or drawn; a step after the pause draws it, probing Hive first", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie, { auto_scene_pictures: true });
    const s = await scene(cookie, id);
    const [a, b] = await Promise.all([loadCharacter(t.db, RAFE), loadCharacter(t.db, JUNIPER)]);
    const at = { id: s.id, chapter: 1, place: "her bedroom", set_place: null, stage: 2, lines: night };
    await pauseHive(t.db, COULDNT_RUN_429);
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    expect(await kickAutoPicture(t.db, id, at, a, b)).toBe(false);
    expect((await t.db.query<{ auto_pictures: string[] }>(`select auto_pictures from adult_scenes where id = $1`, [s.id])).rows[0].auto_pictures).toEqual([]);
    expect(drawn).toEqual([]);
    expect(hive.calls).toEqual([]);
    now += HIVE_PAUSE_FIRST_MS + 1;
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
    const until = await pauseHive(t.db, COULDNT_RUN_429);
    const [fetched, sent] = [venice.length, hive.calls.length];
    const advance = async () => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${started.id}`, { headers: { cookie } }))).json()).reel as Reel;
    const waiting = await advance();
    expect(venice).toHaveLength(fetched);
    expect(hive.calls).toHaveLength(sent);
    expect(waiting.status).toBe("making");
    expect(waiting.shots.every((s) => s.status === "queued" && s.retry_at === until && s.reason === hivePausedReason(until))).toBe(true);
    // Over: the wait each shot was given has passed too, and the next polls collect them.
    now += HIVE_PAUSE_FIRST_MS + 1;
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
    await pauseHive(t.db, COULDNT_RUN_429);
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
    const until = await pauseHive(t.db, COULDNT_RUN_429);
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
});

describe("the probe, once the pause has ended", () => {
  it("asks Hive once, with a plain picture of our own: down again means a longer pause, and nothing is drawn", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, COULDNT_RUN_429);
    now += HIVE_PAUSE_FIRST_MS + 1;
    const drawn = fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "probe" ? outForTheDay() : null));
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(hive.calls).toEqual(["probe"]);
    expect(drawn).toEqual([]);
    expect(JSON.parse(hive.bodies[0])).toEqual({ input: [{ media_base64: PROBE_PNG }], processing_mode: "sync_with_fallback" });
    expect(Buffer.from(PROBE_PNG, "base64").subarray(0, 8)).toEqual(Buffer.from(PNG));
    const pause = await hivePause(t.db);
    expect(pause).toMatchObject({ active: true, failures: 3, reason: "the probe: Hive answered 429: Too Many Requests" });
    expect(untilIn(pause!.until)).toBe(2 * HIVE_PAUSE_FIRST_MS);
    expect((await rejections()).at(-1)).toEqual({ kind: "baseline", reason: notDrawnReason(pause!.until, pause!.reason) });
  });

  it("an answer closes the breaker, and the picture is drawn, checked and kept", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, COULDNT_RUN_429);
    now += HIVE_PAUSE_FIRST_MS + 1;
    const drawn = fakeVenicePictures();
    const hive = fakeHive();
    expect((await baseline(id)).status).toBe("ready");
    expect(hive.calls).toEqual(["probe", "moderation", "vlm"]);
    expect(drawn).toHaveLength(1);
    expect(await hivePause(t.db)).toBeNull();
    expect(await hiveState(t.db)).toMatchObject({ state: "ok" });
  });

  it("a 5xx probe is Hive still down: refused, nothing drawn", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, COULDNT_RUN_429);
    now += HIVE_PAUSE_FIRST_MS + 1;
    const drawn = fakeVenicePictures();
    fakeHive((kind) => (kind === "probe" ? new Response("down", { status: 503 }) : null));
    expect(await failure(baseline(id))).toMatch(UP_FRONT);
    expect(drawn).toEqual([]);
    expect(await hivePause(t.db)).toMatchObject({ active: true, status: 503, failures: 3, reason: "the probe: Hive answered 503: down" });
  });

  it("any other answer says nothing about Hive's state: the draw goes ahead, and its own check closes the breaker", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await pauseHive(t.db, COULDNT_RUN_429);
    now += HIVE_PAUSE_FIRST_MS + 1;
    fakeVenicePictures();
    const hive = fakeHive((kind) => (kind === "probe" ? new Response("unauthorized", { status: 401 }) : null));
    expect((await baseline(id)).status).toBe("ready");
    expect(hive.calls).toEqual(["probe", "moderation", "vlm"]);
    expect(await hivePause(t.db)).toBeNull();
  });

  it("lets one probe through at a time: while it's out, every other draw is still refused", async () => {
    await pauseHive(t.db, COULDNT_RUN_429);
    now += HIVE_PAUSE_FIRST_MS + 1;
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setCheckFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body ?? "").includes(PROBE_PNG) ? "probe" : "check");
      await held;
      return Response.json(CLEAN_MOD);
    });
    const first = hiveGate(t.db, "placeholder-hive");
    await vi.waitFor(() => expect(calls).toEqual(["probe"]));
    const second = await hiveGate(t.db, "placeholder-hive");
    expect(second).toMatchObject({ ok: false, until: new Date(now + HIVE_PROBE_LEASE_MS).toISOString() });
    release();
    expect(await first).toEqual({ ok: true });
    expect(calls).toEqual(["probe"]);
    expect(await hivePause(t.db)).toBeNull();
    expect(await hiveGate(t.db, "placeholder-hive")).toEqual({ ok: true });
  });
});

describe("a video whose keyframes find Hive out", () => {
  it("the second failed check opens the breaker: nothing more goes to Hive, no video starts, and the tokens come back", async () => {
    const { cookie: adminCookie } = await admin();
    await setUp(adminCookie);
    const sub = await subscriber();
    await scene(sub.cookie, sub.id);
    const venice = fakeVeniceReels();
    const hive = fakeHive((kind) => (kind !== "probe" ? outForTheDay() : null));
    director();
    const res = await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, sub.cookie);
    const reel = (await res.json()).reel as Reel;
    // The first keyframe's check (the age question), with its retries; asked once more after a wait (a blip), which
    // opens the breaker; nothing for the other two keyframes.
    expect(hive.calls).toEqual(Array.from({ length: 2 * (1 + HIVE_RETRIES) }, () => "vlm"));
    expect(venice.filter((p) => p === "/image/multi-edit")).toHaveLength(3);
    expect(venice.filter((p) => p === "/video/queue")).toHaveLength(0);
    expect(reel.status).toBe("failed");
    const until = (await hivePause(t.db))!.until;
    expect(reel.shots.every((s) => s.status === "failed" && s.reason === hivePausedReason(until))).toBe(true);
    expect(reelFailureNote(reel.shots)).toBe(`Hive (the safety check) has hit its limit, so its shots couldn't be checked and weren't kept. Try again after ${pauseClock(until)}.`);
    expect((await t.db.query(`select 1 from adult_images where kind = 'frame'`)).rows).toHaveLength(0);
    expect(await spent(sub.id)).toBe(0);
    expect((await rejections()).map((r) => r.reason)).toEqual([`keyframe: ${COULDNT_RUN_429}`, `keyframe: ${hivePausedReason(until)}`, `keyframe: ${hivePausedReason(until)}`]);
  });
});

describe("what the admin sees", () => {
  it("Hive's state (ok, failing, paused until a time, probing next) with the last error, in after_dark_settings and the settings API", async () => {
    const { cookie } = await admin();
    await setUp(cookie);
    const read = async () => {
      const mcp = await runAdultTool(t.db, "after_dark_settings", {});
      const api = await (await settingsGet(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { headers: { cookie } }))).json();
      if (!("data" in mcp)) throw new Error("no data");
      expect(api.hive).toEqual(mcp.data.hive);
      expect(api.pauses).toEqual(mcp.data.pauses);
      return { hive: mcp.data.hive as Record<string, unknown>, pauses: mcp.data.pauses as { what: string }[] };
    };
    expect(await read()).toEqual({ hive: { state: "ok", until: null, failures: 0, status: null, last_error: null, at: null, summary: "OK: answering" }, pauses: [] });
    await recordHiveFailure(t.db, COULDNT_RUN_429, 429);
    const failing = await read();
    expect(failing.hive).toMatchObject({ state: "failing", failures: 1, status: 429, last_error: COULDNT_RUN_429, until: null });
    expect(failing.pauses).toEqual([]);
    const until = (await recordHiveFailure(t.db, COULDNT_RUN_429, 429))!;
    const venice = new Date(now + 60_000).toISOString();
    await t.db.query(`insert into adult_media_cooldowns (provider, until, status, reason) values ('venice', $1, 429, 'Venice 429')`, [venice]);
    const paused = await read();
    expect(paused.hive).toMatchObject({ state: "paused", until, failures: 2, status: 429, last_error: COULDNT_RUN_429 });
    expect(paused.hive.summary).toBe(`Paused until ${pauseClock(until)}: nothing is drawn. Last error: ${COULDNT_RUN_429}`);
    expect(paused.pauses).toEqual([
      { what: "Venice", until: venice, active: true, status: 429, reason: "Venice 429" },
      { what: "Hive (the safety check)", until, active: true, status: 429, reason: COULDNT_RUN_429 },
    ]);
    now += HIVE_PAUSE_FIRST_MS + 1;
    expect((await read()).hive).toMatchObject({ state: "probe_next", until });
  });
});

describe("what the page says", () => {
  it("how long, and what happened to the tokens", () => {
    const at = Date.parse("2026-10-23T21:15:00.000Z");
    const until = new Date(at + 30 * MIN).toISOString();
    expect(hivePausedMessage(until, { now: at })).toBe("Hive (the safety check) has hit its limit, so nothing is drawn until it answers again (about 30 minutes). Your tokens are untouched.");
    expect(hivePausedMessage(until, { now: at, tokens: "back" })).toBe("Hive (the safety check) has hit its limit, so nothing is drawn until it answers again (about 30 minutes). Your tokens are back.");
    expect(hivePausedMessage(until, { now: at + 30 * MIN - 30_000, discarded: true })).toBe(
      "Hive (the safety check) has hit its limit, so this one couldn't be checked and wasn't kept, and nothing more is drawn until it answers again (about a minute).",
    );
    expect(hivePausedReason(until)).toBe("the check couldn't run (Hive is paused until 21:45 UTC)");
    expect(notDrawnReason(until)).toBe("not drawn: Hive is paused until 21:45 UTC");
    expect(hiveNoticeText({ until, status: 429 })).toBe("Pictures and videos are paused: Hive, the safety check, is refusing (429) until about 21:45 UTC.");
    expect(hiveNoticeText({ until, status: null })).toBe("Pictures and videos are paused: Hive, the safety check, is not answering until about 21:45 UTC.");
  });

  it("the scene page shows the notice by the picture and video controls, and disables them with it as the tooltip", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    await scene(cookie, id);
    const until = await pauseHive(t.db, COULDNT_RUN_429);
    expect(await hiveNotice(t.db)).toEqual({ until, status: 429 });
    const s = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene;
    const chars = [
      { id: RAFE, name: "Rafe", house: true, hue: null, portrait: null },
      { id: JUNIPER, name: "Juniper", house: true, hue: null, portrait: null },
    ] as const;
    const pic = { id: "pic", character_id: JUNIPER, character_b: null, kind: "scene" as const, status: "ready", created_at: new Date(now).toISOString(), mime: "image/png", clip: true };
    const notice = hiveNoticeText({ until, status: 429 });
    const html = renderToStaticMarkup(createElement(SceneWriter, { initial: s, gallery: [pic], characters: [...chars], hive: { until, status: 429 } }));
    // Once, right above the clip-or-picture menu (inside it the buttons are disabled with it as their tooltip).
    expect(html.split(`data-hive-paused="true">${notice}</p>`)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*title="${notice.replace(/[.()]/g, "\\$&").replace(/'/g, "&#x27;")}"[^>]*>Make it move`));
    const off = renderToStaticMarkup(createElement(SceneWriter, { initial: s, gallery: [pic], characters: [...chars], hive: null }));
    expect(off).not.toContain("data-hive-paused");
    expect(off).not.toContain("disabled=\"\" title=\"Pictures and videos are paused");
    await closeHiveBreaker(t.db);
    expect(await hiveNotice(t.db)).toBeNull();
  });
});
