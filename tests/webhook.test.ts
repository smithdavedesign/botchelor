import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG } from "@/lib/catalog";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { ownedSkus } from "@/lib/payments";
import {
  paymentsFromEnv,
  PaymentError,
  stripeCheckout,
  verifyStripeSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "@/lib/stripe";
import {
  api,
  checkoutEvent,
  episodeJson,
  FAKE_WEBHOOK_SECRET,
  hmacHex,
  newUserCookie,
  OTHER_WEBHOOK_SECRET,
  scriptedModel,
  startCheckout,
  startTestDb,
  stripeSignature,
  userIdOf,
  validCharacter,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
});

const now = () => Math.floor(Date.now() / 1000);
const premium = PREMIUM_HOUSE_CHARACTERS[0];

async function orderStatus(orderId: string): Promise<string> {
  const { rows } = await t.db.query<{ status: string }>("select status from orders where id = $1", [orderId]);
  return rows[0].status;
}

/** Nothing granted: the order is still pending, nothing is owned, and the premium date stays locked. */
async function expectNothingGranted(buyer: string, orderId: string) {
  expect(await orderStatus(orderId)).toBe("pending");
  expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([]);
  expect(await t.count("orders", "status = 'paid'")).toBe(0);
  const own = await (await api.createCharacter(validCharacter(), buyer)).json();
  scriptedModel([episodeJson()]);
  expect((await api.createEpisode({ character_id: own.id, partner_id: premium.id }, buyer)).status).toBe(402);
}

type BadCase = [label: string, deliver: (payload: string) => Promise<{ body: string; signature: string | null }>];

const BAD_SIGNATURES: BadCase[] = [
  ["signed with the wrong secret", async (p) => ({ body: p, signature: await stripeSignature(p, OTHER_WEBHOOK_SECRET) })],
  [
    "a body changed after signing (unpaid signed, paid sent)",
    async (p) => ({
      body: p,
      signature: await stripeSignature(p.replace('"payment_status":"paid"', '"payment_status":"unpaid"')),
    }),
  ],
  ["no Stripe-Signature header", async (p) => ({ body: p, signature: null })],
  ["a header with a timestamp but no v1", async (p) => ({ body: p, signature: `t=${now()}` })],
  ["only a v0 signature, even a correct one", async (p) => ({ body: p, signature: await stripeSignature(p, FAKE_WEBHOOK_SECRET, now(), "v0") })],
  [
    "a timestamp older than the tolerance (a replay)",
    async (p) => ({ body: p, signature: await stripeSignature(p, FAKE_WEBHOOK_SECRET, now() - WEBHOOK_TOLERANCE_SECONDS - 5) }),
  ],
  [
    "a timestamp too far in the future",
    async (p) => ({ body: p, signature: await stripeSignature(p, FAKE_WEBHOOK_SECRET, now() + WEBHOOK_TOLERANCE_SECONDS + 5) }),
  ],
  [
    "a v1 signed for a different timestamp than the header's",
    async (p) => ({ body: p, signature: `t=${now()},v1=${await hmacHex(FAKE_WEBHOOK_SECRET, `${now() - 10}.${p}`)}` }),
  ],
  ["a garbage header", async (p) => ({ body: p, signature: "definitely-not-a-signature" })],
  ["a v1 that is not a hex digest", async (p) => ({ body: p, signature: `t=${now()},v1=zz` })],
  ["a non-numeric timestamp", async (p) => ({ body: p, signature: (await stripeSignature(p)).replace(/^t=\d+/, "t=soon") })],
];

describe("a webhook with a bad signature returns 400 and grants nothing (exit criterion)", () => {
  it.each(BAD_SIGNATURES)("%s", async (_label, deliver) => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(premium.sku, buyer);
    const { body, signature } = await deliver(paidEvent());

    const res = await api.stripeWebhook(body, signature);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_signature");
    await expectNothingGranted(buyer, orderId);
  });

  it("grants the same event when it is correctly signed (control)", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(premium.sku, buyer);
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(await orderStatus(orderId)).toBe("paid");
    expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([premium.sku]);
  });

  it("accepts any matching v1 during a secret rotation", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout("frame_rose", buyer);
    const payload = paidEvent();
    const ts = now();
    const header = `t=${ts},v1=${await hmacHex(OTHER_WEBHOOK_SECRET, `${ts}.${payload}`)},v1=${await hmacHex(FAKE_WEBHOOK_SECRET, `${ts}.${payload}`)}`;
    expect((await api.stripeWebhook(payload, header)).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it("returns 500 and grants nothing when no webhook secret is configured (so Stripe retries later)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(premium.sku, buyer);
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("webhook_not_configured");
    await expectNothingGranted(buyer, orderId);
  });
});

