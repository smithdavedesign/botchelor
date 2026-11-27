import type { Db } from "./db";
import { loadEngagement, type Engagement } from "./engagement";
import { loadOurIds } from "./our-traffic";

/**
 * The morning numbers (2026-11-27 product audit, David: "do 3"). Once a day the daily job's upkeep part sends the last UTC
 * day's numbers to where the owner reads them, so nobody needs the Mac or /admin/analytics to know whether the show is
 * moving: visitors, new visitors and how many came back, the funnel's steps that matter (made a character, started a
 * date, watched one end, clicked Buy), real money in (paid orders and new plans, our own accounts left out), and the top
 * sources.
 *
 * Where it goes: a Slack incoming webhook when METRICS_DIGEST_SLACK_WEBHOOK is set, else an email to the people the
 * content reports go to (lib/content-reports.ts reportRecipients). METRICS_DIGEST=0 turns it off. One a UTC day: the
 * day is claimed in metrics_digests before anything is sent, and the claim is let go when nothing went out, so the
 * resume pass tries again.
 *
 * Counts only: no visitor id, path with a name in it, or email ever goes into the message.
 */

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export const METRICS_DIGEST_EMAIL = "metrics_digest";

export type MoneyDay = { orders: number; order_cents: number; by_kind: Record<string, number>; new_plans: number };

export type Digest = {
  day: string;
  visitors: number;
  previous_visitors: number;
  new_visitors: number;
  returned: number;
  created: number;
  started: number;
  watched: number;
  signups: number;
  buy_clicks: number;
  money: MoneyDay;
  sources: { source: string; visitors: number; created: number }[];
  top_pages: { path: string; visitors: number }[];
};

/** The UTC day before `now`, YYYY-MM-DD: the last whole day there is. */
export function digestDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
}

export function metricsDigestOn(env: Env = process.env): boolean {
  return env.METRICS_DIGEST?.trim() !== "0";
}

/** The day's paid orders and new plans, our own accounts left out (a test purchase isn't revenue). */
export async function moneyOn(db: Db, day: string, ours: string[]): Promise<MoneyDay> {
  const start = `${day}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  const orders = (
    await db.query<{ kind: string; n: number; cents: number }>(
      `select kind, count(*)::int as n, coalesce(sum(amount_cents), 0)::int as cents from orders
        where status = 'paid' and paid_at >= $1 and paid_at < $2 and not (user_id = any($3::text[])) group by kind`,
      [start, end, ours],
    )
  ).rows;
  const [plans] = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from plan_entitlements
        where subscribed_at >= $1 and subscribed_at < $2 and not (user_id = any($3::text[]))`,
      [start, end, ours],
    )
  ).rows;
  const by_kind: Record<string, number> = {};
  for (const o of orders) by_kind[o.kind] = Number(o.n);
  return {
    orders: orders.reduce((s, o) => s + Number(o.n), 0),
    order_cents: orders.reduce((s, o) => s + Number(o.cents), 0),
    by_kind,
    new_plans: Number(plans?.n ?? 0),
  };
}

/** The digest's numbers from the engagement report the admin page reads (lib/engagement.ts), so the two always agree. */
export function digestFrom(e: Engagement, money: MoneyDay): Digest {
  const step = (key: string) => e.funnel.find((f) => f.key === key)?.visitors ?? 0;
  return {
    day: e.query.from,
    visitors: e.totals.visitors,
    previous_visitors: e.previous.visitors,
    new_visitors: e.returning.new_visitors,
    returned: e.returning.returned,
    created: step("character_created"),
    started: step("date_started"),
    watched: step("date_watched"),
    signups: step("sign_up"),
    buy_clicks: step("begin_checkout"),
    money,
    sources: e.sources
      .filter((s) => s.visitors > 0)
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 3)
      .map((s) => ({ source: s.source, visitors: s.visitors, created: s.created })),
    top_pages: e.pages.slice(0, 3).map((p) => ({ path: p.path, visitors: p.visitors })),
  };
}

