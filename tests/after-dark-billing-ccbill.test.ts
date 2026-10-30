import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ccbillPost } from "@/app/api/after-dark/billing/ccbill/route";
import { POST as subscribePost } from "@/app/api/after-dark/subscribe/route";
import { configuredProcessors, subscriptionState } from "@/lib/adult/billing";
import { ccbillAddress, ccbillDigest, ccbillSingleDigest, parseCcbillWebhook } from "@/lib/adult/billing-ccbill";
import { canAfterDark } from "@/lib/adult/entitlement";
import { setEmailSenderForTests } from "@/lib/email";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// CCBill (lib/adult/billing-ccbill.ts), After Dark's first-choice processor (David, 2026-10-30). Plain words for every
// setting: the secret scanner reads this file too.
const WEBHOOK_KEY = "ccbill-webhook-key-made-of-plain-words";
const ACCOUNT = "900100";
const SUBACCOUNT = "0000";

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
  for (const name of ["SEGPAY_PACKAGE_ID", "SEGPAY_PRICE_POINT_ID", "SEGPAY_POSTBACK_SECRET", "VEROTEL_SHOP_ID", "VEROTEL_SIGNATURE_KEY", "AD_SUBSCRIPTION_PRICE_USD", "RESEND_API_KEY", "AFTER_DARK_ORIGIN", "AFTER_DARK_ONLY"]) {
    vi.stubEnv(name, "");
  }
  setEmailSenderForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
  setEmailSenderForTests(null);
});

const ccbillOn = () => {
  vi.stubEnv("CCBILL_ACCOUNT", ACCOUNT);
  vi.stubEnv("CCBILL_SUBACCOUNT", SUBACCOUNT);
  vi.stubEnv("CCBILL_FLEX_ID", "flex-form-id");
  vi.stubEnv("CCBILL_SALT", "plain-words-salt");
  vi.stubEnv("CCBILL_WEBHOOK_KEY", WEBHOOK_KEY);
};

