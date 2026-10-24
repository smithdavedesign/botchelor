import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as baselinesPost } from "@/app/api/admin/after-dark/baselines/route";
import { POST as facePost } from "@/app/api/admin/after-dark/face/route";
import { POST as ratePost } from "@/app/api/admin/after-dark/rate/route";
import { POST as steerPost } from "@/app/api/admin/after-dark/steer/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { baselinePrompt, drawBaselineChoices, listMedia, makePicture, setMediaFetchForTests } from "@/lib/adult/media";
import { PICTURE_PRESETS, TAG_FIXES } from "@/lib/adult/rating-tags";
import { baselines } from "@/lib/adult/reels";
import {
  betaSample,
  choosePreset,
  faceReferenceId,
  facesFor,
  NO_STEERING,
  presetTally,
  rateMedia,
  resetSteering,
  setFaceReference,
  steerSummary,
  steeringFor,
  STEER_WINDOW,
  withSteering,
} from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Ratings that steer a viewer's own next pictures and videos (lib/adult/steering.ts, David 2026-10-24). Providers stubbed.
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
  setSeasonCastForTests(null);
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
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
async function subscriber() {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signedIn(id) };
}
const setUp = (cookie: string) =>
  call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, image_provider: "venice", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CLEAN_MOD = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] };
function fakeHive() {
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] } : CLEAN_MOD),
  );
}
/** Venice's picture endpoint: every call answered with a picture, each one's prompt and negative prompt kept. */
function fakeVenice() {
  const asked: { prompt: string; negative_prompt: string }[] = [];
  setMediaFetchForTests(async (_input: RequestInfo | URL, init?: RequestInit) => {
    asked.push(JSON.parse(String(init?.body ?? "{}")));
    return Response.json({ images: [Buffer.from(PNG).toString("base64")] });
  });
  return asked;
}

