import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { episodeAllowance } from "@/lib/allowance";
import { catalogItem, ON_SALE } from "@/lib/catalog";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON as FREE } from "@/lib/rules";
import {
  paymentLinkFromEnv,
  paymentLinkUrl,
  priceLabelFromEnv,
  verifyStripeSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "@/lib/stripe";
import {
  api,
  checkoutEvent,
  FAKE_PAYMENT_LINK,
  FAKE_WEBHOOK_SECRET,
  grantByHand,
  hmacHex,
  newSessionId,
  newUserCookie,
  openPayments,
  OTHER_WEBHOOK_SECRET,
  startCheckout,
  startTestDb,
  stripeSignature,
  userIdOf,
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
  openPayments(vi.stubEnv);
});

const now = () => Math.floor(Date.now() / 1000);
const PACK = ON_SALE[0];
const packLeft = async (buyer: string) => (await episodeAllowance(t.db, userIdOf(buyer))).pack_left;

async function orderStatus(orderId: string): Promise<string> {
  const { rows } = await t.db.query<{ status: string }>("select status from orders where id = $1", [orderId]);
  return rows[0].status;
}

/** Nothing granted: the order is still pending, nothing is owned, and no pack date was added. */
async function expectNothingGranted(buyer: string, orderId: string) {
  expect(await orderStatus(orderId)).toBe("pending");
  expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([]);
  expect(await t.count("orders", "status = 'paid'")).toBe(0);
  expect(await episodeAllowance(t.db, userIdOf(buyer))).toMatchObject({ pack_left: 0, left: FREE });
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
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const { body, signature } = await deliver(paidEvent());

    const res = await api.stripeWebhook(body, signature);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_signature");
    await expectNothingGranted(buyer, orderId);
  });

  it("grants the same event when it is correctly signed (control)", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(await orderStatus(orderId)).toBe("paid");
    expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([PACK.sku]);
    expect(await packLeft(buyer)).toBe(PACK.episodes);
  });

  it("never grants a test-mode event on the production site, except during the test-mode proof run", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const payload = JSON.stringify({ ...JSON.parse(paidEvent()), livemode: false });
    vi.stubEnv("VERCEL_ENV", "production");
    const ignored = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(ignored.status).toBe(200); // so Stripe stops retrying
    await expectNothingGranted(buyer, orderId);

    vi.stubEnv("STRIPE_ALLOW_TEST_LINK", "1");
    expect((await api.stripeWebhook(payload, await stripeSignature(payload))).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
    vi.unstubAllEnvs();
    openPayments(vi.stubEnv);
  });

  it("accepts any matching v1 during a secret rotation", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const payload = paidEvent();
    const ts = now();
    const header = `t=${ts},v1=${await hmacHex(OTHER_WEBHOOK_SECRET, `${ts}.${payload}`)},v1=${await hmacHex(FAKE_WEBHOOK_SECRET, `${ts}.${payload}`)}`;
    expect((await api.stripeWebhook(payload, header)).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it("returns 500 and grants nothing when no webhook secret is configured (so Stripe retries later)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("webhook_not_configured");
    await expectNothingGranted(buyer, orderId);
  });
});