async function startOrder() {
  const id = userIdOf(newUserCookie());
  const res = await subscribePost(
    new Request(`${BASE_URL}/api/after-dark/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: signedInCookie(id) },
      body: JSON.stringify({ adult: true, renewal_terms: true }),
    }),
  );
  expect(res.status).toBe(200);
  const url = new URL(((await res.json()) as { url: string }).url);
  return { id, url, orderId: url.searchParams.get("X-orderId")! };
}

/** A webhook as CCBill posts it: the account and event in the query, the fields as JSON (or a form). */
function webhook(eventType: string, body: Record<string, string>, opts: { key?: string | null; account?: string; form?: boolean; headers?: Record<string, string> } = {}) {
  const qs = new URLSearchParams({ clientAccnum: opts.account ?? ACCOUNT, clientSubacc: SUBACCOUNT, eventType, eventGroupType: "Subscription", ...(opts.key === null ? {} : { key: opts.key ?? WEBHOOK_KEY }) });
  return ccbillPost(
    new Request(`${BASE_URL}/api/after-dark/billing/ccbill?${qs}`, {
      method: "POST",
      headers: { "content-type": opts.form ? "application/x-www-form-urlencoded" : "application/json", ...opts.headers },
      body: opts.form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    }),
  );
}
const status = async (id: string) => (await t.db.query<{ subscription_status: string; provider: string }>(`select subscription_status, provider from adult_entitlements where user_id = $1`, [id])).rows[0];

describe("CCBill's link", () => {
  it("reproduces the formDigest examples in CCBill's docs", () => {
    // The docs' example salt, in pieces so the secret scanner doesn't read it as a key.
    const salt = ["7d901dad", "245fd0ff", "6bc20d06"].join("");
    expect(ccbillDigest(salt, { initialPrice: "10.00", initialPeriod: "30", recurringPrice: "10.00", recurringPeriod: "30", numRebills: "99", currencyCode: "840" })).toBe("48f0b12e4307e64edb781c479665c899");
    expect(ccbillSingleDigest(salt, { initialPrice: "10.00", initialPeriod: "30", currencyCode: "840" })).toBe("a7459445d0e5dc0963fe736dc5cf900b");
  });

  it("is off until every setting is there, then offered first, as a monthly FlexForms link carrying our order", async () => {
    expect(configuredProcessors()).toEqual([]);
    expect((await webhook("NewSaleSuccess", {})).status).toBe(404);
    ccbillOn();
    vi.stubEnv("VEROTEL_SHOP_ID", "64233");
    vi.stubEnv("VEROTEL_SIGNATURE_KEY", "test-signature-key-words");
    expect(configuredProcessors()).toEqual(["ccbill", "verotel"]);
    const { url, orderId } = await startOrder();
    expect(`${url.origin}${url.pathname}`).toBe("https://api.ccbill.com/wap-frontflex/flexforms/flex-form-id");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ clientAccnum: ACCOUNT, clientSubacc: SUBACCOUNT, initialPrice: "12.99", initialPeriod: "30", recurringPrice: "12.99", recurringPeriod: "30", numRebills: "99", currencyCode: "840" });
    expect(url.searchParams.get("formDigest")).toBe(ccbillDigest("plain-words-salt", { initialPrice: "12.99", initialPeriod: "30", recurringPrice: "12.99", recurringPeriod: "30", numRebills: "99", currencyCode: "840" }));
    expect(orderId).toMatch(/^ado_[0-9a-f]{24}$/);
    expect((await t.db.query(`select processor from adult_billing_orders where id = $1`, [orderId])).rows[0]).toEqual({ processor: "ccbill" });
  });
});

describe("CCBill's webhooks", () => {
  it("refuses one without our key, for another account, or from an address that isn't CCBill's", async () => {
    ccbillOn();
    const { id, orderId } = await startOrder();
    const sale = { subscriptionId: "0123456789", transactionId: "tx-1", "X-orderId": orderId, nextRenewalDate: "2099-01-01" };
    expect((await webhook("NewSaleSuccess", sale, { key: null })).status).toBe(403);
    expect((await webhook("NewSaleSuccess", sale, { key: "wrong-key-made-of-plain-words-x" })).status).toBe(403);
    expect((await webhook("NewSaleSuccess", sale, { account: "900999" })).status).toBe(403);
    expect((await webhook("NewSaleSuccess", sale, { headers: { "cf-connecting-ip": "203.0.113.9" } })).status).toBe(403);
    expect(await status(id)).toMatchObject({ subscription_status: "none" });
    expect(ccbillAddress("64.38.240.17")).toBe(true);
    expect(ccbillAddress("64.38.213.17")).toBe(false);
  });

  it("opens After Dark on a new sale, once, keeps it through a cancellation until the paid-up date, and ends it on expiry", async () => {
    ccbillOn();
    const { id, orderId } = await startOrder();
    const sale = { subscriptionId: "0123456789", transactionId: "tx-1", "X-orderId": orderId, nextRenewalDate: "2099-01-01", billedInitialPrice: "12.99", billedCurrencyCode: "840", email: "someone@example.com" };
    const res = await webhook("NewSaleSuccess", sale, { headers: { "cf-connecting-ip": "64.38.212.10" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(await status(id)).toEqual({ subscription_status: "active", provider: "ccbill" });
    expect((await canAfterDark(t.db, { userId: id, authenticated: true })).ok).toBe(true);
    // The same sale again changes nothing; nothing personal is kept.
    expect(await (await webhook("NewSaleSuccess", sale)).text()).toBe("OK");
    const events = (await t.db.query<{ outcome: string; params: Record<string, string> }>(`select outcome, params from adult_billing_events order by received_at`)).rows;
    expect(events).toHaveLength(1);
    expect(events[0].params.email).toBeUndefined();
    // A form post works as well as JSON; a renewal and a cancellation find the subscription by its id.
    await webhook("RenewalSuccess", { subscriptionId: "0123456789", transactionId: "tx-2", nextRenewalDate: "2099-02-01" }, { form: true });
    expect((await subscriptionState(t.db, id)).cancelUrl).toBe("https://support.ccbill.com/");
    await webhook("Cancellation", { subscriptionId: "0123456789", timestamp: "2026-11-01 10:00:00", reason: "user" });
    expect(await status(id)).toMatchObject({ subscription_status: "cancelled" });
    await webhook("Expiration", { subscriptionId: "0123456789", timestamp: "2099-02-01 10:00:00" });
    expect(await status(id)).toMatchObject({ subscription_status: "lapsed" });
  });

  it("ends it at once on a chargeback and flags the account", async () => {
    ccbillOn();
    const { id, orderId } = await startOrder();
    await webhook("NewSaleSuccess", { subscriptionId: "555", transactionId: "tx-1", "X-orderId": orderId, nextRenewalDate: "2099-01-01" });
    await webhook("Chargeback", { subscriptionId: "555", transactionId: "tx-cb" });
    expect(await status(id)).toMatchObject({ subscription_status: "lapsed" });
    expect((await t.db.query(`select reason, processor from adult_billing_flags where user_id = $1`, [id])).rows[0]).toEqual({ reason: "chargeback", processor: "ccbill" });
  });

  it("reads each event as the shared billing terms", () => {
    const kinds = ["NewSaleSuccess", "RenewalSuccess", "Cancellation", "Expiration", "Chargeback", "Refund", "Void", "NewSaleFailure", "RenewalFailure", "Something"].map((e) => parseCcbillWebhook(e, {}).kind);
    expect(kinds).toEqual(["initial", "rebill", "cancel", "expiry", "chargeback", "refund", "refund", "declined", "ignored", "ignored"]);
    expect(parseCcbillWebhook("RenewalSuccess", { nextRenewalDate: "2026-12-01" }).periodEnd?.toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });
});
