/**
 * People who have already been inside After Dark, or asked to be (2026-11-26, the revenue pass). They are the warmest
 * leads there are: a beta month that ran out, a subscription that lapsed, an invite request still waiting. Until this,
 * a signed-in one who opened /after-dark or a night they had bookmarked got the same bare not-found as a stranger
 * (while the public door is admins only), and one whose beta month had ended was shown the invite form again, as if
 * they'd never been in. Nothing here is a secret from them: they've seen After Dark, or asked for it by name.
 *
 * `knowsAfterDark` decides where a closed page sends them (the subscribe page, which says what happened and what's
 * next, instead of a not-found). `endedPass` is what that page says.
 */
import type { Db } from "../db";
import { BETA_PROVIDER, REVIEWER_PROVIDER, TASTE_PROVIDER } from "./entitlement";

export type PassRow = { subscription_status: string; period_end: string | Date | null; provider: string | null };

/** What ran out: the invited beta month, or a paid subscription. A taste says so itself; a reviewer's pass is ours. */
export type EndedPass = { kind: "beta" | "subscription"; ended: Date | null };

/**
 * Whether a pass row is one that has ended (pure, so the rule is tested without a database): lapsed, or active or
 * cancelled with its end in the past. A taste (the subscribe page has its own "you've had your free taste") and a
 * processor reviewer's pass are left out; so is a row that was never a pass ('none' with no provider).
 */
export function endedPassOf(row: PassRow | null | undefined, now: Date = new Date()): EndedPass | null {
  if (!row?.provider || row.provider === TASTE_PROVIDER || row.provider === REVIEWER_PROVIDER) return null;
  const end = row.period_end ? new Date(row.period_end) : null;
  const past = end !== null && end.getTime() <= now.getTime();
  const ended =
    row.subscription_status === "lapsed" ||
    (row.subscription_status === "cancelled" && (end === null || past)) ||
    (row.subscription_status === "active" && past);
  if (!ended) return null;
  return { kind: row.provider === BETA_PROVIDER ? "beta" : "subscription", ended: end };
}

/** This person's pass, if it has ended (see endedPassOf). */
export async function endedPass(db: Db, userId: string, now: Date = new Date()): Promise<EndedPass | null> {
  const { rows } = await db.query<PassRow>(`select subscription_status, period_end, provider from adult_entitlements where user_id = $1`, [userId]);
  return endedPassOf(rows[0], now);
}

/**
 * Whether this person has met After Dark: any pass row with a provider (a beta month, a subscription, a taste, ended or
 * not) or an invite request (pending, approved or declined). Best effort: a failed read is a no, so the page falls back
 * to the not-found it always showed.
 */
export async function knowsAfterDark(db: Db, userId: string): Promise<boolean> {
  try {
    const { rows } = await db.query<{ known: boolean }>(
      `select exists (select 1 from adult_entitlements where user_id = $1 and provider is not null)
           or exists (select 1 from adult_invites where user_id = $1) as known`,
      [userId],
    );
    return rows[0]?.known === true;
  } catch {
    return false;
  }
}
