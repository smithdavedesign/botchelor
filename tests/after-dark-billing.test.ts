import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as clearFlagPost } from "@/app/api/admin/after-dark/billing/route";
import { GET as segpayGet, POST as segpayPost } from "@/app/api/after-dark/billing/segpay/route";
import { GET as verotelGet } from "@/app/api/after-dark/billing/verotel/route";
import { POST as subscribePost } from "@/app/api/after-dark/subscribe/route";
import { deleteAfterDarkData } from "@/lib/account";
import { claimAdmin } from "@/lib/admins";
import { configuredProcessors, sendRenewalReminders, subscriptionState } from "@/lib/adult/billing";
import { parseSegpayPostback, segpayPayPageUrl } from "@/lib/adult/billing-segpay";
import { verotelSignature, verotelSignatureValid, verotelStartOrderUrl } from "@/lib/adult/billing-verotel";
import { canAfterDark } from "@/lib/adult/entitlement";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// After Dark's subscription billing (lib/adult/billing.ts): Segpay first, Verotel as backup, off until configured.
// Plain words for every setting: the secret scanner reads this file too.
const VEROTEL_KEY = "test-signature-key-words";
const VEROTEL_SHOP = "64233";
const SEGPAY_SECRET = "segpay-postback-secret-made-of-plain-words-for-tests";

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
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  for (const name of [
    "SEGPAY_PACKAGE_ID", "SEGPAY_PRICE_POINT_ID", "SEGPAY_POSTBACK_SECRET", "SEGPAY_POSTBACK_IPS", "VEROTEL_SHOP_ID", "VEROTEL_SIGNATURE_KEY",
    "VEROTEL_PERIOD", "AD_SUBSCRIPTION_PRICE_USD", "AD_SUBSCRIPTION_NAME", "RESEND_API_KEY", "AFTER_DARK_ORIGIN", "AFTER_DARK_ONLY",
  ]) {
    vi.stubEnv(name, "");
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
  setEmailSenderForTests(null);
});

const verotelOn = () => {
  vi.stubEnv("VEROTEL_SHOP_ID", VEROTEL_SHOP);
  vi.stubEnv("VEROTEL_SIGNATURE_KEY", VEROTEL_KEY);
};
const segpayOn = () => {
  vi.stubEnv("SEGPAY_PACKAGE_ID", "100200");
  vi.stubEnv("SEGPAY_PRICE_POINT_ID", "3000");
  vi.stubEnv("SEGPAY_POSTBACK_SECRET", SEGPAY_SECRET);
};

function person() {
  const id = userIdOf(newUserCookie());
  return { id, cookie: signedInCookie(id) };
}

