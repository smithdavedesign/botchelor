import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { GET as viewRoute, POST as actRoute } from "@/app/api/companion/[id]/route";
import { DELETE as deleteMe } from "@/app/api/me/route";
import { POST as checkoutRoute } from "@/app/api/plans/checkout/route";
import { GET as plansRoute } from "@/app/api/plans/route";
import { POST as plansWebhook } from "@/app/api/webhooks/stripe-plans/route";
import { setCompanionModelForTests } from "@/lib/companion";
import { COMPANION_FAIR_USE_PER_MONTH, COMPANION_FREE_PER_DAY, companionAllowance, pruneCompanionUsage } from "@/lib/companion-plan";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { grantPlan, planLink, planState, plansOn, prunePlanCheckouts, sendPlanReminders, subscriptionOwner } from "@/lib/paid-plans";
import { invoicePeriodEnd, invoiceSubscription, RENEWAL_GRACE_MS, subscriptionEnding, subscriptionPeriodEnd } from "@/lib/stripe";
import { BASE_URL, FAKE_WEBHOOK_SECRET, signedInCookie, startTestDb, stripeSignature, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const LINK = "https://buy.stripe.com/companion_live";
let down = false;
let sent: EmailMessage[] = [];

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  down = false;
  sent = [];
  setEmailSenderForTests(async (m) => {
    sent.push(m);
  });
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are ")) {
        if (down) throw new Error("model down");
        return JSON.stringify({ messages: ["Tell me more."] });
      }
      return "{}";
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setEmailSenderForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = async (opts: { admin?: boolean } = {}) => {
  const id = crypto.randomUUID();
  if (opts.admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function openThread(cookie: string) {
  const res = await openRoute(req("/api/companion", { character_id: CAST.id }, cookie));
  return ((await res.json()) as Any).thread_id as string;
}
async function say(cookie: string, id: string, body: Record<string, unknown> = { action: "send", text: "hi" }) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
const usage = async (userId: string) => (await t.db.query<{ replies: number }>(`select replies from companion_usage where user_id = $1`, [userId])).rows[0]?.replies ?? 0;

describe("the free tier", () => {
  it("gives 30 replies a day across every companion, the opener free, then the plan before the next message", async () => {
    vi.stubEnv("COMPANION_PLAN_LINK", LINK);
    const me = await person();
    const id = await openThread(me.cookie);
    // Opening (and its first message) doesn't count.
    expect(await usage(me.id)).toBe(0);
    const first = await say(me.cookie, id);
    expect(first.status).toBe(200);
    expect(first.body.allowance).toMatchObject({ unlimited: false, per_day: COMPANION_FREE_PER_DAY, left: COMPANION_FREE_PER_DAY - 1, on_sale: true, price: "$9.99 a month" });
    // Another reply counts too.
    expect((await say(me.cookie, id, { action: "regenerate" })).body.allowance.left).toBe(COMPANION_FREE_PER_DAY - 2);
    await t.db.query(`update companion_usage set replies = $2 where user_id = $1`, [me.id, COMPANION_FREE_PER_DAY - 1]);
    expect((await say(me.cookie, id)).status).toBe(200);
    const out = await say(me.cookie, id, { action: "send", text: "one more?" });
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ error: "free_used_up", allowance: { left: 0 } });
    expect(out.body.message).toContain("Companion Plan ($9.99 a month)");
    // Nothing was kept of the refused message: it never went in.
    const view = (await (await viewRoute(req(`/api/companion/${id}`, null, me.cookie, "GET"), ctx(id))).json()) as Any;
    expect(view.view.messages.some((m: Any) => m.text === "one more?")).toBe(false);
    expect(view.allowance.left).toBe(0);
  });

  it("gives a reply back when none came, and says nothing of a plan that isn't on sale", async () => {
    const me = await person();
    const id = await openThread(me.cookie);
    down = true;
    expect((await say(me.cookie, id)).status).toBe(503);
    expect(await usage(me.id)).toBe(0);
    down = false;
    await t.db.query(`insert into companion_usage (user_id, day, replies) values ($1, $2, $3)
      on conflict (user_id, day) do update set replies = excluded.replies`, [me.id, new Date().toISOString().slice(0, 10), COMPANION_FREE_PER_DAY]);
    const out = await say(me.cookie, id);
    expect(out.status).toBe(402);
    expect(out.body.allowance.on_sale).toBe(false);
    expect(out.body.message).not.toContain("Companion Plan");
  });

  it("has a ceiling for everyone together, and taking none of yours when it's reached", async () => {
    vi.stubEnv("COMPANION_FREE_ALL_PER_DAY", "2");
    const a = await person();
    const b = await person();
    const ida = await openThread(a.cookie);
    const idb = await openThread(b.cookie);
    expect((await say(a.cookie, ida)).status).toBe(200);
    expect((await say(b.cookie, idb)).status).toBe(200);
    const busy = await say(b.cookie, idb);
    expect(busy.status).toBe(503);
    expect(busy.body.error).toBe("free_busy");
    expect(await usage(b.id)).toBe(1);
  });

  it("doesn't count admins", async () => {
    const admin = await person({ admin: true });
    const id = await openThread(admin.cookie);
    const r = await say(admin.cookie, id);
    expect(r.body.allowance).toMatchObject({ unlimited: true, admin: true, left: null });
    expect(await usage(admin.id)).toBe(0);
  });
});

