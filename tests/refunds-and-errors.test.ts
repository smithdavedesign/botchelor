import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/app/api/health/route";
import { episodeAllowance } from "@/lib/allowance";
import { cleanMessage, pruneServerErrors, recordServerError, routePattern, serverErrorSummary } from "@/lib/errors";
import { handle } from "@/lib/http";
import { api, BASE_URL, newUserCookie, openPayments, startCheckout, startTestDb, stripeSignature, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  openPayments(vi.stubEnv);
});
afterEach(() => vi.unstubAllEnvs());

/** Buys the pack and pays through PaymentIntent `pi`, as Stripe reports a completed Payment Link session. */
async function buyWith(cookie: string, pi: string) {
  const { orderId, paidEvent } = await startCheckout("pack_5", cookie);
  const payload = paidEvent({ payment_intent: pi });
  expect((await api.stripeWebhook(payload, await stripeSignature(payload))).status).toBe(200);
  return orderId;
}

function refundEvent(pi: string | null, refunded = true): string {
  return JSON.stringify({
    id: `evt_test_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: "charge.refunded",
    data: { object: { id: `ch_${randomUUID().slice(0, 8)}`, object: "charge", payment_intent: pi, refunded, amount: 400, amount_refunded: refunded ? 400 : 100 } },
  });
}
const deliver = async (payload: string) => api.stripeWebhook(payload, await stripeSignature(payload));

describe("a refund made in Stripe takes the pack's unused dates back", () => {
  it("a full refund marks the order refunded and removes its dates", async () => {
    const cookie = newUserCookie();
    const orderId = await buyWith(cookie, "pi_full_1");
    expect((await episodeAllowance(t.db, userIdOf(cookie))).pack_left).toBe(5);
    expect((await deliver(refundEvent("pi_full_1"))).status).toBe(200);
    expect((await t.db.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0].status).toBe("refunded");
    expect((await episodeAllowance(t.db, userIdOf(cookie))).pack_left).toBe(0);
    // A second delivery of the same refund changes nothing.
    expect((await deliver(refundEvent("pi_full_1"))).status).toBe(200);
    expect((await episodeAllowance(t.db, userIdOf(cookie))).pack_left).toBe(0);
  });

  it("a partial refund, or a payment we don't know, changes nothing", async () => {
    const cookie = newUserCookie();
    await buyWith(cookie, "pi_part_1");
    expect((await deliver(refundEvent("pi_part_1", false))).status).toBe(200);
    expect((await deliver(refundEvent("pi_nobody"))).status).toBe(200);
    expect((await deliver(refundEvent(null))).status).toBe(200);
    expect((await episodeAllowance(t.db, userIdOf(cookie))).pack_left).toBe(5);
  });

  it("an unsigned refund is refused and refunds nothing", async () => {
    const cookie = newUserCookie();
    await buyWith(cookie, "pi_forged");
    expect((await api.stripeWebhook(refundEvent("pi_forged"), "t=1,v1=00")).status).toBe(400);
    expect((await episodeAllowance(t.db, userIdOf(cookie))).pack_left).toBe(5);
  });
});

describe("server errors are counted for the monitor", () => {
  it("an unexpected API error is recorded with its route pattern and a cleaned message", async () => {
    const boom = handle(async () => {
      throw new Error("could not reach postgres://owner:pw@ep-x.neon.tech/db with Bearer abc.def");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await boom(new Request(`${BASE_URL}/api/assets/fe0088e8-183a-4354-a79a-b2c155c8a3ee?x=1`));
    logged.mockRestore();
    expect(res.status).toBe(500);
    const { rows } = await t.db.query<{ kind: string; route: string; message: string }>("select kind, route, message from server_errors");
    expect(rows).toEqual([{ kind: "api", route: "/api/assets/:id", message: "could not reach postgres://… with Bearer …" }]);
  });

  it("the health detail reports the last hour, and old rows are pruned", async () => {
    await recordServerError("render", "/feed", "boom", t.db);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const detail = await (await getHealth(new Request(`${BASE_URL}/api/health`, { headers: { authorization: "Bearer cron-secret" } }))).json();
    expect(detail.errors.last_hour).toBe(1);
    expect(detail.errors.latest).toMatchObject({ kind: "render", route: "/feed", message: "boom" });
    expect((await serverErrorSummary(t.db, new Date(Date.now() + 2 * 60 * 60 * 1000))).last_hour).toBe(0);
    await pruneServerErrors(t.db, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await t.count("server_errors")).toBe(0);
  });

  it("route patterns and messages never carry ids or secrets", () => {
    expect(routePattern("/characters/5169c199-24e7-4c68-855c-765774eeab1f/memory")).toBe("/characters/:id/memory");
    expect(routePattern("/watch/123?x=1")).toBe("/watch/:id");
    expect(cleanMessage("key " + ["sk", "live", "x".repeat(30)].join("_") + " failed")).toBe("key sk_… failed");
  });
});
