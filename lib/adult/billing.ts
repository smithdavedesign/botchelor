/**
 * After Dark's subscription billing (docs/after-dark.md "Billing", 2026-10-24): $12.99 a month on an adult card
 * processor, Segpay first and Verotel as backup (docs/after-dark-legal-review.md "Payments"). Stripe never sees it: the
 * show's token packs stay on lib/payments.ts, untouched.
 *
 * Built complete and off. A processor is on only when its settings are all in the environment (billing-segpay.ts,
 * billing-verotel.ts); with neither, the subscribe page keeps its waitlist and every billing route is not found.
 *
 * The flow: POST /api/after-dark/subscribe records the 18+ self-declaration and opens an order (adult_billing_orders),
 * whose id travels to the processor and back in its postbacks. The postbacks drive adult_entitlements, which
 * canAfterDark reads:
 *   initial, rebill, uncancel  → active, access until the next charge (or a month on)
 *   extend                     → access until the new date (cancelled stays cancelled)
 *   cancel                     → cancelled: no more charges, access until period_end
 *   expiry                     → lapsed now
 *   chargeback, refund         → lapsed now, and the account is flagged: subscribing again waits for an admin
 * Every postback is recorded (adult_billing_events); the same transaction twice is applied once.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db";
import { sendAccountEmail } from "../email";
import { siteUrl } from "../site";
import { PROCESSORS } from "../legal-entity";
import { ccbillConfig, ccbillPayUrl } from "./billing-ccbill";
import { segpayConfig, segpayPayPageUrl } from "./billing-segpay";
import { verotelCancelUrl, verotelConfig, verotelStartOrderUrl, type ParsedPostback } from "./billing-verotel";

export type Processor = "ccbill" | "segpay" | "verotel";
type Env = Record<string, string | undefined>;

export const DEFAULT_PRICE_USD = 12.99;
export const DEFAULT_SUBSCRIPTION_NAME = "Botchelor After Dark";

/** The monthly price shown and charged: AD_SUBSCRIPTION_PRICE_USD (it must match the Segpay price point), else $12.99. */
export function subscriptionPrice(env: Env = process.env): number {
  const n = Number(env.AD_SUBSCRIPTION_PRICE_USD?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 500 ? Math.round(n * 100) / 100 : DEFAULT_PRICE_USD;
}

/** What the processor's page and the statement's description call it: AD_SUBSCRIPTION_NAME, else "Botchelor After Dark". */
export function subscriptionName(env: Env = process.env): string {
  return env.AD_SUBSCRIPTION_NAME?.trim().slice(0, 100) || DEFAULT_SUBSCRIPTION_NAME;
}

/** "$12.99". */
export const priceLabel = (usd: number): string => `$${usd.toFixed(2)}`;

/** The processors set up here, in the order they're offered: CCBill first (David's pick, 2026-10-30), then Segpay. */
export function configuredProcessors(env: Env = process.env): Processor[] {
  return [...(ccbillConfig(env) ? (["ccbill"] as const) : []), ...(segpayConfig(env) ? (["segpay"] as const) : []), ...(verotelConfig(env) ? (["verotel"] as const) : [])];
}

export const billingOn = (env: Env = process.env): boolean => configuredProcessors(env).length > 0;

/** Each processor's name for people, how it shows on a card statement and where a subscriber cancels (lib/legal-entity.ts, shared with /cancel and the terms). */
export const PROCESSOR_INFO: Record<Processor, { label: string; statement: string; cancelUrl: string }> = {
  ccbill: { label: PROCESSORS.ccbill.name, statement: PROCESSORS.ccbill.statement, cancelUrl: PROCESSORS.ccbill.cancelUrl },
  segpay: { label: PROCESSORS.segpay.name, statement: PROCESSORS.segpay.statement, cancelUrl: PROCESSORS.segpay.cancelUrl },
  verotel: { label: PROCESSORS.verotel.name, statement: PROCESSORS.verotel.statement, cancelUrl: PROCESSORS.verotel.cancelUrl },
};

/** A new order id: our reference with the processor. Segpay's user-defined values are ≤ 32 characters and can't start with a digit. */
export const newOrderId = (): string => `ado_${randomBytes(12).toString("hex")}`;

export type Checkout = { url: string; processor: Processor; orderId: string };

/**
 * Opens an order for this person and returns the processor's checkout link, or null when that processor (or, with none
 * named, any processor) isn't set up. `base` is the address the buyer comes back to (After Dark's own host when it has
 * one).
 */
export async function startCheckout(db: Db, userId: string, opts: { processor?: Processor; base: string }, env: Env = process.env): Promise<Checkout | null> {
  const offered = configuredProcessors(env);
  const processor = opts.processor ? (offered.includes(opts.processor) ? opts.processor : null) : (offered[0] ?? null);
  if (!processor) return null;
  const orderId = newOrderId();
  const price = subscriptionPrice(env);
  const base = opts.base.replace(/\/+$/, "");
  const successUrl = `${base}/after-dark/subscribe?done=1`;
  const declineUrl = `${base}/after-dark/subscribe?declined=1`;
  let url: string;
  if (processor === "ccbill") url = ccbillPayUrl(ccbillConfig(env)!, { referenceId: orderId, priceUsd: price });
  else if (processor === "segpay") url = segpayPayPageUrl(segpayConfig(env)!, { referenceId: orderId, successUrl, declineUrl });
  else url = verotelStartOrderUrl(verotelConfig(env)!, { referenceId: orderId, priceUsd: price, name: subscriptionName(env), successUrl, declineUrl });
  await db.query(`insert into adult_billing_orders (id, user_id, processor, price_usd) values ($1, $2, $3, $4)`, [orderId, userId, processor, price]);
  return { url, processor, orderId };
}

/** Records the person's 18+ declaration the first time they subscribe (a provider's check, once one exists, is kept). */
export async function recordSelfDeclaration(db: Db, userId: string, country: string | null): Promise<void> {
  await db.query(
    `insert into adult_entitlements (user_id, age_verified_at, age_method, age_country, updated_at) values ($1, now(), 'self_declared', $2, now())
     on conflict (user_id) do update set age_verified_at = now(), age_method = 'self_declared', age_country = excluded.age_country, updated_at = now()
       where adult_entitlements.age_verified_at is null`,
    [userId, country],
  );
}

/** Whether a chargeback or refund flag still waits for an admin. */
export async function billingFlagged(db: Db, userId: string): Promise<boolean> {
  const r = await db.query(`select 1 from adult_billing_flags where user_id = $1 and reviewed_at is null`, [userId]);
  return r.rows.length > 0;
}

/** An admin has looked at a flagged account: it may subscribe again. */
export async function clearBillingFlag(db: Db, userId: string, adminId: string): Promise<boolean> {
  const r = await db.query(`update adult_billing_flags set reviewed_at = now(), reviewed_by = $2 where user_id = $1 and reviewed_at is null returning user_id`, [userId, adminId]);
  return r.rows.length > 0;
}

export type ApplyOutcome = "applied" | "duplicate" | "ignored" | "unknown_order" | "no_account";

const MONTH_MS = 30 * 86_400_000;
const plusMonth = (from: Date): Date => {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/** A stable fingerprint of a postback's kept parameters: two deliveries of the same message match. */
function fingerprint(processor: Processor, ev: ParsedPostback): string {
  const sorted = Object.keys(ev.kept)
    .sort()
    .map((k) => `${k}=${ev.kept[k]}`)
    .join("&");
  return createHash("sha256").update(`${processor}|${ev.kind}|${sorted}`).digest("hex").slice(0, 32);
}

type OrderRow = { id: string; user_id: string | null; sale_id: string | null };

async function findOrder(db: Db, processor: Processor, ev: ParsedPostback): Promise<OrderRow | null> {
  if (ev.orderId) {
    const r = (await db.query<OrderRow>(`select id, user_id, sale_id from adult_billing_orders where id = $1 and processor = $2`, [ev.orderId, processor])).rows[0];
    if (r) return r;
  }
  if (ev.saleId) {
    const r = (
      await db.query<OrderRow>(`select id, user_id, sale_id from adult_billing_orders where processor = $1 and sale_id = $2 order by created_at desc limit 1`, [processor, ev.saleId])
    ).rows[0];
    if (r) return r;
  }
  return null;
}

/**
 * Applies one verified postback, once. A transaction id seen before is a duplicate. A postback without one (Verotel's
 * cancel, expiry, extend; Segpay's member postbacks) is a duplicate when it matches the last one recorded for the same
 * subscription, so a retry changes nothing while a later cancel, after an uncancel, still counts.
 */
export async function applyBillingEvent(db: Db, processor: Processor, ev: ParsedPostback, now: Date = new Date()): Promise<ApplyOutcome> {
  const fp = fingerprint(processor, ev);
  if (ev.transactionId) {
    const seen = await db.query(`select 1 from adult_billing_events where processor = $1 and event_key = $2`, [processor, `tx:${ev.transactionId}`]);
    if (seen.rows.length) return "duplicate";
  } else if (ev.saleId || ev.orderId) {
    const last = (
      await db.query<{ fingerprint: string }>(
        `select fingerprint from adult_billing_events where processor = $1 and (sale_id = $2 or order_id = $3) order by received_at desc, id desc limit 1`,
        [processor, ev.saleId, ev.orderId],
      )
    ).rows[0];
    if (last?.fingerprint === fp) return "duplicate";
  }
  const order = await findOrder(db, processor, ev);
  const userId = order?.user_id ?? null;
  let outcome: ApplyOutcome;
  if (!order) outcome = ev.kind === "ignored" || ev.kind === "declined" ? "ignored" : "unknown_order";
  else if (!userId) outcome = "no_account";
  else if (ev.kind === "ignored" || ev.kind === "declined") outcome = "ignored";
  else outcome = "applied";

  const eventKey = ev.transactionId ? `tx:${ev.transactionId}` : `fp:${fp}:${randomBytes(6).toString("hex")}`;
  const inserted = await db.query(
    `insert into adult_billing_events (id, processor, event_key, fingerprint, kind, raw_event, order_id, user_id, sale_id, amount, currency, params, outcome, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     on conflict (processor, event_key) do nothing returning id`,
    [
      `abe_${randomBytes(10).toString("hex")}`,
      processor,
      eventKey,
      fp,
      ev.kind,
      ev.rawEvent.slice(0, 80),
      order?.id ?? ev.orderId?.slice(0, 64) ?? null,
      userId,
      ev.saleId?.slice(0, 64) ?? null,
      ev.amount?.slice(0, 20) ?? null,
      ev.currency?.slice(0, 8) ?? null,
      JSON.stringify(ev.kept),
      outcome,
      now.toISOString(),
    ],
  );
  // Two deliveries of one transaction at the same moment: the second insert finds the first and stops here.
  if (!inserted.rows.length) return "duplicate";
  if (outcome !== "applied" || !order || !userId) return outcome;

  if (ev.saleId && !order.sale_id) await db.query(`update adult_billing_orders set sale_id = $2 where id = $1`, [order.id, ev.saleId.slice(0, 64)]);
  const current = (
    await db.query<{ subscription_status: string; period_end: Date | string | null; subscribed_at: Date | string | null }>(
      `select subscription_status, period_end, subscribed_at from adult_entitlements where user_id = $1`,
      [userId],
    )
  ).rows[0];
  const periodEnd = current?.period_end ? new Date(current.period_end) : null;
  const running = Boolean(current && (current.subscription_status === "active" || current.subscription_status === "cancelled") && periodEnd && periodEnd > now);
  const upsert = (status: string, end: Date | null, extra: { subscribedAt?: Date | null; resetReminder?: boolean } = {}) =>
    db.query(
      `insert into adult_entitlements (user_id, subscription_status, period_end, provider, subscribed_at, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update set subscription_status = excluded.subscription_status, period_end = excluded.period_end,
         provider = excluded.provider, subscribed_at = coalesce($5, adult_entitlements.subscribed_at),
         renewal_reminded_at = case when $6 then null else adult_entitlements.renewal_reminded_at end, updated_at = now()`,
      [userId, status, end?.toISOString() ?? null, processor, extra.subscribedAt?.toISOString() ?? null, extra.resetReminder === true],
    );

  switch (ev.kind) {
    case "initial": {
      await db.query(`update adult_billing_orders set paid_at = coalesce(paid_at, $2) where id = $1`, [order.id, now.toISOString()]);
      // A new run of the subscription starts its anniversary over; one still running keeps its own.
      const fresh = !running;
      await upsert("active", ev.periodEnd ?? plusMonth(now), { subscribedAt: fresh ? now : (current?.subscribed_at ? new Date(current.subscribed_at) : now), resetReminder: fresh });
      if (fresh) await sendSubscriptionEmail(db, userId, "confirmation", processor).catch(() => {});
      break;
    }
    case "rebill":
    case "uncancel": {
      // Without a date from the processor: a month on from whichever is later, now or the paid-up date.
      const from = periodEnd && periodEnd > now ? periodEnd : now;
      await upsert("active", ev.periodEnd ?? plusMonth(from), { subscribedAt: running ? null : now, resetReminder: !running });
      break;
    }
    case "extend": {
      const status = current?.subscription_status === "cancelled" ? "cancelled" : "active";
      await upsert(status, ev.periodEnd ?? periodEnd ?? new Date(now.getTime() + MONTH_MS));
      break;
    }
    case "cancel": {
      // No more charges; what's paid for stays open (canAfterDark lets 'cancelled' in until period_end).
      if (current?.subscription_status === "lapsed" || current?.subscription_status === "none" || !current) break;
      await upsert("cancelled", ev.periodEnd ?? periodEnd);
      break;
    }
    case "expiry":
      await upsert("lapsed", now);
      break;
    case "chargeback":
    case "refund":
      await upsert("lapsed", now);
      await db.query(
        `insert into adult_billing_flags (user_id, reason, processor, flagged_at) values ($1, $2, $3, $4)
         on conflict (user_id) do update set reason = excluded.reason, processor = excluded.processor, flagged_at = excluded.flagged_at, reviewed_at = null, reviewed_by = null`,
        [userId, ev.kind, processor, now.toISOString()],
      );
      break;
  }
  return "applied";
}

export type SubscriptionState = {
  status: "none" | "active" | "cancelled" | "lapsed";
  periodEnd: string | null;
  processor: Processor | null;
  /** The processor's own page where this subscriber cancels (Verotel's per-sale link, Segpay's consumer site). */
  cancelUrl: string | null;
  flagged: boolean;
};

/** What the account page says about someone's subscription. A cancelled one whose paid-up time is over reads as lapsed. */
export async function subscriptionState(db: Db, userId: string, now: Date = new Date(), env: Env = process.env): Promise<SubscriptionState> {
  const e = (
    await db.query<{ subscription_status: string; period_end: Date | string | null; provider: string | null }>(
      `select subscription_status, period_end, provider from adult_entitlements where user_id = $1`,
      [userId],
    )
  ).rows[0];
  const flagged = await billingFlagged(db, userId);
  const processor = e?.provider === "ccbill" || e?.provider === "segpay" || e?.provider === "verotel" ? e.provider : null;
  if (!e || !processor || e.subscription_status === "none") return { status: "none", periodEnd: null, processor: null, cancelUrl: null, flagged };
  const end = e.period_end ? new Date(e.period_end) : null;
  let status = e.subscription_status as SubscriptionState["status"];
  if ((status === "active" || status === "cancelled") && end && end <= now) status = "lapsed";
  let cancelUrl: string | null = null;
  if (status === "active") {
    if (processor === "ccbill") cancelUrl = PROCESSOR_INFO.ccbill.cancelUrl;
    else if (processor === "segpay") cancelUrl = PROCESSOR_INFO.segpay.cancelUrl;
    else {
      const config = verotelConfig(env);
      const sale = (
        await db.query<{ sale_id: string }>(
          `select sale_id from adult_billing_orders where user_id = $1 and processor = 'verotel' and sale_id is not null order by paid_at desc nulls last, created_at desc limit 1`,
          [userId],
        )
      ).rows[0];
      // Verotel's signed cancel link for this very sale when we have it, else its cancel lookup.
      cancelUrl = config && sale ? verotelCancelUrl(config, sale.sale_id) : PROCESSOR_INFO.verotel.cancelUrl;
    }
  }
  return { status, periodEnd: end?.toISOString() ?? null, processor, cancelUrl, flagged };
}

/* ----------------------------------------------- California's notices ----------------------------------------------- */

/** Where a subscriber's confirmed email is: their Google account's, else the address they confirmed for notifications. */
async function accountEmail(db: Db, userId: string): Promise<string | null> {
  const a = (await db.query<{ email: string | null; google_sub: string | null }>(`select email, google_sub from accounts where user_id = $1`, [userId])).rows[0];
  if (a?.google_sub && a.email) return a.email;
  const p = (await db.query<{ email: string }>(`select email from email_prefs where user_id = $1 and confirmed_at is not null`, [userId])).rows[0];
  return p?.email ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The renewal terms, in words California's automatic renewal law asks for (Bus. & Prof. Code § 17600 ff., as amended by
 * AB 2863 from 2025-07-01: the confirmation after signing up, and a yearly reminder, each saying what it is, how often
 * and how much it charges, and how to cancel online). Discreet: nothing in the subject or body says what the site is.
 */
export function subscriptionEmail(kind: "confirmation" | "reminder", opts: { price: number; processor: Processor; base: string }): { subject: string; text: string; html: string } {
  const price = priceLabel(opts.price);
  const { label, statement } = PROCESSOR_INFO[opts.processor];
  const cancel = `${opts.base.replace(/\/+$/, "")}/cancel`;
  const account = `${opts.base.replace(/\/+$/, "")}/account`;
  const lines = [
    kind === "confirmation"
      ? "Thanks for subscribing. This confirms your Botchelor subscription."
      : "A yearly reminder: you have a Botchelor subscription that renews automatically.",
    `It costs ${price} a month and renews every month until you cancel. The charge shows on your statement as ${statement} (${label} handles the billing).`,
    `You can cancel any time, online: from your account page (${account}) or our cancellation page (${cancel}). Cancelling stops the next charge; what you've paid for stays open until the end of the month.`,
    "If you didn't expect this email, reply and we'll look into it.",
  ];
  const text = `${lines.join("\n\n")}\n`;
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
    `<p style="font-size:20px;font-weight:700;color:#c82f60;margin:0 0 16px">Botchelor</p>` +
    lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join("") +
    `<p style="margin:0 0 14px"><a href="${esc(account)}" style="color:#b52c59;font-weight:600">Your account</a> · <a href="${esc(cancel)}" style="color:#b52c59;font-weight:600">Cancel</a></p></div>`;
  return { subject: "Your Botchelor subscription", text, html };
}

/** Sends the confirmation or the yearly reminder to the subscriber's confirmed email, when they have one and email is set up. */
export async function sendSubscriptionEmail(db: Db, userId: string, kind: "confirmation" | "reminder", processor: Processor, env: Env = process.env): Promise<boolean> {
  const to = await accountEmail(db, userId);
  if (!to) return false;
  const message = subscriptionEmail(kind, { price: subscriptionPrice(env), processor, base: siteUrl(env) });
  return (await sendAccountEmail(db, userId, `ad_subscription_${kind}`, to, message, env)) === "sent";
}

/** Whole years from `from` to `now`. */
const yearsBetween = (from: Date, now: Date): number => {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from.getTime());
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary > now) years -= 1;
  return years;
};

