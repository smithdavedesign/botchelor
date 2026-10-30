import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/spend/route";
import { claimAdmin } from "@/lib/admins";
import { amountIn, KNOWN_COSTS, providerReadings, recordedIncome, summarize, type MoneyEntry } from "@/lib/spend";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => vi.unstubAllEnvs());

const entry = (over: Partial<MoneyEntry>): MoneyEntry => ({
  id: "e", kind: "cost", category: "infra", provider: "X", label: "x", usd: 10, every: "month", starts_on: "2026-10-15", ends_on: null, note: null, seed_key: null, ...over,
});
const offline = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return signedInCookie(id);
}
const get = (cookie: string, month = "2026-10") => GET(new Request(`${BASE_URL}/api/admin/spend?month=${month}`, { headers: { cookie } }));
const post = (cookie: string, body: unknown) =>
  POST(new Request(`${BASE_URL}/api/admin/spend`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("what an entry comes to in a month", () => {
  it("a once on its month, a monthly bill every month it runs, a yearly one on its start's month", () => {
    expect(amountIn(entry({ every: "once" }), "2026-10")).toBe(10);
    expect(amountIn(entry({ every: "once" }), "2026-11")).toBe(0);
    expect(amountIn(entry({}), "2026-09")).toBe(0);
    expect(amountIn(entry({}), "2027-03")).toBe(10);
    expect(amountIn(entry({ ends_on: "2026-11-30" }), "2026-12")).toBe(0);
    expect(amountIn(entry({ every: "year", usd: 15 }), "2027-10")).toBe(15);
    expect(amountIn(entry({ every: "year", usd: 15 }), "2027-04")).toBe(0);
  });

  it("net is income less costs, with our own purchases left out", () => {
    const s = summarize("2026-10", [entry({ category: "api", usd: 4 }), entry({ usd: 6 }), entry({ kind: "income", usd: 3 })], [
      { source: "orders", label: "", usd: 10, count: 2, ours_usd: 4, note: null },
    ]);
    expect(s.costs).toEqual({ api: 4, infra: 6, other: 0, total: 10 });
    expect(s.income).toEqual({ recorded: 10, entered: 3, ours: 4, total: 13 });
    expect(s.net).toBe(-1);
  });
});

describe("income from the app's records", () => {
  it("counts paid orders (never Stripe test-mode ones), After Dark payments less refunds, and operator passes at their price", async () => {
    const buyer = userIdOf(newUserCookie());
    const own = userIdOf(newUserCookie());
    await claimAdmin(t.db, own);
    const order = (user: string, cents: number, status: string, at: string, session = `cs_live_${crypto.randomUUID()}`) =>
      t.db.query(
        `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, paid_at, stripe_session_id) values ($1, $2, 'pack', 'episode_pack', $3, 'usd', $4, $5, $6)`,
        [crypto.randomUUID(), user, cents, status, at, session],
      );
    await order(buyer, 400, "paid", "2026-10-20T12:00:00Z");
    await order(own, 400, "paid", "2026-10-21T12:00:00Z");
    await order(buyer, 400, "refunded", "2026-10-22T12:00:00Z");
    await order(buyer, 400, "paid", "2026-09-30T12:00:00Z");
    await order(buyer, 400, "paid", "2026-10-13T12:00:00Z", "cs_test_a1b2");
    const ad = (kind: string, amount: string, outcome = "applied") =>
      t.db.query(
        `insert into adult_billing_events (id, processor, event_key, fingerprint, kind, raw_event, user_id, amount, currency, outcome, received_at)
         values ($1, 'ccbill', $1, $1, $2, $2, $3, $4, 'USD', $5, '2026-10-25T00:00:00Z')`,
        [crypto.randomUUID(), kind, buyer, amount, outcome],
      );
    await ad("initial", "12.99");
    await ad("rebill", "12.99");
    await ad("refund", "12.99");
    await ad("initial", "12.99", "unknown_order");
    await t.db.query(`insert into operator_pass_events (id, event_id, type, user_id, outcome, received_at) values ('p1', 'evt_1', 'invoice.paid', $1, 'initial', '2026-10-26T00:00:00Z')`, [buyer]);

    const lines = await recordedIncome(t.db, "2026-10", { OPERATOR_PASS_PRICE_USD: "9" });
    const by = Object.fromEntries(lines.map((l) => [l.source, l]));
    expect(by.orders).toMatchObject({ usd: 8, count: 2, ours_usd: 4 });
    expect(by.after_dark).toMatchObject({ usd: 12.99, count: 3, ours_usd: 0 });
    expect(by.operator_pass).toMatchObject({ usd: 9, count: 1 });
  });
});

describe("the provider readings", () => {
  it("say which have no key or no billing API, read DigitalOcean with its token, and keep the day's snapshot", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ month_to_date_usage: "7.25", month_to_date_balance: "7.25" }), { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date("2026-10-30T12:00:00Z");
    const readings = await providerReadings(t.db, { SESSION_SECRET: TEST_SESSION_SECRET, DO_BILLING_TOKEN: "do-read-only" }, fake, now);
    const by = Object.fromEntries(readings.map((r) => [r.provider, r]));
    expect(by.digitalocean).toMatchObject({ state: "live", used_month_usd: 7.25 });
    expect(by.openrouter.state).toBe("no_key");
    expect(by.bunny.state).toBe("no_key");
    expect(by.fal.state).toBe("no_api");
    expect(calls).toEqual(["https://api.digitalocean.com/v2/customers/my/balance"]);
    expect((await t.db.query(`select provider, used_month_usd from spend_snapshots`)).rows).toEqual([{ provider: "digitalocean", used_month_usd: 7.25 }]);

    const later = await providerReadings(t.db, { DO_BILLING_TOKEN: "do-read-only" }, fake, new Date("2026-11-07T12:00:00Z"));
    expect(later.find((r) => r.provider === "digitalocean")?.balance_week_ago).toBe(7.25);
  });

  it("a provider that doesn't answer is marked, never thrown", async () => {
    const readings = await providerReadings(t.db, { DO_BILLING_TOKEN: "do-read-only" }, offline);
    expect(readings.find((r) => r.provider === "digitalocean")).toMatchObject({ state: "error" });
  });
});

