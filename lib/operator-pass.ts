/**
 * The operator pass (docs/PRDs/agent-world.md, Phase 0): a monthly subscription an agent OPERATOR buys to keep its
 * integration unblocked — RESERVED_PER_MONTH reserved show-model dates a month and a priority jump past the shared
 * daily cap (lib/dating.ts agentDailyDateCap). Keyed on the agent_id, which is also the user_id ("the agent_id IS the
 * user_id", lib/mcp/dispatcher.ts), so an anonymous agent can hold one without an account, exactly like BYOK (lib/keys.ts).
 *
 * Built complete and OFF, like After Dark billing (lib/adult/billing.ts). It is on only when OPERATOR_PASS_ENABLED=1
 * (to comp or pilot a pass) or a purchasable Stripe subscription link is set (OPERATOR_PASS_LINK). With neither, every
 * function here returns after a single env check — no table read, no change to any reply — so the live budget
 * behaviour is byte-for-byte what it was. grantOperatorPass is how the Stripe webhook (app/api/webhooks/stripe-operator)
 * grants a bought pass, how an admin comps one, and how the tests drive it.
 */
import type { Db } from "./db";
import { isTestModeLink } from "./stripe";

/** Reserved show-model dates a pass gives each month (docs/pricing-and-byok.md). */
export const RESERVED_PER_MONTH = 100;

type Env = Record<string, string | undefined>;

/** The purchasable Stripe subscription Payment Link, or null unless it's a valid https link (test-mode counts as none on prod). */
export function operatorPassLink(env: Env = process.env): URL | null {
  const raw = (env.OPERATOR_PASS_LINK || env.NEXT_PUBLIC_OPERATOR_PASS_LINK || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (env.VERCEL_ENV === "production" && isTestModeLink(url) && env.STRIPE_ALLOW_TEST_LINK !== "1") return null;
    return url;
  } catch {
    return null;
  }
}

/** Whether the operator pass is switched on at all: a comp/pilot flag, or a purchasable link. Off by default. */
export function operatorPassOn(env: Env = process.env): boolean {
  return env.OPERATOR_PASS_ENABLED === "1" || operatorPassLink(env) !== null;
}

/** "YYYY-MM" in UTC: the month a reserved date belongs to (reserved dates reset on the UTC month). */
export const monthKey = (now: Date = new Date()): string => now.toISOString().slice(0, 7);

