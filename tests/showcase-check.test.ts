import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as checkGet, POST as checkPost } from "@/app/api/jobs/showcase-check/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { bestOf, listShowcase, publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { checkBatch, checkCount, checkTargets } from "@/lib/showcase-check";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Dressed pictures off After Dark's side (lib/showcase-check.ts; David, 2026-10-29: "in the gallery mode we added all
// the dressed images of the nsfw. They don't make sense in the NSFW gallery"). The real ffmpeg on a real little clip;
// the PG check faked.

let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  const { files } = await runFfmpeg({ args: ["-f", "lavfi", "-i", "testsrc2=duration=2:size=240x320:rate=16", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"], inputs: {}, outputs: ["clip.mp4"] });
  MP4 = files["clip.mp4"];
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ADMIN: ShowcaseViewer = { id: "an-admin", admin: true, ratings: ["pg", "suggestive", "nsfw"] };

/** The PG check, faked: every picture or frame comes back as `clothing`, its people `age`. How many were asked is kept. */
function verdict(clothing: string, age = "ADULTS") {
  const asked = { n: 0 };
  setModerationFetchForTests(async () => {
    asked.n++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age }) } }] });
  });
  return asked;
}

/** Mara's After Dark posts, all rated explicit as everything from After Dark starts. */
async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  const post = async (id: string, o: { kind?: string; mime?: string; data?: Buffer; level?: number | null; attire?: string | null; stage?: string } = {}) => {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, level, attire) values ($1, $2, $3, $4, 'p', $5, $6, 'ready', $7, $8)`, [
      id,
      me,
      mara,
      o.kind ?? "scene",
      o.mime ?? "image/png",
      o.data ?? PNG,
      o.level ?? null,
      o.attire ?? null,
    ]);
    if (o.stage) await t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, 'stage', $3, 'choice')`, [id, me, o.stage]);
    const r = await publish(t.db, me, { source: "after_dark", media_id: id });
    if (!r.ok) throw new Error(r.message);
    return r.post_id;
  };
  const ids = {
    dressed: await post("dressed", { level: 0 }),
    unknown: await post("unknown"),
    clip: await post("clip", { kind: "video", mime: "video/mp4", data: MP4 }),
    baseline: await post("baseline", { kind: "baseline", stage: "0" }),
    // Asked to be nude or more: explicit whatever a check says, so never checked.
    explicit: await post("explicit", { level: 3 }),
    staged: await post("staged", { stage: "3" }),
    nude: await post("nude", { kind: "baseline", attire: "nude" }),
  };
  return { me, mara, ids };
}

const side = async (postId: string) => (await t.db.query<{ rating: string }>(`select rating from showcase_posts where id = $1`, [postId])).rows[0]?.rating ?? "gone";
const asset = async (id: string) => (await t.db.query<{ content_rating: string }>(`select content_rating from adult_images where id = $1`, [id])).rows[0].content_rating;

