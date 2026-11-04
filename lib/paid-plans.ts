/**
 * Subscription plans sold on a Stripe Payment Link (docs/companions.md, P2): the Companion Plan first, and where any
 * later plan goes (one table, one webhook). Like the token packs (lib/stripe.ts) and the operator pass
 * (lib/operator-pass.ts), nothing here calls Stripe's API: a Subscribe click makes a random checkout id that rides the
 * owner's Payment Link as client_reference_id, and the signed webhook (app/api/webhooks/stripe-plans) grants, renews,
 * cancels and ends the plan. A plan is on sale only while its link is set; a subscriber keeps what they paid for either way.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { isProductionDeploy } from "./deploy";
import { sendAccountEmail } from "./email";
import { siteUrl } from "./site";
import { isTestModeLink, paymentLinkUrl, RENEWAL_GRACE_MS } from "./stripe";

type Env = Record<string, string | undefined>;

export const PLAN_IDS = ["companion"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanSpec = {
  id: PlanId;
  name: string;
  /** The price as the page says it; the Payment Link holds the real one, so the two are set together. */
  price: string;
  /** Where its Payment Link is set. */
  linkEnv: string;
  priceEnv: string;
};

export const PLANS: Record<PlanId, PlanSpec> = {
  companion: { id: "companion", name: "Companion Plan", price: "$9.99 a month", linkEnv: "COMPANION_PLAN_LINK", priceEnv: "COMPANION_PLAN_PRICE" },
};

const isPlan = (v: unknown): v is PlanId => (PLAN_IDS as readonly unknown[]).includes(v);

/** The plan's Payment Link, or null unless it's a valid https link (a test-mode link counts as none on production). */
export function planLink(plan: PlanId, env: Env = process.env): URL | null {
  const raw = (env[PLANS[plan].linkEnv] ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (isProductionDeploy(env) && isTestModeLink(url) && env.STRIPE_ALLOW_TEST_LINK !== "1") return null;
    return url;
  } catch {
    return null;
  }
}

/** Whether any plan is on sale: the webhook exists only then. */
export function plansOn(env: Env = process.env): boolean {
  return PLAN_IDS.some((p) => planLink(p, env) !== null);
}

/** The plan's price as shown (its env label, set with the link; else the default). */
export function planPrice(plan: PlanId, env: Env = process.env): string {
  return (env[PLANS[plan].priceEnv] ?? "").trim().slice(0, 40) || PLANS[plan].price;
}

/** Stripe's billing portal login link (STRIPE_PORTAL_LINK), where a subscriber cancels or changes their card. */
export function portalLink(env: Env = process.env): string | null {
  const raw = (env.STRIPE_PORTAL_LINK ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "billing.stripe.com" ? url.href : null;
  } catch {
    return null;
  }
}

export type PlanStatus = "none" | "active" | "cancelled" | "lapsed";
export type PlanState = { plan: PlanId; status: PlanStatus; active: boolean; period_end: string | null };

type Row = { status: string; period_end: Date | string | null; stripe_subscription_id: string | null };

async function row(db: Db, userId: string, plan: PlanId): Promise<Row | null> {
  return (await db.query<Row>(`select status, period_end, stripe_subscription_id from plan_entitlements where user_id = $1 and plan = $2`, [userId, plan])).rows[0] ?? null;
}

/** Where a person's plan stands: active (renewing), cancelled (runs to its date), lapsed or none. */
export async function planState(db: Db, userId: string, plan: PlanId, now: Date = new Date()): Promise<PlanState> {
  const r = await row(db, userId, plan);
  if (!r) return { plan, status: "none", active: false, period_end: null };
  const end = r.period_end ? new Date(r.period_end) : null;
  const t = now.getTime();
  const active =
    r.status === "active" ? end === null || end.getTime() + RENEWAL_GRACE_MS > t : r.status === "cancelled" ? end !== null && end.getTime() > t : false;
  const status: PlanStatus = !active ? "lapsed" : r.status === "cancelled" ? "cancelled" : "active";
  return { plan, status, active, period_end: end?.toISOString() ?? null };
}

/** The plans Stripe will still charge a person for (on, not cancelled): deleting the account doesn't stop them. */
export async function renewingPlans(db: Db, userId: string, now: Date = new Date()): Promise<PlanId[]> {
  const out: PlanId[] = [];
  for (const plan of PLAN_IDS) if ((await planState(db, userId, plan, now)).status === "active") out.push(plan);
  return out;
}