describe("POST /api/webhooks/stripe with a valid signature", () => {
  const deliver = async (payload: string) => api.stripeWebhook(payload, await stripeSignature(payload));

  it("grants an order once, however many times Stripe delivers the event", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout("frame_gold", buyer);
    const payload = paidEvent();
    expect((await deliver(payload)).status).toBe(200);
    const first = (await t.db.query<{ paid_at: Date }>("select paid_at from orders where id = $1", [orderId])).rows[0].paid_at;
    expect((await deliver(payload)).status).toBe(200);
    expect((await deliver(paidEvent())).status).toBe(200); // a re-sent event with a new event id
    const { rows } = await t.db.query<{ status: string; paid_at: Date }>("select status, paid_at from orders");
    expect(rows).toEqual([{ status: "paid", paid_at: first }]);
  });

  it("waits for an async payment: unpaid completes nothing, async_payment_succeeded grants", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout("frame_gold", buyer);
    expect((await deliver(paidEvent({ payment_status: "unpaid" }))).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("pending");
    expect((await deliver(paidEvent({}, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it.each([
    ["an unknown order id", { client_reference_id: "00000000-0000-4000-8000-000000000000" }],
    ["a client_reference_id that isn't an order id", { client_reference_id: "someone-elses-app" }],
    ["no client_reference_id", { client_reference_id: null }],
    ["an amount below the catalog price", { amount_total: 1 }],
    ["a different currency", { currency: "eur" }],
    ["a checkout session other than the one created for the order", { id: "cs_test_made_elsewhere" }],
  ])("acknowledges but grants nothing for %s", async (_label, overrides) => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(premium.sku, buyer);
    const res = await deliver(paidEvent(overrides));
    expect(res.status).toBe(200);
    await expectNothingGranted(buyer, orderId);
  });

  it("acknowledges unrelated event types without granting anything", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(premium.sku, buyer);
    for (const type of ["checkout.session.expired", "payment_intent.succeeded", "charge.refunded"]) {
      expect((await deliver(paidEvent({}, type))).status).toBe(200);
    }
    await expectNothingGranted(buyer, orderId);
  });

  it("returns 400 for a correctly signed body that isn't a Stripe event", async () => {
    for (const payload of ["not json", JSON.stringify({ hello: "world" }), JSON.stringify({ type: "checkout.session.completed" })]) {
      const res = await deliver(payload);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_payload");
    }
  });

  it("returns 413 for an oversized body, before even checking its signature", async () => {
    const payload = checkoutEvent({ padding: "x".repeat(300_000) });
    expect((await api.stripeWebhook(payload, "t=1,v1=00")).status).toBe(413);
    expect((await deliver(payload)).status).toBe(413);
  });
});

describe("verifyStripeSignature", () => {
  const payload = checkoutEvent({ id: "cs_test_x", client_reference_id: "o", amount_total: 300 });

  it("accepts HMAC-SHA256(secret, `${t}.${rawBody}`) as hex, within the tolerance on either side", async () => {
    const ts = 1_800_000_000;
    const header = await stripeSignature(payload, FAKE_WEBHOOK_SECRET, ts);
    expect(verifyStripeSignature(payload, header, FAKE_WEBHOOK_SECRET, ts)).toBe(true);
    expect(verifyStripeSignature(payload, header, FAKE_WEBHOOK_SECRET, ts + WEBHOOK_TOLERANCE_SECONDS)).toBe(true);
    expect(verifyStripeSignature(payload, header, FAKE_WEBHOOK_SECRET, ts - WEBHOOK_TOLERANCE_SECONDS)).toBe(true);
    expect(verifyStripeSignature(payload, header, FAKE_WEBHOOK_SECRET, ts + WEBHOOK_TOLERANCE_SECONDS + 1)).toBe(false);
    expect(verifyStripeSignature(payload, header, FAKE_WEBHOOK_SECRET, ts - WEBHOOK_TOLERANCE_SECONDS - 1)).toBe(false);
  });

  it("checks the exact raw text: re-serialized JSON with the same meaning fails", async () => {
    const ts = now();
    const header = await stripeSignature(payload, FAKE_WEBHOOK_SECRET, ts);
    const reserialized = JSON.stringify(JSON.parse(payload), null, 2);
    expect(verifyStripeSignature(reserialized, header, FAKE_WEBHOOK_SECRET, ts)).toBe(false);
    expect(verifyStripeSignature(payload, header, "", ts)).toBe(false);
    expect(verifyStripeSignature(payload, null, FAKE_WEBHOOK_SECRET, ts)).toBe(false);
  });

  it("tolerates spaces and extra schemes in the header", async () => {
    const ts = now();
    const v1 = await hmacHex(FAKE_WEBHOOK_SECRET, `${ts}.${payload}`);
    expect(verifyStripeSignature(payload, ` t=${ts} , v0=abc , v1=${v1} `, FAKE_WEBHOOK_SECRET, ts)).toBe(true);
  });
});

describe("the Stripe Checkout client", () => {
  const secretKey = ["sk", "test", "A1b2C3d4".repeat(3)].join("_");
  const item = CATALOG.find((i) => i.kind === "house_character")!;
  const request = {
    orderId: "4f1c2b8e-1111-4222-8333-944455556666",
    item,
    successUrl: "https://botchelor.example/shop?checkout=success",
    cancelUrl: "https://botchelor.example/shop?checkout=cancelled",
  };

  function fakeFetch(respond: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("creates a one-item payment session priced from the catalog, keyed by the order id", async () => {
    const { calls, fetchImpl } = fakeFetch(() =>
      Response.json({ id: "cs_test_abc", url: "https://checkout.stripe.com/c/pay/cs_test_abc", object: "checkout.session" }),
    );
    const session = await stripeCheckout({ secretKey, fetchImpl }).createCheckoutSession(request);
    expect(session).toEqual({ id: "cs_test_abc", url: "https://checkout.stripe.com/c/pay/cs_test_abc" });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${secretKey}`);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("idempotency-key")).toBe(request.orderId);

    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({
      mode: "payment",
      client_reference_id: request.orderId,
      "metadata[order_id]": request.orderId,
      "metadata[sku]": item.sku,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(item.price_cents),
      "line_items[0][price_data][product_data][name]": item.name,
      "line_items[0][price_data][product_data][description]": item.description,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    expect(String(init.body)).not.toContain(secretKey);
  });

  it.each([
    ["an HTTP error", () => Response.json({ error: { message: "Invalid API Key provided" } }, { status: 401 })],
    ["a response without a url", () => Response.json({ id: "cs_test_abc" })],
    ["a non-https url", () => Response.json({ id: "cs_test_abc", url: "http://checkout.stripe.com/c/pay/cs_test_abc" })],
    ["a body that isn't JSON", () => new Response("<html>bad gateway</html>", { status: 200 })],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("throws PaymentError on %s, never echoing the key", async (_label, respond) => {
    const { fetchImpl } = fakeFetch(respond);
    const attempt = stripeCheckout({ secretKey, fetchImpl }).createCheckoutSession(request);
    await expect(attempt).rejects.toBeInstanceOf(PaymentError);
    await expect(attempt).rejects.not.toThrow(secretKey);
  });

  it("is switched off without STRIPE_SECRET_KEY, and on with it", () => {
    expect(paymentsFromEnv({})).toBeNull();
    expect(paymentsFromEnv({ STRIPE_SECRET_KEY: "" })).toBeNull();
    expect(paymentsFromEnv({ STRIPE_SECRET_KEY: secretKey })).not.toBeNull();
  });
});

describe("orders never leak who bought", () => {
  it("keeps the buyer's id out of what Stripe receives and what the webhook returns", async () => {
    const buyer = newUserCookie();
    const { request, paidEvent } = await startCheckout(CATALOG[0].sku, buyer);
    expect(JSON.stringify(request)).not.toContain(userIdOf(buyer));
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(await res.text()).not.toContain(userIdOf(buyer));
  });
});
