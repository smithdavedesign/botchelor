import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminGrantPost } from "@/app/api/admin/after-dark/tokens/route";
import { GET as segpayGet } from "@/app/api/after-dark/billing/segpay/route";
import { GET as verotelGet } from "@/app/api/after-dark/billing/verotel/route";
import { POST as buyPost } from "@/app/api/after-dark/tokens/route";
import { deleteAfterDarkData } from "@/lib/account";
import { claimAdmin, grantTokens } from "@/lib/admins";
import { episodeAllowance } from "@/lib/allowance";
import { ccbillSingleDigest, ccbillSinglePayUrl } from "@/lib/adult/billing-ccbill";
import { parseVerotelPostback, verotelPurchaseUrl, verotelSignature, verotelSignatureValid } from "@/lib/adult/billing-verotel";
import { adTokenBalance, adTokensOn, grantAdTokens, refundAdTokens, spendAdTokens, tokenPacks, tokenProcessors } from "@/lib/adult/tokens";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// After Dark's own token packs (lib/adult/tokens.ts, David 2026-11-04): one-time orders on the adult processors, a balance
// apart from the show's, off (spending the show's tokens) until a processor can sell a pack. Plain words for every
// setting: the secret scanner reads this file too.
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
    "CCBILL_ACCOUNT", "CCBILL_SUBACCOUNT", "CCBILL_FLEX_ID", "CCBILL_SALT", "CCBILL_WEBHOOK_KEY", "SEGPAY_PACKAGE_ID", "SEGPAY_PRICE_POINT_ID",
    "SEGPAY_POSTBACK_SECRET", "SEGPAY_POSTBACK_IPS", "SEGPAY_TOKEN_PRICE_POINTS", "VEROTEL_SHOP_ID", "VEROTEL_SIGNATURE_KEY", "VEROTEL_PERIOD",
    "AD_TOKEN_PACKS", "AFTER_DARK_ORIGIN", "AFTER_DARK_ONLY", "RESEND_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
});

const verotelOn = () => {
  vi.stubEnv("VEROTEL_SHOP_ID", VEROTEL_SHOP);
  vi.stubEnv("VEROTEL_SIGNATURE_KEY", VEROTEL_KEY);
};
const segpayOn = (points = "") => {
  vi.stubEnv("SEGPAY_PACKAGE_ID", "100200");
  vi.stubEnv("SEGPAY_PRICE_POINT_ID", "3000");
  vi.stubEnv("SEGPAY_POSTBACK_SECRET", SEGPAY_SECRET);
  vi.stubEnv("SEGPAY_TOKEN_PRICE_POINTS", points);
};

/** A subscriber: After Dark is open to them. */
async function subscriber() {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, period_end, provider, age_verified_at) values ($1, 'active', '2099-01-01', 'verotel', now())`, [id]);
  return { id, cookie: signedInCookie(id) };
}

const buy = (cookie: string | null, body: unknown) =>
  buyPost(
    new Request(`${BASE_URL}/api/after-dark/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

/** A Verotel postback, signed the way Verotel signs it; a purchase's own success postback has no event. */
function verotelPostback(params: Record<string, string>) {
  const all = { shopID: VEROTEL_SHOP, type: "purchase", ...params };
  const qs = new URLSearchParams({ ...all, signature: verotelSignature(VEROTEL_KEY, all) });
  return verotelGet(new Request(`${BASE_URL}/api/after-dark/billing/verotel?${qs}`));
}

/** Buys a pack through the route and returns the order id Verotel would hand back. */
async function order(who: { cookie: string }, tokens = 10): Promise<string> {
  const res = await buy(who.cookie, { tokens });
  expect(res.status).toBe(200);
  return new URL(((await res.json()) as { url: string }).url).searchParams.get("referenceID")!;
}

const flagged = async (id: string) => (await t.db.query(`select reason from adult_billing_flags where user_id = $1`, [id])).rows[0];

