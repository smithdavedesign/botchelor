import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postTokens } from "@/app/api/admin/tokens/route";
import { claimAdmin } from "@/lib/admins";
import { episodeAllowance } from "@/lib/allowance";
import { refundOrder } from "@/lib/payments";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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

const topUp = (cookie: string) => postTokens(new Request(`${BASE_URL}/api/admin/tokens`, { method: "POST", headers: { cookie } }));

describe("admin token top-up", () => {
  it("an admin adds 20 free dates to their own account, each time; never an order", async () => {
    const id = userIdOf(newUserCookie());
    const admin = signedInCookie(id);
    await claimAdmin(t.db, id);
    const res = await topUp(admin);
    expect(res.status).toBe(200);
    expect((await res.json()).granted).toBe(20);
    expect((await episodeAllowance(t.db, id)).pack_left).toBe(20);
    await topUp(admin);
    expect((await episodeAllowance(t.db, id)).pack_left).toBe(40);
    expect((await t.db.query(`select 1 from orders where user_id = $1`, [id])).rows).toHaveLength(0);
  });

  it("an admin's bare user id, without signing in, is refused", async () => {
    const bare = newUserCookie();
    await claimAdmin(t.db, userIdOf(bare));
    expect((await topUp(bare)).status).toBe(403);
    expect((await episodeAllowance(t.db, userIdOf(bare))).pack_left).toBe(0);
  });

  it("anyone else is refused", async () => {
    const someone = newUserCookie();
    expect((await topUp(someone)).status).toBe(403);
    expect((await episodeAllowance(t.db, userIdOf(someone))).pack_left).toBe(0);
  });

  it("refunding a bought pack keeps the granted dates", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    await topUp(signedInCookie(id));
    await t.db.query(
      `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes, paid_at) values ('o1', $1, 'episode_pack_5', 'episode_pack', 400, 'usd', 'paid', 5, now())`,
      [id],
    );
    await t.db.query(`insert into pack_episode_usage (user_id, used) values ($1, 22)`, [id]);
    expect(await refundOrder(t.db, "o1")).toBe(true);
    expect((await t.db.query<{ used: number }>(`select used from pack_episode_usage where user_id = $1`, [id])).rows[0].used).toBe(20);
  });
});