describe("/api/admin/spend", () => {
  it("is for admins only", async () => {
    expect((await get(newUserCookie())).status).toBe(403);
    expect((await post(newUserCookie(), { action: "add_known" })).status).toBe(403);
  });

  it("adds an entry, shows it in its month, fills in the documented costs once, and deletes", async () => {
    vi.stubGlobal("fetch", offline);
    const cookie = await admin();
    const add = await post(cookie, {
      action: "add",
      entry: { kind: "cost", category: "api", provider: "Venice", label: "Auto-pay top-up", usd: 10, every: "once", starts_on: "2026-10-28" },
    });
    expect(add.status).toBe(200);
    const { id } = await add.json();
    let view = await (await get(cookie)).json();
    expect(view.summary.costs.api).toBe(10);
    expect(view.known_missing).toBe(KNOWN_COSTS.length);

    expect((await (await post(cookie, { action: "add_known" })).json()).added).toBe(KNOWN_COSTS.length);
    expect((await (await post(cookie, { action: "add_known" })).json()).added).toBe(0);
    view = await (await get(cookie)).json();
    expect(view.known_missing).toBe(0);
    expect(view.summary.costs.total).toBeGreaterThan(10);

    expect((await post(cookie, { action: "delete", id })).status).toBe(200);
    expect((await post(cookie, { action: "delete", id })).status).toBe(404);
    vi.unstubAllGlobals();
  });

  it("refuses an entry that isn't whole", async () => {
    const cookie = await admin();
    const res = await post(cookie, { action: "add", entry: { kind: "cost", category: "api", provider: "", label: "x", usd: -1, every: "once", starts_on: "soon" } });
    expect(res.status).toBe(422);
  });
});