describe("the packs and who sells them", () => {
  it("David's packs by default, AD_TOKEN_PACKS to change them; nothing sells them until a processor is set up", () => {
    expect(tokenPacks()).toEqual([
      { tokens: 10, usd: 9.99 },
      { tokens: 25, usd: 22.99 },
      { tokens: 50, usd: 42.99 },
    ]);
    expect(tokenPacks({ AD_TOKEN_PACKS: "30:24.99, 5:4.99, junk, 0:1" })).toEqual([
      { tokens: 5, usd: 4.99 },
      { tokens: 30, usd: 24.99 },
    ]);
    // A video (8 tokens) never brings in less than about 86¢ a token, on the biggest pack.
    for (const p of tokenPacks()) expect(p.usd / p.tokens).toBeGreaterThan(0.85);
    expect(adTokensOn()).toBe(false);
    expect(tokenProcessors()).toEqual([]);
  });

  it("Verotel and CCBill price any pack; Segpay only the packs with a price point of their own", () => {
    segpayOn();
    expect(tokenProcessors()).toEqual([]);
    expect(adTokensOn()).toBe(false);
    segpayOn("10:3101,25:3102");
    expect(tokenProcessors()).toEqual(["segpay"]);
    expect(tokenProcessors(process.env, { tokens: 50, usd: 42.99 })).toEqual([]);
    verotelOn();
    expect(tokenProcessors(process.env, { tokens: 50, usd: 42.99 })).toEqual(["verotel"]);
  });

  it("CCBill's link is a single charge: no recurring fields, signed with the single digest", () => {
    const url = new URL(ccbillSinglePayUrl({ accnum: "900000", subacc: "0001", flexId: "flex-1", salt: "salt-words", webhookKey: "x".repeat(24) }, { referenceId: "ado_a", priceUsd: 9.99 }));
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({ initialPrice: "9.99", initialPeriod: "30", currencyCode: "840", "X-orderId": "ado_a" });
    expect(p).not.toHaveProperty("recurringPrice");
    expect(p).not.toHaveProperty("numRebills");
    expect(p.formDigest).toBe(ccbillSingleDigest("salt-words", { initialPrice: "9.99", initialPeriod: "30", currencyCode: "840" }));
  });

  it("Verotel's link is a signed purchase, and its success postback (no event, type=purchase) is a first payment", () => {
    const url = new URL(verotelPurchaseUrl({ shopId: VEROTEL_SHOP, signatureKey: VEROTEL_KEY, period: "P1M" }, { referenceId: "ado_b", priceUsd: 22.99, description: "25 tokens", successUrl: "https://a/ok", declineUrl: "https://a/no" }));
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({ type: "purchase", priceAmount: "22.99", priceCurrency: "USD", description: "25 tokens", referenceID: "ado_b" });
    expect(p).not.toHaveProperty("subscriptionType");
    expect(verotelSignatureValid(VEROTEL_KEY, p)).toBe(true);
    expect(parseVerotelPostback({ type: "purchase", referenceID: "ado_b", saleID: "9", transactionID: "1" }).kind).toBe("initial");
    expect(parseVerotelPostback({ type: "purchase", event: "credit", referenceID: "ado_b" }).kind).toBe("refund");
    expect(parseVerotelPostback({ type: "subscription", referenceID: "ado_b" }).kind).toBe("ignored");
  });
});