const plusMonth = (from: Date): Date => {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

export type PassStatus = "none" | "active" | "lapsed" | "cancelled";

type EntitlementRow = { subscription_status: string; period_end: Date | string | null };

async function entitlement(db: Db, agentId: string): Promise<EntitlementRow | null> {
  return (await db.query<EntitlementRow>(`select subscription_status, period_end from operator_entitlements where user_id = $1`, [agentId])).rows[0] ?? null;
}

/** Whether this agent has an operator pass that's paid up right now. Short-circuits (no DB read) when the pass is off. */
export async function operatorPassActive(db: Db, agentId: string, now: Date = new Date(), env: Env = process.env): Promise<boolean> {
  if (!operatorPassOn(env)) return false;
  const e = await entitlement(db, agentId);
  if (!e) return false;
  const end = e.period_end ? new Date(e.period_end).getTime() : null;
  return (
    (e.subscription_status === "active" && (end === null || end > now.getTime())) ||
    (e.subscription_status === "cancelled" && end !== null && end > now.getTime())
  );
}

export type ReservedDates = { reserved_left: number; reserved_cap: number };

/** This month's reserved dates left for an active pass-holder, or null when there's no active pass. */
export async function operatorReserved(db: Db, agentId: string, now: Date = new Date(), env: Env = process.env): Promise<ReservedDates | null> {
  if (!(await operatorPassActive(db, agentId, now, env))) return null;
  const used = (await db.query<{ used: number }>(`select used from operator_date_usage where user_id = $1 and period_month = $2`, [agentId, monthKey(now)])).rows[0]?.used ?? 0;
  return { reserved_left: Math.max(0, RESERVED_PER_MONTH - used), reserved_cap: RESERVED_PER_MONTH };
}

/**
 * Takes one of this month's reserved dates for an active pass-holder (a conditional upsert, like reserveEpisode): true
 * when one was claimed, false when the pass is off/inactive or this month's reserved dates are used up. The caller
 * releases it (releaseOperatorDate) if no date gets saved.
 */
export async function reserveOperatorDate(db: Db, agentId: string, now: Date = new Date(), env: Env = process.env): Promise<boolean> {
  if (!(await operatorPassActive(db, agentId, now, env))) return false;
  const r = await db.query(
    `insert into operator_date_usage as u (user_id, period_month, used) values ($1, $2, 1)
     on conflict (user_id, period_month) do update set used = u.used + 1 where u.used < $3
     returning used`,
    [agentId, monthKey(now), RESERVED_PER_MONTH],
  );
  return r.rows.length > 0;
}

/** Gives back a reserved date whose episode was never saved. Never below zero. */
export async function releaseOperatorDate(db: Db, agentId: string, now: Date = new Date()): Promise<void> {
  await db.query(`update operator_date_usage set used = used - 1 where user_id = $1 and period_month = $2 and used > 0`, [agentId, monthKey(now)]);
}

export type PassEventKind = "initial" | "rebill" | "cancel" | "expiry";

/**
 * Applies one subscription event to the entitlement, the way lib/adult/billing.ts applyBillingEvent does for After
 * Dark: initial/rebill set it active to a month out (rebill extends from the later of now and the paid-up date), cancel
 * keeps access until period_end, expiry lapses it now. Used by the Stripe webhook, an admin comp, and the tests.
 */
export async function grantOperatorPass(
  db: Db,
  agentId: string,
  kind: PassEventKind,
  opts: { provider?: string; periodEnd?: Date | null; subscriptionId?: string | null } = {},
  now: Date = new Date(),
): Promise<void> {
  const cur = await entitlement(db, agentId);
  const curEnd = cur?.period_end ? new Date(cur.period_end) : null;
  const running = Boolean(cur && (cur.subscription_status === "active" || cur.subscription_status === "cancelled") && curEnd && curEnd > now);
  const provider = opts.provider ?? "admin";
  const upsert = (status: PassStatus, end: Date | null) =>
    db.query(
      `insert into operator_entitlements (user_id, subscription_status, period_end, provider, stripe_subscription_id, updated_at)
         values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update set subscription_status = excluded.subscription_status, period_end = excluded.period_end,
         provider = excluded.provider,
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, operator_entitlements.stripe_subscription_id), updated_at = now()`,
      [agentId, status, end?.toISOString() ?? null, provider, opts.subscriptionId ?? null],
    );
  switch (kind) {
    case "initial":
      await upsert("active", opts.periodEnd ?? plusMonth(now));
      break;
    case "rebill": {
      const from = running && curEnd ? curEnd : now;
      await upsert("active", opts.periodEnd ?? plusMonth(from));
      break;
    }
    case "cancel":
      if (cur && cur.subscription_status !== "none" && cur.subscription_status !== "lapsed") await upsert("cancelled", opts.periodEnd ?? curEnd);
      break;
    case "expiry":
      await upsert("lapsed", now);
      break;
  }
}

/** Looks up the agent behind a Stripe subscription id (renewal/cancel events don't carry the agent_id). */
export async function agentForSubscription(db: Db, subscriptionId: string): Promise<string | null> {
  return (await db.query<{ user_id: string }>(`select user_id from operator_entitlements where stripe_subscription_id = $1 limit 1`, [subscriptionId])).rows[0]?.user_id ?? null;
}

export type PassView = { on: boolean; purchasable: boolean; reserved_per_month: number };

/** What the pricing page shows: whether the pass is on and whether it can be bought right now. */
export function passView(env: Env = process.env): PassView {
  return { on: operatorPassOn(env), purchasable: operatorPassLink(env) !== null, reserved_per_month: RESERVED_PER_MONTH };
}