export async function loadDigest(db: Db, day: string, now = new Date()): Promise<Digest> {
  const [engagement, ours] = await Promise.all([
    loadEngagement(db, { from: day, to: day, includeOurs: false, host: "show" }, now),
    loadOurIds(db),
  ]);
  return digestFrom(engagement, await moneyOn(db, day, ours));
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

function change(now: number, before: number): string {
  if (!before) return now ? "new" : "same as the day before";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "same as the day before" : `${pct > 0 ? "+" : ""}${pct}% on the day before`;
}

/** The message, as plain lines: Slack shows *bold*, and an email reads fine with the stars. */
export function formatDigest(d: Digest, site: string): string {
  const money =
    d.money.orders || d.money.new_plans
      ? [
          d.money.orders ? `${d.money.orders} paid order${d.money.orders === 1 ? "" : "s"} (${dollars(d.money.order_cents)}: ${Object.entries(d.money.by_kind).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ")})` : "",
          d.money.new_plans ? `${d.money.new_plans} new plan${d.money.new_plans === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(", ")
      : "nothing";
  const sources = d.sources.length ? d.sources.map((s) => `${s.source} ${s.visitors}${s.created ? ` (${s.created} made a character)` : ""}`).join(" · ") : "none";
  const pages = d.top_pages.length ? d.top_pages.map((p) => `${p.path} ${p.visitors}`).join(" · ") : "none";
  return [
    `*Botchelor, ${d.day} (UTC day)*`,
    `*Visitors:* ${d.visitors} (${change(d.visitors, d.previous_visitors)}). ${d.new_visitors} new, ${d.returned} of them came back on a later day so far.`,
    `*Funnel:* ${d.created} made a character · ${d.started} started a date · ${d.watched} watched one end · ${d.signups} made an account · ${d.buy_clicks} clicked Buy`,
    `*Money in:* ${money}`,
    `*Top sources:* ${sources}`,
    `*Top pages:* ${pages}`,
    `Our own browsers and accounts are left out. More: ${site}/admin/analytics`,
  ].join("\n");
}

/** Claims the day; true when this call got it (no digest went out for it yet). */
async function claimDay(db: Db, day: string, via: string): Promise<boolean> {
  const { rows } = await db.query(`insert into metrics_digests (day, via) values ($1, $2) on conflict (day) do nothing returning day`, [day, via]);
  return rows.length > 0;
}

async function releaseDay(db: Db, day: string): Promise<void> {
  await db.query(`delete from metrics_digests where day = $1`, [day]);
}

export type DigestResult = { sent: "slack" | "email" | null; day: string; reason?: "off" | "already_sent" | "no_recipients" | "failed" };

/** Sends yesterday's numbers once. Never throws. */
export async function sendMetricsDigest(db: Db, env: Env = process.env, doFetch: Fetch = fetch, now = new Date()): Promise<DigestResult> {
  const day = digestDay(now);
  if (!metricsDigestOn(env)) return { sent: null, day, reason: "off" };
  const webhook = env.METRICS_DIGEST_SLACK_WEBHOOK?.trim();
  const via = webhook ? "slack" : "email";
  try {
    if (!(await claimDay(db, day, via))) return { sent: null, day, reason: "already_sent" };
  } catch {
    return { sent: null, day, reason: "failed" };
  }
  try {
    const { siteUrl } = await import("./site");
    const text = formatDigest(await loadDigest(db, day, now), siteUrl());
    if (webhook) {
      const res = await doFetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, unfurl_links: false }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`slack ${res.status}`);
      return { sent: "slack", day };
    }
    const [{ reportRecipients }, { sendAccountEmail }] = await Promise.all([import("./content-reports"), import("./email")]);
    const to = await reportRecipients(db, env);
    if (!to.length) {
      await releaseDay(db, day);
      return { sent: null, day, reason: "no_recipients" };
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px">${text
      .split("\n")
      .map((l) => `<p style="margin:0 0 10px">${esc(l).replace(/\*([^*]+)\*/g, "<strong>$1</strong>")}</p>`)
      .join("")}</div>`;
    let any = false;
    for (const r of to) {
      const sent = await sendAccountEmail(db, r.userId, METRICS_DIGEST_EMAIL, r.email, { subject: `Botchelor numbers for ${day}`, text: text.replace(/\*/g, ""), html }, env);
      if (sent === "sent") any = true;
    }
    if (!any) {
      await releaseDay(db, day);
      return { sent: null, day, reason: "failed" };
    }
    return { sent: "email", day };
  } catch {
    await releaseDay(db, day).catch(() => {});
    return { sent: null, day, reason: "failed" };
  }
}