/**
 * A Subscribe click: a random checkout id (never the person's id, which the link shows to Stripe and anyone in its
 * dashboard) and the Payment Link carrying it. Null when the plan isn't on sale.
 */
export async function startPlanCheckout(db: Db, userId: string, plan: PlanId, env: Env = process.env): Promise<string | null> {
  const link = planLink(plan, env);
  if (!link) return null;
  const id = randomUUID();
  await db.query(`insert into plan_checkouts (id, user_id, plan) values ($1, $2, $3)`, [id, userId, plan]);
  return paymentLinkUrl(link, id);
}

/** A Subscribe click is needed only until its checkout completes (Stripe's sessions expire in a day): a week, then it goes. */
export async function prunePlanCheckouts(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(`delete from plan_checkouts where created_at < $1`, [new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)]);
}

export type PlanOwner = { userId: string; plan: PlanId };

/** Whose Subscribe click a checkout id was. */
export async function checkoutOwner(db: Db, checkoutId: string): Promise<PlanOwner | null> {
  const r = (await db.query<{ user_id: string; plan: string }>(`select user_id, plan from plan_checkouts where id = $1`, [checkoutId])).rows[0];
  return r && isPlan(r.plan) ? { userId: r.user_id, plan: r.plan } : null;
}

/** Whose plan a Stripe subscription is (renewals and cancels carry only the subscription). */
export async function subscriptionOwner(db: Db, subscriptionId: string): Promise<PlanOwner | null> {
  const r = (await db.query<{ user_id: string; plan: string }>(`select user_id, plan from plan_entitlements where stripe_subscription_id = $1 limit 1`, [subscriptionId])).rows[0];
  return r && isPlan(r.plan) ? { userId: r.user_id, plan: r.plan } : null;
}

export type PlanEventKind = "initial" | "rebill" | "cancel" | "resume" | "expiry";

const plusMonth = (from: Date): Date => {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/**
 * Applies one subscription event: initial and rebill make it active to the period's end (Stripe's when it says, else a
 * month on from the later of now and the paid-up date); cancel keeps it to the end; resume undoes a cancel; expiry
 * ends it now. A resume never starts a plan that isn't running: only a payment does.
 */
export async function grantPlan(
  db: Db,
  userId: string,
  plan: PlanId,
  kind: PlanEventKind,
  opts: { periodEnd?: Date | null; subscriptionId?: string | null; provider?: string; email?: string | null } = {},
  now: Date = new Date(),
): Promise<void> {
  const cur = await row(db, userId, plan);
  const curEnd = cur?.period_end ? new Date(cur.period_end) : null;
  const running = Boolean(cur && (cur.status === "active" || cur.status === "cancelled") && curEnd && curEnd > now);
  const put = (status: Exclude<PlanStatus, "none">, end: Date | null) =>
    db.query(
      `insert into plan_entitlements (user_id, plan, status, period_end, provider, stripe_subscription_id, email, subscribed_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, case when $3 = 'active' then $8::timestamptz end, now())
       on conflict (user_id, plan) do update set status = excluded.status, period_end = excluded.period_end, provider = excluded.provider,
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, plan_entitlements.stripe_subscription_id),
         email = coalesce(excluded.email, plan_entitlements.email),
         subscribed_at = case when $9 then coalesce(excluded.subscribed_at, plan_entitlements.subscribed_at) else coalesce(plan_entitlements.subscribed_at, excluded.subscribed_at) end,
         updated_at = now()`,
      [userId, plan, status, end?.toISOString() ?? null, opts.provider ?? "stripe", opts.subscriptionId ?? null, opts.email ?? null, now.toISOString(), kind === "initial" && !running],
    );
  switch (kind) {
    case "initial":
      await put("active", opts.periodEnd ?? plusMonth(now));
      break;
    case "rebill":
      await put("active", opts.periodEnd ?? plusMonth(running && curEnd ? curEnd : now));
      break;
    case "cancel":
      if (cur && (cur.status === "active" || cur.status === "cancelled")) await put("cancelled", opts.periodEnd ?? curEnd);
      break;
    case "resume":
      if (cur && (cur.status === "active" || cur.status === "cancelled")) await put("active", opts.periodEnd ?? curEnd);
      break;
    case "expiry":
      if (cur) await put("lapsed", now);
      break;
  }
}

/* ------------------------------------------- the receipt and the reminder ------------------------------------------- */

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const longDay = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The words California's automatic renewal law asks for (Bus. & Prof. Code section 17600 ff., as amended by AB 2863: the
 * confirmation after subscribing and a yearly reminder, each saying what it is, how often and how much it charges, and
 * how to cancel online), as lib/adult/billing.ts says them for After Dark.
 */