let n = 0;
/** A ready picture (or video) straight into the table: `ago` minutes old. */
async function picture(owner: string, character: string, opts: { kind?: string; b?: string | null; ago?: number; preset?: string | null; status?: string } = {}) {
  const id = `img-${++n}`;
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, preset, created_at) values ($1, $2, $3, $4, $5, 'p', $6, $7, $8, $9, now() - make_interval(mins => $10))`,
    [id, owner, character, opts.b ?? null, opts.kind ?? "baseline", opts.kind === "video" ? "video/mp4" : "image/png", Buffer.from(PNG), opts.status ?? "ready", opts.preset ?? null, opts.ago ?? 0],
  );
  return id;
}
/** A rating made `ago` minutes ago (steeringFor reads the newest). */
async function rateAt(viewer: string, id: string, r: -1 | 1, tags: string[], ago: number) {
  expect((await rateMedia(t.db, viewer, id, r, tags)).ok).toBe(true);
  await t.db.query(`update adult_media_thumbs set updated_at = now() - make_interval(mins => $3) where owner_id = $1 and media_id = $2`, [viewer, id, ago]);
}

describe("rating a picture or video", () => {
  it("keeps 👍 or 👎 with what was off (only the tags its kind has, never on a 👍), and 0 takes it back", async () => {
    const { id } = await admin();
    const pic = await picture(id, JUNIPER);
    expect(await rateMedia(t.db, id, pic, -1, ["face", "blurry", "face", "motion", "nonsense"])).toEqual({ ok: true, rating: -1, tags: ["face", "blurry"] });
    expect(await rateMedia(t.db, id, pic, 1, ["face"])).toEqual({ ok: true, rating: 1, tags: [] });
    const vid = await picture(id, JUNIPER, { kind: "video", b: RAFE });
    expect(await rateMedia(t.db, id, vid, -1, ["motion", "outfit"])).toEqual({ ok: true, rating: -1, tags: ["motion"] });
    expect((await t.db.query(`select 1 from adult_media_thumbs where owner_id = $1`, [id])).rows).toHaveLength(2);
    expect(await rateMedia(t.db, id, pic, 0)).toEqual({ ok: true, rating: 0, tags: [] });
    expect((await t.db.query(`select media_id from adult_media_thumbs where owner_id = $1`, [id])).rows).toEqual([{ media_id: vid }]);
  });

  it("is theirs only: someone else's picture, one not ready, or a keyframe is not found; an admin can rate any", async () => {
    const owner = await subscriber();
    const other = await subscriber();
    const pic = await picture(owner.id, JUNIPER);
    expect(await rateMedia(t.db, other.id, pic, 1)).toMatchObject({ ok: false, status: 404 });
    expect(await rateMedia(t.db, owner.id, await picture(owner.id, JUNIPER, { status: "pending" }), 1)).toMatchObject({ ok: false, status: 404 });
    expect(await rateMedia(t.db, owner.id, await picture(owner.id, JUNIPER, { kind: "frame", b: RAFE }), 1)).toMatchObject({ ok: false, status: 404 });
    const { id: adminId } = await admin();
    expect(await rateMedia(t.db, adminId, pic, -1, ["body"])).toMatchObject({ ok: true, rating: -1 });
    // Each viewer's own: the owner's rating is unaffected by the admin's.
    expect((await t.db.query(`select owner_id from adult_media_thumbs`)).rows).toEqual([{ owner_id: adminId }]);
  });

  it("goes when the picture does", async () => {
    const { id } = await admin();
    const pic = await picture(id, JUNIPER);
    await rateMedia(t.db, id, pic, -1, ["face"]);
    await t.db.query(`delete from adult_images where id = $1`, [pic]);
    expect((await t.db.query(`select 1 from adult_media_thumbs`)).rows).toHaveLength(0);
  });

  it("over its route: hidden from anyone After Dark isn't open to, a 404 for another's picture, the rating back", async () => {
    const owner = await subscriber();
    await setUp((await admin()).cookie);
    const pic = await picture(owner.id, JUNIPER);
    const stranger = signedIn(userIdOf(newUserCookie()));
    expect((await call(ratePost, "/api/admin/after-dark/rate", { media_id: pic, rating: 1 }, stranger)).status).toBe(404);
    expect((await call(ratePost, "/api/admin/after-dark/rate", { media_id: pic, rating: 1 }, (await subscriber()).cookie)).status).toBe(404);
    expect((await call(ratePost, "/api/admin/after-dark/rate", { media_id: pic, rating: 2 }, owner.cookie)).status).toBe(422);
    const res = await call(ratePost, "/api/admin/after-dark/rate", { media_id: pic, rating: -1, tags: ["outfit", "voice"] }, owner.cookie);
    expect(await res.json()).toEqual({ rating: -1, tags: ["outfit"] });
  });
});

describe("what the ratings steer", () => {
  it("a tag on any 👎 among the newest dozen ratings of their pictures adds its fix, past a 👍 since, until it's changed", async () => {
    const { id } = await admin();
    const [p1, p2, p3] = [await picture(id, JUNIPER), await picture(id, JUNIPER), await picture(id, JUNIPER)];
    await rateAt(id, p1, -1, ["blurry", "pose"], 30);
    await rateAt(id, p2, -1, ["anatomy"], 20);
    await rateAt(id, p3, 1, [], 10);
    const steer = await steeringFor(t.db, id, [JUNIPER]);
    expect(steer.tags).toEqual(["pose", "anatomy", "blurry"]);
    expect(steer.positive).toEqual([TAG_FIXES.pose.positive, TAG_FIXES.blurry.positive]);
    expect(steer.negative).toEqual([TAG_FIXES.pose.negative, TAG_FIXES.anatomy.negative, TAG_FIXES.blurry.negative]);
    // Pictures steer pictures: nothing for a video.
    expect(steer.video).toEqual([]);
    // Changed to a 👍: its fixes go.
    await rateMedia(t.db, id, p1, 1);
    expect((await steeringFor(t.db, id, [JUNIPER])).tags).toEqual(["anatomy"]);
    // Someone else's ratings, or another character's, steer nothing here.
    expect(await steeringFor(t.db, (await admin()).id, [JUNIPER])).toEqual(NO_STEERING);
    expect(await steeringFor(t.db, id, [RAFE])).toEqual(NO_STEERING);
  });

  it("steers a video by their ratings of videos with either of the pair, never by a picture's, the newest dozen only", async () => {
    const { id } = await admin();
    const pair = await picture(id, RAFE, { kind: "video", b: JUNIPER });
    await rateAt(id, pair, -1, ["motion", "anatomy"], 100);
    const steer = await steeringFor(t.db, id, [JUNIPER]);
    expect(steer.video).toEqual([TAG_FIXES.anatomy.video, TAG_FIXES.motion.video]);
    expect(steer.negative).toEqual([]);
    // A dozen newer ratings of pictures (picking a face is one) leave it be.
    for (let i = 0; i < STEER_WINDOW; i++) await rateAt(id, await picture(id, JUNIPER), 1, [], 50 - i);
    expect((await steeringFor(t.db, id, [RAFE, JUNIPER])).video).toEqual([TAG_FIXES.anatomy.video, TAG_FIXES.motion.video]);
    // A dozen newer ratings of videos push it out.
    for (let i = 0; i < STEER_WINDOW; i++) await rateAt(id, await picture(id, JUNIPER, { kind: "video", b: RAFE }), 1, [], 30 - i);
    expect((await steeringFor(t.db, id, [RAFE, JUNIPER])).video).toEqual([]);
  });

  it("goes into a prompt before its closing words about adults, with the preset's light", () => {
    const steer = { ...NO_STEERING, positive: ["sharp focus, fine detail", "a natural, relaxed pose"] };
    expect(withSteering("A picture of her. Everyone shown is an adult.", steer, "Warm low-key light.")).toBe(
      "A picture of her. Warm low-key light. Sharp focus, fine detail, a natural, relaxed pose. Everyone shown is an adult.",
    );
    expect(withSteering("A picture of her.", steer)).toBe("A picture of her. Sharp focus, fine detail, a natural, relaxed pose.");
    expect(withSteering("Unchanged. Everyone shown is an adult.", NO_STEERING)).toBe("Unchanged. Everyone shown is an adult.");
  });

  it("never makes a picture more explicit: Not explicit enough changes nothing, Too explicit tones it down", async () => {
    const { id } = await admin();
    const p = await picture(id, JUNIPER);
    await rateMedia(t.db, id, p, -1, ["too_tame"]);
    expect(await steeringFor(t.db, id, [JUNIPER])).toMatchObject({ positive: [], negative: [], video: [] });
    await rateMedia(t.db, id, p, -1, ["too_explicit"]);
    expect((await steeringFor(t.db, id, [JUNIPER])).positive).toEqual(["tasteful, more implied than shown"]);
  });

  it("is in the next picture's prompt and negative prompt, drawn in a preset the per-character test picks", async () => {
    const { id, cookie } = await admin();
    await setUp(cookie);
    fakeHive();
    const asked = fakeVenice();
    const p = await picture(id, JUNIPER);
    await rateMedia(t.db, id, p, -1, ["anatomy", "pose"]);
    const c = (await loadCharacter(t.db, JUNIPER))!;
    const made = await makePicture(t.db, id, { prompt: "Explicit, uncensored adult photograph: a kiss. Everyone shown is an adult.", kind: "scene", character_id: JUNIPER });
    expect(asked[0].prompt).toMatch(/A natural, relaxed pose\. Everyone shown is an adult\.$/);
    expect(asked[0].negative_prompt).toContain(TAG_FIXES.anatomy.negative);
    expect(asked[0].negative_prompt).toContain(TAG_FIXES.pose.negative);
    // The usual guard stays first.
    expect(asked[0].negative_prompt).toMatch(/^child, /);
    expect(PICTURE_PRESETS.map((x) => x.id)).toContain(made.preset);
    expect(asked[0].prompt).toContain(PICTURE_PRESETS.find((x) => x.id === made.preset)!.words);
    // A baseline's light is in its prompt already: its preset is the natural one, no preset words added.
    const base = await makePicture(t.db, id, { prompt: baselinePrompt(c, id), kind: "baseline", character_id: JUNIPER });
    expect(base.preset).toBe("natural");
    expect(asked[1].prompt).not.toContain("candid and unposed");
    // A picture of the two of them has no preset (the test is per character).
    const both = await makePicture(t.db, id, { prompt: "Two of them. Everyone shown is an adult.", kind: "scene", character_id: JUNIPER, character_b: RAFE });
    expect(both.preset).toBeNull();
  });
});

describe("the per-character preset test", () => {
  it("draws Beta samples between 0 and 1, centred where they should be", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const draws = Array.from({ length: 2000 }, () => betaSample(9, 3, rng));
    expect(draws.every((d) => d > 0 && d < 1)).toBe(true);
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.71);
    expect(mean).toBeLessThan(0.79);
  });

  it("tallies this viewer's 👍 and 👎 per preset on the character alone, and mostly picks the one they like", async () => {
    const { id } = await admin();
    for (let i = 0; i < 6; i++) await rateMedia(t.db, id, await picture(id, JUNIPER, { kind: "scene", preset: "warm" }), 1);
    for (let i = 0; i < 6; i++) await rateMedia(t.db, id, await picture(id, JUNIPER, { kind: "scene", preset: "studio" }), -1);
    await rateMedia(t.db, id, await picture(id, JUNIPER, { kind: "scene", preset: "natural" }), -1);
    // A picture of the pair doesn't count for one of them.
    await rateMedia(t.db, id, await picture(id, JUNIPER, { kind: "scene", b: RAFE, preset: "natural" }), 1);
    expect(await presetTally(t.db, id, JUNIPER)).toEqual({ natural: { up: 0, down: 1 }, warm: { up: 6, down: 0 }, studio: { up: 0, down: 6 } });
    let seed = 11;
    const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const picks = [];
    for (let i = 0; i < 200; i++) picks.push((await choosePreset(t.db, id, JUNIPER, rng)).id);
    expect(picks.filter((p) => p === "warm").length).toBeGreaterThan(150);
    // Nothing rated yet: each gets tried.
    const fresh = new Set<string>();
    for (let i = 0; i < 60; i++) fresh.add((await choosePreset(t.db, id, RAFE, rng)).id);
    expect(fresh.size).toBe(3);
  });
});

describe("the face a viewer's pictures and videos keep", () => {
  it("is the one they picked, else their own 👍, else their own, else the admins' newest, never one they 👎'd first", async () => {
    const sub = await subscriber();
    const { id: adminId } = await admin();
    const adminOld = await picture(adminId, JUNIPER, { ago: 30 });
    const adminNew = await picture(adminId, JUNIPER, { ago: 20 });
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(adminNew);
    await rateMedia(t.db, adminId, adminNew, -1, ["face"]);
    // The admin's 👎 is the admin's: the subscriber's face is unchanged.
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(adminNew);
    expect(await faceReferenceId(t.db, adminId, JUNIPER)).toBe(adminOld);
    const ownOld = await picture(sub.id, JUNIPER, { ago: 10 });
    const ownNew = await picture(sub.id, JUNIPER, { ago: 5 });
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(ownNew);
    await rateMedia(t.db, sub.id, ownOld, 1);
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(ownOld);
    await rateMedia(t.db, sub.id, ownOld, -1, ["face"]);
    await rateMedia(t.db, sub.id, ownNew, -1, ["face"]);
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(adminNew);
    // A scene picture of them alone can be picked; that's a 👍 on it too, and it wins.
    const scene = await picture(sub.id, JUNIPER, { kind: "scene", ago: 1 });
    expect(await setFaceReference(t.db, sub.id, JUNIPER, scene)).toEqual({ ok: true, image_id: scene });
    expect(await faceReferenceId(t.db, sub.id, JUNIPER)).toBe(scene);
    expect((await t.db.query(`select rating from adult_media_thumbs where owner_id = $1 and media_id = $2`, [sub.id, scene])).rows).toEqual([{ rating: 1 }]);
    expect(await facesFor(t.db, sub.id, [JUNIPER, RAFE])).toEqual({ [JUNIPER]: { image_id: scene, picked: true }, [RAFE]: { image_id: null, picked: false } });
    // Back to the default.
    expect(await setFaceReference(t.db, sub.id, JUNIPER, null)).toEqual({ ok: true, image_id: adminNew });
  });

  it("can only be one of their own pictures of that character alone", async () => {
    const sub = await subscriber();
    const other = await subscriber();
    expect(await setFaceReference(t.db, sub.id, JUNIPER, await picture(other.id, JUNIPER))).toMatchObject({ ok: false, status: 404 });
    expect(await setFaceReference(t.db, sub.id, JUNIPER, await picture(sub.id, RAFE))).toMatchObject({ ok: false, status: 404 });
    expect(await setFaceReference(t.db, sub.id, JUNIPER, await picture(sub.id, JUNIPER, { kind: "scene", b: RAFE }))).toMatchObject({ ok: false, status: 404 });
    expect(await setFaceReference(t.db, sub.id, JUNIPER, await picture(sub.id, JUNIPER, { kind: "video" }))).toMatchObject({ ok: false, status: 404 });
    expect((await t.db.query(`select 1 from adult_face_refs`)).rows).toHaveLength(0);
  });

  it("is what a video's keyframes start from, for that viewer", async () => {
    const sub = await subscriber();
    const { id: adminId } = await admin();
    const [aJ, aR] = [await picture(adminId, JUNIPER, { ago: 9 }), await picture(adminId, RAFE, { ago: 9 })];
    const mine = await picture(sub.id, JUNIPER, { kind: "scene", ago: 1 });
    await setFaceReference(t.db, sub.id, JUNIPER, mine);
    expect(await baselines(t.db, RAFE, JUNIPER, sub.id)).toEqual([aR, mine]);
    expect(await baselines(t.db, RAFE, JUNIPER, adminId)).toEqual([aR, aJ]);
    // With nobody given: each one's newest baseline, as before.
    expect(await baselines(t.db, RAFE, JUNIPER)).toEqual([aR, aJ]);
  });

  it("goes when the picture or the character does", async () => {
    const { id } = await admin();
    const pic = await picture(id, JUNIPER);
    await setFaceReference(t.db, id, JUNIPER, pic);
    await t.db.query(`delete from adult_images where id = $1`, [pic]);
    expect((await t.db.query(`select 1 from adult_face_refs`)).rows).toHaveLength(0);
  });

  it("over its route: hidden for a character they can't open, a 404 for another's picture", async () => {
    const sub = await subscriber();
    await setUp((await admin()).cookie);
    const pic = await picture(sub.id, JUNIPER);
    expect((await call(facePost, "/api/admin/after-dark/face", { character_id: "not-a-character", image_id: pic }, sub.cookie)).status).toBe(404);
    expect((await call(facePost, "/api/admin/after-dark/face", { character_id: JUNIPER, image_id: pic }, (await subscriber()).cookie)).status).toBe(404);
    const res = await call(facePost, "/api/admin/after-dark/face", { character_id: JUNIPER, image_id: pic }, sub.cookie);
    expect(await res.json()).toEqual({ image_id: pic });
  });
});

describe("three to pick a face from", () => {
  it("draws three waist-up pictures in the same framing, one in each light, each its preset, and counts them", async () => {
    const sub = await subscriber();
    await setUp((await admin()).cookie);
    fakeHive();
    const asked = fakeVenice();
    const res = await call(baselinesPost, "/api/admin/after-dark/baselines", { character_id: JUNIPER }, sub.cookie);
    const body = await res.json();
    expect(body.pictures.map((p: { preset: string }) => p.preset)).toEqual(["natural", "warm", "studio"]);
    expect(body.failed).toBe(0);
    expect(asked).toHaveLength(3);
    for (const [i, p] of PICTURE_PRESETS.entries()) {
      expect(asked[i].prompt).toContain(`alone, waist-up, facing the camera, face clearly visible, ${p.light}, photorealistic.`);
    }
    expect((await t.db.query<{ pictures: number }>(`select pictures from adult_usage where owner_id = $1`, [sub.id])).rows[0].pictures).toBe(3);
    // Theirs: in their gallery, and one can be their face.
    expect((await listMedia(t.db, [JUNIPER], sub.id)).map((m) => m.id).sort()).toEqual(body.pictures.map((p: { id: string }) => p.id).sort());
  });

  it("stops at this month's cap, and says so when none came", async () => {
    const sub = await subscriber();
    await setUp((await admin()).cookie);
    await t.db.query(`update adult_settings set cap_pictures = 1`);
    fakeHive();
    const asked = fakeVenice();
    const c = (await loadCharacter(t.db, JUNIPER))!;
    const r = await drawBaselineChoices(t.db, sub.id, c);
    expect(r.pictures).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
    expect(asked).toHaveLength(1);
    const res = await call(baselinesPost, "/api/admin/after-dark/baselines", { character_id: JUNIPER }, sub.cookie);
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/^None of the three came through: You've used this month's 1 pictures/);
  });

  it("is hidden for a character outside After Dark", async () => {
    const sub = await subscriber();
    expect((await call(baselinesPost, "/api/admin/after-dark/baselines", { character_id: "nobody" }, sub.cookie)).status).toBe(404);
  });
});

describe("the gallery", () => {
  it("lists for a viewer what they can open, with their ratings and the face they picked; an admin sees everyone's", async () => {
    const sub = await subscriber();
    const other = await subscriber();
    const { id: adminId } = await admin();
    const mine = await picture(sub.id, JUNIPER, { ago: 2 });
    await picture(other.id, JUNIPER, { ago: 1 });
    await rateMedia(t.db, sub.id, mine, -1, ["face"]);
    expect(await listMedia(t.db, [JUNIPER, RAFE], sub.id)).toMatchObject([{ id: mine, rating: -1, tags: ["face"], face: false }]);
    await setFaceReference(t.db, sub.id, JUNIPER, mine);
    expect(await listMedia(t.db, [JUNIPER, RAFE], sub.id)).toMatchObject([{ id: mine, rating: -1, face: true }]);
    expect(await listMedia(t.db, [JUNIPER, RAFE], adminId)).toHaveLength(2);
    expect((await listMedia(t.db, [JUNIPER, RAFE], adminId)).every((m) => m.rating === null && !m.face)).toBe(true);
  });
});

describe("what the page shows, and Start fresh", () => {
  it("sums up what the ratings steer and the light that's done best; Start fresh sets it aside and deletes nothing", async () => {
    const { id } = await admin();
    const warm = await picture(id, JUNIPER, { kind: "scene", preset: "warm" });
    const studio = await picture(id, JUNIPER, { kind: "scene", preset: "studio" });
    await rateAt(id, warm, 1, [], 20);
    await rateAt(id, studio, -1, ["blurry", "pose"], 10);
    expect(await steerSummary(t.db, id, [JUNIPER, RAFE])).toEqual({ [JUNIPER]: { avoid: ["pose", "blurry"], light: "warm" }, [RAFE]: { avoid: [], light: null } });
    await resetSteering(t.db, id, JUNIPER);
    expect(await steerSummary(t.db, id, [JUNIPER])).toEqual({ [JUNIPER]: { avoid: [], light: null } });
    expect(await steeringFor(t.db, id, [JUNIPER])).toEqual(NO_STEERING);
    // Kept: the ratings are all still there.
    expect((await t.db.query(`select 1 from adult_media_thumbs where owner_id = $1`, [id])).rows).toHaveLength(2);
    // A rating since counts again; another character's are untouched.
    await rateMedia(t.db, id, studio, -1, ["anatomy"]);
    expect((await steeringFor(t.db, id, [JUNIPER])).tags).toEqual(["anatomy"]);
    const rafe = await picture(id, RAFE, { kind: "scene" });
    await rateMedia(t.db, id, rafe, -1, ["outfit"]);
    expect((await steeringFor(t.db, id, [RAFE])).tags).toEqual(["outfit"]);
    // A picture of the two of them, rated before Juniper's reset, no longer counts for either of them.
    const both = await picture(id, RAFE, { kind: "scene", b: JUNIPER });
    await rateAt(id, both, -1, ["body"], 30);
    expect((await steeringFor(t.db, id, [RAFE])).tags).toEqual(["outfit"]);
  });

  it("learns from a face picked out of Draw three: each light passed over counts half a 👎", async () => {
    const { id } = await admin();
    const [natural, warm, studio] = [await picture(id, JUNIPER, { preset: "natural" }), await picture(id, JUNIPER, { preset: "warm" }), await picture(id, JUNIPER, { preset: "studio" })];
    const notMine = await picture((await subscriber()).id, JUNIPER, { preset: "natural" });
    expect(await setFaceReference(t.db, id, JUNIPER, warm, [natural, studio, notMine, "no-such-picture"])).toEqual({ ok: true, image_id: warm });
    expect(await presetTally(t.db, id, JUNIPER)).toEqual({ natural: { up: 0, down: 0.5 }, warm: { up: 1, down: 0 }, studio: { up: 0, down: 0.5 } });
    // From the gallery (no rivals) it's a 👍 and no ranking.
    await setFaceReference(t.db, id, JUNIPER, natural);
    expect(await presetTally(t.db, id, JUNIPER)).toEqual({ natural: { up: 1, down: 0.5 }, warm: { up: 1, down: 0 }, studio: { up: 0, down: 0.5 } });
    // Start fresh sets the picks aside too.
    await resetSteering(t.db, id, JUNIPER);
    expect(await presetTally(t.db, id, JUNIPER)).toEqual({ natural: { up: 0, down: 0 }, warm: { up: 0, down: 0 }, studio: { up: 0, down: 0 } });
  });

  it("over its routes: Start fresh hidden for a character outside After Dark; a face with its rivals teaches the light test", async () => {
    const sub = await subscriber();
    await setUp((await admin()).cookie);
    expect((await call(steerPost, "/api/admin/after-dark/steer", { character_id: "nobody", reset: true }, sub.cookie)).status).toBe(404);
    expect((await call(steerPost, "/api/admin/after-dark/steer", { character_id: JUNIPER }, sub.cookie)).status).toBe(422);
    const studio = await picture(sub.id, JUNIPER, { kind: "scene", preset: "studio" });
    await rateMedia(t.db, sub.id, studio, -1, ["blurry"]);
    const res = await call(steerPost, "/api/admin/after-dark/steer", { character_id: JUNIPER, reset: true }, sub.cookie);
    expect(await res.json()).toEqual({ steer: { avoid: [], light: null } });
    const [a, b] = [await picture(sub.id, JUNIPER, { preset: "natural" }), await picture(sub.id, JUNIPER, { preset: "warm" })];
    expect((await call(facePost, "/api/admin/after-dark/face", { character_id: JUNIPER, image_id: b, rivals: [a] }, sub.cookie)).status).toBe(200);
    expect((await presetTally(t.db, sub.id, JUNIPER)).natural).toEqual({ up: 0, down: 0.5 });
  });
});
