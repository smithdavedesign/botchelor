import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount } from "@/lib/account";
import { buyTemplate, claimTemplate, delistTemplate, listTemplate, marketListings, purchasesOf, salesOf } from "@/lib/money/marketplace";
import { addSponsorship, endSponsorship, sponsorOf } from "@/lib/money/sponsored";
import { moneyOn } from "@/lib/money/switches";
import { readTipNote, startTip, tipsFor, tipsReceived } from "@/lib/money/tips";
import { grantOrder } from "@/lib/payments";
import { POST as tipRoute } from "@/app/api/money/tips/route";
import { GET as marketRoute } from "@/app/api/money/market/route";
import { startTestDb } from "./helpers";

// The money features (lib/money/*): tips, the creator marketplace and sponsored cast, each behind a switch that is off.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const LINK = "https://buy.stripe.com/test_abc";
const ON: Record<string, string> = {
  MONEY_TIPS: "1",
  MONEY_MARKETPLACE: "1",
  MONEY_SPONSORED: "1",
  STRIPE_LINK_TIP_3: LINK,
  STRIPE_LINK_MARKET_5: LINK,
};

async function character(id: string, owner: string, opts: { house?: boolean; visibility?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, $3, $4, 30, 'A lighthouse keeper.', '["a","b","c"]'::jsonb, 'w', 'd', $5, true)`,
    [id, owner, opts.house ?? false, `Char ${id}`, opts.visibility ?? "public"],
  );
}
/** What the signed webhook does when Stripe says the order was paid. */
async function pay(orderId: string, cents: number) {
  expect(await grantOrder(t.db, { orderId, sessionId: `cs_${orderId}`, paymentLink: "plink_1", amountTotal: cents, currency: "usd" })).toBe("granted");
}

describe("the switches", () => {
  it("are all off unless set to 1, and the APIs answer 404 while off", async () => {
    expect(moneyOn("tips", {})).toBe(false);
    expect(moneyOn("marketplace", { MONEY_MARKETPLACE: "true" })).toBe(false);
    expect(moneyOn("sponsored", { MONEY_SPONSORED: "1" })).toBe(true);
    await character("ada", "alice");
    expect(await startTip(t.db, "bob", { character_id: "ada", sku: "tip_3" }, {})).toMatchObject({ ok: false, code: "not_found" });
    const tip = await tipRoute(new Request("http://x/api/money/tips", { method: "POST", body: JSON.stringify({ character_id: "ada", sku: "tip_3", attest: true }) }));
    expect(tip.status).toBe(404);
    expect((await marketRoute(new Request("http://x/api/money/market"))).status).toBe(404);
  });
});

describe("tips", () => {
  it("go to another creator's public character, count once paid, and show the creator 'A viewer'", async () => {
    await character("ada", "alice");
    await character("house1", "house", { house: true });
    expect(await startTip(t.db, "alice", { character_id: "ada", sku: "tip_3" }, ON)).toMatchObject({ ok: false, code: "own" });
    expect(await startTip(t.db, "bob", { character_id: "house1", sku: "tip_3" }, ON)).toMatchObject({ ok: false, code: "house" });
    expect(await startTip(t.db, "bob", { character_id: "ada", sku: "tip_1" }, ON)).toMatchObject({ ok: false, code: "unavailable" });
    const started = await startTip(t.db, "bob", { character_id: "ada", sku: "tip_3", note: "Loved the pier date." }, ON);
    if (!started.ok) throw new Error(started.error);
    expect(started.url).toContain(`client_reference_id=${started.order_id}`);
    expect(await tipsFor(t.db, "ada")).toEqual({ tips: 0 });
    await pay(started.order_id, 300);
    expect(await tipsFor(t.db, "ada")).toEqual({ tips: 1 });
    const got = await tipsReceived(t.db, "alice");
    expect(got).toMatchObject({ total_cents: 300, count: 1, tips: [{ character: { id: "ada" }, note: "Loved the pier date.", from: "A viewer" }] });
    expect(JSON.stringify(got)).not.toContain("bob");
  });

  it("check the note", () => {
    expect(readTipNote("see www.example.com")).toMatchObject({ ok: false, code: "link" });
    expect(readTipNote("x".repeat(141))).toMatchObject({ ok: false, code: "note" });
    expect(readTipNote("  thanks   for the laughs ")).toEqual({ ok: true, note: "thanks for the laughs" });
  });
});

describe("the marketplace", () => {
  it("sells a copy of a sheet, claimed once under the buyer's own name, private", async () => {
    await character("ada", "alice");
    await character("secret", "alice", { visibility: "private" });
    expect(await listTemplate(t.db, "alice", { character_id: "secret", sku: "market_5" }, ON)).toMatchObject({ ok: false, code: "private" });
    expect(await listTemplate(t.db, "bob", { character_id: "ada", sku: "market_5" }, ON)).toMatchObject({ ok: false, code: "not_your_character" });
    const listed = await listTemplate(t.db, "alice", { character_id: "ada", sku: "market_5", blurb: "A keeper with a past." }, ON);
    if (!listed.ok) throw new Error(listed.error);
    expect(await listTemplate(t.db, "alice", { character_id: "ada", sku: "market_5" }, ON)).toMatchObject({ ok: false, code: "already_listed" });
    expect((await marketListings(t.db, "bob", ON)).map((l) => [l.character.id, l.price_cents, l.yours ?? false])).toEqual([["ada", 500, false]]);
    expect(await marketListings(t.db, "bob", {})).toEqual([]);
    expect(await buyTemplate(t.db, "alice", listed.id, ON)).toMatchObject({ ok: false, code: "own" });

    const bought = await buyTemplate(t.db, "bob", listed.id, ON);
    if (!bought.ok) throw new Error(bought.error);
    expect(await claimTemplate(t.db, "bob", bought.order_id, { name: "Beacon" })).toMatchObject({ ok: false, code: "not_paid" });
    await pay(bought.order_id, 500);
    expect(await claimTemplate(t.db, "cara", bought.order_id, { name: "Beacon" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await claimTemplate(t.db, "bob", bought.order_id, { name: "Char ada" })).toMatchObject({ ok: false, code: "name_taken" });
    const made = await claimTemplate(t.db, "bob", bought.order_id, { name: "Beacon" });
    if (!made.ok) throw new Error(made.error);
    expect(await claimTemplate(t.db, "bob", bought.order_id, { name: "Beacon Two" })).toMatchObject({ ok: false, code: "claimed" });
    const copy = (await t.db.query(`select owner_id, name, bio, visibility, open_to_dates from characters where id = $1`, [made.character_id])).rows[0];
    expect(copy).toEqual({ owner_id: "bob", name: "Beacon", bio: "A lighthouse keeper.", visibility: "private", open_to_dates: false });
    expect(await purchasesOf(t.db, "bob")).toMatchObject([{ status: "paid", claimed: true, copy_id: made.character_id, template: { id: "ada" } }]);
    expect(await salesOf(t.db, "alice")).toEqual({ gross_cents: 500, sales: 1 });

    expect(await delistTemplate(t.db, "alice", listed.id)).toEqual({ ok: true });
    expect(await buyTemplate(t.db, "cara", listed.id, ON)).toMatchObject({ ok: false, code: "no_listing" });
  });

  it("forgets a buyer's and a seller's rows with their account, and keeps the buyer's copy", async () => {
    await character("ada", "alice");
    const listed = await listTemplate(t.db, "alice", { character_id: "ada", sku: "market_5" }, ON);
    if (!listed.ok) throw new Error(listed.error);
    const bought = await buyTemplate(t.db, "bob", listed.id, ON);
    if (!bought.ok) throw new Error(bought.error);
    await pay(bought.order_id, 500);
    const made = await claimTemplate(t.db, "bob", bought.order_id, { name: "Beacon" });
    if (!made.ok) throw new Error(made.error);
    await deleteAccount(t.db, "alice");
    expect((await t.db.query(`select count(*)::int as n from market_listings`)).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query(`select count(*)::int as n from market_purchases`)).rows[0]).toEqual({ n: 0 });
    expect((await t.db.query(`select owner_id from characters where id = $1`, [made.character_id])).rows[0]).toEqual({ owner_id: "bob" });
  });
});

describe("sponsored cast", () => {
  const NOW = new Date("2026-12-05T12:00:00Z");
  const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

  it("labels a house character while it runs and the switch is on, never anyone else's", async () => {
    await character("house1", "house", { house: true });
    await character("ada", "alice");
    expect(await addSponsorship(t.db, "admin", { character_id: "ada", brand: "Acme Tea", starts_at: days(-1), ends_at: days(10) })).toMatchObject({ ok: false, code: "not_house" });
    expect(await addSponsorship(t.db, "admin", { character_id: "house1", brand: "Acme Tea", disclosure: "A friend of the show", starts_at: days(-1), ends_at: days(10) })).toMatchObject({ ok: false, code: "disclosure" });
    expect(await addSponsorship(t.db, "admin", { character_id: "house1", brand: "Acme Tea", starts_at: days(0), ends_at: days(200) })).toMatchObject({ ok: false, code: "dates" });
    const s = await addSponsorship(t.db, "admin", { character_id: "house1", brand: "Acme Tea", starts_at: days(-1), ends_at: days(10) });
    if (!s.ok) throw new Error(s.error);
    expect(await addSponsorship(t.db, "admin", { character_id: "house1", brand: "Other", starts_at: days(5), ends_at: days(20) })).toMatchObject({ ok: false, code: "overlap" });
    expect(await sponsorOf(t.db, "house1", NOW, ON)).toMatchObject({ brand: "Acme Tea", label: "Sponsored by Acme Tea" });
    expect(await sponsorOf(t.db, "house1", NOW, {})).toBeNull();
    expect(await sponsorOf(t.db, "house1", days(11), ON)).toBeNull();
    expect(await endSponsorship(t.db, s.id, NOW)).toBe(true);
    expect(await sponsorOf(t.db, "house1", days(1), ON)).toBeNull();
  });
});