describe("the balance", () => {
  it("until a processor sells packs, After Dark spends and refunds the show's bought tokens, as before", async () => {
    const id = userIdOf(newUserCookie());
    await grantTokens(t.db, id, 5, "test");
    expect(await adTokenBalance(t.db, id)).toBe(5);
    expect(await spendAdTokens(t.db, id, 3)).toBe(true);
    expect((await episodeAllowance(t.db, id)).pack_left).toBe(2);
    expect(await spendAdTokens(t.db, id, 3)).toBe(false);
    await refundAdTokens(t.db, id, 3);
    expect(await adTokenBalance(t.db, id)).toBe(5);
  });

  it("once they're sold, it's After Dark's own: the show's tokens don't count, and it never overdraws or refunds below zero", async () => {
    verotelOn();
    const id = userIdOf(newUserCookie());
    await grantTokens(t.db, id, 5, "test");
    expect(await adTokenBalance(t.db, id)).toBe(0);
    expect(await spendAdTokens(t.db, id, 1)).toBe(false);
    await grantAdTokens(t.db, id, 10, "admin-x");
    expect(await spendAdTokens(t.db, id, 8)).toBe(true);
    expect(await spendAdTokens(t.db, id, 3)).toBe(false);
    expect(await adTokenBalance(t.db, id)).toBe(2);
    await refundAdTokens(t.db, id, 50);
    expect(await adTokenBalance(t.db, id)).toBe(10);
    // The show's own tokens weren't touched.
    expect((await episodeAllowance(t.db, id)).pack_left).toBe(5);
  });
});

describe("buying a pack", () => {
  it("is not found until a processor sells packs, and refuses an anonymous cookie, someone After Dark isn't open to, and a missing pack", async () => {
    const who = await subscriber();
    expect((await buy(who.cookie, { tokens: 10 })).status).toBe(404);
    verotelOn();
    expect((await buy(newUserCookie(), { tokens: 10 })).status).toBe(401);
    const stranger = userIdOf(newUserCookie());
    expect((await buy(signedInCookie(stranger), { tokens: 10 })).status).toBe(404);
    expect((await buy(who.cookie, { tokens: 11 })).status).toBe(422);
    expect((await t.db.query(`select count(*)::int as n from adult_billing_orders`)).rows[0]).toEqual({ n: 0 });
  });

  it("refuses where After Dark's pictures and videos aren't offered", async () => {
    verotelOn();
    const who = await subscriber();
    setPlaceForTests({ country: "US", region: "TX" });
    expect((await buy(who.cookie, { tokens: 10 })).status).toBe(451);
  });

  it("opens a one-time order and Verotel's purchase link; the tokens come with the postback, once", async () => {
    verotelOn();
    const who = await subscriber();
    const orderId = await order(who, 25);
    expect((await t.db.query(`select kind, tokens, price_usd::text as price, paid_at from adult_billing_orders where id = $1`, [orderId])).rows[0]).toEqual({
      kind: "tokens",
      tokens: 25,
      price: "22.99",
      paid_at: null,
    });
    expect(await adTokenBalance(t.db, who.id)).toBe(0);
    const paid = { referenceID: orderId, saleID: "801", transactionID: "9001", priceAmount: "22.99", priceCurrency: "USD", truncatedPAN: "411111XXXXXX1111" };
    for (let i = 0; i < 2; i++) expect(await (await verotelPostback(paid)).text()).toBe("OK");
    expect(await adTokenBalance(t.db, who.id)).toBe(25);
    expect((await t.db.query(`select count(*)::int as n from adult_token_grants where order_id = $1`, [orderId])).rows[0]).toEqual({ n: 1 });
    // The subscription is untouched, and Verotel's cancel link still names the subscription, not the pack.
    expect((await t.db.query(`select subscription_status from adult_entitlements where user_id = $1`, [who.id])).rows[0]).toEqual({ subscription_status: "active" });
  });

  it("a refund or chargeback takes back what's left of the pack (not what was spent) and waits for an admin before the next buy", async () => {
    verotelOn();
    const who = await subscriber();
    const first = await order(who);
    await verotelPostback({ referenceID: first, saleID: "811", transactionID: "9101" });
    expect(await spendAdTokens(t.db, who.id, 8)).toBe(true);
    expect(await (await verotelPostback({ event: "chargeback", referenceID: first, saleID: "811", transactionID: "9102", parentID: "9101" })).text()).toBe("OK");
    expect(await adTokenBalance(t.db, who.id)).toBe(0);
    expect(await flagged(who.id)).toEqual({ reason: "chargeback" });
    expect((await t.db.query(`select subscription_status from adult_entitlements where user_id = $1`, [who.id])).rows[0]).toEqual({ subscription_status: "active" });
    const res = await buy(who.cookie, { tokens: 10 });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "billing_review" });
    // Cleared, the next pack is whole: the 8 spent aren't taken out of it.
    await t.db.query(`update adult_billing_flags set reviewed_at = now() where user_id = $1`, [who.id]);
    const second = await order(who);
    await verotelPostback({ referenceID: second, saleID: "812", transactionID: "9103" });
    expect(await adTokenBalance(t.db, who.id)).toBe(10);
  });

  it("a renewal, cancel or expiry naming a pack changes nothing", async () => {
    verotelOn();
    const who = await subscriber();
    const orderId = await order(who);
    await verotelPostback({ referenceID: orderId, saleID: "821", transactionID: "9201" });
    for (const event of ["rebill", "cancel", "expiry"]) await verotelPostback({ event, referenceID: orderId, saleID: "821", transactionID: `92${event}` });
    expect(await adTokenBalance(t.db, who.id)).toBe(10);
    expect((await t.db.query(`select subscription_status from adult_entitlements where user_id = $1`, [who.id])).rows[0]).toEqual({ subscription_status: "active" });
    expect((await t.db.query<{ outcome: string }>(`select outcome from adult_billing_events where kind <> 'initial' order by received_at`)).rows.map((r) => r.outcome)).toEqual(["ignored", "ignored", "ignored"]);
  });

  it("on Segpay, a pack uses its own price point and Segpay's signup postback grants it", async () => {
    segpayOn("10:3101");
    const who = await subscriber();
    const res = await buy(who.cookie, { tokens: 10 });
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.searchParams.get("x-eticketid")).toBe("100200:3101");
    expect((await buy(who.cookie, { tokens: 25 })).status).toBe(422);
    const ref = url.searchParams.get("REF1")!;
    const qs = new URLSearchParams({ secret: SEGPAY_SECRET, trantype: "Sale", stage: "Initial", approved: "Yes", tranid: "s-1", purchaseid: "p-1", ref1: ref, price: "9.99" });
    expect((await segpayGet(new Request(`${BASE_URL}/api/after-dark/billing/segpay?${qs}`))).status).toBe(200);
    expect(await adTokenBalance(t.db, who.id)).toBe(10);
  });
});

