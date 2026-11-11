import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/after-dark/route";
import { POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as momentsPost } from "@/app/api/admin/after-dark/moments/route";
import { GET as reelGet } from "@/app/api/admin/after-dark/reel/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { NEXT_WORDS_MAX, SEAMLESS_RUN_MAX } from "@/lib/adult/clips";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { deriveClip, joinsSettled, saveMoment } from "@/lib/adult/moments";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import { setReplicatePausesForTests } from "@/lib/adult/replicate";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { runFfmpeg, videoDuration, videoInfo } from "@/lib/media-tools/ffmpeg";
import { publish, saveCreatorProfile } from "@/lib/showcase";
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
const mediaOf = (url: unknown) => String(url).match(/media\/([^?]+?)(?:\.png)?(?:\?|$)/)?.[1];

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

describe("a chain of clips posted as one reel", () => {
  /** Asks for the join, lets it be made in the background, and asks again: the video. */
  async function join(cookie: string, ids: string[]) {
    const first = await moments(cookie, { action: "join", media_ids: ids });
    if (first.status !== 202) return first;
    await joinsSettled();
    return moments(cookie, { action: "join", media_ids: ids });
  }
  const bytesOf = async (mediaId: string) => Buffer.from((await t.db.query<{ data: Buffer }>(`select data from adult_images where id = $1`, [mediaId])).rows[0].data);

  it("joins the clips, each as its trim keeps it, into one video: unchecked, made once, and posted as a reel", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    const hive = fakeHive();
    const one = (await kissClip(cookie)).video;
    const two = (await kissClip(cookie)).video;
    await t.db.query(`update adult_images set trim = $2::jsonb where id = $1`, [two, JSON.stringify({ start: 1, end: null, cuts: [] })]);
    hive.length = 0;
    const started = await moments(cookie, { action: "join", media_ids: [one, two] });
    expect(started.status).toBe(202);
    const pending = (await started.json()) as { making: boolean; id: string };
    expect(pending.making).toBe(true);
    // Asked again while it's being made: the same one, still making; out of every gallery till it's in.
    expect(((await (await moments(cookie, { action: "join", media_ids: [one, two] })).json()) as { id: string }).id).toBe(pending.id);
    expect((await t.db.query<{ status: string }>(`select status from adult_images where id = $1`, [pending.id])).rows[0].status).toBe("pending");
    await joinsSettled();
    const res = await moments(cookie, { action: "join", media_ids: [one, two] });
    expect(res.status).toBe(200);
    const reel = (await res.json()).media as { id: string; kind: string; derived: string; from_clip: string; character_id: string; character_b: string };
    expect(reel).toMatchObject({ id: pending.id, kind: "video", derived: "chain", from_clip: two });
    expect([reel.character_id, reel.character_b].sort()).toEqual([JUNIPER, RAFE].sort());
    // 3 s and the 2 s the second one's trim keeps; silent, as both clips are; nothing new checked.
    const info = await videoInfo(await bytesOf(reel.id));
    expect(info.duration).toBeCloseTo(5, 0);
    expect(info.audio).toBe(false);
    expect(hive).toEqual([]);
    // Their tags, together.
    const tags = (await t.db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 and kind in ('who', 'act')`, [reel.id])).rows;
    expect(tags).toEqual(expect.arrayContaining([{ kind: "who", value: "pair" }, { kind: "act", value: "kiss" }]));
    // The same chain again is the one made; another order is another reel.
    expect(((await (await moments(cookie, { action: "join", media_ids: [one, two] })).json()).media as { id: string }).id).toBe(reel.id);
    // Not a reel of a reel, and two clips at least.
    expect((await moments(cookie, { action: "join", media_ids: [reel.id, one] })).status).toBe(409);
    expect((await moments(cookie, { action: "join", media_ids: [one] })).status).toBe(422);
    // Posted on the showcase like any clip, as a reel.
    await saveCreatorProfile(t.db, id, { handle: "chainmaker", display_name: "Chain" });
    const post = await publish(t.db, id, { source: "after_dark", media_id: reel.id });
    expect(post).toMatchObject({ ok: true, status: "live" });
    const row = (await t.db.query<{ medium: string }>(`select medium from showcase_posts where media_id = $1`, [reel.id])).rows[0];
    expect(row.medium).toBe("reel");
  });

  it("plays a silent shot's voice in its place, the last frame held while a longer line finishes", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const first = await kissClip(cookie);
    const two = (await kissClip(cookie)).video;
    const { files } = await runFfmpeg({ args: ["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-y", "voice.wav"], inputs: {}, outputs: ["voice.wav"] });
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('voice-1', $1, $2, 'audio', 'a line', 'audio/wav', $3, 'ready')`, [id, RAFE, files["voice.wav"]]);
    const shots = first.reel.shots.map((s) => ({ ...s, audio_id: "voice-1" }));
    await t.db.query(`update adult_reels set shots = $2::jsonb where id = $1`, [first.reel.id, JSON.stringify(shots)]);
    const reel = (await (await join(cookie, [first.video, two])).json()).media as { id: string };
    const info = await videoInfo(await bytesOf(reel.id));
    // The 4 s line holds the 3 s clip a second longer; then the second clip, silent.
    expect(info.duration).toBeCloseTo(7, 0);
    expect(info.audio).toBe(true);
  });

  it("says once why a join failed, and tries again when asked again", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const one = (await kissClip(cookie)).video;
    const two = (await kissClip(cookie)).video;
    await t.db.query(`update adult_images set data = $2 where id = $1`, [two, Buffer.from("not a video")]);
    const res = await join(cookie, [one, two]);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toMatch(/couldn't be joined/);
    expect((await t.db.query(`select 1 from adult_images where derived = 'chain' and status = 'ready'`)).rows).toHaveLength(0);
    expect((await moments(cookie, { action: "join", media_ids: [one, two] })).status).toBe(202);
    await joinsSettled();
  });

  it("joins only the owner's own clips of one pair: shots of one of them alone go with the two of them, a third person doesn't", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const one = (await kissClip(cookie)).video;
    const two = (await kissClip(cookie)).video;
    const three = (await kissClip(cookie)).video;
    expect((await moments((await admin()).cookie, { action: "join", media_ids: [one, two] })).status).toBe(404);
    // A night's film: a shot of one of them alone first, then the two of them; the reel is the pair's.
    const pairOf = (await t.db.query<{ character_id: string; character_b: string }>(`select character_id, character_b from adult_images where id = $1`, [two])).rows[0];
    await t.db.query(`update adult_images set character_id = $2, character_b = null where id = $1`, [one, pairOf.character_b]);
    const res = await join(cookie, [one, two]);
    expect(res.status).toBe(200);
    const reel = (await res.json()).media as { character_id: string; character_b: string };
    expect([reel.character_id, reel.character_b]).toEqual([pairOf.character_id, pairOf.character_b]);
    // Someone else in one of them: not one pair.
    await t.db.query(`update adult_images set character_b = $2 where id = $1`, [three, HOUSE_CHARACTERS[2].id]);
    expect((await moments(cookie, { action: "join", media_ids: [two, three] })).status).toBe(422);
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

describe("keep going, in the owner's own words", () => {
  /** The director (the text model): what it was asked, and the motion it writes. */
  function director(motion = "She draws him closer by his collar and kisses him slowly.") {
    const asked: string[] = [];
    setAdultModelForTests({
      complete: async (messages) => {
        asked.push(messages.map((m) => String(m.content)).join("\n"));
        return JSON.stringify({ motion });
      },
    });
    return asked;
  }

  it("refuses words past the lines, their limits or how far the clip has gone, before the director or a draw; the director writes the motion from words that fit", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    const seen = fakeVenice();
    fakeHive();
    const { reel, video } = await kissClip(cookie);
    const asked = director();
    seen.length = 0;
    const refused = async (prompt: string) => {
      const res = await clip(cookie, { continue: reel.id, prompt });
      expect(res.status).toBe(422);
      return ((await res.json()) as { message: string }).message;
    };
    expect(await refused("they kiss like teenagers")).toBe("Those words cross one of the lines After Dark never crosses.");
    await t.db.query(`update adult_scenes set hard_nos = $1::jsonb`, [JSON.stringify({ chips: ["pain"], own: [] })]);
    expect(await refused("a playful spank")).toBe("That's past the limits you've set for these two: crossed a hard limit (Pain).");
    expect(await refused("they undress each other")).toBe("That goes further than they've got so far: this clip goes as far as kissing.");
    // Asked first with the words (the page does, before it cuts a frame for them): refused at once, or ready, nothing made.
    const clips = async () => (await t.db.query(`select 1 from adult_reels where kind = 'clip'`)).rows.length;
    const made = await clips();
    const check = (prompt: string) => clip(cookie, { continue: reel.id, media_id: video, prompt, check: true });
    expect((await check("they kiss like teenagers")).status).toBe(422);
    const fine = await check("she pulls him closer by his collar");
    expect([fine.status, await fine.json()]).toEqual([200, { ready: true }]);
    expect(await clips()).toBe(made);
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
    expect((await clip(cookie, { continue: reel.id, prompt: "x".repeat(NEXT_WORDS_MAX + 1) })).status).toBe(422);
    // Words that fit: the director is asked for them, from where the shot left them; the clip keeps them.
    const res = await keepFrom(cookie, reel.id, video, "end", { prompt: "she pulls him closer by his collar" });
    expect(res.status).toBe(200);
    const next = (await res.json()).reel as Reel;
    expect(next.clip).toMatchObject({ prompt: "she pulls him closer by his collar", cut: { video, seamless: true } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('What the viewer wants to happen next, in their own words: "She pulls him closer by his collar"');
    expect(asked[0]).toContain("no further than kissing");
    expect(next.shots[0].motion).toBe("She draws him closer by his collar and kisses him slowly.");
    // The next link from it doesn't carry them on: each link's words are its own.
    const after = await advance(next.id, cookie);
    const again = (await (await keepFrom(cookie, after.id, after.shots[0].media_id!, "end")).json()).reel as Reel;
    expect(again.clip!.prompt).toBeUndefined();
  });

  it("somewhere public, goes no further than kissing; without words, just as before", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id);
    fakeVenice();
    fakeHive();
    const { reel } = await kissClip(cookie);
    const asked = director();
    await t.db.query(`update adult_reels set clip = jsonb_set(clip, '{place}', '"the bar"') where id = $1`, [reel.id]);
    const res = await clip(cookie, { continue: reel.id, prompt: "she unbuttons his shirt" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toBe("Nothing past kissing somewhere public: that waits until they're somewhere private.");
    // Blank words are no words: the act's own next motion, no director.
    const plain = await clip(cookie, { continue: reel.id, prompt: "   " });
    expect(plain.status).toBe(200);
    expect(((await plain.json()).reel as Reel).clip!.prompt).toBeUndefined();
    expect(asked).toEqual([]);
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
    const shot = renderToStaticMarkup(createElement(MomentTools, { mediaId: "v1", now: () => 0, keepGoing: { reelId: "r1", price: "1 token", onReel: () => {} } }));
    expect(shot).toContain("▶▶ Keep going from here · 1 token");
    // A subscriber's included clip (#1005): the price in words, as Reels.tsx useClipPrice gives it.
    const included = renderToStaticMarkup(createElement(MomentTools, { mediaId: "v1", now: () => 0, keepGoing: { reelId: "r1", price: "included (2 of 3 clips left this month)", onReel: () => {} } }));
    expect(included).toContain("▶▶ Keep going from here · included (2 of 3 clips left this month)");
    expect(shot).toContain('aria-pressed="true"');
    expect(shot).toMatch(/Seamless[\s\S]*Fresh faces/);
    // What happens next, in their own words: optional, as long as a picture's What's happening.
    expect(shot).toContain('placeholder="What happens next? Optional, in your own words"');
    expect(shot).toMatch(new RegExp(`maxlength="${NEXT_WORDS_MAX}"`, "i"));
    expect(bare).not.toContain("What happens next");
  });
});
