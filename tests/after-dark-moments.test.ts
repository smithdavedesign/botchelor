import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as momentsPost } from "@/app/api/admin/after-dark/moments/route";
import { GET as reelGet } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { SEAMLESS_RUN_MAX } from "@/lib/adult/clips";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { deriveClip, saveMoment } from "@/lib/adult/moments";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { runFfmpeg, videoDuration } from "@/lib/media-tools/ffmpeg";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// A clip's moments (lib/adult/moments.ts) and Keep going from here (lib/adult/clips.ts): the real ffmpeg on a real
// little clip, the providers and Hive faked.
let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  // 3 s of a moving test pattern: what a provider's finished video stands in for.
  const { files } = await runFfmpeg({
    args: ["-f", "lavfi", "-i", "testsrc2=duration=3:size=240x320:rate=24", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"],
    inputs: {},
    outputs: ["clip.mp4"],
  });
  MP4 = files["clip.mp4"];
}, 60_000);
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
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
  setReplicatePausesForTests(true);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
const CHILD_MOD = { output: [{ classes: [{ class: "no_child_present", value: 0.5 }, { class: "yes_child_present", value: 0.5 }] }] };
const ADULTS = { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] };
/** Hive: everything passes unless `refuse` answers; records which check each call was. */
function fakeHive(refuse: (vlm: boolean) => unknown = () => null) {
  const seen: string[] = [];
  setCheckFetchForTests(async (input: RequestInfo | URL) => {
    const vlm = String(input) === HIVE_VLM;
    seen.push(vlm ? "vlm" : "moderation");
    const custom = refuse(vlm);
    return Response.json(custom ?? (vlm ? ADULTS : CLEAN_MOD));
  });
  return seen;
}
/** Venice: keyframes, queues, and a shot that's done at once, as a real MP4. */
function fakeVenice() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  let q = 0;
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ path, body });
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ model: body.model, queue_id: `q${++q}` });
    if (path === "/video/retrieve") return new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } });
    return new Response("?", { status: 500 });
  });
  return seen;
}
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+)/)?.[1];

/** After Dark on, both baselines in, and the pair's night at sex in her bedroom. */
async function ready(cookie: string, ownerId: string) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const res = await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }));
  const scene = (await res.json()).scene as { id: string };
  const lines = Array.from({ length: 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `*leans closer* Line number ${i} is said quite softly here.`, stage: 2 }));
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = 2, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [scene.id, JSON.stringify(lines)]);
}
const clip = (cookie: string, body: Record<string, unknown>) => call(clipsPost, "/api/admin/after-dark/clips", body, cookie);
const moments = (cookie: string, body: Record<string, unknown>) => call(momentsPost, "/api/admin/after-dark/moments", body, cookie);
/** Keep going from a moment: its frame cut first (the moments route), then the clip from it (the clips route). */
async function keepFrom(cookie: string, reelId: string, mediaId: string, at: number | "end", extra: Record<string, unknown> = {}) {
  const cut = await moments(cookie, { action: "frame", media_id: mediaId, at });
  if (cut.status !== 200) return cut;
  const frame = (await cut.json()).frame as { id: string };
  return clip(cookie, { continue: reelId, media_id: mediaId, frame_id: frame.id, ...extra });
}
const advance = async (id: string, cookie: string) => (await (await reelGet(new Request(`${BASE_URL}/api/admin/after-dark/reel?id=${id}`, { headers: { cookie } }))).json()).reel as Reel;
/** A clip of the two of them kissing, made and collected: its reel, and its video's id. */
async function kissClip(cookie: string): Promise<{ reel: Reel; video: string }> {
  const first = (await (await clip(cookie, { a: RAFE, b: JUNIPER, act: "kiss" })).json()).reel as Reel;
  const reel = await advance(first.id, cookie);
  expect(reel.status).toBe("ready");
  return { reel, video: reel.shots[0].media_id! };
}