describe("POST /api/webhooks/stripe with a valid signature (Payment Link sessions)", () => {
  const deliver = async (payload: string) => api.stripeWebhook(payload, await stripeSignature(payload));

  it("records the Stripe session and the amount actually charged on the order", async () => {
    const buyer = newUserCookie();
    const { orderId, sessionId, paidEvent } = await startCheckout(PACK.sku, buyer);
    expect((await deliver(paidEvent({ amount_total: PACK.price_cents + 100 }))).status).toBe(200);
    const { rows } = await t.db.query("select status, stripe_session_id, amount_cents, currency, paid_at from orders where id = $1", [
      orderId,
    ]);
    expect(rows[0]).toMatchObject({ status: "paid", stripe_session_id: sessionId, amount_cents: PACK.price_cents + 100, currency: "usd" });
    expect(rows[0].paid_at).not.toBeNull();
  });

  it("grants a session once, however many times Stripe delivers it", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const payload = paidEvent();
    expect((await deliver(payload)).status).toBe(200);
    const first = (await t.db.query<{ paid_at: Date }>("select paid_at from orders where id = $1", [orderId])).rows[0].paid_at;
    expect((await deliver(payload)).status).toBe(200);
    expect((await deliver(paidEvent())).status).toBe(200); // a re-sent event with a new event id, same session
    expect((await deliver(paidEvent({}, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    const { rows } = await t.db.query<{ status: string; paid_at: Date }>("select status, paid_at from orders");
    expect(rows).toEqual([{ status: "paid", paid_at: first }]);
    expect(await packLeft(buyer)).toBe(PACK.episodes);
  });

  it("gives a second payment through the same link URL its own pack, once (a Payment Link can be paid again)", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    expect((await deliver(paidEvent())).status).toBe(200);
    const again = newSessionId();
    const second = paidEvent({ id: again });
    expect((await deliver(second)).status).toBe(200);
    expect((await deliver(second)).status).toBe(200); // the second payment, delivered twice
    expect(await packLeft(buyer)).toBe(PACK.episodes! * 2);

    const { rows } = await t.db.query<{ id: string; user_id: string; sku: string; status: string; episodes: number }>(
      "select id, user_id, sku, status, episodes from orders where stripe_session_id = $1",
      [again],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userIdOf(buyer), sku: PACK.sku, status: "paid", episodes: PACK.episodes });
    expect(rows[0].id).not.toBe(orderId);
    expect(await t.count("orders", "status = 'paid'")).toBe(2);
  });

  it("gives a payment on a refunded order's link its own pack too", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    expect((await deliver(paidEvent())).status).toBe(200);
    await t.db.query("update orders set status = 'refunded' where id = $1", [orderId]);
    expect(await packLeft(buyer)).toBe(0);
    expect((await deliver(paidEvent({ id: newSessionId() }))).status).toBe(200);
    expect(await packLeft(buyer)).toBe(PACK.episodes);
  });

  it("never clones a one-time item: a second payment referencing an owned frame grants nothing more", async () => {
    const buyer = newUserCookie();
    const frameOrder = await grantByHand(t.db, buyer, "frame_rose");
    const payload = checkoutEvent({
      id: newSessionId(),
      client_reference_id: frameOrder,
      amount_total: catalogItem("frame_rose")!.price_cents,
    });
    expect((await deliver(payload)).status).toBe(200);
    expect(await t.count("orders")).toBe(1);
  });

  it("waits for an async payment: unpaid completes nothing, async_payment_succeeded grants", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    expect((await deliver(paidEvent({ payment_status: "unpaid" }))).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("pending");
    expect((await deliver(paidEvent({}, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("paid");
  });

  it.each([
    ["an unknown order id", { client_reference_id: "00000000-0000-4000-8000-000000000000" }],
    ["a client_reference_id that isn't an order id", { client_reference_id: "someone-elses-app" }],
    ["no client_reference_id (paid on the bare link, or Stripe dropped it)", { client_reference_id: null }],
    ["an amount below the list price", { amount_total: 1 }],
    ["no amount", { amount_total: null }],
    ["a different currency", { currency: "eur" }],
    ["a session that didn't come from a Payment Link", { payment_link: null }],
  ])("acknowledges but grants nothing for %s", async (_label, overrides) => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    const res = await deliver(paidEvent(overrides));
    expect(res.status).toBe(200);
    await expectNothingGranted(buyer, orderId);
  });

  it("refuses an under-priced second payment on a used link, too", async () => {
    const buyer = newUserCookie();
    const { paidEvent } = await startCheckout(PACK.sku, buyer);
    expect((await deliver(paidEvent())).status).toBe(200);
    expect((await deliver(paidEvent({ id: newSessionId(), amount_total: 1 }))).status).toBe(200);
    expect((await deliver(paidEvent({ id: newSessionId(), payment_link: null }))).status).toBe(200);
    expect(await t.count("orders", "status = 'paid'")).toBe(1);
  });

  it("acknowledges unrelated event types without granting anything", async () => {
    const buyer = newUserCookie();
    const { orderId, paidEvent } = await startCheckout(PACK.sku, buyer);
    // charge.refunded is handled now: tests/refunds-and-errors.test.ts.
    for (const type of ["checkout.session.expired", "payment_intent.succeeded"]) {
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
  const payload = checkoutEvent({ id: "cs_test_x", client_reference_id: "o", amount_total: 400 });

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

describe("the Payment Link settings", () => {
  it("reads STRIPE_PAYMENT_LINK, else NEXT_PUBLIC_STRIPE_PAYMENT_LINK, and only as an https URL", () => {
    expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK })?.href).toBe(FAKE_PAYMENT_LINK);
    expect(paymentLinkFromEnv({ NEXT_PUBLIC_STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK })?.href).toBe(FAKE_PAYMENT_LINK);
    expect(
      paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK, NEXT_PUBLIC_STRIPE_PAYMENT_LINK: "https://example.com/other" })?.href,
    ).toBe(FAKE_PAYMENT_LINK);
    expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: `  ${FAKE_PAYMENT_LINK}  ` })?.href).toBe(FAKE_PAYMENT_LINK);
    for (const bad of [undefined, "", "   ", "http://buy.stripe.com/test_x", "buy.stripe.com/test_x", "javascript:alert(1)", "ftp://x.y/z"]) {
      expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: bad })).toBeNull();
    }
  });

  it("on the production site a test-mode link means purchases aren't open (a real card would be declined)", () => {
    const live = "https://buy.stripe.com/aB3cD4eF5gH6";
    expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK, VERCEL_ENV: "production" })).toBeNull();
    expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: live, VERCEL_ENV: "production" })?.href).toBe(live);
    // Previews, local runs and tests keep the test link; a deliberate test-mode run on prod can opt in.
    expect(paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK, VERCEL_ENV: "preview" })?.href).toBe(FAKE_PAYMENT_LINK);
    expect(
      paymentLinkFromEnv({ STRIPE_PAYMENT_LINK: FAKE_PAYMENT_LINK, VERCEL_ENV: "production", STRIPE_ALLOW_TEST_LINK: "1" })?.href,
    ).toBe(FAKE_PAYMENT_LINK);
  });

  it("adds the order id as client_reference_id without touching the configured link", () => {
    const link = new URL(`${FAKE_PAYMENT_LINK}?prefilled_promo_code=LAUNCH`);
    const orderId = "4f1c2b8e-1111-4222-8333-944455556666";
    expect(paymentLinkUrl(link, orderId)).toBe(`${FAKE_PAYMENT_LINK}?prefilled_promo_code=LAUNCH&client_reference_id=${orderId}`);
    expect(link.search).toBe("?prefilled_promo_code=LAUNCH");
  });

  it("uses STRIPE_PRICE_LABEL for the Buy button, trimmed and capped, with a plain fallback", () => {
    expect(priceLabelFromEnv({ STRIPE_PRICE_LABEL: " 5 more dates · $4 " }, "Buy for $4")).toBe("5 more dates · $4");
    expect(priceLabelFromEnv({ STRIPE_PRICE_LABEL: "" }, "Buy for $4")).toBe("Buy for $4");
    expect(priceLabelFromEnv({}, "Buy for $4")).toBe("Buy for $4");
    expect(priceLabelFromEnv({ STRIPE_PRICE_LABEL: "x".repeat(200) }, "Buy for $4")).toHaveLength(60);
  });
});

describe("orders never leak who bought", () => {
  it("keeps the buyer's id out of the Payment Link url and what the webhook returns", async () => {
    const buyer = newUserCookie();
    const { url, paidEvent } = await startCheckout(PACK.sku, buyer);
    expect(url).not.toContain(userIdOf(buyer));
    const payload = paidEvent();
    const res = await api.stripeWebhook(payload, await stripeSignature(payload));
    expect(await res.text()).not.toContain(userIdOf(buyer));
  });
});
