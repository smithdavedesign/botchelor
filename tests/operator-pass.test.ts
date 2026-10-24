import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as operatorWebhook } from "@/app/api/webhooks/stripe-operator/route";
import {
  agentForSubscription,
  grantOperatorPass,
  operatorPassActive,
  operatorPassOn,
  operatorReserved,
  releaseOperatorDate,
  reserveOperatorDate,
  RESERVED_PER_MONTH,
} from "@/lib/operator-pass";
import { FAKE_WEBHOOK_SECRET, startTestDb, stripeSignature } from "./helpers";

// The pass is off unless a flag or a link turns it on; the module tests pass this as the env explicitly.
const ON: Record<string, string | undefined> = { OPERATOR_PASS_ENABLED: "1" };

describe("operator pass (lib/operator-pass)", () => {
  it("is off by default and on with the flag or a live link", () => {
    expect(operatorPassOn({})).toBe(false);
    expect(operatorPassOn({ OPERATOR_PASS_ENABLED: "1" })).toBe(true);
    expect(operatorPassOn({ OPERATOR_PASS_LINK: "https://buy.stripe.com/live_pass" })).toBe(true);
    // A test-mode link doesn't count as purchasable on production.
    expect(operatorPassOn({ OPERATOR_PASS_LINK: "https://buy.stripe.com/test_pass", VERCEL_ENV: "production" })).toBe(false);
  });

  it("no pass means inactive, on or off", async () => {
    const { db } = await startTestDb();
    expect(await operatorPassActive(db, "agent:1", new Date(), {})).toBe(false); // off: short-circuits
    expect(await operatorPassActive(db, "agent:1", new Date(), ON)).toBe(false); // on, but no entitlement
    expect(await reserveOperatorDate(db, "agent:1", new Date(), ON)).toBe(false);
    expect(await operatorReserved(db, "agent:1", new Date(), ON)).toBeNull();
  });

  it("grants, reserves, releases, and lapses", async () => {
    const { db } = await startTestDb();
    const now = new Date("2026-11-10T00:00:00Z");
    await grantOperatorPass(db, "agent:1", "initial", { provider: "admin" }, now);
    expect(await operatorPassActive(db, "agent:1", now, ON)).toBe(true);
    // Off → inactive even with an entitlement.
    expect(await operatorPassActive(db, "agent:1", now, {})).toBe(false);

    expect(await operatorReserved(db, "agent:1", now, ON)).toEqual({ reserved_left: RESERVED_PER_MONTH, reserved_cap: RESERVED_PER_MONTH });
    expect(await reserveOperatorDate(db, "agent:1", now, ON)).toBe(true);
    expect((await operatorReserved(db, "agent:1", now, ON))!.reserved_left).toBe(RESERVED_PER_MONTH - 1);
    await releaseOperatorDate(db, "agent:1", now);
    expect((await operatorReserved(db, "agent:1", now, ON))!.reserved_left).toBe(RESERVED_PER_MONTH);

    await grantOperatorPass(db, "agent:1", "expiry", {}, now);
    expect(await operatorPassActive(db, "agent:1", now, ON)).toBe(false);
    expect(await reserveOperatorDate(db, "agent:1", now, ON)).toBe(false);
  });

  it("reserved dates stop at the monthly cap and reset the next month", async () => {
    const { db } = await startTestDb();
    const nov = new Date("2026-11-10T00:00:00Z");
    await grantOperatorPass(db, "agent:2", "initial", {}, nov);
    for (let i = 0; i < RESERVED_PER_MONTH; i++) expect(await reserveOperatorDate(db, "agent:2", nov, ON)).toBe(true);
    expect(await reserveOperatorDate(db, "agent:2", nov, ON)).toBe(false); // this month is used up

    const dec = new Date("2026-12-10T00:00:00Z");
    await grantOperatorPass(db, "agent:2", "rebill", {}, dec); // the subscription renewed
    expect(await reserveOperatorDate(db, "agent:2", dec, ON)).toBe(true); // a fresh month
  });

  it("cancel keeps access until period_end", async () => {
    const { db } = await startTestDb();
    const now = new Date("2026-11-10T00:00:00Z");
    await grantOperatorPass(db, "agent:3", "initial", {}, now); // active to ~Dec 10
    await grantOperatorPass(db, "agent:3", "cancel", {}, now); // cancelled, period_end unchanged
    expect(await operatorPassActive(db, "agent:3", now, ON)).toBe(true); // still inside the paid month
    expect(await operatorPassActive(db, "agent:3", new Date("2026-12-20T00:00:00Z"), ON)).toBe(false); // past period_end
  });

  it("maps a Stripe subscription id back to its agent", async () => {
    const { db } = await startTestDb();
    await grantOperatorPass(db, "agent:4", "initial", { provider: "stripe", subscriptionId: "sub_123" });
    expect(await agentForSubscription(db, "sub_123")).toBe("agent:4");
    expect(await agentForSubscription(db, "sub_nope")).toBeNull();
  });
});

describe("operator pass webhook (app/api/webhooks/stripe-operator)", () => {
  beforeEach(() => vi.unstubAllEnvs());

  const post = (payload: string, sig: string) =>
    operatorWebhook(
      new Request("http://localhost:3000/api/webhooks/stripe-operator", {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": sig },
        body: payload,
      }),
    );

  it("404s when the pass is off", async () => {
    await startTestDb();
    expect((await post("{}", "t=1,v1=00")).status).toBe(404);
  });

  it("grants a pass on a paid subscription checkout, once", async () => {
    const { db } = await startTestDb();
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    vi.stubEnv("OPERATOR_PASS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    const event = JSON.stringify({
      id: "evt_pass_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", client_reference_id: "agent:9", subscription: "sub_9" } },
    });
    expect((await post(event, await stripeSignature(event))).status).toBe(200);
    expect(await operatorPassActive(db, "agent:9", new Date(), { OPERATOR_PASS_ENABLED: "1" })).toBe(true);
    expect(await agentForSubscription(db, "sub_9")).toBe("agent:9");
    // A duplicate delivery of the same event changes nothing.
    expect((await post(event, await stripeSignature(event))).status).toBe(200);
  });

  it("rejects a bad signature", async () => {
    await startTestDb();
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    vi.stubEnv("OPERATOR_PASS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    expect((await post("{}", "t=1,v1=deadbeef")).status).toBe(400);
  });
});