describe("the plan", () => {
  it("has no daily limit, under a fair use a month", async () => {
    const me = await person();
    await grantPlan(t.db, me.id, "companion", "initial", { subscriptionId: "sub_1" });
    const id = await openThread(me.cookie);
    await t.db.query(`insert into companion_usage (user_id, day, replies) values ($1, $2, $3)`, [me.id, new Date().toISOString().slice(0, 10), COMPANION_FREE_PER_DAY + 5]);
    const r = await say(me.cookie, id);
    expect(r.status).toBe(200);
    expect(r.body.allowance).toMatchObject({ unlimited: true, plan: "active", left: null });
    await t.db.query(`update companion_usage set replies = $2 where user_id = $1`, [me.id, COMPANION_FAIR_USE_PER_MONTH]);
    const capped = await say(me.cookie, id);
    expect(capped.status).toBe(429);
    expect(capped.body.error).toBe("fair_use");
  });

  it("stays on through a late renewal, ends on a cancel's date, and lapses", async () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const end = new Date("2026-12-04T12:00:00Z");
    await grantPlan(t.db, "u1", "companion", "initial", { periodEnd: end }, now);
    expect((await planState(t.db, "u1", "companion", now)).status).toBe("active");
    // A renewal Stripe sends a day late: still on.
    expect((await planState(t.db, "u1", "companion", new Date(end.getTime() + RENEWAL_GRACE_MS / 2))).active).toBe(true);
    expect((await planState(t.db, "u1", "companion", new Date(end.getTime() + RENEWAL_GRACE_MS + 1000))).status).toBe("lapsed");
    await grantPlan(t.db, "u1", "companion", "cancel", {}, now);
    expect((await planState(t.db, "u1", "companion", now)).status).toBe("cancelled");
    // A cancelled plan has no grace.
    expect((await planState(t.db, "u1", "companion", new Date(end.getTime() + 1000))).active).toBe(false);
    await grantPlan(t.db, "u1", "companion", "resume", {}, now);
    expect((await planState(t.db, "u1", "companion", now)).status).toBe("active");
    await grantPlan(t.db, "u1", "companion", "expiry", {}, now);
    expect((await planState(t.db, "u1", "companion", now)).status).toBe("lapsed");
    // A resume never starts a plan: only a payment does.
    await grantPlan(t.db, "u2", "companion", "resume", { periodEnd: end }, now);
    expect((await planState(t.db, "u2", "companion", now)).status).toBe("none");
  });

  it("is on sale only with a live https link on production", () => {
    expect(planLink("companion", {})).toBeNull();
    expect(plansOn({ COMPANION_PLAN_LINK: LINK })).toBe(true);
    expect(planLink("companion", { COMPANION_PLAN_LINK: "http://buy.stripe.com/x" })).toBeNull();
    expect(planLink("companion", { COMPANION_PLAN_LINK: "https://buy.stripe.com/test_x", DEPLOY_ENV: "production" })).toBeNull();
    expect(planLink("companion", { COMPANION_PLAN_LINK: "https://buy.stripe.com/test_x" })).not.toBeNull();
  });
});

describe("subscribing", () => {
  const checkout = (body: unknown, cookie?: string) => checkoutRoute(req("/api/plans/checkout", body, cookie));
  const ok = { plan: "companion", attest: true, renews: true };

  it("needs an account, the 18+ gate and both boxes, and sends a random checkout id, never the person's", async () => {
    vi.stubEnv("COMPANION_PLAN_LINK", LINK);
    const me = await person();
    expect((await checkout(ok, "bz_adult=1")).status).toBe(401);
    expect((await checkout(ok, signedInCookie(me.id))).status).toBe(403);
    expect((await checkout({ ...ok, renews: false }, me.cookie)).status).toBe(422);
    const res = await checkout(ok, me.cookie);
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as Any).url);
    expect(url.origin + url.pathname).toBe(LINK);
    const ref = url.searchParams.get("client_reference_id")!;
    expect(ref).not.toBe(me.id);
    expect((await t.db.query(`select user_id, plan from plan_checkouts where id = $1`, [ref])).rows[0]).toEqual({ user_id: me.id, plan: "companion" });
  });

  it("is refused while the plan isn't on sale", async () => {
    const me = await person();
    expect((await checkout(ok, me.cookie)).status).toBe(503);
  });
});