describe("the PG check on After Dark's posts", () => {
  it("checks only what wasn't asked to be nude, pictures and clips, and moves the dressed ones to the safe side, for good", async () => {
    const w = await world();
    expect((await checkTargets(t.db)).map((x) => x.post_id).sort()).toEqual([w.ids.dressed, w.ids.unknown, w.ids.clip, w.ids.baseline].sort());
    const asked = verdict("CLOTHED");
    const r = await checkBatch(t.db);
    expect([r.results.every((x) => x.outcome === "safe"), r.left]).toEqual([true, 0]);
    // A picture once, a clip by three frames.
    expect(asked.n).toBe(3 + 3);
    for (const id of ["dressed", "unknown", "clip", "baseline"] as const) {
      expect(await side(w.ids[id])).toBe("pg");
      expect(await asset(id)).toBe("pg");
    }
    for (const id of ["explicit", "staged", "nude"] as const) expect([await side(w.ids[id]), await asset(id)]).toEqual(["nsfw", "nsfw"]);
    // The safe side has them, After Dark's the rest; nothing is checked twice.
    expect((await listShowcase(t.db, ADMIN, {})).posts.map((p) => p.media_id).sort()).toEqual(["baseline", "clip", "dressed", "unknown"]);
    expect((await listShowcase(t.db, ADMIN, { side: "after_dark" })).posts.map((p) => p.media_id).sort()).toEqual(["explicit", "nude", "staged"]);
    expect(await checkCount(t.db)).toBe(0);
  });

  it("keeps what a check didn't pass explicit (an age doubt held out of sight too), and tries again one it couldn't check", async () => {
    const w = await world();
    setModerationFetchForTests(async () => new Response("busy", { status: 503 }));
    const busy = await checkBatch(t.db);
    expect(busy.results.every((x) => x.outcome === "skipped")).toBe(true);
    expect(busy.left).toBe(4);
    verdict("NUDITY");
    await checkBatch(t.db, 2);
    verdict("CLOTHED", "MINOR");
    const rest = await checkBatch(t.db);
    expect(rest.results.map((x) => (x.outcome === "explicit" ? x.held : null))).toEqual([true, true]);
    expect(rest.left).toBe(0);
    for (const id of ["dressed", "unknown", "clip", "baseline"] as const) expect([await side(w.ids[id]), await asset(id)]).toEqual(["nsfw", "nsfw"]);
    const held = (await t.db.query<{ n: number }>(`select count(*)::int as n from showcase_posts where held`)).rows[0].n;
    expect(held).toBe(2);
  });

  it("takes a suggestive level as no less than suggestive, whatever the check saw", async () => {
    const w = await world();
    await t.db.query(`update adult_images set level = 1 where id = 'dressed'`);
    verdict("CLOTHED");
    await checkBatch(t.db);
    expect([await side(w.ids.dressed), await asset("dressed")]).toEqual(["suggestive", "suggestive"]);
  });

  it("leaves a dressed one's SFW twin as its one safe face: the original's post comes down, and Publish my best work leaves it out", async () => {
    const w = await world();
    // Mara's 👍 on the dressed picture, and its SFW twin in the PG gallery, up on the safe side.
    await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, 'dressed', 1)`, [w.me]);
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, twin_of) values ('dressed-twin', $1, $2, 'p', 'image/png', $3, 'pg', 'dressed')`, [w.me, w.mara, PNG]);
    const twin = await publish(t.db, w.me, { source: "pg", media_id: "dressed-twin" });
    if (!twin.ok) throw new Error(twin.message);
    expect((await bestOf(t.db, w.me)).after_dark).toContain("dressed");
    verdict("CLOTHED");
    const r = await checkBatch(t.db);
    expect(r.results.find((x) => x.post_id === w.ids.dressed)).toMatchObject({ outcome: "twin", rating: "pg", twin_post: twin.post_id });
    expect([await side(w.ids.dressed), await asset("dressed"), await side(twin.post_id)]).toEqual(["gone", "pg", "pg"]);
    expect((await bestOf(t.db, w.me)).after_dark).not.toContain("dressed");
    expect((await bestOf(t.db, w.me)).pg).toContain("dressed-twin");
  });

  it("runs hourly from Vercel Cron and from an admin, and is nobody else's", async () => {
    const w = await world();
    vi.stubEnv("CRON_SECRET", "cron-placeholder");
    verdict("CLOTHED");
    const get = (headers: Record<string, string>) => checkGet(new Request(`${BASE_URL}/api/jobs/showcase-check`, { headers }));
    expect((await get({})).status).toBe(404);
    expect((await get({ cookie: signedInCookie(w.me) })).status).toBe(404);
    expect(await (await get({ authorization: "Bearer cron-placeholder" })).json()).toMatchObject({ ok: true, left: 0 });
    await claimAdmin(t.db, w.me);
    const res = await checkPost(new Request(`${BASE_URL}/api/jobs/showcase-check`, { method: "POST", headers: { cookie: signedInCookie(w.me) } }));
    expect(await res.json()).toMatchObject({ ok: true, results: [], left: 0 });
  });
});
