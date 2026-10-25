import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/characters/[id]/pictures/route";
import { faceReferenceId } from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { approvedPortraitId, recordAsset, reviewAsset } from "@/lib/assets";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// Choose their picture (lib/studio/picture-choice.ts; David, 2026-10-25): any picture already made for the character, as
// their profile picture (pg only) or After Dark face (where After Dark is open to them). No uploads.

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
});
afterEach(() => vi.unstubAllEnvs());

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, cookie: string) => GET(new Request(`${BASE_URL}/api/characters/${id}/pictures`, { headers: { cookie } }), params(id));
const post = (id: string, body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/characters/${id}/pictures`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), params(id));
async function owner() {
  const uid = crypto.randomUUID();
  const cookie = signedInCookie(uid);
  const id = (await (await api.createCharacter(validCharacter({ name: `Ona ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
  for (const [pid, rating] of [["pic-pg", "pg"], ["pic-sug", "suggestive"]] as const) {
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, mime, data, content_rating) values ($1, $2, $3, 'image/png', $4, $5)`, [`${pid}-${uid.slice(0, 6)}`, uid, id, PNG, rating]);
  }
  const old = await recordAsset(t.db, { character_id: id, kind: "portrait", source_type: "generated", source_model: "fal:test", url: `data:image/png;base64,${PNG.toString("base64")}`, content_rating: "pg" });
  await reviewAsset(t.db, old, "approved", "test");
  return { uid, cookie, id, pg: `pic-pg-${uid.slice(0, 6)}`, sug: `pic-sug-${uid.slice(0, 6)}`, old };
}

describe("choosing their picture", () => {
  it("lists their Studio pictures and portraits, only to the owner", async () => {
    const me = await owner();
    const c = await (await get(me.id, me.cookie)).json();
    expect(c.studio.map((p: { rating: string }) => p.rating).sort()).toEqual(["pg", "suggestive"]);
    expect(c.portraits).toEqual([{ id: me.old, current: true }]);
    expect(c.after_dark).toBe(false);
    expect((await get(me.id, signedInCookie(crypto.randomUUID()))).status).toBe(404);
  });

  it("makes a pg Studio picture their profile picture, never a suggestive one, and an earlier portrait the current one again", async () => {
    const me = await owner();
    const r = await (await post(me.id, { source: "studio", id: me.pg, as: "portrait" }, me.cookie)).json();
    const current = await approvedPortraitId(t.db, me.id);
    expect(r.portrait_path).toBe(`/api/assets/${current}`);
    expect(current).not.toBe(me.old);
    expect((await t.db.query<{ content_rating: string }>(`select content_rating from character_assets where id = $1`, [current])).rows[0].content_rating).toBe("pg");
    expect((await post(me.id, { source: "studio", id: me.sug, as: "portrait" }, me.cookie)).status).toBe(422);
    expect((await post(me.id, { source: "portrait", id: me.old, as: "portrait" }, me.cookie)).status).toBe(200);
    expect(await approvedPortraitId(t.db, me.id)).toBe(me.old);
  });

  it("makes one their After Dark face only where After Dark is open to them, with the character in their After Dark", async () => {
    const me = await owner();
    expect((await post(me.id, { source: "studio", id: me.pg, as: "face" }, me.cookie)).status).toBe(403);
    await claimAdmin(t.db, me.uid);
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [me.uid, me.id]);
    const r = await (await post(me.id, { source: "studio", id: me.sug, as: "face" }, me.cookie)).json();
    expect(await faceReferenceId(t.db, me.uid, me.id)).toBe(r.face_id);
    const c = await (await get(me.id, me.cookie)).json();
    expect(c).toMatchObject({ after_dark: true, face_from: me.sug });
    // Someone else's character: nothing.
    const other = await owner();
    expect((await post(other.id, { source: "studio", id: me.pg, as: "portrait" }, me.cookie)).status).toBe(404);
  });
});
