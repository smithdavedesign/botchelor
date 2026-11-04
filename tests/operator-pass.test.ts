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
import { RENEWAL_GRACE_MS } from "@/lib/stripe";
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

  it("a pass Stripe renews keeps going while the renewal is billed; a comp ends on its date", async () => {
    const { db } = await startTestDb();
    const now = new Date("2026-11-10T00:00:00Z");
    const end = new Date("2026-12-10T00:00:00Z");
    await grantOperatorPass(db, "agent:5", "initial", { provider: "stripe", subscriptionId: "sub_5", periodEnd: end }, now);
    await grantOperatorPass(db, "agent:6", "initial", { provider: "admin", periodEnd: end }, now);
    const hourLate = new Date(end.getTime() + 60 * 60 * 1000);
    expect(await operatorPassActive(db, "agent:5", hourLate, ON)).toBe(true);
    expect(await operatorPassActive(db, "agent:5", new Date(end.getTime() + RENEWAL_GRACE_MS + 1000), ON)).toBe(false);
    expect(await operatorPassActive(db, "agent:6", hourLate, ON)).toBe(false);
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

  const ends = async (db: Awaited<ReturnType<typeof startTestDb>>["db"], agentId: string) =>
    (await db.query<{ subscription_status: string; period_end: Date | string | null }>(`select subscription_status, period_end from operator_entitlements where user_id = $1`, [agentId])).rows[0];
  const at = (unix: number) => new Date(unix * 1000).toISOString();
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    return post(body, await stripeSignature(body));
  };
  const bought = (n: number) =>
    send({
      id: `evt_buy_${n}`,
      type: "checkout.session.completed",
      data: { object: { id: `cs_${n}`, mode: "subscription", payment_status: "paid", client_reference_id: `agent:${n}`, subscription: `sub_${n}` } },
    });

  it("renews on a paid cycle invoice, to the period it paid for, in the shape the account's API version sends", async () => {
    const { db } = await startTestDb();
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    vi.stubEnv("OPERATOR_PASS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    await bought(20);
    await bought(21);
    const period = { start: 1_800_000_000, end: 1_802_678_400 };
    // From 2025-03-31 on: the subscription is under parent.subscription_details.
    const renewed = await send({
      id: "evt_renew_20",
      type: "invoice.paid",
      data: { object: { id: "in_20", billing_reason: "subscription_cycle", parent: { type: "subscription_details", subscription_details: { subscription: "sub_20" } }, lines: { data: [{ period }] } } },
    });
    expect(renewed.status).toBe(200);
    expect(await ends(db, "agent:20")).toMatchObject({ subscription_status: "active" });
    expect(new Date((await ends(db, "agent:20")).period_end!).toISOString()).toBe(at(period.end));
    // Before it: on the invoice itself.
    await send({ id: "evt_renew_21", type: "invoice.paid", data: { object: { id: "in_21", billing_reason: "subscription_cycle", subscription: "sub_21", lines: { data: [{ period }] } } } });
    expect(new Date((await ends(db, "agent:21")).period_end!).toISOString()).toBe(at(period.end));
    // The first invoice isn't a renewal: the checkout already granted that month.
    await send({ id: "evt_first_21", type: "invoice.paid", data: { object: { id: "in_21a", billing_reason: "subscription_create", subscription: "sub_21", lines: { data: [{ period: { start: 1, end: 2 } }] } } } });
    expect(new Date((await ends(db, "agent:21")).period_end!).toISOString()).toBe(at(period.end));
  });

  it("a cancel keeps the pass to the date Stripe ends it, set either way", async () => {
    const { db } = await startTestDb();
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    vi.stubEnv("OPERATOR_PASS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    await bought(30);
    await bought(31);
    const periodEnd = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
    // Today's shape: the period's end is on the items, and a cancel can come as cancel_at.
    await send({
      id: "evt_cancel_30",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_30", status: "active", cancel_at_period_end: false, cancel_at: periodEnd, items: { data: [{ current_period_end: periodEnd }] } } },
    });
    expect(await ends(db, "agent:30")).toMatchObject({ subscription_status: "cancelled" });
    expect(new Date((await ends(db, "agent:30")).period_end!).toISOString()).toBe(at(periodEnd));
    expect(await operatorPassActive(db, "agent:30", new Date(), ON)).toBe(true);
    expect(await operatorPassActive(db, "agent:30", new Date((periodEnd + 60) * 1000), ON)).toBe(false); // a cancelled pass gets no grace
    // The older shape: cancel_at_period_end with the date on the subscription.
    await send({ id: "evt_cancel_31", type: "customer.subscription.updated", data: { object: { id: "sub_31", status: "active", cancel_at_period_end: true, current_period_end: periodEnd } } });
    expect(new Date((await ends(db, "agent:31")).period_end!).toISOString()).toBe(at(periodEnd));
    // An update that doesn't end it changes nothing, and a deleted subscription lapses the pass.
    await send({ id: "evt_upd_31", type: "customer.subscription.updated", data: { object: { id: "sub_31", status: "active", cancel_at_period_end: false, cancel_at: null } } });
    expect(await ends(db, "agent:31")).toMatchObject({ subscription_status: "cancelled" });
    await send({ id: "evt_del_31", type: "customer.subscription.deleted", data: { object: { id: "sub_31", status: "canceled" } } });
    expect(await ends(db, "agent:31")).toMatchObject({ subscription_status: "lapsed" });
  });

  it("rejects a bad signature", async () => {
    await startTestDb();
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    vi.stubEnv("OPERATOR_PASS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    expect((await post("{}", "t=1,v1=deadbeef")).status).toBe(400);
  });
});
