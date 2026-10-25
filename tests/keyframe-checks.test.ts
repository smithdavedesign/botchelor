import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as mediaGet } from "@/app/api/admin/after-dark/media/[id]/route";
import { POST as picturesPost } from "@/app/api/admin/after-dark/pictures/route";
import { GET as reelGet, POST as reelPost } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { checkOutput, HIVE_MODERATION, HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { pairContent } from "@/lib/adult/graph";
import { baselinePrompt, makePicture, setMediaFetchForTests, signedMediaUrl } from "@/lib/adult/media";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { coverOptions } from "@/lib/adult/shorts";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Fewer Hive moderation requests a video (2026-10-23): a keyframe gets the age question alone, its shot keeps
// moderation, and a keyframe is never shown on its own before its shot has passed. Hive and Venice stubbed, no live calls.
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
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
  setReplicatePausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const PAIR = [RAFE, JUNIPER].sort() as [string, string];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.2 }] }] };
const CHILD_MOD = { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] };
const says = (answer: string) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ answer }) } }] });

/** Hive: `answer` decides a call (null: it passes, ADULTS); every call is recorded by which model it asked. */
function fakeHive(answer: (vlm: boolean, n: number) => unknown = () => null) {
  const calls: ("moderation" | "vlm")[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    if (!vlm && String(input) !== HIVE_MODERATION) return new Response("?", { status: 500 });
    calls.push(vlm ? "vlm" : "moderation");
    return Response.json(answer(vlm, calls.length - 1) ?? (vlm ? says("ADULTS") : CLEAN_MOD));
  });
  return calls;
}
/** Venice: keyframes, queued videos that are done on their first retrieve, and pictures. Records every path. */
function fakeVenice() {
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
  setMediaFetchForTests(async () => Response.json({ images: [Buffer.from(PNG).toString("base64")] }));
  return seen;
}
function director(shots = [{ line: 2 }, { line: 5 }, { line: 9 }]) {
  setAdultModelForTests({ complete: async () => JSON.stringify({ shots: shots.map((s) => ({ frame: "", motion: "", ...s })) }) } as never);
}
const night = Array.from({ length: 12 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage: 2 }));

/** After Dark on (Venice and Hive keys), both baselines in, and the admin's scene with a night of lines. */
async function ready(cookie: string, ownerId: string) {
  await call(
    settingsPost,
    "/api/admin/after-dark/settings",
    { enabled: true, image_provider: "venice", openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", reel_shots: 3, auto_scene_pictures: false },
    cookie,
  );
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const s = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [s.id, JSON.stringify(night)]);
}
const startReel = async (cookie: string) => (await (await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER }, cookie)).json()).reel as Reel;
const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;
const frames = async () => (await t.db.query<{ id: string }>(`select id from adult_images where kind = 'frame' order by created_at, id`)).rows.map((r) => r.id);
/** The owner's media route, with their session; or, with `signed`, a video provider's signed link (no session). */
const serve = (id: string, opts: { cookie?: string; signed?: boolean } = {}) =>
  mediaGet(new Request(opts.signed ? signedMediaUrl(id, BASE_URL) : `${BASE_URL}/api/admin/after-dark/media/${id}`, { headers: opts.cookie ? { cookie: opts.cookie } : {} }), {
    params: Promise.resolve({ id }),
  });