describe("the webhook", () => {
  const post = (payload: string, sig: string) =>
    plansWebhook(new Request(BASE_URL + "/api/webhooks/stripe-plans", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: payload }));
  const send = async (event: Record<string, unknown>) => {
    const payload = JSON.stringify(event);
    return post(payload, await stripeSignature(payload));
  };
  const on = () => {
    vi.stubEnv("COMPANION_PLAN_LINK", LINK);
    vi.stubEnv("STRIPE_PLANS_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("STRIPE_PORTAL_LINK", "https://billing.stripe.com/p/login/abc");
  };
  async function subscribe(me: { id: string; cookie: string }) {
    const res = await checkoutRoute(req("/api/plans/checkout", { plan: "companion", attest: true, renews: true }, me.cookie));
    return new URL(((await res.json()) as Any).url).searchParams.get("client_reference_id")!;
  }

  it("404s until a plan is on sale, and refuses a bad signature", async () => {
    expect((await post("{}", "t=1,v1=00")).status).toBe(404);
    on();
    expect((await post("{}", "t=1,v1=deadbeef")).status).toBe(400);
  });

  it("starts the plan on a paid checkout, once, and sends the confirmation with how to cancel", async () => {
    on();
    const me = await person();
    const ref = await subscribe(me);
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", client_reference_id: ref, subscription: "sub_1", customer_details: { email: "me@example.com" } } },
    };
    expect((await send(event)).status).toBe(200);
    expect((await planState(t.db, me.id, "companion")).status).toBe("active");
    expect(await subscriptionOwner(t.db, "sub_1")).toEqual({ userId: me.id, plan: "companion" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("me@example.com");
    expect(sent[0].text).toContain("$9.99 a month, charged every month until you cancel");
    expect(sent[0].text).toContain("https://billing.stripe.com/p/login/abc");
    // The same event again changes nothing and sends nothing.
    expect((await send(event)).status).toBe(200);
    expect(sent).toHaveLength(1);
    // The page shows it.
    const plans = (await (await plansRoute(req("/api/plans", null, me.cookie, "GET"))).json()) as Any;
    expect(plans.plans[0]).toMatchObject({ plan: "companion", status: "active", active: true, manage: "https://billing.stripe.com/p/login/abc" });
    expect((await companionAllowance(t.db, me.id)).unlimited).toBe(true);
  });

  it("ignores an unknown checkout, an unpaid one, and a test-mode event on production", async () => {
    on();
    const me = await person();
    const ref = await subscribe(me);
    await send({ id: "evt_a", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", client_reference_id: "nobody", subscription: "sub_x" } } });
    await send({ id: "evt_b", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "unpaid", client_reference_id: ref, subscription: "sub_x" } } });
    vi.stubEnv("DEPLOY_ENV", "production");
    await send({ id: "evt_c", livemode: false, type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", client_reference_id: ref, subscription: "sub_x" } } });
    expect((await planState(t.db, me.id, "companion")).status).toBe("none");
  });

  it("renews, cancels, resumes and ends, on the 2025-03-31 payload shapes and the older ones", async () => {
    on();
    const me = await person();
    await grantPlan(t.db, me.id, "companion", "initial", { subscriptionId: "sub_2" });
    const next = Math.floor(Date.UTC(2027, 0, 4) / 1000);
    // Renewal on the new shape: the subscription under parent, the period on the line.
    await send({
      id: "evt_r",
      type: "invoice.paid",
      data: { object: { id: "in_1", billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: "sub_2" } }, lines: { data: [{ period: { end: next } }] } } },
    });
    expect((await planState(t.db, me.id, "companion")).period_end).toBe(new Date(next * 1000).toISOString());
    // Cancelled at the period's end (the period on the items).
    await send({ id: "evt_c", type: "customer.subscription.updated", data: { object: { id: "sub_2", status: "active", cancel_at_period_end: true, items: { data: [{ current_period_end: next }] } } } });
    expect((await planState(t.db, me.id, "companion", new Date(Date.UTC(2026, 11, 1)))).status).toBe("cancelled");
    // Changed their mind: on again.
    await send({ id: "evt_u", type: "customer.subscription.updated", data: { object: { id: "sub_2", status: "active", cancel_at_period_end: false, current_period_end: next } } });
    expect((await planState(t.db, me.id, "companion", new Date(Date.UTC(2026, 11, 1)))).status).toBe("active");
    await send({ id: "evt_d", type: "customer.subscription.deleted", data: { object: { id: "sub_2", status: "canceled" } } });
    expect((await planState(t.db, me.id, "companion")).status).toBe("lapsed");
    // The first invoice (subscription_create) isn't a renewal.
    await send({ id: "evt_f", type: "invoice.paid", data: { object: { id: "in_0", billing_reason: "subscription_create", subscription: "sub_2" } } });
    expect((await planState(t.db, me.id, "companion")).status).toBe("lapsed");
    const outcomes = (await t.db.query<{ outcome: string }>(`select outcome from plan_events order by received_at, event_id`)).rows.map((r) => r.outcome);
    expect(outcomes.sort()).toEqual(["cancel", "expiry", "ignored", "rebill", "resume"].sort());
  });

  it("reads both API versions' fields", () => {
    expect(invoiceSubscription({ subscription: "sub_old" })).toBe("sub_old");
    expect(invoiceSubscription({ parent: { subscription_details: { subscription: "sub_new" } } })).toBe("sub_new");
    expect(invoicePeriodEnd({ lines: { data: [{ period: { end: 1800000000 } }] } })?.getTime()).toBe(1800000000 * 1000);
    expect(subscriptionPeriodEnd({ current_period_end: 1800000000 })?.getTime()).toBe(1800000000 * 1000);
    expect(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1800000001 }] } })?.getTime()).toBe(1800000001 * 1000);
    expect(subscriptionPeriodEnd({ cancel_at: 1800000002, current_period_end: 1800000000 })?.getTime()).toBe(1800000002 * 1000);
    expect(subscriptionEnding({ cancel_at_period_end: true })).toBe(true);
    expect(subscriptionEnding({ cancel_at: 1800000002 })).toBe(true);
    expect(subscriptionEnding({ cancel_at_period_end: false, cancel_at: null })).toBe(false);
  });
});

