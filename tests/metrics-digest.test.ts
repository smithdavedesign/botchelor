// The morning numbers (lib/metrics-digest.ts): yesterday's visitors, funnel, money and sources, once a UTC day.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { digestDay, formatDigest, metricsDigestOn, sendMetricsDigest, type Digest } from "@/lib/metrics-digest";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from metrics_digests`);
  await t.db.query(`delete from web_events`);
  await t.db.query(`delete from orders`);
});

const NOW = new Date("2026-12-02T16:20:00Z");
const DAY = "2026-12-01";

async function event(visitor: string, event: string, at: string, extra: { path?: string; source?: string; user_id?: string } = {}) {
  await t.db.query(`insert into web_events (at, visitor, session, user_id, event, path, source) values ($1, $2, $3, $4, $5, $6, $7)`, [
    at,
    visitor,
    `${visitor}-s`,
    extra.user_id ?? null,
    event,
    extra.path ?? "/",
    extra.source ?? null,
  ]);
}

/** A visitor seen on screen (a page_view and a page_leave), with any further events. */
async function visit(visitor: string, events: string[] = [], source = "producthunt", at = `${DAY}T10:00:00Z`) {
  await event(visitor, "page_view", at, { source });
  await event(visitor, "page_leave", at, { source });
  for (const e of events) await event(visitor, e, at, { source });
}

describe("the day and the switch", () => {
  it("covers the last whole UTC day", () => {
    expect(digestDay(NOW)).toBe(DAY);
    expect(digestDay(new Date("2027-01-01T00:05:00Z"))).toBe("2026-12-31");
  });
  it("is on unless METRICS_DIGEST is 0", () => {
    expect(metricsDigestOn({})).toBe(true);
    expect(metricsDigestOn({ METRICS_DIGEST: "0" })).toBe(false);
  });
});

describe("the message", () => {
  const base: Digest = {
    day: DAY,
    visitors: 120,
    previous_visitors: 40,
    new_visitors: 100,
    returned: 7,
    created: 12,
    started: 9,
    watched: 6,
    signups: 4,
    buy_clicks: 2,
    money: { orders: 1, order_cents: 1000, by_kind: { episode_pack: 1 }, new_plans: 1 },
    sources: [{ source: "producthunt", visitors: 80, created: 9 }],
    top_pages: [{ path: "/", visitors: 110 }],
  };
  it("says the numbers plainly", () => {
    const text = formatDigest(base, "https://botchelor.com");
    expect(text).toContain("*Visitors:* 120 (+200% on the day before)");
    expect(text).toContain("12 made a character · 9 started a date · 6 watched one end · 4 made an account · 2 clicked Buy");
    expect(text).toContain("1 paid order ($10: 1 episode pack), 1 new plan");
    expect(text).toContain("producthunt 80 (9 made a character)");
    expect(text).toContain("https://botchelor.com/admin/analytics");
  });
  it("says nothing came in when nothing did", () => {
    const text = formatDigest({ ...base, money: { orders: 0, order_cents: 0, by_kind: {}, new_plans: 0 }, previous_visitors: 0 }, "x");
    expect(text).toContain("*Money in:* nothing");
    expect(text).toContain("(new)");
  });
});

describe("sending", () => {
  it("posts yesterday's numbers to the Slack webhook once, leaving our own traffic and purchases out", async () => {
    await visit("v-one-aaaaaa", ["character_created", "date_started"]);
    await visit("v-two-bbbbbb", ["begin_checkout"], "reddit");
    await visit("v-old-cccccc", [], "direct", "2026-11-29T10:00:00Z");
    // An admin's browser and test purchase: never counted.
    await t.db.query(`insert into admins (user_id) values ('admin-1') on conflict do nothing`);
    await event("v-admin-dddd", "page_view", `${DAY}T11:00:00Z`, { user_id: "admin-1" });
    await t.db.query(
      `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, paid_at, episodes) values
         ('o1', 'buyer-1', 'pack_15', 'episode_pack', 1000, 'usd', 'paid', $1, 15),
         ('o2', 'admin-1', 'pack_5', 'episode_pack', 400, 'usd', 'paid', $1, 5)`,
      [`${DAY}T12:00:00Z`],
    );
    const posts: string[] = [];
    const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)).text);
      return new Response("ok");
    }) as unknown as typeof fetch;
    const env = { METRICS_DIGEST_SLACK_WEBHOOK: "https://hooks.slack.test/x" };

    expect(await sendMetricsDigest(t.db, env, fake, NOW)).toEqual({ sent: "slack", day: DAY });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("*Visitors:* 2");
    expect(posts[0]).toContain("1 made a character · 1 started a date");
    expect(posts[0]).toContain("1 clicked Buy");
    expect(posts[0]).toContain("1 paid order ($10: 1 episode pack)");
    expect(posts[0]).not.toContain("v-one");

    // The resume pass, an hour later: already sent.
    expect(await sendMetricsDigest(t.db, env, fake, new Date(NOW.getTime() + 3_600_000))).toMatchObject({ sent: null, reason: "already_sent" });
    expect(posts).toHaveLength(1);
  });

  it("lets the day go when Slack refuses, so the next pass tries again", async () => {
    const env = { METRICS_DIGEST_SLACK_WEBHOOK: "https://hooks.slack.test/x" };
    const down = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await sendMetricsDigest(t.db, env, down, NOW)).toMatchObject({ sent: null, reason: "failed" });
    const up = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    expect(await sendMetricsDigest(t.db, env, up, NOW)).toEqual({ sent: "slack", day: DAY });
  });

  it("sends nothing when switched off, and nothing by email without anyone to send to", async () => {
    const fake = vi.fn() as unknown as typeof fetch;
    expect(await sendMetricsDigest(t.db, { METRICS_DIGEST: "0", METRICS_DIGEST_SLACK_WEBHOOK: "https://x" }, fake, NOW)).toMatchObject({ reason: "off" });
    expect(await sendMetricsDigest(t.db, {}, fake, NOW)).toMatchObject({ sent: null, reason: "no_recipients" });
    expect(fake).not.toHaveBeenCalled();
    expect((await t.db.query(`select 1 from metrics_digests`)).rows).toHaveLength(0);
  });
});
