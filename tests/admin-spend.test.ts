import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/spend/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { setEmailSenderForTests } from "@/lib/email";
import {
  alertLowBalances,
  amountIn,
  daysLeft,
  forgetReadingsForTests,
  isLowBalance,
  KNOWN_COSTS,
  lowBalanceLine,
  planPriceUsd,
  providerReadings,
  recordedIncome,
  summarize,
  type MoneyEntry,
} from "@/lib/spend";
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
    await t.db.query(
      `insert into plan_events (event_id, type, plan, user_id, outcome, received_at) values
         ('evt_p1', 'checkout.session.completed', 'companion', $1, 'initial', '2026-10-27T00:00:00Z'),
         ('evt_p2', 'invoice.paid', 'companion', $2, 'rebill', '2026-10-28T00:00:00Z'),
         ('evt_p3', 'customer.subscription.updated', 'companion', $1, 'cancel', '2026-10-29T00:00:00Z')`,
      [buyer, own],
    );
    await t.db.query(`insert into operator_pass_events (id, event_id, type, user_id, outcome, received_at) values ('p1', 'evt_1', 'invoice.paid', $1, 'initial', '2026-10-26T00:00:00Z')`, [buyer]);

    const lines = await recordedIncome(t.db, "2026-10", { OPERATOR_PASS_PRICE_USD: "9" });
    const by = Object.fromEntries(lines.map((l) => [l.source, l]));
    expect(by.orders).toMatchObject({ usd: 8, count: 2, ours_usd: 4 });
    expect(by.after_dark).toMatchObject({ usd: 12.99, count: 3, ours_usd: 0 });
    expect(by.operator_pass).toMatchObject({ usd: 9, count: 1 });
    // Plans count each payment at the price the page shows; a cancel isn't a payment.
    expect(by.plans).toMatchObject({ usd: 19.98, count: 2, ours_usd: 9.99 });
    expect(planPriceUsd("$9.99 a month")).toBe(9.99);
    expect(planPriceUsd("free")).toBe(0);
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

// UX audit 2026-11-22: OpenRouter sat at $3.78, about two days left at its pace, and the page said nothing.
describe("a balance about to run out", () => {
  const day = 86_400_000;
  const now = new Date("2026-11-22T06:00:00Z");

  it("lasts as long as the pace it went down at says, over the days it really spans; a top-up or a bill says nothing", () => {
    expect(daysLeft("openrouter", 3.78, { balance: 17.25, at: new Date(now.getTime() - 8 * day) }, now)).toBeCloseTo(2.245, 2);
    // A reading 16 days back paces it over 16 days, not 7.
    expect(daysLeft("openrouter", 3.78, { balance: 17.25, at: new Date(now.getTime() - 16 * day) }, now)).toBeCloseTo(4.49, 1);
    expect(daysLeft("openrouter", 30, { balance: 10, at: new Date(now.getTime() - 8 * day) }, now)).toBeNull(); // topped up
    expect(daysLeft("openrouter", 3, { balance: 9, at: new Date(now.getTime() - 3_600_000) }, now)).toBeNull(); // under a day
    expect(daysLeft("digitalocean", 7, { balance: 2, at: new Date(now.getTime() - 8 * day) }, now)).toBeNull(); // what's owed
    expect(daysLeft("openrouter", null, { balance: 2, at: new Date(now.getTime() - 8 * day) }, now)).toBeNull();
  });

  it("is flagged under a week unless the provider tops itself up, in words with the pace's start", () => {
    const r = { label: "OpenRouter (After Dark's writer, companions)", balance_usd: 3.78, days_left: 4.49, auto_top_up: false, pace_since: "2026-11-06" };
    expect(isLowBalance(r)).toBe(true);
    expect(lowBalanceLine(r)).toBe("OpenRouter: $3.78 left, about 4 days at the pace since Nov 6.");
    expect(isLowBalance({ ...r, auto_top_up: true })).toBe(false);
    expect(isLowBalance({ ...r, days_left: 9 })).toBe(false);
    expect(isLowBalance({ ...r, days_left: null })).toBe(false);
    expect(lowBalanceLine({ ...r, days_left: 0.4 })).toContain("less than a day");
  });

  it("reads OpenRouter's pace from a snapshot a week or more old, and the daily job emails the admins once a day", async () => {
    await saveAdultSettings(t.db, { openrouter_key: ["test", "key", "not", "real", "or", "5678"].join("-") });
    await t.db.query(`insert into spend_snapshots (day, provider, balance_usd, read_at) values ('2026-11-14', 'openrouter', 17.25, '2026-11-14T06:00:00Z')`);
    const fake = (async (url: string) =>
      new Response(JSON.stringify({ data: url.endsWith("/credits") ? { total_credits: 100, total_usage: 96.22 } : { usage: 6, usage_monthly: 6 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const env = { SESSION_SECRET: TEST_SESSION_SECRET, RESEND_API_KEY: "re_test_not_real", CONTACT_EMAIL: "owner@example.com" };
    const or = (await providerReadings(t.db, env, fake, now)).find((r) => r.provider === "openrouter")!;
    expect(or).toMatchObject({ state: "live", balance_usd: 3.78, balance_week_ago: 17.25, pace_since: "2026-11-14", auto_top_up: false });
    expect(or.days_left).toBeCloseTo(2.245, 2);

    const sent: { to: string; subject: string }[] = [];
    setEmailSenderForTests(async (msg) => {
      sent.push({ to: String(msg.to), subject: msg.subject });
      return "id";
    });
    try {
      expect(await alertLowBalances(t.db, env, fake, now)).toBe(1);
      expect(sent).toEqual([{ to: "owner@example.com", subject: "Low balance: OpenRouter: $3.78 left, about 2 days at the pace since Nov 14." }]);
      // Again the same day (a manual run): flagged, not emailed twice.
      expect(await alertLowBalances(t.db, env, fake, new Date(now.getTime() + 3_600_000))).toBe(1);
      expect(sent).toHaveLength(1);
    } finally {
      setEmailSenderForTests(null);
    }
  });
});

describe("/api/admin/spend", () => {
  it("is for admins only", async () => {
    expect((await get(newUserCookie())).status).toBe(403);
    expect((await GET(new Request(`${BASE_URL}/api/admin/spend?part=balances`, { headers: { cookie: newUserCookie() } }))).status).toBe(403);
    expect((await post(newUserCookie(), { action: "add_known" })).status).toBe(403);
  });

  it("hands the ledger without waiting on a billing API, and the balances on their own, kept a few minutes", async () => {
    forgetReadingsForTests();
    const cookie = await admin();
    const view = await (await get(cookie)).json();
    expect(view).not.toHaveProperty("readings");
    let reads = 0;
    vi.stubGlobal("fetch", (async () => {
      reads++;
      return new Response(JSON.stringify({ month_to_date_usage: "1", month_to_date_balance: "1" }), { status: 200 });
    }) as unknown as typeof fetch);
    vi.stubEnv("DO_BILLING_TOKEN", "do-read-only");
    try {
      const balances = async () => (await GET(new Request(`${BASE_URL}/api/admin/spend?part=balances`, { headers: { cookie } }))).json();
      const first = await balances();
      expect(first.readings.find((r: { provider: string }) => r.provider === "digitalocean")).toMatchObject({ state: "live" });
      expect(typeof first.read_at).toBe("string");
      expect((await balances()).read_at).toBe(first.read_at);
      expect(reads).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      forgetReadingsForTests();
    }
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