describe("the yearly reminder", () => {
  it("goes once on each anniversary to a running plan", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const start = new Date("2025-10-01T00:00:00Z");
    const now = new Date("2026-11-04T00:00:00Z");
    await grantPlan(t.db, "u9", "companion", "initial", { email: "u9@example.com", periodEnd: new Date("2026-12-01T00:00:00Z") }, start);
    expect(await sendPlanReminders(t.db, now)).toBe(1);
    expect(sent[0].text).toContain("A yearly reminder");
    expect(await sendPlanReminders(t.db, now)).toBe(0);
    // A plan under a year old gets none.
    await grantPlan(t.db, "u10", "companion", "initial", { email: "u10@example.com" }, new Date("2026-06-01T00:00:00Z"));
    expect(await sendPlanReminders(t.db, now)).toBe(0);
  });
});

describe("deleting the account", () => {
  const del = (cookie: string, body: unknown) => deleteMe(req("/api/me", body, cookie, "DELETE"));

  it("says first that a renewing plan isn't stopped by it, deletes on purpose, and keeps the billing record", async () => {
    vi.stubEnv("STRIPE_PORTAL_LINK", "https://billing.stripe.com/p/login/test");
    const me = await person();
    await grantPlan(t.db, me.id, "companion", "initial", { subscriptionId: "sub_gone", email: "me@example.com" });
    const first = await del(me.cookie, { confirm: true });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: "plan_renews", manage: "https://billing.stripe.com/p/login/test" });
    expect((await del(me.cookie, { confirm: true, plan_renews: true })).status).toBe(200);
    // Stripe's later events still find it (a cancel in the portal, the end), and the yearly reminder still goes.
    expect(await subscriptionOwner(t.db, "sub_gone")).toEqual({ userId: me.id, plan: "companion" });
  });

  it("goes straight through once the plan is cancelled", async () => {
    const me = await person();
    await grantPlan(t.db, me.id, "companion", "initial", { subscriptionId: "sub_cancelled" });
    await grantPlan(t.db, me.id, "companion", "cancel", {});
    expect((await del(me.cookie, { confirm: true })).status).toBe(200);
  });
});

describe("pruning", () => {
  it("keeps this month's and last month's reply counts, and a week of Subscribe clicks", async () => {
    const me = await person();
    await t.db.query(`insert into companion_usage (user_id, day, replies) values ($1, '2026-09-30', 4), ($1, '2026-10-01', 5), ($1, '2026-11-03', 6)`, [me.id]);
    await pruneCompanionUsage(t.db, new Date("2026-11-04T12:00:00Z"));
    const days = (await t.db.query<{ day: string }>(`select day::text as day from companion_usage where user_id = $1 order by day`, [me.id])).rows;
    expect(days.map((r) => r.day)).toEqual(["2026-10-01", "2026-11-03"]);
    await t.db.query(
      `insert into plan_checkouts (id, user_id, plan, created_at) values ('old', $1, 'companion', now() - interval '8 days'), ('new', $1, 'companion', now() - interval '6 days')`,
      [me.id],
    );
    await prunePlanCheckouts(t.db);
    expect((await t.db.query<{ id: string }>(`select id from plan_checkouts`)).rows.map((r) => r.id)).toEqual(["new"]);
  });
});
