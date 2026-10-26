import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { autoPicturesSettled } from "@/lib/adult/auto-pictures";
import { beatPicturesSettled } from "@/lib/adult/beats";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { missingNote, pairReadiness, readinessOf } from "@/lib/adult/readiness";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: "force the user to go to the studio and set up the baseline face and body images, so when we go
// after dark it is not guessing for new characters … creation → image bases → after dark". Sweet thang (18, anime, no
// face or body set) is the case: none of her pictures came out.
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
});
afterEach(async () => {
  await beatPicturesSettled();
  await autoPicturesSettled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setReelPausesForTests(true);
});

const RAFE = HOUSE_CHARACTERS[0].id;
const SWEET = "sweet-thang";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string, handler: (r: Request) => Promise<Response> = POST, path = "/api/admin/after-dark") =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));

/** An admin with After Dark on, Rafe's baseline drawn, and Sweet thang: theirs, switched on, nothing set up. */
async function setup() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = signedIn(id);
  await post({ enabled: true, openrouter_key: "placeholder-text-ABCD", image_provider: "venice", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie, settingsPost, "/api/admin/after-dark/settings");
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, pronouns, extras)
     values ($1, $2, false, 'Sweet thang', 18, 'One of the hottest women in the world.', '["bold"]'::jsonb, 'x', 'x', 'she/her', $3::jsonb)`,
    [SWEET, id, JSON.stringify({ looks: { gender: "woman", age: 18, style: "anime", body: "average", hair_color: "brunette" } })],
  );
  await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [id, SWEET]);
  await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('base-rafe', $1, $2, 'baseline', 'p', 'image/png', $3)`, [id, RAFE, Buffer.from(PNG)]);
  return { id, cookie };
}
/** Sets her up as the Studio would: a face picked ("Use this face") and a body reference ("Use as body"). */
async function setUp(owner: string, parts: { face?: boolean; body?: boolean } = { face: true, body: true }) {
  if (parts.face) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('face-sweet', $1, $2, 'baseline', 'p', 'image/png', $3) on conflict do nothing`, [owner, SWEET, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_face_refs (owner_id, character_id, image_id) values ($1, $2, 'face-sweet') on conflict do nothing`, [owner, SWEET]);
  }
  if (parts.body) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ('body-sweet', $1, $2, 'scene', 'p', 'image/png', $3) on conflict do nothing`, [owner, SWEET, Buffer.from(PNG)]);
    await t.db.query(`insert into adult_identity (owner_id, character_id, body_image_id) values ($1, $2, 'body-sweet') on conflict (owner_id, character_id) do update set body_image_id = 'body-sweet'`, [owner, SWEET]);
  }
}
function writes() {
  let n = 0;
  setAdultModelForTests({
    complete: async (m: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(m[0].content)) return "{}";
      n++;
      return JSON.stringify({
        lines: [
          { who: "a", text: `*leans on the counter ${n}* The ovens are still warm.` },
          { who: "b", text: `*grins ${n}* So are you.` },
        ],
        place: "the bakery",
        set: "the bakery",
      });
    },
  } as never);
}

describe("readiness", () => {
  it("her own character needs a face she picked and a body reference; the house cast needs its face", async () => {
    const { id } = await setup();
    expect(await readinessOf(t.db, id, SWEET)).toMatchObject({ own: true, face: false, body: false, ready: false, studio: `/after-dark/studio/${SWEET}` });
    expect(await readinessOf(t.db, id, RAFE)).toMatchObject({ own: false, face: true, ready: true });
    // The house cast is curated: ready even before its first baseline is drawn.
    expect(await readinessOf(t.db, id, HOUSE_CHARACTERS[1].id)).toMatchObject({ own: false, face: false, ready: true });
    await setUp(id, { face: true });
    expect(await readinessOf(t.db, id, SWEET)).toMatchObject({ face: true, body: false, ready: false });
    // A baseline drawn but never picked isn't her face: it was a guess.
    await t.db.query(`delete from adult_face_refs`);
    expect(await readinessOf(t.db, id, SWEET)).toMatchObject({ face: false });
    await setUp(id);
    expect(await readinessOf(t.db, id, SWEET)).toMatchObject({ face: true, body: true, ready: true });
  });

  it("says what's missing, in plain words", async () => {
    const { id } = await setup();
    expect(missingNote(await pairReadiness(t.db, id, SWEET, RAFE))).toBe("No pictures until they're set up: Sweet needs a face and a body set in the Studio.");
    await setUp(id, { face: true });
    expect(missingNote(await pairReadiness(t.db, id, SWEET, RAFE))).toBe("No pictures until they're set up: Sweet needs a body set in the Studio.");
    await setUp(id);
    expect(missingNote(await pairReadiness(t.db, id, SWEET, RAFE))).toBeNull();
  });
});

describe("a night with someone not set up", () => {
  it("draws no picture of any kind, guesses no baseline, offers no moment; the scene says what's missing", async () => {
    const { cookie } = await setup();
    const drawn: string[] = [];
    setReelFetchForTests(async (input: RequestInfo | URL) => {
      drawn.push(String(input));
      return new Response("?", { status: 500 });
    });
    writes();
    const r = await post({ a: SWEET, b: RAFE }, cookie);
    expect(r.status).toBe(200);
    await autoPicturesSettled();
    const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${SWEET}&b=${RAFE}`, { headers: { cookie } }))).json()).scene;
    expect(scene.picture_note).toMatch(/Sweet needs a face and a body set in the Studio/);
    // Picture this, its preview and the shot menu all say so, nothing drawn.
    for (const body of [{ picture_now: { line: 1 } }, { picture_preview: { line: 1 } }]) {
      const res = await post({ a: SWEET, b: RAFE, ...body }, cookie);
      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/needs a face and a body/);
    }
    await beatPicturesSettled();
    expect(drawn).toEqual([]);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from adult_images where character_id = $1`, [SWEET])).rows[0].n).toBe(0);
  });

  it("once she's set up, Picture this goes ahead", async () => {
    const { id, cookie } = await setup();
    await setUp(id);
    writes();
    await post({ a: SWEET, b: RAFE }, cookie);
    const res = await post({ a: SWEET, b: RAFE, picture_preview: { line: 1 } }, cookie);
    expect(res.status).toBe(200);
  });
});
