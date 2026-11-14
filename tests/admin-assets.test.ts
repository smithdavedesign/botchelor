import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/assets/route";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { withPortraits } from "@/lib/portrait-sql";
import { api, BASE_URL, named, newUserCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const PW = ["assets", "pw", "tests"].join("-");
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("FRONTIER_PASSWORD", PW);
});
afterEach(() => vi.unstubAllEnvs());

const call = (body: unknown, key: string | null = PW) =>
  POST(new Request(`${BASE_URL}/api/admin/assets`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) }, body: JSON.stringify(body) }));

// A tiny real PNG, so the asset passes the compactor like a drawn portrait would.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * /api/admin/assets (2026-11-13 design review: an approved "PG portrait" that was a blurred picture showed as a brown
 * blur on the safe side): an admin rejects one asset, and the character's face falls back at once.
 */
describe("the admin asset review route", () => {
  it("needs the admin password or an admin account", async () => {
    const res = await call({ id: crypto.randomUUID(), status: "rejected" }, null);
    expect(res.status).toBe(403);
  });

  it("rejecting a portrait takes it off the character's pages: the previous approved one shows, else their initials", async () => {
    const cookie = await named(newUserCookie(), "Tester");
    const { id } = (await (await api.createCharacter(validCharacter({ name: "Clementine Test" }), cookie)).json()) as { id: string };
    const older = await recordAsset(t.db, { character_id: id, kind: "portrait", source_type: "generated", source_model: "test", url: PNG, content_rating: "pg" });
    await reviewAsset(t.db, older, "approved", "first portrait");
    const blurred = await recordAsset(t.db, { character_id: id, kind: "portrait", source_type: "generated", source_model: "test", url: PNG, content_rating: "pg" });
    await reviewAsset(t.db, blurred, "approved", "the blurred one");
    expect((await withPortraits(t.db, [{ id }]))[0].portrait).toBe(`/api/assets/${blurred}`);

    const res = await call({ id: blurred, status: "rejected", note: "a blurred picture approved as a PG portrait" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; asset: { was: string; now: string } };
    expect(body.asset).toMatchObject({ was: "approved", now: "rejected" });
    expect((await withPortraits(t.db, [{ id }]))[0].portrait).toBe(`/api/assets/${older}`);

    await call({ id: older, status: "rejected" });
    expect((await withPortraits(t.db, [{ id }]))[0].portrait).toBeNull();
  });

  it("says when there is no such asset, and refuses a status it doesn't know", async () => {
    expect((await call({ id: crypto.randomUUID(), status: "rejected" })).status).toBe(404);
    expect((await call({ id: crypto.randomUUID(), status: "pending" })).status).toBe(422);
  });
});