/**
 * California's yearly reminder (the daily job): every active subscriber whose subscription has passed another
 * anniversary since the last reminder gets one. Off with billing off. Returns how many went.
 */
export async function sendRenewalReminders(db: Db, now: Date = new Date(), env: Env = process.env): Promise<number> {
  if (!billingOn(env)) return 0;
  const yearAgo = new Date(now.getTime());
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const due = (
    await db.query<{ user_id: string; provider: string; subscribed_at: Date | string; renewal_reminded_at: Date | string | null }>(
      `select user_id, provider, subscribed_at, renewal_reminded_at from adult_entitlements
        where subscription_status = 'active' and provider in ('ccbill', 'segpay', 'verotel') and subscribed_at <= $1
          and (period_end is null or period_end > $2)
        limit 200`,
      [yearAgo.toISOString(), now.toISOString()],
    )
  ).rows;
  let sent = 0;
  for (const row of due) {
    const start = new Date(row.subscribed_at);
    const years = yearsBetween(start, now);
    if (years < 1) continue;
    const anniversary = new Date(start.getTime());
    anniversary.setUTCFullYear(start.getUTCFullYear() + years);
    if (row.renewal_reminded_at && new Date(row.renewal_reminded_at) >= anniversary) continue;
    // Marked first, so a send that fails isn't retried every day into a capped mailbox; a person with no email is marked too.
    await db.query(`update adult_entitlements set renewal_reminded_at = $2 where user_id = $1`, [row.user_id, now.toISOString()]);
    if (await sendSubscriptionEmail(db, row.user_id, "reminder", row.provider as Processor, env).catch(() => false)) sent++;
  }
  return sent;
}

