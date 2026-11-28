import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { earningsOf, recordPayout, saleShareCents, setPayoutMethod, showEarnings, stripeFeeCents, tipShareCents } from "@/lib/money/earnings";
import { buyTemplate, listTemplate } from "@/lib/money/marketplace";
import { startTip } from "@/lib/money/tips";
import { grantOrder } from "@/lib/payments";
import { isShowDate } from "@/lib/show-spoilers";
import { startTestDb } from "./helpers";

// Creators' earnings and the owner's (lib/money/earnings.ts; David, 2026-11-28), and what may be spoiled (lib/show-spoilers.ts).
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
const ON: Record<string, string> = { MONEY_TIPS: "1", MONEY_MARKETPLACE: "1", STRIPE_LINK_TIP_3: LINK, STRIPE_LINK_MARKET_5: LINK };

async function character(id: string, owner: string) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, open_to_dates)
     values ($1, $2, false, $3, 30, 'A clockmaker.', '["a","b","c"]'::jsonb, 'w', 'd', 'public', true)`,
    [id, owner, `Char ${id}`],
  );
}
async function pay(orderId: string, cents: number) {
  expect(await grantOrder(t.db, { orderId, sessionId: `cs_${orderId}`, paymentLink: `plink_${cents}`, amountTotal: cents, currency: "usd" })).toBe("granted");
}

describe("the split", () => {
  it("gives a tip less Stripe's fee and 70% of a template", () => {
    expect(stripeFeeCents(300)).toBe(39);
    expect(tipShareCents(300)).toBe(261);
    expect(tipShareCents(20)).toBe(0);
    expect(saleShareCents(500)).toBe(350);
  });
});

describe("a creator's earnings", () => {
  it("counts paid tips and sales only, and payouts come off what's owed", async () => {
    await character("ada", "alice");
    const tip = await startTip(t.db, "bob", { character_id: "ada", sku: "tip_3", note: "Loved her" }, ON);
    const unpaid = await startTip(t.db, "carol", { character_id: "ada", sku: "tip_3" }, ON);
    if (!tip.ok || !unpaid.ok) throw new Error("tip didn't start");
    await pay(tip.order_id, 300);
    const listed = await listTemplate(t.db, "alice", { character_id: "ada", sku: "market_5" }, ON);
    if (!listed.ok) throw new Error("not listed");
    const sale = await buyTemplate(t.db, "dan", listed.id, ON);
    if (!sale.ok) throw new Error("not bought");
    await pay(sale.order_id, 500);

    const e = await earningsOf(t.db, "alice");
    expect(e.tips).toEqual({ count: 1, gross_cents: 300, share_cents: 261 });
    expect(e.sales).toEqual({ count: 1, gross_cents: 500, share_cents: 350 });
    expect(e.earned_cents).toBe(611);
    expect(e.owed_cents).toBe(611);
    expect(e.recent.map((l) => l.kind).sort()).toEqual(["sale", "tip"]);

    expect(await recordPayout(t.db, "owner", { user_id: "alice", amount_cents: 10_000 })).toMatchObject({ ok: false, code: "over" });
    expect(await recordPayout(t.db, "owner", { user_id: "alice", amount_cents: 500, note: "PayPal" })).toMatchObject({ ok: true });
    const after = await earningsOf(t.db, "alice");
    expect(after.paid_out_cents).toBe(500);
    expect(after.owed_cents).toBe(111);
    expect(after.payouts[0]).toMatchObject({ amount_cents: 500, note: "PayPal" });

    const show = await showEarnings(t.db);
    expect(show.gross_cents).toBe(800);
    expect(show.creators_cents).toBe(611);
    expect(show.owed_cents).toBe(111);
    expect(show.creators[0]).toMatchObject({ user_id: "alice", tips: 1, sales: 1, owed_cents: 111 });
    expect(show.show_cents).toBe(800 - show.fees_cents - 611);
  });

  it("keeps where to send it, and checks it", async () => {
    expect(await setPayoutMethod(t.db, "alice", { method: "venmo", handle: "x" })).toMatchObject({ ok: false, code: "method" });
    expect(await setPayoutMethod(t.db, "alice", { method: "paypal", handle: "not an email" })).toMatchObject({ ok: false, code: "handle" });
    expect(await setPayoutMethod(t.db, "alice", { method: "paypal", handle: "alice@example.com" })).toEqual({ ok: true });
    expect(await setPayoutMethod(t.db, "alice", { method: "bank", handle: "UK account, ask me" })).toEqual({ ok: true });
    expect((await earningsOf(t.db, "alice")).method).toEqual({ method: "bank", handle: "UK account, ask me" });
  });
});

describe("what may be spoiled", () => {
  it("is anything but a date with the show's own cast", () => {
    expect(isShowDate(true, false)).toBe(true);
    expect(isShowDate(false, true)).toBe(true);
    expect(isShowDate(false, false)).toBe(false);
  });
});
