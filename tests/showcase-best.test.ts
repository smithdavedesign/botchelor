import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as modGet, POST as modPost } from "@/app/api/admin/showcase/route";
import { POST as profilePost } from "@/app/api/creator-profile/route";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { pairKey } from "@/lib/relationships";
import { bestOf, TWIN_BATCH, twinCandidates } from "@/lib/showcase";
import { setPgStudioFetchForTests } from "@/lib/studio/pg";
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
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
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

/** Venice, the PG check and Hive, stubbed: every twin drawn comes back `clothing` (CLOTHED passes, NUDITY doesn't). */
function stubTwins(clothing = "CLOTHED") {
  let drawn = 0;
  setCheckSleepForTests(async () => {});
  setPgStudioFetchForTests(async () => {
    drawn++;
    return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
  });
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age: "ADULTS" }) } }] }));
  const clean = { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.05 }] }] };
  setCheckFetchForTests(async (input: RequestInfo | URL) => Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "ADULTS" }) } }] } : clean));
  return () => drawn;
}

describe("SFW twins of my best work", () => {
  it("twins their best pictures a few at a time, best first, never a twin, a clip or one already twinned, and the twins count as their best", async () => {
    const raw = newUserCookie();
    const me = userIdOf(raw);
    const mine = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), raw)).json()).id as string;
    await claimAdmin(t.db, me);
    await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive", image_provider: "venice", studio: { pg: { open_to: "everyone" } } });
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [me, mine]);
    const cookie = signedInCookie(me);
    const pic = (id: string, a: string, b: string | null = null, kind = "scene", mime = "image/png") =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, $5, 'p', $6, $7, 'ready')`, [id, me, a, b, kind, mime, PNG]);
    const up = (id: string) => t.db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, 1)`, [me, id]);
    for (const id of ["b", "c", "already"]) {
      await pic(id, mine);
      await up(id);
    }
    await pic("a", mine);
    await t.db.query(`insert into adult_media_ratings (user_id, item_id, item_kind, rating) values ($1, 'a', 'image', 5)`, [me]);
    const [h1, h2] = pairKey(mine, HOUSE_CHARACTERS[0].id);
    await pic("pair", h1, h2);
    await up("pair");
    await pic("clip", mine, null, "video", "video/mp4");
    await up("clip");
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, twin_of) values ('old-twin', $1, $2, 'p', 'image/png', $3, 'pg', 'already')`, [me, mine, PNG]);
    const todo = await twinCandidates(t.db, me);
    expect(todo[0]).toBe("a");
    expect([...todo].sort()).toEqual(["a", "b", "c", "pair"]);
    expect((await (await modGet(req("/x", { cookie }))).json()).mine.twins).toBe(4);

    const drawn = stubTwins();
    const twin = (body: Record<string, unknown>, headers: Record<string, string> = { cookie }) =>
      modPost(new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action: "twin_best", ...body }) }));
    const first = await (await twin({})).json();
    expect(first.made).toHaveLength(TWIN_BATCH);
    expect(first.left).toBe(4 - TWIN_BATCH);
    const second = await (await twin({})).json();
    expect([second.made.length, second.left]).toEqual([4 - TWIN_BATCH, 0]);
    expect(drawn()).toBe(4);
    const made = [...first.made, ...second.made];
    expect(made.find((m: { original: string }) => m.original === "pair").where).toBe("after_dark");
    expect(made.filter((m: { where: string }) => m.where === "pg")).toHaveLength(3);
    // Nothing left to twin, and the twins are among their best: the solo ones in the PG Studio, the pair's in After Dark.
    expect(await twinCandidates(t.db, me)).toEqual([]);
    const best = await bestOf(t.db, me);
    expect(best.after_dark).toContain(made.find((m: { original: string }) => m.original === "pair").id);
    expect(best.pg).toEqual(expect.arrayContaining(["old-twin", ...made.filter((m: { where: string }) => m.where === "pg").map((m: { id: string }) => m.id)]));

    // One the PG check turns down is reported, and skipped when the run carries on.
    await pic("d", mine);
    await up("d");
    stubTwins("NUDITY");
    const refused = await (await twin({})).json();
    expect(refused).toMatchObject({ made: [], failed: [{ original: "d" }], left: 0 });
    expect(await (await twin({ skip: ["d"] })).json()).toMatchObject({ made: [], failed: [], left: 0 });

    // With the admin password, for an admin named; never for anyone else, and never without one of the two.
    vi.stubEnv("FRONTIER_PASSWORD", "test-admin-password");
    const someone = userIdOf(newUserCookie());
    expect((await twin({ owner: someone, skip: ["d"] }, { "x-frontier-key": "test-admin-password" })).status).toBe(404);
    expect((await twin({ owner: me, skip: ["d"] }, { "x-frontier-key": "test-admin-password" })).status).toBe(200);
    expect((await twin({ skip: ["d"] }, { "x-frontier-key": "test-admin-password", cookie: signedInCookie(someone) })).status).toBe(404);
    expect((await twin({ owner: me }, { "x-frontier-key": "wrong" })).status).toBe(403);
    expect((await twin({}, { cookie: signedInCookie(someone) })).status).toBe(403);
  });
});
