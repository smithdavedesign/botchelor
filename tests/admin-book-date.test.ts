import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/book-date/route";
import { episodeAllowance } from "@/lib/allowance";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const book = (body: unknown, key?: string) =>
  POST(
    new Request(`${BASE_URL}/api/admin/book-date`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-frontier-key": key } : {}) },
      body: JSON.stringify(body),
    }),
  );

describe("the admin's test dates (POST /api/admin/book-date)", () => {
  it("needs the admin password", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw-for-tests");
    expect((await book({ character_id: "x", partner_id: HOUSE_PARTNER_ID })).status).toBe(403);
    expect((await book({ character_id: "x", partner_id: HOUSE_PARTNER_ID }, "wrong")).status).toBe(403);
  });

  it("books as the owner through the ordinary route, and leaves their balance where it was", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw-for-tests");
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const c = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), cookie)).json();
    const before = (await episodeAllowance(t.db, owner)).left;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await book({ character_id: c.id, partner_id: HOUSE_PARTNER_ID }, "pw-for-tests");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.booked).toBe(true);
    const ep = (await t.db.query<{ creator_id: string; visibility: string }>(`select creator_id, visibility from episodes where id = $1`, [body.episode_id])).rows[0];
    expect(ep).toEqual({ creator_id: owner, visibility: "public" });
    expect((await episodeAllowance(t.db, owner)).left).toBe(before);
  });

  it("a booking that fails takes its date back", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", "pw-for-tests");
    const cookie = newUserCookie();
    const c = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), cookie)).json();
    const res = await book({ character_id: c.id, partner_id: "no-such-character" }, "pw-for-tests");
    expect(res.ok).toBe(false);
    expect((await t.db.query(`select 1 from token_grants where user_id = $1`, [userIdOf(cookie)])).rows).toHaveLength(0);
  });
});
