import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as studioGet, POST as studioPost } from "@/app/api/characters/[id]/studio/route";
import { GET as pictureGet } from "@/app/api/studio/pictures/[id]/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { planPgShoot, pgShootPrompt, PG_GROUPS } from "@/lib/studio/pg-catalog";
import { setPgStudioFetchForTests, setPgStudioPausesForTests } from "@/lib/studio/pg";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// The PG Studio (plan PR 3; David, 2026-10-25): safe shoots of an owner's own character. Venice's pictures and its
// vision check are stubbed: no live calls.

describe("the PG catalog", () => {
  it("plans picks into words, holds one-pick groups and the accessory limit, and keeps swimwear to a beach or pool", () => {
    const ok = planPgShoot({ shot: "candid", place: "cafe", accessories: ["glasses", "watch"], custom: "laughing" });
    expect(ok).toMatchObject({ ok: true, plan: { beach: false, custom: "laughing" } });
    if (ok.ok) {
      const p = pgShootPrompt(ok.plan, { noun: "woman", age: 29, look: "auburn hair" }, true);
      expect(p).toMatch(/^A photograph of the person in the reference picture \(a 29-year-old woman, auburn hair\), keeping their face exactly\./);
      expect(p).toContain("In a cosy café.");
      expect(p).toContain("With glasses, a wristwatch.");
      expect(p).toContain("Fully clothed, tasteful and everyday, safe for work.");
    }
    expect(planPgShoot({ shot: ["candid", "headshot"] })).toMatchObject({ ok: false, error: "too_many" });
    expect(planPgShoot({ accessories: ["glasses", "watch", "rings", "scarf", "cap", "book"] })).toMatchObject({ ok: false, error: "too_many" });
    expect(planPgShoot({ wardrobe: "swim", place: "cafe" })).toMatchObject({ ok: false, error: "beach_only" });
    expect(planPgShoot({ wardrobe: "swim", place: "beach" })).toMatchObject({ ok: true, plan: { beach: true } });
    expect(planPgShoot({ shot: "nope" })).toMatchObject({ ok: false, error: "unknown_option" });
    // Every option of every group is everyday words (the show's check and the PG word check pass them).
    expect(PG_GROUPS.length).toBeGreaterThanOrEqual(10);
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setPgStudioPausesForTests(false);
  await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
/** Venice draws a picture per call (counted); the vision check answers each in turn. */
function venice(answers: string[]) {
  const drawn: { url: string; body: Record<string, unknown> }[] = [];
  setPgStudioFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    drawn.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  });
  let i = 0;
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: answers[i++ % answers.length], age: "ADULTS" }) } }] }));
  return drawn;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown, cookie: string) =>
  studioPost(new Request(`${BASE_URL}/api/characters/${id}/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), params(id));
const state = async (id: string, cookie: string) => studioGet(new Request(`${BASE_URL}/api/characters/${id}/studio`, { headers: { cookie } }), params(id));
async function owner() {
  const uid = crypto.randomUUID();
  const cookie = signedInCookie(uid);
  const res = await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie);
  return { uid, cookie, id: (await res.json()).id as string };
}
const tokens = (uid: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), uid, n]);

describe("who may open it", () => {
  it("is each owner's for their own characters (admins only when it's closed again); an admin also the house cast", async () => {
    const me = await owner();
    expect((await state(me.id, me.cookie)).status).toBe(200);
    await saveAdultSettings(t.db, { studio: { pg: { open_to: "admins" } } });
    expect((await state(me.id, me.cookie)).status).toBe(404);
    await saveAdultSettings(t.db, { studio: { pg: { open_to: "everyone" } } });
    expect((await state(me.id, me.cookie)).status).toBe(200);
    const other = await owner();
    expect((await state(me.id, other.cookie)).status).toBe(404);
    expect((await state(HOUSE_CHARACTERS[0].id, me.cookie)).status).toBe(404);
    await claimAdmin(t.db, other.uid);
    const house = await (await state(HOUSE_CHARACTERS[0].id, other.cookie)).json();
    expect(house).toMatchObject({ character: { id: HOUSE_CHARACTERS[0].id, face: true }, free: true, admin: true });
  });
});

describe("a shoot", () => {
  beforeEach(async () => {
    await saveAdultSettings(t.db, { studio: { pg: { open_to: "everyone" } } });
  });

  it("is free the first time, keeps only pg and suggestive pictures with their rating, then costs a token", async () => {
    const me = await owner();
    const drawn = venice(["CLOTHED", "REVEALING", "NUDITY", "CLOTHED"]);
    const r = await (await post(me.id, { action: "shoot", choices: { shot: "candid", place: "park" } }, me.cookie)).json();
    expect(r.shoot).toMatchObject({ free: true, tokens: 0, asked: 4, made: 3, status: "partial" });
    expect(r.pictures.map((p: { rating: string }) => p.rating).sort()).toEqual(["pg", "pg", "suggestive"]);
    // No portrait: a new picture from words, in Venice's safe mode.
    expect(drawn[0].url).toMatch(/\/image\/generate$/);
    expect(drawn[0].body).toMatchObject({ safe_mode: true });
    const rows = (await t.db.query<{ content_rating: string }>(`select content_rating from studio_pg_pictures where owner_id = $1`, [me.uid])).rows;
    expect(rows.map((x) => x.content_rating).sort()).toEqual(["pg", "pg", "suggestive"]);
    // The second shoot costs a token: none, refused before anything's drawn.
    const before = drawn.length;
    expect((await post(me.id, { action: "shoot", choices: { shot: "candid" } }, me.cookie)).status).toBe(402);
    expect(drawn.length).toBe(before);
    await tokens(me.uid, 2);
    const paid = await (await post(me.id, { action: "shoot", choices: { shot: "headshot" } }, me.cookie)).json();
    expect(paid.shoot).toMatchObject({ free: false, tokens: 1 });
    expect((await (await state(me.id, me.cookie)).json()).tokens).toBe(1);
  });

  it("gives the token back when nothing passes, and keeps the free shoot when the free one keeps nothing", async () => {
    const me = await owner();
    venice(["NUDITY"]);
    const free = await (await post(me.id, { action: "shoot", choices: { shot: "candid" } }, me.cookie)).json();
    expect(free.shoot).toMatchObject({ made: 0, status: "failed" });
    expect(free.message).toMatch(/free shoot is still there/);
    expect((await (await state(me.id, me.cookie)).json()).free).toBe(true);
    venice(["CLOTHED"]);
    await post(me.id, { action: "shoot", choices: { shot: "candid" } }, me.cookie);
    await tokens(me.uid, 1);
    venice(["SEXUAL"]);
    const paid = await (await post(me.id, { action: "shoot", choices: { shot: "candid" } }, me.cookie)).json();
    expect(paid).toMatchObject({ refunded: true, shoot: { made: 0, tokens: 0 } });
    expect((await (await state(me.id, me.cookie)).json()).tokens).toBe(1);
  });

  it("refuses words a show picture can't have, and swimwear away from water, before anything is drawn", async () => {
    const me = await owner();
    const drawn = venice(["CLOTHED"]);
    for (const custom of ["in black lingerie", "looks like Taylor Swift", "topless on a boat"]) {
      expect((await post(me.id, { action: "shoot", choices: { custom } }, me.cookie)).status, custom).toBe(422);
    }
    expect((await post(me.id, { action: "shoot", choices: { wardrobe: "swim", place: "cafe" } }, me.cookie)).status).toBe(422);
    expect(drawn).toHaveLength(0);
  });

  it("edits the house cast's portrait (the face kept) for an admin, free", async () => {
    const me = await owner();
    await claimAdmin(t.db, me.uid);
    const drawn = venice(["SWIMWEAR"]);
    const r = await (await post(HOUSE_CHARACTERS[0].id, { action: "shoot", choices: { place: "beach", wardrobe: "swim" } }, me.cookie)).json();
    expect(drawn[0].url).toMatch(/\/image\/multi-edit$/);
    expect(String((drawn[0].body.images as string[])[0])).toMatch(/\/cast\/house-.*\.webp$/);
    // Swimwear at the beach is pg.
    expect(r.pictures.every((p: { rating: string }) => p.rating === "pg")).toBe(true);
    expect(r.shoot.tokens).toBe(0);
  });

  it("shows a picture to its owner only, and deletes it", async () => {
    const me = await owner();
    venice(["CLOTHED"]);
    const r = await (await post(me.id, { action: "shoot", choices: { shot: "candid" } }, me.cookie)).json();
    const pid = r.pictures[0].id as string;
    const get = (cookie?: string) => pictureGet(new Request(`${BASE_URL}/api/studio/pictures/${pid}`, { headers: cookie ? { cookie } : {} }), params(pid));
    const mine = await get(me.cookie);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect((await get()).status).toBe(404);
    expect((await get((await owner()).cookie)).status).toBe(404);
    expect((await post(me.id, { action: "delete", picture_id: pid }, me.cookie)).status).toBe(200);
    expect((await get(me.cookie)).status).toBe(404);
  });
});