const subscribe = (cookie: string | null, body: unknown = { adult: true, renewal_terms: true }, headers: Record<string, string> = {}) =>
  subscribePost(
    new Request(`${BASE_URL}/api/after-dark/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(body),
    }),
  );

/** Subscribes `who` through the route and returns the order id the processor would hand back. */
async function startOrder(who: { cookie: string }, processor?: "segpay" | "verotel"): Promise<{ url: URL; orderId: string }> {
  const res = await subscribe(who.cookie, { adult: true, renewal_terms: true, ...(processor ? { processor } : {}) });
  expect(res.status).toBe(200);
  const url = new URL(((await res.json()) as { url: string }).url);
  return { url, orderId: url.searchParams.get("referenceID") ?? url.searchParams.get("REF1")! };
}

/** A Verotel postback, signed the way Verotel signs it. */
function verotelPostback(params: Record<string, string>, key = VEROTEL_KEY) {
  const all = { shopID: VEROTEL_SHOP, type: "subscription", ...params };
  const qs = new URLSearchParams({ ...all, signature: verotelSignature(key, all) });
  return verotelGet(new Request(`${BASE_URL}/api/after-dark/billing/verotel?${qs}`));
}

function segpayPostback(params: Record<string, string>, secret: string | null = SEGPAY_SECRET, headers: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...(secret !== null ? { secret } : {}), ...params });
  return segpayGet(new Request(`${BASE_URL}/api/after-dark/billing/segpay?${qs}`, { headers }));
}

const entitlement = async (id: string) =>
  (await t.db.query<{ subscription_status: string; period_end: Date | null; provider: string | null; age_method: string | null; age_country: string | null }>(
    `select subscription_status, period_end, provider, age_method, age_country from adult_entitlements where user_id = $1`,
    [id],
  )).rows[0];
const access = (id: string, now?: Date) => canAfterDark(t.db, { userId: id, authenticated: true }, now);

describe("off until a processor is configured", () => {
  it("offers nothing: no processors, the routes are not found, no reminders", async () => {
    expect(configuredProcessors()).toEqual([]);
    const who = person();
    expect((await subscribe(who.cookie)).status).toBe(404);
    expect((await verotelPostback({ event: "initial", referenceID: "ado_x", saleID: "1" })).status).toBe(404);
    expect((await segpayPostback({ trantype: "Sale", action: "Auth", stage: "Initial", approved: "Yes" })).status).toBe(404);
    expect(await sendRenewalReminders(t.db)).toBe(0);
    expect(await t.count("rate_hits")).toBe(0);
  });

  it("needs every setting: a short Segpay secret or a non-numeric shop leaves that processor off", () => {
    vi.stubEnv("SEGPAY_PACKAGE_ID", "100200");
    vi.stubEnv("SEGPAY_PRICE_POINT_ID", "3000");
    vi.stubEnv("SEGPAY_POSTBACK_SECRET", "too-short");
    vi.stubEnv("VEROTEL_SHOP_ID", "shop");
    vi.stubEnv("VEROTEL_SIGNATURE_KEY", VEROTEL_KEY);
    expect(configuredProcessors()).toEqual([]);
    segpayOn();
    verotelOn();
    expect(configuredProcessors()).toEqual(["segpay", "verotel"]);
  });
});

describe("Verotel's signature", () => {
  it("is SHA-256 of the key then name=value sorted by name, joined with colons (the FlexPay docs' worked example)", () => {
    const params = { description: "Super video download", priceAmount: "9.99", priceCurrency: "USD", custom1: "xxyyzz", shopID: "64233", type: "purchase", version: "4" };
    const expected = createHash("sha256")
      .update(`${VEROTEL_KEY}:custom1=xxyyzz:description=Super video download:priceAmount=9.99:priceCurrency=USD:shopID=64233:type=purchase:version=4`)
      .digest("hex");
    expect(verotelSignature(VEROTEL_KEY, params)).toBe(expected);
    // Empty values aren't signed; the signature itself never is.
    expect(verotelSignature(VEROTEL_KEY, { ...params, custom2: "", signature: "x" })).toBe(expected);
  });

  it("accepts a good postback (any case, or the older SHA-1) and refuses a changed one or another key", () => {
    const p = { shopID: VEROTEL_SHOP, event: "rebill", saleID: "77", transactionID: "9001", nextChargeOn: "2026-12-01" };
    const sig = verotelSignature(VEROTEL_KEY, p);
    expect(verotelSignatureValid(VEROTEL_KEY, { ...p, signature: sig })).toBe(true);
    expect(verotelSignatureValid(VEROTEL_KEY, { ...p, signature: sig.toUpperCase() })).toBe(true);
    expect(verotelSignatureValid(VEROTEL_KEY, { ...p, signature: verotelSignature(VEROTEL_KEY, p, "sha1") })).toBe(true);
    expect(verotelSignatureValid(VEROTEL_KEY, { ...p, nextChargeOn: "2027-12-01", signature: sig })).toBe(false);
    expect(verotelSignatureValid("another-key-in-words", { ...p, signature: sig })).toBe(false);
    expect(verotelSignatureValid(VEROTEL_KEY, p)).toBe(false);
  });

  it("signs the startorder link for a monthly recurring subscription", () => {
    const url = new URL(
      verotelStartOrderUrl(
        { shopId: VEROTEL_SHOP, signatureKey: VEROTEL_KEY, period: "P1M" },
        { referenceId: "ado_abc", priceUsd: 12.99, name: "Botchelor After Dark", successUrl: "https://botchelor.com/after-dark/subscribe?done=1", declineUrl: "https://botchelor.com/after-dark/subscribe?declined=1" },
      ),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://secure.verotel.com/startorder");
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({ version: "4", shopID: VEROTEL_SHOP, type: "subscription", subscriptionType: "recurring", period: "P1M", priceAmount: "12.99", priceCurrency: "USD", referenceID: "ado_abc", name: "Botchelor After Dark" });
    expect(verotelSignatureValid(VEROTEL_KEY, p)).toBe(true);
  });
});

describe("subscribing", () => {
  it("refuses an anonymous cookie, a crawler, and a request without both confirmations", async () => {
    verotelOn();
    expect((await subscribe(newUserCookie())).status).toBe(401);
    const who = person();
    expect((await subscribe(who.cookie, { adult: true, renewal_terms: true }, { "user-agent": "GPTBot/1.0" })).status).toBe(403);
    for (const body of [{}, { adult: true }, { renewal_terms: true }, { adult: false, renewal_terms: true }, { adult: "yes", renewal_terms: true }]) {
      const res = await subscribe(who.cookie, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe("confirmations_required");
    }
    expect((await t.db.query(`select count(*)::int as n from adult_billing_orders`)).rows[0]).toEqual({ n: 0 });
    expect(await entitlement(who.id)).toBeUndefined();
  });

  it("refuses where After Dark isn't offered (Texas), with the reason, and records nothing", async () => {
    verotelOn();
    setPlaceForTests({ country: "US", region: "TX" });
    const who = person();
    const res = await subscribe(who.cookie);
    expect(res.status).toBe(451);
    expect(((await res.json()) as { message: string }).message).toMatch(/^Texas requires/);
    expect(await entitlement(who.id)).toBeUndefined();
    expect((await t.db.query(`select count(*)::int as n from adult_billing_orders`)).rows[0]).toEqual({ n: 0 });
  });

  it("records the 18+ self-declaration and the country once, opens an order, and offers Segpay first", async () => {
    segpayOn();
    verotelOn();
    setPlaceForTests({ country: "GB", region: null }); // text only: subscribing is still allowed
    const who = person();
    const { url, orderId } = await startOrder(who);
    expect(`${url.origin}${url.pathname}`).toBe("https://secure2.segpay.com/billing/poset.cgi");
    expect(url.searchParams.get("x-eticketid")).toBe("100200:3000");
    expect(orderId).toMatch(/^ado_[0-9a-f]{24}$/);
    expect(url.searchParams.get("x-auth-link")).toBe(`${BASE_URL}/after-dark/subscribe?done=1`);
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "none", age_method: "self_declared", age_country: "GB" });
    const row = (await t.db.query(`select user_id, processor, price_usd from adult_billing_orders where id = $1`, [orderId])).rows[0];
    expect(row).toEqual({ user_id: who.id, processor: "segpay", price_usd: "12.99" });
    // Asking for Verotel gets Verotel; the declaration isn't written again.
    await t.db.query(`update adult_entitlements set age_verified_at = '2026-01-01T00:00:00Z' where user_id = $1`, [who.id]);
    const second = await startOrder(who, "verotel");
    expect(second.url.hostname).toBe("secure.verotel.com");
    const at = (await t.db.query<{ age_verified_at: Date }>(`select age_verified_at from adult_entitlements where user_id = $1`, [who.id])).rows[0];
    expect(at.age_verified_at.toISOString()).toBe(new Date("2026-01-01").toISOString());
  });

  it("refuses someone already subscribed", async () => {
    verotelOn();
    const who = person();
    const { orderId } = await startOrder(who);
    await verotelPostback({ event: "initial", referenceID: orderId, saleID: "500", nextChargeOn: "2099-01-01" });
    expect((await subscribe(who.cookie)).status).toBe(409);
  });
});

describe("Verotel's postbacks", () => {
  async function subscribed() {
    verotelOn();
    const who = person();
    const { orderId } = await startOrder(who);
    const res = await verotelPostback({ event: "initial", referenceID: orderId, saleID: "501", transactionID: "7001", priceAmount: "12.99", priceCurrency: "USD", nextChargeOn: "2099-01-01", truncatedPAN: "411111XXXXXX1111", CCBrand: "VISA" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    return { ...who, orderId };
  }

  it("initial: active until the next charge, and opens After Dark; card details aren't kept", async () => {
    const who = await subscribed();
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "active", provider: "verotel" });
    expect((await entitlement(who.id)).period_end?.toISOString()).toBe("2099-01-02T00:00:00.000Z");
    expect(await access(who.id)).toEqual({ ok: true, why: "subscribed" });
    const ev = (await t.db.query<{ params: Record<string, string>; outcome: string; kind: string }>(`select params, outcome, kind from adult_billing_events`)).rows[0];
    expect(ev).toMatchObject({ outcome: "applied", kind: "initial" });
    expect(ev.params).not.toHaveProperty("truncatedPAN");
    expect(ev.params).not.toHaveProperty("CCBrand");
    expect(ev.params).toMatchObject({ saleID: "501", referenceID: who.orderId });
    const state = await subscriptionState(t.db, who.id);
    expect(state).toMatchObject({ status: "active", processor: "verotel" });
    expect(state.cancelUrl).toMatch(/^https:\/\/secure\.verotel\.com\/cancel-subscription\?/);
    expect(verotelSignatureValid(VEROTEL_KEY, Object.fromEntries(new URL(state.cancelUrl!).searchParams))).toBe(true);
  });

  it("rebill: the same transaction twice is applied once", async () => {
    const who = await subscribed();
    await t.db.query(`update adult_entitlements set period_end = '2099-01-02T00:00:00Z' where user_id = $1`, [who.id]);
    const rebill = { event: "rebill", referenceID: who.orderId, saleID: "501", transactionID: "7002", amount: "12.99", currency: "USD" };
    for (let i = 0; i < 2; i++) expect(await (await verotelPostback(rebill)).text()).toBe("OK");
    // No nextChargeOn: a month on from the paid-up date, once.
    expect((await entitlement(who.id)).period_end?.toISOString()).toBe("2099-02-02T00:00:00.000Z");
    expect((await t.db.query(`select count(*)::int as n from adult_billing_events where kind = 'rebill'`)).rows[0]).toEqual({ n: 1 });
  });

  it("cancel: no more charges, but access until the end of what was paid for; then it's over", async () => {
    const who = await subscribed();
    await verotelPostback({ event: "cancel", referenceID: who.orderId, saleID: "501", expiresOn: "2099-01-01", cancelledBy: "user" });
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "cancelled" });
    expect(await access(who.id)).toEqual({ ok: true, why: "subscribed" });
    expect(await access(who.id, new Date("2099-01-03"))).toEqual({ ok: false, why: "needs_subscription" });
    expect((await subscriptionState(t.db, who.id)).status).toBe("cancelled");
    expect((await subscriptionState(t.db, who.id, new Date("2099-01-03"))).status).toBe("lapsed");
    // Uncancel opens it again; a second cancel after it still counts (not taken for a retry of the first).
    await verotelPostback({ event: "uncancel", referenceID: who.orderId, saleID: "501", nextChargeOn: "2099-01-01", uncancelledBy: "support" });
    expect((await entitlement(who.id)).subscription_status).toBe("active");
    await verotelPostback({ event: "cancel", referenceID: who.orderId, saleID: "501", expiresOn: "2099-01-01", cancelledBy: "user" });
    expect((await entitlement(who.id)).subscription_status).toBe("cancelled");
  });

  it("a cancelled row with nothing paid up doesn't open it", async () => {
    const who = person();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, period_end, age_verified_at) values ($1, 'cancelled', null, now())`, [who.id]);
    expect(await access(who.id)).toEqual({ ok: false, why: "needs_subscription" });
  });

  it("expiry: lapsed at once", async () => {
    const who = await subscribed();
    await verotelPostback({ event: "expiry", referenceID: who.orderId, saleID: "501" });
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "lapsed" });
    expect((await access(who.id)).ok).toBe(false);
  });

  it("chargeback: lapsed at once and flagged; subscribing again waits for an admin", async () => {
    const who = await subscribed();
    await verotelPostback({ event: "chargeback", referenceID: who.orderId, saleID: "501", transactionID: "7003", parentID: "7001", priceAmount: "12.99", priceCurrency: "USD", subscriptionPhase: "terminated" });
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "lapsed" });
    expect((await access(who.id)).ok).toBe(false);
    expect((await subscriptionState(t.db, who.id)).flagged).toBe(true);
    const again = await subscribe(who.cookie);
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: string }).error).toBe("billing_review");
    // Only an admin clears it.
    const clear = (cookie: string) =>
      clearFlagPost(new Request(`${BASE_URL}/api/admin/after-dark/billing`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ user_id: who.id }) }));
    expect((await clear(who.cookie)).status).toBe(404);
    const admin = person();
    await claimAdmin(t.db, admin.id);
    expect((await clear(admin.cookie)).status).toBe(200);
    expect((await subscribe(who.cookie)).status).toBe(200);
  });

  it("credit: a full refund lapses and flags; a partial one that leaves it running changes nothing", async () => {
    const who = await subscribed();
    await verotelPostback({ event: "credit", referenceID: who.orderId, saleID: "501", transactionID: "7004", parentID: "7001", subscriptionPhase: "normal" });
    expect((await entitlement(who.id)).subscription_status).toBe("active");
    await verotelPostback({ event: "credit", referenceID: who.orderId, saleID: "501", transactionID: "7005", parentID: "7001", subscriptionPhase: "terminated" });
    expect((await entitlement(who.id)).subscription_status).toBe("lapsed");
    expect((await subscriptionState(t.db, who.id)).flagged).toBe(true);
  });

  it("refuses a bad signature or another shop, and answers an order it can't place with an error (so Verotel refunds it)", async () => {
    const who = await subscribed();
    const before = await t.db.query(`select count(*)::int as n from adult_billing_events`);
    const forged = await verotelPostback({ event: "expiry", referenceID: who.orderId, saleID: "501" }, "a-guessed-key-in-words");
    expect(forged.status).toBe(400);
    expect(await forged.text()).toMatch(/^ERROR/);
    expect((await verotelPostback({ event: "expiry", referenceID: who.orderId, saleID: "501", shopID: "99999" })).status).toBe(400);
    expect((await t.db.query(`select count(*)::int as n from adult_billing_events`)).rows[0]).toEqual(before.rows[0]);
    expect((await entitlement(who.id)).subscription_status).toBe("active");
    const stray = await verotelPostback({ event: "initial", referenceID: "ado_000000000000000000000000", saleID: "999" });
    expect(stray.status).toBe(400);
    expect((await t.db.query(`select outcome from adult_billing_events where sale_id = '999'`)).rows[0]).toEqual({ outcome: "unknown_order" });
  });
});

