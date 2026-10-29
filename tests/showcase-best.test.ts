import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as modGet, POST as modPost } from "@/app/api/admin/showcase/route";
import { POST as profilePost } from "@/app/api/creator-profile/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { pairKey } from "@/lib/relationships";
import { bestOf } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Publishing one's best work in one go (lib/showcase.ts bestOf, publishBest; David, 2026-10-29).

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const req = (path: string, init: RequestInit & { cookie?: string } = {}) => new Request(`${BASE_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) } });

describe("publishing my best work", () => {
  it("takes their 👍 and 4–5★ work, never 👎, 1–3★, archived or a pair with someone else's character, and their pg PG pictures", async () => {
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const mine = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
    const theirs = (await (await api.createCharacter(validCharacter({ name: "Other Person" }), newUserCookie())).json()).id as string;
    await claimAdmin(t.db, me);
    const cookie = signedInCookie(me);
    const pic = async (id: string, a: string, b: string | null = null) =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready')`, [id, me, a, b, PNG]);
    const up = (id: string) => t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, 1)`, [me, id]);
    const stars = (id: string, n: number, kind = "image") => t.db.query(`insert into adult_media_ratings (user_id, item_id, item_kind, rating) values ($1, $2, $3, $4)`, [me, id, kind, n]);
    await pic("liked", mine);
    await up("liked");
    await pic("starred", mine);
    await stars("starred", 5);
    await pic("liked-but-3", mine);
    await up("liked-but-3");
    await stars("liked-but-3", 3);
    await pic("disliked", mine);
    await stars("disliked", 5);
    await t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, 'disliked', -1)`, [me]);
    await pic("unrated", mine);
    const [h1, h2] = pairKey(mine, HOUSE_CHARACTERS[0].id);
    await pic("with-house", h1, h2);
    await up("with-house");
    const [o1, o2] = pairKey(mine, theirs);
    await pic("with-someone", o1, o2);
    await up("with-someone");
    // A clip of a reel given 4 stars, and one taken out to the Archive.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('reel-shot', $1, $2, 'video', 'p', 'video/mp4', $3, 'ready'), ('archived-shot', $1, $2, 'video', 'p', 'video/mp4', $3, 'ready')`, [me, mine, PNG]);
    await t.db.query(
      `insert into adult_reels (id, owner_id, character_a, character_b, status, shots) values ('reel-1', $1, $2, $3, 'ready', $4::jsonb)`,
      [me, h1, h2, JSON.stringify([{ line: 0, who: "a", text: "", motion: "", status: "ready", media_id: "reel-shot" }, { line: 1, who: "a", text: "", motion: "", status: "ready", media_id: "archived-shot", archived_at: "2026-10-28T00:00:00Z" }])],
    );
    await stars("reel-1", 4, "reel");
    await up("archived-shot");
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating) values ('pg-1', $1, $2, 'p', 'image/png', $3, 'pg'), ('pg-2', $1, $2, 'p', 'image/png', $3, 'suggestive')`, [me, mine, PNG]);
    const best = await bestOf(t.db, me);
    expect(best.after_dark.sort()).toEqual(["liked", "reel-shot", "starred", "with-house"]);
    expect(best.pg).toEqual(["pg-1"]);
    // The admin page says so, then publishes them all once a handle is picked; a second go publishes nothing new.
    const mineState = (await (await modGet(req("/x", { cookie }))).json()).mine;
    expect(mineState).toMatchObject({ profile: null, best: { after_dark: 4, pg: 1 }, posted: 0 });
    expect((await modPost(req("/x", { method: "POST", cookie, body: JSON.stringify({ action: "publish_best" }) }))).status).toBe(409);
    await profilePost(req("/api/creator-profile", { method: "POST", cookie, body: JSON.stringify({ handle: "mara", display_name: "Mara" }) }));
    expect(await (await modPost(req("/x", { method: "POST", cookie, body: JSON.stringify({ action: "publish_best" }) }))).json()).toMatchObject({ published: 5, already: 0, failed: 0 });
    expect(await (await modPost(req("/x", { method: "POST", cookie, body: JSON.stringify({ action: "publish_best" }) }))).json()).toMatchObject({ published: 0, already: 5 });
    expect((await t.db.query(`select 1 from showcase_consents`)).rows).toHaveLength(0);
  });
});
