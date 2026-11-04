import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { GET as checkGet } from "@/app/api/jobs/showcase-check/route";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runFfmpeg } from "@/lib/media-tools/ffmpeg";
import { listShowcase, publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { posterBatch, posterCount } from "@/lib/showcase-posters";
import { THUMB_WIDTHS } from "@/lib/showcase-thumbs";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// David, 2026-11-02: "do all 3". A clip showed black on the grid and in the reels until it loaded: only 22 of 203 live
// clips had a still (the picture they were filmed from). The rest get their own first frame (lib/showcase-posters.ts).
// The real ffmpeg on a real little clip.

let t: Awaited<ReturnType<typeof startTestDb>>;
let MP4: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  const { files } = await runFfmpeg({ args: ["-f", "lavfi", "-i", "testsrc2=duration=1:size=720x1280:rate=12", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-y", "clip.mp4"], inputs: {}, outputs: ["clip.mp4"] });
  MP4 = files["clip.mp4"];
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Mara's safe After Dark clips: one with no still, one filmed from a picture, one that can't be read; and a picture. */
async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  const item = (id: string, mime: string, data: Buffer, from: string | null = null) =>
    t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating, source_image) values ($1, $2, $3, $4, 'p', $5, $6, 'ready', 'pg', $7)`, [
      id, me, mara, mime.startsWith("video/") ? "video" : "scene", mime, data, from,
    ]);
  await item("frame-1", "image/png", PNG);
  await item("clip-bare", "video/mp4", MP4);
  await item("clip-from", "video/mp4", MP4, "frame-1");
  await item("clip-broken", "video/mp4", Buffer.from("not really an mp4"));
  const ids: Record<string, string> = {};
  for (const id of ["clip-bare", "clip-from", "clip-broken", "frame-1"]) {
    const r = await publish(t.db, me, { source: "after_dark", media_id: id });
    if (!r.ok) throw new Error(r.message);
    ids[id] = r.post_id;
  }
  return ids;
}
const get = (id: string, q = "") => mediaGet(new Request(`${BASE_URL}/api/showcase/${id}/media${q}`, { headers: { "user-agent": UA } }), { params: Promise.resolve({ id }) });

describe("a still for every clip", () => {
  it("cuts a clip's first frame once, at both sizes, and serves it as the clip's poster", async () => {
    const ids = await world();
    // Only the clips with no picture of their own: never one filmed from a picture, never a picture.
    expect(await posterCount(t.db)).toBe(2);
    const before = Object.fromEntries((await listShowcase(t.db, ANYONE, { medium: "clip" })).posts.map((p) => [p.media_id, p.poster]));
    expect(before).toMatchObject({ "clip-bare": false, "clip-from": true });
    expect((await get(ids["clip-bare"], "?size=screen")).status).toBe(404);

    const run = await posterBatch(t.db);
    const by = Object.fromEntries(run.results.map((r) => [r.post_id, r.outcome]));
    expect(by).toEqual({ [ids["clip-bare"]]: "made", [ids["clip-broken"]]: "skipped" });
    // The one that can't be read stays to try again; the rest are done.
    expect(run.left).toBe(1);

    const after = Object.fromEntries((await listShowcase(t.db, ANYONE, { medium: "clip" })).posts.map((p) => [p.media_id, p.poster]));
    expect(after).toMatchObject({ "clip-bare": true, "clip-from": true, "clip-broken": false });
    for (const size of ["tile", "screen"] as const) {
      const res = await get(ids["clip-bare"], `?size=${size}`);
      expect([res.status, res.headers.get("content-type")]).toEqual([200, "image/webp"]);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      // Never wider than the clip (720).
      expect(meta.width).toBe(Math.min(720, THUMB_WIDTHS[size]));
    }
    // The clip itself is still the clip.
    expect((await get(ids["clip-bare"])).headers.get("content-type")).toBe("video/mp4");
    // Once: a second run has only the unreadable one to try.
    expect((await posterBatch(t.db)).results.map((r) => r.post_id)).toEqual([ids["clip-broken"]]);
  }, 60_000);

  it("a boomerang's poster is the picture its clip was filmed from (2026-11-03: its tile 404'd)", async () => {
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
    await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
    const still = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#c33" } }).png().toBuffer();
    const item = (id: string, mime: string, data: Buffer, from: string | null) =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating, source_image) values ($1, $2, $3, $4, 'p', $5, $6, 'ready', 'pg', $7)`, [
        id, me, mara, mime.startsWith("video/") ? "video" : "scene", mime, data, from,
      ]);
    await item("still", "image/png", still, null);
    await item("clip", "video/mp4", MP4, "still");
    await item("boomerang", "video/mp4", MP4, "clip");
    await item("loop-of-nothing", "video/mp4", MP4, "boomerang-gone");
    const post = async (id: string) => {
      const r = await publish(t.db, me, { source: "after_dark", media_id: id });
      if (!r.ok) throw new Error(r.message);
      return r.post_id;
    };
    const res = await get(await post("boomerang"), "?size=tile");
    expect([res.status, res.headers.get("content-type")]).toEqual([200, "image/webp"]);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(Math.min(600, THUMB_WIDTHS.tile));
    // A chain that never reaches a picture has no poster, never a clip served as one.
    expect((await get(await post("loop-of-nothing"), "?size=tile")).status).toBe(404);
  }, 60_000);

  it("comes with the hourly job, and alone with ?posters=1", async () => {
    const ids = await world();
    vi.stubEnv("CRON_SECRET", "cron-placeholder");
    const job = (q = "") => checkGet(new Request(`${BASE_URL}/api/jobs/showcase-check${q}`, { headers: { authorization: "Bearer cron-placeholder" } })).then((r) => r.json());
    const only = await job("?posters=1");
    expect(only).toMatchObject({ ok: true, left: 1 });
    expect(only.results.find((r: { post_id: string }) => r.post_id === ids["clip-bare"])).toMatchObject({ outcome: "made" });
    expect(await job()).toMatchObject({ ok: true, posters: { ok: true, left: 1 } });
  }, 60_000);
});
