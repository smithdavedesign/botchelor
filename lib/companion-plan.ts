import { isAdmin } from "./admins";
import type { Db } from "./db";
import { planLink, planPrice, planState, portalLink, type PlanStatus } from "./paid-plans";

/**
 * What talking with companions costs a person (docs/companions.md, P2): a free tier of replies a day across every
 * companion, and the Companion Plan (lib/paid-plans.ts) for unlimited, under a fair-use ceiling a month. A reply is counted
 * when it's asked for and given back when none came (the model down, a refusal, the crisis pause), so an error never
 * costs one; the opener a new conversation starts with is free. The free tier as a whole has a ceiling a day too, the
 * most it can cost the show. Admins aren't counted. Agents over MCP have their own limits (lib/companion-mcp.ts).
 */

type Env = Record<string, string | undefined>;

import { COMPANION_FAIR_USE_PER_MONTH, COMPANION_FREE_PER_DAY } from "./companion-shared";

export { COMPANION_FAIR_USE_PER_MONTH, COMPANION_FREE_PER_DAY };
/** Every free reply in a UTC day, across everyone: about $3 on DeepSeek at the most. */
export const COMPANION_FREE_ALL_PER_DAY = 3000;
/** The row that counts the whole free tier. */
const EVERYONE = "*free*";

const intEnv = (raw: string | undefined, fallback: number) => {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
export const companionFreePerDay = (env: Env = process.env) => intEnv(env.COMPANION_FREE_PER_DAY, COMPANION_FREE_PER_DAY);
export const companionFreeAllPerDay = (env: Env = process.env) => intEnv(env.COMPANION_FREE_ALL_PER_DAY, COMPANION_FREE_ALL_PER_DAY);

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const nextDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

export type CompanionAllowance = {
  /** No count: the plan, or an admin. */
  unlimited: boolean;
  admin: boolean;
  plan: PlanStatus;
  /** When a cancelled plan ends, or an active one renews. */
  plan_ends: string | null;
  per_day: number;
  /** Free replies left today; null when unlimited. */
  left: number | null;
  /** When the free count starts again (UTC midnight). */
  resets_at: string;
  price: string;
  /** Whether the plan can be bought right now. */
  on_sale: boolean;
  /** Stripe's billing portal, for a subscriber to cancel or change their card. */
  manage: string | null;
};

async function used(db: Db, userId: string, day: string): Promise<number> {
  return (await db.query<{ replies: number }>(`select replies from companion_usage where user_id = $1 and day = $2`, [userId, day])).rows[0]?.replies ?? 0;
}

/** Where a person stands: unlimited, or how many free replies are left today, and the plan on offer. */
export async function companionAllowance(db: Db, userId: string, now: Date = new Date(), env: Env = process.env): Promise<CompanionAllowance> {
  const [plan, admin] = await Promise.all([planState(db, userId, "companion", now), isAdmin(db, userId)]);
  const perDay = companionFreePerDay(env);
  const unlimited = plan.active || admin;
  return {
    unlimited,
    admin,
    plan: plan.status,
    plan_ends: plan.active ? plan.period_end : null,
    per_day: perDay,
    left: unlimited ? null : Math.max(0, perDay - (await used(db, userId, dayOf(now)))),
    resets_at: nextDay(now),
    price: planPrice("companion", env),
    on_sale: planLink("companion", env) !== null,
    manage: plan.status === "none" ? null : portalLink(env),
  };
}

export type ReplyTicket =
  | { ok: true; free: boolean; day: string; counted: boolean }
  | { ok: false; status: number; error: "free_used_up" | "free_busy" | "fair_use"; message: string; allowance: CompanionAllowance };

const bump = (db: Db, userId: string, day: string, cap: number | null) =>
  db.query(
    cap === null
      ? `insert into companion_usage as u (user_id, day, replies) values ($1, $2, 1)
         on conflict (user_id, day) do update set replies = u.replies + 1 returning replies`
      : `insert into companion_usage as u (user_id, day, replies) values ($1, $2, 1)
         on conflict (user_id, day) do update set replies = u.replies + 1 where u.replies < $3 returning replies`,
    cap === null ? [userId, day] : [userId, day, cap],
  );
const unbump = (db: Db, userId: string, day: string) =>
  db.query(`update companion_usage set replies = replies - 1 where user_id = $1 and day = $2 and replies > 0`, [userId, day]);

/**
 * Takes one reply before it's drawn: counted for the plan's fair use, or out of today's free ones (and the free tier's
 * ceiling). Refused before anything is sent, never in the middle of a reply.
 */
export async function takeReply(db: Db, userId: string, now: Date = new Date(), env: Env = process.env): Promise<ReplyTicket> {
  const day = dayOf(now);
  const allowance = await companionAllowance(db, userId, now, env);
  if (allowance.admin) return { ok: true, free: false, day, counted: false };
  if (allowance.unlimited) {
    const month = (await db.query<{ n: number }>(`select coalesce(sum(replies), 0)::int as n from companion_usage where user_id = $1 and day >= date_trunc('month', $2::date)`, [userId, day])).rows[0]?.n ?? 0;
    if (month >= COMPANION_FAIR_USE_PER_MONTH) {
      return { ok: false, status: 429, error: "fair_use", allowance, message: `That's ${COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} messages this month, the plan's fair use. It starts again on the 1st.` };
    }
    await bump(db, userId, day, null);
    return { ok: true, free: false, day, counted: true };
  }
  const perDay = companionFreePerDay(env);
  const usedUp = { ok: false as const, status: 402, error: "free_used_up" as const, allowance: { ...allowance, left: 0 } };
  const offer = allowance.on_sale ? ` Or the Companion Plan (${allowance.price}) has no daily limit.` : "";
  if (perDay === 0 || !(await bump(db, userId, day, perDay)).rows.length) {
    return { ...usedUp, message: `That's today's ${perDay} free replies. They come back at midnight UTC.${offer}` };
  }
  if (!(await bump(db, EVERYONE, day, companionFreeAllPerDay(env))).rows.length) {
    await unbump(db, userId, day);
    return { ok: false, status: 503, error: "free_busy", allowance, message: `Free replies are used up across Botchelor for today. They come back at midnight UTC.${offer}` };
  }
  return { ok: true, free: true, day, counted: true };
}

/** Reply counts matter for today and this month's fair use: kept through last month, then they go (the daily job). */
export async function pruneCompanionUsage(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(`delete from companion_usage where day < (date_trunc('month', $1::date) - interval '1 month')::date`, [now.toISOString().slice(0, 10)]);
}

/** Gives a reply back when none came. */
export async function giveBackReply(db: Db, userId: string, ticket: Extract<ReplyTicket, { ok: true }>): Promise<void> {
  if (!ticket.counted) return;
  await unbump(db, userId, ticket.day);
  if (ticket.free) await unbump(db, EVERYONE, ticket.day);
}