/* ------------------------------------------------------- admin ------------------------------------------------------- */

export type AdminSubscription = {
  user_id: string;
  status: string;
  period_end: string | null;
  provider: string | null;
  subscribed_at: string | null;
  age_method: string | null;
  age_country: string | null;
  flagged: string | null;
};
export type AdminBillingEvent = { processor: string; kind: string; raw_event: string; outcome: string; user_id: string | null; sale_id: string | null; amount: string | null; currency: string | null; received_at: string };
export type AdminFlag = { user_id: string; reason: string; processor: string; flagged_at: string; reviewed_at: string | null };

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** The admin's view: subscriptions (paid ones first), the latest postbacks and the flags. */
export async function billingOverview(db: Db): Promise<{ subscriptions: AdminSubscription[]; events: AdminBillingEvent[]; flags: AdminFlag[] }> {
  const subs = await db.query<Omit<AdminSubscription, "period_end" | "subscribed_at"> & { period_end: Date | string | null; subscribed_at: Date | string | null }>(
    `select e.user_id, e.subscription_status as status, e.period_end, e.provider, e.subscribed_at, e.age_method, e.age_country, f.reason as flagged
       from adult_entitlements e left join adult_billing_flags f on f.user_id = e.user_id and f.reviewed_at is null
      where e.provider in ('ccbill', 'segpay', 'verotel') or e.subscription_status <> 'none'
      order by (e.subscription_status = 'active') desc, e.updated_at desc limit 100`,
  );
  const events = await db.query<Omit<AdminBillingEvent, "received_at"> & { received_at: Date | string }>(
    `select processor, kind, raw_event, outcome, user_id, sale_id, amount, currency, received_at from adult_billing_events order by received_at desc limit 50`,
  );
  const flags = await db.query<Omit<AdminFlag, "flagged_at" | "reviewed_at"> & { flagged_at: Date | string; reviewed_at: Date | string | null }>(
    `select user_id, reason, processor, flagged_at, reviewed_at from adult_billing_flags order by flagged_at desc limit 50`,
  );
  return {
    subscriptions: subs.rows.map((r) => ({ ...r, period_end: iso(r.period_end), subscribed_at: iso(r.subscribed_at) })),
    events: events.rows.map((r) => ({ ...r, received_at: iso(r.received_at)! })),
    flags: flags.rows.map((r) => ({ ...r, flagged_at: iso(r.flagged_at)!, reviewed_at: iso(r.reviewed_at) })),
  };
}

/* ---------------------------------------------------- postbacks ---------------------------------------------------- */

/** A postback's parameters: the query string, plus a form body when it's a POST (Segpay can send either). Last one wins. */
export async function postbackParams(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) out[k] = v;
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    const body = (await req.text()).slice(0, 20_000);
    // CCBill's guide names its form posts "application/x-www-form-encoded"; its other choice is JSON.
    if (!type || /application\/x-www-form-(?:url)?encoded|text\/plain/i.test(type)) for (const [k, v] of new URLSearchParams(body)) out[k] = v;
    else if (/application\/json/i.test(type)) {
      const parsed: unknown = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return null;
        }
      })();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (["string", "number", "boolean"].includes(typeof v) && !(k in out)) out[k] = String(v);
    }
  }
  return out;
}

/** The plain-text answer a processor reads ("OK" when taken). */
export const plainText = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** One line in the logs per postback: which processor, what it meant and what came of it. No ids, no amounts. */
export function logPostback(processor: Processor, kind: string, outcome: string): void {
  console.log(JSON.stringify({ log: "after-dark-billing", processor, kind, outcome, at: new Date().toISOString() }));
}
