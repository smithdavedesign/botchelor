import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { GET as mediaGet } from "@/app/api/showcase/[id]/media/route";
import { hasAiMark } from "@/lib/ai-mark";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { publish, saveCreatorProfile } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Smaller pictures for the showcase's tiles and reels (lib/showcase-thumbs.ts; David, 2026-10-29: each tile loaded the
// full picture, about 2.3 MB, heavy on a phone).

let t: Awaited<ReturnType<typeof startTestDb>>;
let BIG: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  // A real portrait from the repo, at the size a model's picture comes at, as a PNG (a few MB, as on the showcase).
  BIG = await sharp(readFileSync("public/cast/house-juniper-v3.webp")).resize({ width: 1536, height: 2048, fit: "cover" }).png().toBuffer();
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

async function posts() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ('pg-1', $1, $2, 'p', 'image/png', $3, 'pg')`, [me, mara, BIG]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ('ad-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready', 'nsfw')`, [me, mara, BIG]);
  const safe = await publish(t.db, me, { source: "pg", media_id: "pg-1" });
  const dark = await publish(t.db, me, { source: "after_dark", media_id: "ad-1" });
  if (!safe.ok || !dark.ok) throw new Error("publish");
  return { safe: safe.post_id, dark: dark.post_id };
}
const get = (id: string, q = "") => mediaGet(new Request(`${BASE_URL}/api/showcase/${id}/media${q}`), { params: Promise.resolve({ id }) });

describe("the showcase's smaller pictures", () => {
  it("sends a tile or a phone screen's copy, small, marked, drawn once; the original when no size is asked", async () => {
    const p = await posts();
    const original = Buffer.from(await (await get(p.safe)).arrayBuffer());
    // The original, as it is (with the AI mark it goes out with).
    expect(original.length).toBeGreaterThanOrEqual(BIG.length);
    for (const [size, width] of [["tile", 640], ["screen", 1080]] as const) {
      const res = await get(p.safe, `?size=${size}`);
      expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/webp", "public, max-age=31536000, immutable"]);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect((await sharp(bytes).metadata()).width).toBe(width);
      expect(bytes.length).toBeLessThan(original.length / 4);
      expect(hasAiMark(bytes)).toBe(true);
    }
    expect((await t.db.query(`select size from showcase_thumbs order by size`)).rows).toEqual([{ size: "screen" }, { size: "tile" }]);
    // A size nobody asks for is the original.
    expect(Buffer.from(await (await get(p.safe, "?size=huge")).arrayBuffer()).length).toBe(original.length);
  });

  it("gives a clip the picture it was filmed from as its poster, and never the clip in its place", async () => {
    // The reels show it while the clip loads (2026-10-30: "the videos and assets are heavy").
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const mara = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
    await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
    const CLIP = Buffer.from("not really an mp4");
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating) values ('frame-1', $1, $2, 'frame', 'p', 'image/png', $3, 'ready', 'pg')`, [me, mara, BIG]);
    for (const [id, from] of [["clip-1", "frame-1"], ["clip-2", null]] as const) {
      await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status, content_rating, source_image) values ($1, $2, $3, 'video', 'p', 'video/mp4', $4, 'ready', 'pg', $5)`, [id, me, mara, CLIP, from]);
    }
    const [one, two] = await Promise.all(["clip-1", "clip-2"].map((media_id) => publish(t.db, me, { source: "after_dark", media_id })));
    if (!one.ok || !two.ok) throw new Error("publish");
    const poster = await get(one.post_id, "?size=screen");
    expect([poster.status, poster.headers.get("content-type")]).toEqual([200, "image/webp"]);
    expect((await sharp(Buffer.from(await poster.arrayBuffer())).metadata()).width).toBe(1080);
    expect((await get(two.post_id, "?size=screen")).status).toBe(404);
    expect(Buffer.from(await (await get(two.post_id)).arrayBuffer()).equals(CLIP)).toBe(true);
  });

  it("asks who may see the post first, whatever the size", async () => {
    const p = await posts();
    expect((await get(p.dark, "?size=tile")).status).toBe(404);
    expect((await t.db.query(`select 1 from showcase_thumbs`)).rows).toHaveLength(0);
  });
});
