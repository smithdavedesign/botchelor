/**
 * What companions' extras cost (docs/companions.md, P3): voice notes (lib/companion-voice.ts), and later selfies.
 *
 *  - The Companion Plan includes COMPANION_EXTRAS[kind].included a calendar month (UTC), counted per person.
 *  - Past that, and for everyone without the plan, a bought token (the shop's, lib/allowance.ts) buys a bundle of
 *    `bundle`, kept as credits until used: priced from what one costs us, since a token can't be split.
 *  - One is taken before it's made and given back when it isn't (a failure, a refusal). A bundle bought for one that
 *    then failed is undone whole: the token comes back and the bundle goes.
 *  - A token is only ever spent when the caller says so (`buy`): the button shows the price first. Never mid-reply:
 *    an extra is asked for on its own, after the reply is there.
 *  - Admins aren't counted. Guests (no account) get none: the routes ask them to sign in first.
 */
import { isAdmin } from "./admins";
import { episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "./allowance";
import { COMPANION_EXTRAS, type CompanionExtraKind, type CompanionExtraState } from "./companion-shared";
import type { Db } from "./db";
import { planState } from "./paid-plans";

const monthOf = (now: Date) => `${now.toISOString().slice(0, 7)}-01`;

/** Where a person stands on one extra (lib/companion-shared.ts CompanionExtraState). */
export async function extraState(db: Db, userId: string, kind: CompanionExtraKind, now: Date = new Date()): Promise<CompanionExtraState> {
  const x = COMPANION_EXTRAS[kind];
  const [admin, plan, credits, tokens] = await Promise.all([
    isAdmin(db, userId),
    planState(db, userId, "companion", now),
    db.query<{ credits: number }>(`select credits from companion_credits where user_id = $1 and kind = $2`, [userId, kind]),
    episodeAllowance(db, userId, now),
  ]);
  const used = plan.active
    ? ((await db.query<{ used: number }>(`select used from companion_extras_usage where user_id = $1 and month = $2 and kind = $3`, [userId, monthOf(now), kind])).rows[0]?.used ?? 0)
    : 0;
  return {
    free: admin,
    included_left: plan.active ? Math.max(0, x.included - used) : null,
    credits: credits.rows[0]?.credits ?? 0,
    tokens: x.tokens,
    bundle: x.bundle,
    tokens_left: tokens.pack_left,
  };
}

/** Every extra's state, for a thread's page. */
export async function extrasState(db: Db, userId: string, now: Date = new Date()): Promise<Record<CompanionExtraKind, CompanionExtraState>> {
  const kinds = Object.keys(COMPANION_EXTRAS) as CompanionExtraKind[];
  const states = await Promise.all(kinds.map((k) => extraState(db, userId, k, now)));
  return Object.fromEntries(kinds.map((k, i) => [k, states[i]])) as Record<CompanionExtraKind, CompanionExtraState>;
}

export type ExtraTicket = { ok: true; kind: CompanionExtraKind; source: "admin" | "included" | "credit"; month: string; bought: boolean };
export type ExtraRefusal = { ok: false; status: number; error: "needs_tokens" | "price"; message: string; price: { tokens: number; bundle: number } };

/** "1 token buys 100 voice notes" */
export const bundleWords = (kind: CompanionExtraKind): string => {
  const x = COMPANION_EXTRAS[kind];
  return `${x.tokens} token${x.tokens === 1 ? "" : "s"} buys ${x.bundle} ${x.many}`;
};

/**
 * Takes one before it's made: free for an admin, else the plan's included ones this month, else a credit, else (only
 * with `buy`) a bought token for a bundle. Refused (nothing taken) when none of those can pay.
 */
export async function takeExtra(db: Db, userId: string, kind: CompanionExtraKind, opts: { buy?: boolean; now?: Date } = {}): Promise<ExtraTicket | ExtraRefusal> {
  const now = opts.now ?? new Date();
  const x = COMPANION_EXTRAS[kind];
  const month = monthOf(now);
  const ticket = (source: ExtraTicket["source"], bought = false): ExtraTicket => ({ ok: true, kind, source, month, bought });
  if (await isAdmin(db, userId)) return ticket("admin");
  if ((await planState(db, userId, "companion", now)).active) {
    const took = await db.query(
      `insert into companion_extras_usage as u (user_id, month, kind, used) values ($1, $2, $3, 1)
       on conflict (user_id, month, kind) do update set used = u.used + 1 where u.used < $4 returning used`,
      [userId, month, kind, x.included],
    );
    if (took.rows.length) return ticket("included");
  }
  const credit = await db.query(`update companion_credits set credits = credits - 1 where user_id = $1 and kind = $2 and credits > 0 returning credits`, [userId, kind]);
  if (credit.rows.length) return ticket("credit");
  const price = { tokens: x.tokens, bundle: x.bundle };
  if (!opts.buy) return { ok: false, status: 402, error: "price", price, message: `${cap(x.many)}: ${bundleWords(kind)}.` };
  if (!(await spendBoughtTokens(db, userId, x.tokens))) {
    return { ok: false, status: 402, error: "needs_tokens", price, message: `${cap(bundleWords(kind))}, and you're out of tokens. Get more on the shop page.` };
  }
  // The bundle, less the one this is.
  await db.query(
    `insert into companion_credits as c (user_id, kind, credits) values ($1, $2, $3)
     on conflict (user_id, kind) do update set credits = c.credits + $3`,
    [userId, kind, x.bundle - 1],
  );
  return ticket("credit", true);
}

/** Gives one back when it wasn't made; a bundle bought for it goes back whole (the token too). */
export async function giveBackExtra(db: Db, userId: string, t: ExtraTicket): Promise<void> {
  const x = COMPANION_EXTRAS[t.kind];
  if (t.source === "admin") return;
  if (t.source === "included") {
    await db.query(`update companion_extras_usage set used = used - 1 where user_id = $1 and month = $2 and kind = $3 and used > 0`, [userId, t.month, t.kind]);
    return;
  }
  if (t.bought) {
    await db.query(`update companion_credits set credits = greatest(0, credits - $3) where user_id = $1 and kind = $2`, [userId, t.kind, x.bundle - 1]);
    await refundBoughtTokens(db, userId, x.tokens);
    return;
  }
  await db.query(`update companion_credits set credits = credits + 1 where user_id = $1 and kind = $2`, [userId, t.kind]);
}

/** The plan's monthly counts matter this month only: older months go (the daily job). */
export async function pruneExtrasUsage(db: Db, now: Date = new Date()): Promise<void> {
  await db.query(`delete from companion_extras_usage where month < $1::date`, [monthOf(now)]);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