describe("save this moment", () => {
  it("keeps the frame at the second paused on as a checked picture of the two of them, with the clip's tags", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    const hive = fakeHive();
    const { video } = await kissClip(cookie);
    hive.length = 0;
    const res = await moments(cookie, { action: "save", media_id: video, at: 1.5 });
    expect(res.status).toBe(200);
    const media = (await res.json()).media as { id: string; kind: string; character_id: string; character_b: string; moment_at: number; from_clip: string };
    expect(media).toMatchObject({ kind: "scene", moment_at: 1.5, from_clip: video });
    expect([media.character_id, media.character_b].sort()).toEqual([JUNIPER, RAFE].sort());
    // Checked like any picture: moderation and the age question.
    expect(hive).toEqual(["moderation", "vlm"]);
    const row = (await t.db.query<{ mime: string; level: number; source_image: string }>(`select mime, level, source_image from adult_images where id = $1`, [media.id])).rows[0];
    expect(row).toMatchObject({ mime: "image/png", source_image: video });
    // The clip's tags: who and what, and how far it goes (a kiss: suggestive at most).
    const tags = (await t.db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 and kind in ('who', 'act')`, [media.id])).rows;
    expect(tags).toEqual(expect.arrayContaining([{ kind: "who", value: "pair" }, { kind: "act", value: "kiss" }]));
    expect(row.level).toBeLessThanOrEqual(2);
    // The same moment again (within a frame) is the one already kept: no second check.
    const again = (await (await moments(cookie, { action: "save", media_id: video, at: 1.52 })).json()).media as { id: string };
    expect(again.id).toBe(media.id);
    expect(hive).toHaveLength(2);
  });

  it("keeps nothing the check refuses, and only for the clip's owner", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const { video } = await kissClip(cookie);
    fakeHive((vlm) => (vlm ? null : CHILD_MOD));
    const res = await moments(cookie, { action: "save", media_id: video, at: 1 });
    expect(res.status).toBe(422);
    expect((await t.db.query(`select 1 from adult_images where source_image = $1 and kind = 'scene'`, [video])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from adult_rejections where kind = 'moment'`)).rows).toHaveLength(1);
    // Another admin can watch it, but cutting it is its owner's.
    expect((await moments((await admin()).cookie, { action: "save", media_id: video, at: 1 })).status).toBe(404);
    expect((await moments((await admin()).cookie, { action: "boomerang", media_id: video })).status).toBe(404);
  });

  it("is capped by the month's moments for someone who isn't an admin", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const { video } = await kissClip(cookie);
    const someone = userIdOf(newUserCookie());
    await t.db.query(`update adult_images set owner_id = $2 where id = $1`, [video, someone]);
    await t.db.query(`update adult_settings set cap_moments = 0 where id = 1`);
    const r = await saveMoment(t.db, someone, video, 1);
    expect(r).toMatchObject({ ok: false, status: 429 });
  });
});

describe("a boomerang and a loop", () => {
  it("are new videos of the clip's own frames, unchecked, made once per trim", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    const hive = fakeHive();
    const { video } = await kissClip(cookie);
    hive.length = 0;
    const boom = (await (await moments(cookie, { action: "boomerang", media_id: video })).json()).media as { id: string; kind: string; derived: string; from_clip: string };
    expect(boom).toMatchObject({ kind: "video", derived: "boomerang", from_clip: video });
    const bytes = (await t.db.query<{ data: Buffer }>(`select data from adult_images where id = $1`, [boom.id])).rows[0].data;
    expect(await videoDuration(Buffer.from(bytes))).toBeCloseTo(6, 0);
    const loop = (await (await moments(cookie, { action: "loop", media_id: video })).json()).media as { id: string; derived: string };
    expect(loop.derived).toBe("loop");
    // Nothing new was checked: they're the clip's own frames.
    expect(hive).toEqual([]);
    // The same again is the one made; a new trim makes a new one; a boomerang isn't made from a boomerang.
    expect(((await (await moments(cookie, { action: "boomerang", media_id: video })).json()).media as { id: string }).id).toBe(boom.id);
    await t.db.query(`update adult_images set trim = $2::jsonb where id = $1`, [video, JSON.stringify({ start: 0.5, end: 2.5, cuts: [] })]);
    const trimmed = await deriveClip(t.db, id, video, "boomerang");
    expect(trimmed.ok && trimmed.media.id).not.toBe(boom.id);
    expect((await moments(cookie, { action: "loop", media_id: boom.id })).status).toBe(409);
  });
});