describe("an admin's grant", () => {
  it("is for signed-in admins only, to an account that exists", async () => {
    verotelOn();
    const admin = userIdOf(newUserCookie());
    await claimAdmin(t.db, admin);
    const who = await subscriber();
    await t.db.query(`insert into accounts (user_id, handle) values ($1, 'tester')`, [who.id]);
    const grant = (cookie: string, body: unknown) =>
      adminGrantPost(new Request(`${BASE_URL}/api/admin/after-dark/tokens`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    expect((await grant(who.cookie, { user_id: who.id, tokens: 8 })).status).toBe(404);
    expect((await grant(signedInCookie(admin), { user_id: "nobody", tokens: 8 })).status).toBe(404);
    const res = await grant(signedInCookie(admin), { user_id: who.id, tokens: 8 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: 8, balance: 8 });
  });
});

describe("deleting the account", () => {
  it("removes their tokens; the order stays, unlinked", async () => {
    verotelOn();
    const who = await subscriber();
    const orderId = await order(who);
    await verotelPostback({ referenceID: orderId, saleID: "831", transactionID: "9301" });
    await spendAdTokens(t.db, who.id, 2);
    await deleteAfterDarkData(t.db, who.id);
    expect((await t.db.query(`select count(*)::int as n from adult_token_grants`)).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query(`select count(*)::int as n from adult_token_usage`)).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query(`select user_id from adult_billing_orders where id = $1`, [orderId])).rows[0]).toEqual({ user_id: null });
  });
});
