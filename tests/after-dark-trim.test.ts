import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as trimPost } from "@/app/api/admin/after-dark/media/[id]/trim/route";
import { GET as trimsGet } from "@/app/api/admin/after-dark/media/trims/route";
import { keptLength, trimStep } from "@/app/after-dark/trimPlayback";
import { cleanTrim } from "@/lib/adult/trim";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Trimming a video without making a new one (lib/adult/trim.ts; David, 2026-10-25). No live calls.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  setSeasonCastForTests([]);
});

const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];

describe("a trim", () => {
  it("keeps a start before the end and parts cut out inside them, apart; sorts the cuts", () => {
    expect(cleanTrim({ start: 1, end: 7.25, cuts: [[5, 6], [2, 3]] })).toEqual({ ok: true, trim: { start: 1, end: 7.25, cuts: [[2, 3], [5, 6]] } });
    expect(cleanTrim({ start: 0.5 })).toEqual({ ok: true, trim: { start: 0.5, end: null, cuts: [] } });
    expect(cleanTrim({ start: 4, end: 3 }).ok).toBe(false);
    expect(cleanTrim({ start: 1, end: 6, cuts: [[0.5, 2]] }).ok).toBe(false);
    expect(cleanTrim({ start: 0, end: 9, cuts: [[2, 4], [3, 5]] }).ok).toBe(false);
    expect(cleanTrim({ start: -1 }).ok).toBe(false);
    expect(cleanTrim({ start: 0, cuts: Array.from({ length: 7 }, (_, k) => [k, k + 0.5]) }).ok).toBe(false);
  });

  it("plays from the start, over the parts cut out, and stops at the end", () => {
    const trim = { start: 1, end: 8, cuts: [[3, 4.5]] as [number, number][] };
    expect(trimStep(trim, 0)).toEqual({ seek: 1 });
    expect(trimStep(trim, 2)).toBeNull();
    expect(trimStep(trim, 3.2)).toEqual({ seek: 4.5 });
    expect(trimStep(trim, 8)).toEqual({ done: true });
    expect(trimStep(null, 3)).toBeNull();
    expect(keptLength(trim, 10)).toBe(5.5);
    expect(keptLength({ start: 0, end: null, cuts: [] }, 10)).toBe(10);
  });
});

describe("the trim routes", () => {
  it("the owner trims their video and takes it back; the trims come back for a player; a stranger gets not found", async () => {
    const owner = userIdOf(newUserCookie());
    await claimAdmin(t.db, owner);
    await saveAdultSettings(t.db, { enabled: true, openrouter_key: "placeholder-text-ABCD" });
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, data) values ('clip-1', $1, 'video', 'Clip', 'video/mp4', $2)`, [owner, Buffer.from([0, 0, 0, 24])]);
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, data) values ('pic-1', $1, 'scene', 'p', 'image/png', $2)`, [owner, Buffer.from([137, 80])]);
    const post = (id: string, body: unknown, cookie: string) =>
      trimPost(new Request(`${BASE_URL}/api/admin/after-dark/media/${id}/trim`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    const get = (ids: string, cookie: string) => trimsGet(new Request(`${BASE_URL}/api/admin/after-dark/media/trims?ids=${ids}`, { headers: { cookie } }));
    const cookie = signedIn(owner);

    const saved = await post("clip-1", { start: 0.5, end: 4, cuts: [[1, 2]] }, cookie);
    expect(saved.status).toBe(200);
    expect((await saved.json()).trim).toEqual({ start: 0.5, end: 4, cuts: [[1, 2]] });
    expect((await (await get("clip-1,pic-1", cookie)).json()).trims).toEqual({ "clip-1": { start: 0.5, end: 4, cuts: [[1, 2]] } });
    // A bad trim says why; a picture can't be trimmed.
    expect((await post("clip-1", { start: 3, end: 2 }, cookie)).status).toBe(422);
    expect((await post("pic-1", { start: 1 }, cookie)).status).toBe(404);
    // The whole clip again.
    expect((await (await post("clip-1", { clear: true }, cookie)).json()).trim).toBeNull();
    expect((await (await get("clip-1", cookie)).json()).trims).toEqual({});

    // Someone else (even with After Dark open to them) can't trim it.
    const stranger = userIdOf(newUserCookie());
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [stranger]);
    expect((await post("clip-1", { start: 1 }, signedIn(stranger))).status).toBe(404);
  });
});