describe("a video's keyframes and shots", () => {
  it("each keyframe gets the age question and no moderation; each shot's video gets moderation", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const venice = fakeVenice();
    const calls = fakeHive();
    director();
    const started = await startReel(cookie);
    expect(started.shots.map((s) => s.status)).toEqual(["queued", "queued", "queued"]);
    expect(calls).toEqual(["vlm", "vlm", "vlm"]);
    expect(venice.filter((p) => p === "/video/queue")).toHaveLength(3);
    calls.length = 0;
    await advance(started.id, cookie);
    const done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(calls).toEqual(["moderation", "moderation", "moderation"]);
    // Three shots: three moderation requests in all (the self-serve cap's unit), where it used to be six.
  });

  it("a keyframe the age question doesn't call ADULTS is refused: never kept, logged, and no video starts from it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const venice = fakeVenice();
    fakeHive((vlm, n) => (vlm && n === 0 ? says("UNSURE") : null));
    director();
    const started = await startReel(cookie);
    expect(started.shots.map((s) => s.status)).toEqual(["discarded", "queued", "queued"]);
    expect(started.shots[0].reason).toBe("age check: UNSURE");
    expect(await frames()).toHaveLength(2);
    expect(venice.filter((p) => p === "/video/queue")).toHaveLength(2);
    expect((await t.db.query<{ reason: string }>(`select reason from adult_rejections`)).rows.map((r) => r.reason)).toEqual(["keyframe: age check: UNSURE"]);
  });

  it("the age-only check still fails closed: anything but ADULTS, or no reply, refuses", async () => {
    for (const [reply, reason] of [
      [says("MINOR"), "age check: MINOR"],
      [{ choices: [{ message: { content: "" } }] }, "age check: no answer"],
    ] as const) {
      const calls = fakeHive((vlm) => (vlm ? reply : null));
      expect(await checkOutput("placeholder-hive", { base64: "aGVsbG8=", mime: "image/png" }, "keyframe")).toEqual({ ok: false, reason });
      expect(calls).toEqual(["vlm"]);
    }
    setCheckFetchForTests(async () => new Response("down", { status: 503 }));
    expect(await checkOutput("placeholder-hive", { base64: "aGVsbG8=", mime: "image/png" }, "keyframe")).toMatchObject({ ok: false, reason: expect.stringMatching(/^the check couldn't run/) });
  });
});

describe("a keyframe is shown on its own only once its shot has passed", () => {
  it("not on the media route, as a Short's cover or in the admin's pair view before; a video provider still gets it to start from", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    director([{ line: 2 }]);
    const started = await startReel(cookie);
    const frame = started.shots[0].frame_id!;
    expect(started.shots[0].status).toBe("queued");
    expect(await frames()).toContain(frame);
    // Before its shot is in: hidden from the owner, but the provider's signed link works.
    expect((await serve(frame, { cookie })).status).toBe(404);
    expect((await serve(frame, { signed: true })).status).toBe(200);
    expect((await coverOptions(t.db, id, PAIR)).map((c) => c.id)).not.toContain(frame);
    expect((await pairContent(t.db, ...PAIR))!.pictures.map((p) => p.id)).not.toContain(frame);
    // Its shot passed moderation and is kept: now it's the shot's poster, a cover and in the pair view.
    let done = await advance(started.id, cookie);
    while (done.status === "making") done = await advance(started.id, cookie);
    expect(done.status).toBe("ready");
    expect(done.shots[0]).toMatchObject({ status: "ready", frame_id: frame });
    expect((await serve(frame, { cookie })).status).toBe(200);
    expect((await coverOptions(t.db, id, PAIR)).map((c) => c.id)).toContain(frame);
    expect((await pairContent(t.db, ...PAIR))!.pictures.map((p) => p.id)).toContain(frame);
  });

  it("but in a draft storyboard of the owner's, before any video, the owner sees it (not another admin)", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    director([{ line: 2 }]);
    // Plan a storyboard, then draw its pictures — a draft, no video.
    const plan = (await (await call(reelPost, "/api/admin/after-dark/reel", { a: RAFE, b: JUNIPER, action: "plan" }, cookie)).json()).reel as Reel;
    expect(plan.status).toBe("draft");
    expect(plan.shots[0].status).toBe("planned");
    const drawn = (await (await call(reelPost, "/api/admin/after-dark/reel", { action: "draw", id: plan.id }, cookie)).json()).reel as Reel;
    expect(drawn.status).toBe("draft");
    expect(drawn.shots[0].status).toBe("frame_ready");
    const frame = drawn.shots[0].frame_id!;
    // The owner checks the picture in their own storyboard before filming; no video exists yet.
    expect((await serve(frame, { cookie })).status).toBe(200);
    // It's still not a cover (no video has passed), and another admin can't see it: it's not their draft.
    expect((await coverOptions(t.db, id, PAIR)).map((c) => c.id)).not.toContain(frame);
    const other = await admin();
    expect((await serve(frame, { cookie: other.cookie })).status).toBe(404);
  });

  it("never, when moderation discards its shot", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    director([{ line: 2 }]);
    fakeHive();
    const started = await startReel(cookie);
    const frame = started.shots[0].frame_id!;
    expect(await frames()).toContain(frame);
    fakeHive(() => CHILD_MOD);
    let done = await advance(started.id, cookie);
    while (done.status === "making") done = await advance(started.id, cookie);
    expect(done.shots[0]).toMatchObject({ status: "discarded", frame_id: frame });
    expect((await serve(frame, { cookie })).status).toBe(404);
    expect((await coverOptions(t.db, id, PAIR)).map((c) => c.id)).not.toContain(frame);
    expect((await pairContent(t.db, ...PAIR))!.pictures.map((p) => p.id)).not.toContain(frame);
  });
});

describe("what doesn't change", () => {
  it("a picture shown as a still (a baseline, a menu picture) still gets moderation and the age question", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    await t.db.query(`delete from adult_images where id = 'base-juniper'`);
    let calls = fakeHive();
    const juniper = (await loadCharacter(t.db, JUNIPER))!;
    expect((await makePicture(t.db, id, { prompt: baselinePrompt(juniper, id), kind: "baseline", character_id: JUNIPER })).status).toBe("ready");
    expect(calls).toEqual(["moderation", "vlm"]);
    calls = fakeHive();
    const res = await call(picturesPost, "/api/admin/after-dark/pictures", { a: RAFE, b: JUNIPER, act: "kiss", outfit: "tonight", framing: "medium", place: "her bedroom" }, cookie);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["moderation", "vlm"]);
  });
});