export function planEmail(plan: PlanId, kind: "confirmation" | "reminder", o: { price: string; renews: Date | null; manage: string | null; base: string }) {
  const spec = PLANS[plan];
  const page = `${o.base}/companion/plan`;
  const cancel = o.manage ?? page;
  const lines = [
    kind === "confirmation" ? `Thanks for subscribing. This confirms your ${spec.name} on Botchelor.` : `A yearly reminder: your ${spec.name} on Botchelor renews automatically.`,
    `It costs ${o.price}, charged every month until you cancel${o.renews ? `; the next charge is on ${longDay(o.renews)}` : ""}. Stripe handles the billing.`,
    `It gives you unlimited messages with every companion (fair use: 3,000 a month).`,
    `You can cancel any time, online, in Stripe's billing portal (${cancel}). Cancelling stops the next charge; the plan runs to the end of the month you paid for, with no partial refunds. The plan's terms: ${o.base}/terms#companion-plan`,
    "If you didn't expect this email, reply and we'll look into it.",
  ];
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#241022">` +
    `<p style="font-size:20px;font-weight:700;color:#c82f60;margin:0 0 16px">Botchelor</p>` +
    lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join("") +
    `<p style="margin:0 0 14px"><a href="${esc(page)}" style="color:#b52c59;font-weight:600">Your plan</a> · <a href="${esc(cancel)}" style="color:#b52c59;font-weight:600">Cancel</a></p></div>`;
  return { subject: `Your ${spec.name} on Botchelor`, text: `${lines.join("\n\n")}\n`, html };
}

/** Sends a plan's confirmation or yearly reminder to the address they paid with. */
export async function sendPlanEmail(db: Db, userId: string, plan: PlanId, kind: "confirmation" | "reminder", env: Env = process.env): Promise<boolean> {
  const r = (await db.query<{ email: string | null; period_end: Date | string | null }>(`select email, period_end from plan_entitlements where user_id = $1 and plan = $2`, [userId, plan])).rows[0];
  if (!r?.email) return false;
  const message = planEmail(plan, kind, { price: planPrice(plan, env), renews: r.period_end ? new Date(r.period_end) : null, manage: portalLink(env), base: siteUrl(env) });
  return (await sendAccountEmail(db, userId, `${plan}_plan_${kind}`, r.email, message, env)) === "sent";
}

/** Whole years from `from` to `now`. */
const yearsBetween = (from: Date, now: Date): number => {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from.getTime());
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary > now) years -= 1;
  return years;
};

/** The yearly reminder (the daily job): each running plan that has passed another anniversary since the last one. */
export async function sendPlanReminders(db: Db, now: Date = new Date(), env: Env = process.env): Promise<number> {
  const yearAgo = new Date(now.getTime());
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const due = (
    await db.query<{ user_id: string; plan: string; subscribed_at: Date | string; renewal_reminded_at: Date | string | null }>(
      `select user_id, plan, subscribed_at, renewal_reminded_at from plan_entitlements
        where status = 'active' and subscribed_at <= $1 and (period_end is null or period_end > $2) limit 200`,
      [yearAgo.toISOString(), now.toISOString()],
    )
  ).rows;
  let sent = 0;
  for (const r of due) {
    if (!isPlan(r.plan)) continue;
    const start = new Date(r.subscribed_at);
    const years = yearsBetween(start, now);
    if (years < 1) continue;
    const anniversary = new Date(start.getTime());
    anniversary.setUTCFullYear(start.getUTCFullYear() + years);
    if (r.renewal_reminded_at && new Date(r.renewal_reminded_at) >= anniversary) continue;
    // Marked first, so a failed send isn't retried every day into a capped mailbox.
    await db.query(`update plan_entitlements set renewal_reminded_at = $3 where user_id = $1 and plan = $2`, [r.user_id, r.plan, now.toISOString()]);
    if (await sendPlanEmail(db, r.user_id, r.plan, "reminder", env).catch(() => false)) sent++;
  }
  return sent;
}
