import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ratePost } from "@/app/api/admin/after-dark/rate/route";
import { listMedia } from "@/lib/adult/media";
import { archiveShot, shotsFollowRating, type ReelShot } from "@/lib/adult/reels";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-24: a 👎 on a clip takes it out of the highlight reel (its video of the night), and the gallery knows a
// reel's shot from a clip (its sections).
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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const [LO, HI] = [RAFE, JUNIPER].sort();

async function setup() {
  const owner = userIdOf(newUserCookie());
  await claimAdmin(t.db, owner);
  const video = (id: string) =>
    t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status) values ($1, $2, $3, $4, 'video', 'x', 'video/mp4', 'ready')`, [id, owner, LO, HI]);
  await video("shot-1");
  await video("shot-2");
  await video("clip-1");
  const shots: ReelShot[] = [
    { status: "ready", media_id: "shot-1" } as ReelShot,
    { status: "ready", media_id: "shot-2" } as ReelShot,
  ];
  await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots) values ('reel-1', $1, $2, $3, 'ready', $4::jsonb)`, [owner, LO, HI, JSON.stringify(shots)]);
  return owner;
}
const shotsOf = async () => (await t.db.query<{ shots: ReelShot[] }>(`select shots from adult_reels where id = 'reel-1'`)).rows[0].shots;

describe("a 👎 takes a shot out of its video of the night", () => {
  it("archives it (marked as the rating's), keeps it in the gallery under Not liked, and taking the 👎 back puts it back", async () => {
    const owner = await setup();
    expect(await shotsFollowRating(t.db, owner, "shot-1", -1)).toBe(1);
    const s1 = (await shotsOf()).find((s) => s.media_id === "shot-1")!;
    expect(s1).toMatchObject({ archived_by: "rating", archived_at: expect.any(String) });
    // Still in the gallery, so the 👎 can be taken back there.
    expect((await listMedia(t.db, [LO, HI], owner)).map((m) => m.id)).toContain("shot-1");
    expect(await shotsFollowRating(t.db, owner, "shot-1", 0)).toBe(1);
    expect((await shotsOf()).find((s) => s.media_id === "shot-1")!.archived_at).toBeUndefined();
  });

  it("leaves a shot archived by hand alone, and a 👍 never archives", async () => {
    const owner = await setup();
    await archiveShot(t.db, owner, "reel-1", "shot-2", true);
    expect(await shotsFollowRating(t.db, owner, "shot-2", 1)).toBe(0);
    expect((await shotsOf()).find((s) => s.media_id === "shot-2")!.archived_at).toEqual(expect.any(String));
    expect(await shotsFollowRating(t.db, owner, "shot-1", 1)).toBe(0);
  });

  it("happens through the rate route, and the gallery tells a reel's shot from a clip", async () => {
    const owner = await setup();
    const cookie = sessionCookies({ userId: owner, authenticated: true })[0].split(";")[0];
    const res = await ratePost(new Request(`${BASE_URL}/api/admin/after-dark/rate`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ media_id: "shot-2", rating: -1 }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).reels_changed).toBe(1);
    expect((await shotsOf()).find((s) => s.media_id === "shot-2")!.archived_by).toBe("rating");
    const media = await listMedia(t.db, [LO, HI], owner);
    expect(media.find((m) => m.id === "shot-1")?.in_reel).toBe(true);
    expect(media.find((m) => m.id === "clip-1")?.in_reel).toBe(false);
  });
});