describe("Segpay's postbacks", () => {
  async function subscribed() {
    segpayOn();
    const who = person();
    const { orderId } = await startOrder(who);
    const res = await segpayPostback({ action: "Auth", stage: "Initial", approved: "Yes", trantype: "Sale", purchaseid: "880", tranid: "5001", price: "12.99", currencycode: "USD", iint: "30", rint: "30", ref1: orderId, email: "someone@example.com", ip: "203.0.113.9" });
    expect(await res.text()).toBe("OK");
    return { ...who, orderId };
  }

  it("needs our secret, and a listed address when there's a list", async () => {
    const who = await subscribed();
    for (const secret of [null, "wrong", `${SEGPAY_SECRET}x`]) {
      const res = await segpayPostback({ action: "Disable", purchaseid: "880" }, secret);
      expect(res.status, String(secret)).toBe(403);
    }
    expect((await entitlement(who.id)).subscription_status).toBe("active");
    vi.stubEnv("SEGPAY_POSTBACK_IPS", "198.51.100.7, 198.51.100.8");
    expect((await segpayPostback({ action: "Disable", purchaseid: "880" }, SEGPAY_SECRET, { "x-forwarded-for": "203.0.113.50" })).status).toBe(403);
    expect((await segpayPostback({ action: "Disable", purchaseid: "880" }, SEGPAY_SECRET, { "x-forwarded-for": "198.51.100.8" })).status).toBe(200);
    expect((await entitlement(who.id)).subscription_status).toBe("lapsed");
  });

  it("signup: active for the initial period; nothing personal is kept", async () => {
    const who = await subscribed();
    const e = await entitlement(who.id);
    expect(e).toMatchObject({ subscription_status: "active", provider: "segpay" });
    const days = (e.period_end!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const params = (await t.db.query<{ params: Record<string, string> }>(`select params from adult_billing_events`)).rows[0].params;
    expect(params).not.toHaveProperty("email");
    expect(params).not.toHaveProperty("ip");
    expect(params).not.toHaveProperty("secret");
    expect((await subscriptionState(t.db, who.id)).cancelUrl).toBe("https://cs.segpay.com/");
  });

  it("renewal: the same tranid twice is applied once (form-posted too)", async () => {
    const who = await subscribed();
    const rebill = new URLSearchParams({ action: "Auth", stage: "Rebill", approved: "Yes", trantype: "Sale", purchaseid: "880", tranid: "5002", rint: "30" });
    for (let i = 0; i < 2; i++) {
      const res = await segpayPost(
        new Request(`${BASE_URL}/api/after-dark/billing/segpay?secret=${SEGPAY_SECRET}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: rebill.toString() }),
      );
      expect(await res.text()).toBe("OK");
    }
    expect((await t.db.query(`select count(*)::int as n from adult_billing_events where kind = 'rebill'`)).rows[0]).toEqual({ n: 1 });
  });

  it("Cancellation keeps access to the end; Disable lapses; Reactivation opens it again", async () => {
    const who = await subscribed();
    await segpayPostback({ action: "Cancel", purchaseid: "880" });
    expect((await entitlement(who.id)).subscription_status).toBe("cancelled");
    expect((await access(who.id)).ok).toBe(true);
    await segpayPostback({ action: "Disable", purchaseid: "880" });
    expect((await entitlement(who.id)).subscription_status).toBe("lapsed");
    expect((await access(who.id)).ok).toBe(false);
    await segpayPostback({ action: "Reactivation", purchaseid: "880", nextbilldate: "01/15/2099" });
    expect(await entitlement(who.id)).toMatchObject({ subscription_status: "active" });
    expect((await entitlement(who.id)).period_end?.toISOString()).toBe("2099-01-15T00:00:00.000Z");
  });

  it("chargeback (Charge) lapses and flags at once, even after a Disable carrying the same tranid", async () => {
    const who = await subscribed();
    await segpayPostback({ action: "Disable", purchaseid: "880", tranid: "5009" });
    await segpayPostback({ action: "Auth", stage: "Initial", approved: "Yes", trantype: "Charge", purchaseid: "880", tranid: "5009", relatedtranid: "5001" });
    expect((await entitlement(who.id)).subscription_status).toBe("lapsed");
    expect((await subscriptionState(t.db, who.id)).flagged).toBe(true);
  });

  it("reads the matrix: declines and won-back chargebacks change nothing; credits, voids and RDR refunds are refunds", () => {
    const k = (p: Record<string, string>) => parseSegpayPostback(p).kind;
    expect(k({ trantype: "Sale", action: "Auth", stage: "Initial", approved: "No" })).toBe("declined");
    expect(k({ trantype: "Sale", action: "Auth", stage: "Conversion", approved: "Yes" })).toBe("rebill");
    expect(k({ trantype: "Sale", action: "Auth", stage: "Instant Conversion", approved: "Yes" })).toBe("rebill");
    expect(k({ TRANTYPE: "SALE", ACTION: "AUTH", STAGE: "INITIAL", APPROVED: "YES" })).toBe("initial");
    expect(k({ trantype: "Sale", action: "Void", stage: "Initial", approved: "Yes" })).toBe("refund");
    expect(k({ trantype: "Credit", action: "Auth", stage: "Initial", approved: "Yes" })).toBe("refund");
    expect(k({ trantype: "RDRreversal", action: "Auth", stage: "Initial", approved: "Yes" })).toBe("refund");
    expect(k({ trantype: "CBReversal", action: "Auth", stage: "Initial", approved: "Yes" })).toBe("ignored");
    expect(k({ action: "Inquiry" })).toBe("ignored");
    const url = new URL(segpayPayPageUrl({ packageId: "1", pricePointId: "2", postbackSecret: SEGPAY_SECRET, postbackIps: [] }, { referenceId: "ado_x", successUrl: "https://a/b", declineUrl: "https://a/c" }));
    expect(url.searchParams.get("REF1")).toBe("ado_x");
    expect(url.search).not.toContain(SEGPAY_SECRET);
  });
});

describe("deleting the account", () => {
  it("removes the flag and the subscription, and keeps the orders and postbacks unlinked", async () => {
    verotelOn();
    const who = person();
    const { orderId } = await startOrder(who);
    await verotelPostback({ event: "initial", referenceID: orderId, saleID: "601", nextChargeOn: "2099-01-01" });
    await verotelPostback({ event: "chargeback", referenceID: orderId, saleID: "601", transactionID: "8001", subscriptionPhase: "terminated" });
    await deleteAfterDarkData(t.db, who.id);
    expect(await entitlement(who.id)).toBeUndefined();
    expect((await t.db.query(`select count(*)::int as n from adult_billing_flags where user_id = $1`, [who.id])).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query(`select user_id from adult_billing_orders where id = $1`, [orderId])).rows).toEqual([{ user_id: null }]);
    expect((await t.db.query(`select count(*)::int as n from adult_billing_events where user_id is null`)).rows[0]).toEqual({ n: 2 });
    // A postback that arrives afterwards finds no account and changes nothing.
    await verotelPostback({ event: "expiry", referenceID: orderId, saleID: "601" });
    expect((await t.db.query(`select outcome from adult_billing_events where kind = 'expiry'`)).rows[0]).toEqual({ outcome: "no_account" });
  });
});

describe("California's notices", () => {
  it("sends the confirmation on signing up and the yearly reminder on each anniversary, discreetly, once", async () => {
    verotelOn();
    vi.stubEnv("RESEND_API_KEY", "resend-test-key-in-words");
    const sent: EmailMessage[] = [];
    setEmailSenderForTests(async (msg) => {
      sent.push(msg);
    });
    const who = person();
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, 'subscriber@example.com', 'on', now())`, [who.id]);
    const { orderId } = await startOrder(who);
    await verotelPostback({ event: "initial", referenceID: orderId, saleID: "701", nextChargeOn: "2099-01-01" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "subscriber@example.com", subject: "Your Botchelor subscription" });
    expect(sent[0].text).toMatch(/\$12\.99 a month and renews every month until you cancel/);
    expect(sent[0].text).toMatch(/VTSUP\.COM/);
    expect(sent[0].text).toMatch(/\/cancel/);
    expect(`${sent[0].subject} ${sent[0].text}`).not.toMatch(/after dark|adult|nsfw|explicit|sex/i);

    const start = new Date("2026-03-10T12:00:00Z");
    await t.db.query(`update adult_entitlements set subscribed_at = $2, period_end = '2099-01-01T00:00:00Z' where user_id = $1`, [who.id, start.toISOString()]);
    expect(await sendRenewalReminders(t.db, new Date("2027-03-09T12:00:00Z"))).toBe(0);
    expect(await sendRenewalReminders(t.db, new Date("2027-03-10T13:00:00Z"))).toBe(1);
    expect(sent[1].text).toMatch(/yearly reminder/);
    expect(await sendRenewalReminders(t.db, new Date("2027-03-11T13:00:00Z"))).toBe(0);
    expect(await sendRenewalReminders(t.db, new Date("2028-03-10T13:00:00Z"))).toBe(1);
    // A cancelled subscription gets no reminder.
    await t.db.query(`update adult_entitlements set subscription_status = 'cancelled' where user_id = $1`, [who.id]);
    expect(await sendRenewalReminders(t.db, new Date("2029-03-10T13:00:00Z"))).toBe(0);
  });
});