describe("keep going from here", () => {
  it("starts straight from the clip's last frame (seamless): nothing drawn, the video queued from the cut frame", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    const hive = fakeHive();
    const { reel, video } = await kissClip(cookie);
    hive.length = 0;
    seen.length = 0;
    const res = await keepFrom(cookie, reel.id, video, "end");
    expect(res.status).toBe(200);
    const next = (await res.json()).reel as Reel;
    expect(next.clip).toMatchObject({ from: reel.id, cut: { video, seamless: true } });
    expect(next.clip!.cut!.at).toBeCloseTo(2.92, 1);
    expect(seen.some((s) => s.path === "/image/multi-edit")).toBe(false);
    const queued = seen.find((s) => s.path === "/video/queue")!;
    const frame = mediaOf(queued.body.image_url)!;
    expect(next.shots[0]).toMatchObject({ from_cut: true, frame_id: frame });
    const row = (await t.db.query<{ kind: string; source_image: string; moment_at: number }>(`select kind, source_image, moment_at from adult_images where id = $1`, [frame])).rows[0];
    expect(row).toMatchObject({ kind: "frame", source_image: video });
    // The cut frame got the age question, like any keyframe.
    expect(hive).toEqual(["vlm"]);
  });

  it("from fresh faces: a new keyframe of their faces, posed like the cut frame (Picture 3)", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    const { reel, video } = await kissClip(cookie);
    seen.length = 0;
    const next = (await (await keepFrom(cookie, reel.id, video, 1.2, { mode: "fresh" })).json()).reel as Reel;
    expect(next.clip!.cut).toMatchObject({ at: 1.2, seamless: false });
    const edit = seen.find((s) => s.path === "/image/multi-edit")!;
    const pictures = (edit.body.images as string[]).map(mediaOf);
    expect(pictures.slice(0, 2)).toEqual(["base-juniper", "base-rafe"]);
    expect((await t.db.query<{ moment_at: number }>(`select moment_at from adult_images where id = $1`, [pictures[2]])).rows[0].moment_at).toBeCloseTo(1.2, 2);
    expect(String(edit.body.prompt)).toMatch(/together, at the very moment in Picture 3\./);
  });

  it(`draws every link after ${SEAMLESS_RUN_MAX} seamless ones from fresh faces, and says so`, async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    let from = (await kissClip(cookie)).reel;
    for (let k = 0; k < SEAMLESS_RUN_MAX; k++) {
      const next = (await (await keepFrom(cookie, from.id, from.shots[0].media_id!, "end")).json()).reel as Reel;
      expect(next.clip!.cut!.seamless).toBe(true);
      from = await advance(next.id, cookie);
    }
    seen.length = 0;
    const res = await (await keepFrom(cookie, from.id, from.shots[0].media_id!, "end")).json();
    expect((res.reel as Reel).clip!.cut!.seamless).toBe(false);
    expect(res.note).toMatch(/fresh picture of their faces/);
    expect(seen.some((s) => s.path === "/image/multi-edit")).toBe(true);
  });

  it("keeps going from a shot of a night's video too: a new clip of its own", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const { reel, video } = await kissClip(cookie);
    // The clip as if it were a shot of the night's video.
    await t.db.query(`update adult_reels set kind = 'night', clip = null where id = $1`, [reel.id]);
    const res = await keepFrom(cookie, reel.id, video, 2);
    expect(res.status).toBe(200);
    const next = (await res.json()).reel as Reel;
    expect(next.clip).toMatchObject({ from: null, label: "Kept going", cut: { video, seamless: true } });
    // A shot that isn't in that video isn't kept going from; nor is a frame once a clip has started from it.
    expect((await clip(cookie, { continue: reel.id, media_id: "not-a-shot", frame_id: next.shots[0].frame_id })).status).toBe(404);
    expect((await advance(next.id, cookie)).status).toBe("ready");
    expect((await clip(cookie, { continue: reel.id, media_id: video, frame_id: next.shots[0].frame_id })).status).toBe(404);
  });
});

describe("the moments' buttons", () => {
  it("offer a still, a boomerang and a loop on any clip, and Keep going from here (with its price) on a shot of a video", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: MomentTools } = await import("@/app/after-dark/MomentTools");
    const bare = renderToStaticMarkup(createElement(MomentTools, { mediaId: "v1", now: () => 0 }));
    expect(bare).toContain("📸 Save this moment");
    expect(bare).toContain("↔ Boomerang");
    expect(bare).toContain("∞ Loop");
    expect(bare).not.toContain("Keep going");
    const shot = renderToStaticMarkup(createElement(MomentTools, { mediaId: "v1", now: () => 0, keepGoing: { reelId: "r1", price: 3, onReel: () => {} } }));
    expect(shot).toContain("▶▶ Keep going from here · 3 tokens");
    expect(shot).toContain('aria-pressed="true"');
    expect(shot).toMatch(/Seamless[\s\S]*Fresh faces/);
  });
});
