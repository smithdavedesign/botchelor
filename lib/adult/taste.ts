/**
 * A free taste of After Dark (competitor review 2026-11-08, David's "1-5"): every adult competitor lets a new person in
 * before they pay (CrushOn 50 free messages a day, OurDream 55 free coins), and After Dark had nothing but an invite
 * queue. So a signed-in person who has never had After Dark can start a taste themselves, once:
 *  - It lasts TASTE_HOURS and is the scenes only: TASTE_WRITES scene steps (about one chapter), no pictures, video or
 *    voiced lines (lib/adult/place.ts mediaRefusal refuses them with a "that's the subscription" message), so it costs
 *    a few text calls on the default model and nothing on Hive's picture checks.
 *  - Only where After Dark is fully open (not text-only places, where the law asks more of us, and not blocked ones).
 *  - One per person ever (adult_tastes), and at most TASTE_PER_DAY started across the site in a UTC day, so a burst of
 *    new accounts can't run up the bill.
 *  - It's written as an ordinary pass (adult_entitlements provider 'taste'), so every After Dark check that already
 *    asks canAfterDark works unchanged, and a later subscription or beta pass simply replaces it.
 */
import type { Db } from "../db";
import { TASTE_PROVIDER } from "./entitlement";

/** How long a taste stays open. */
export const TASTE_HOURS = 48;
/** The scene steps a taste includes (a chapter is up to 120 lines, two a step, so about a third of one to most of one). */
export const TASTE_WRITES = 40;
/** The most tastes started across the site in one UTC day. */
export const TASTE_PER_DAY = 40;

export type TasteRefusal = "already_had" | "has_after_dark" | "sold_out_today";

/** Whether this person may start a taste: null when they may, else why not. */
export async function tasteRefusal(db: Db, userId: string, now: Date = new Date()): Promise<TasteRefusal | null> {
  if ((await db.query(`select 1 from adult_tastes where user_id = $1`, [userId])).rows.length) return "already_had";
  const e = (await db.query<{ provider: string | null }>(`select provider from adult_entitlements where user_id = $1`, [userId])).rows[0];
  // A row with no provider is only a recorded 18+ declaration (an invite request): that person may still taste.
  if (e?.provider) return "has_after_dark";
  // The UTC day's bounds, as instants, so the database's own time zone never shifts the day.
  const from = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const started = (await db.query<{ n: number }>(`select count(*)::int as n from adult_tastes where started_at >= $1 and started_at < $2`, [from.toISOString(), to.toISOString()]))
    .rows[0]?.n ?? 0;
  return started >= TASTE_PER_DAY ? "sold_out_today" : null;
}

/** What each refusal says. */
export const TASTE_REFUSAL_TEXT: Record<TasteRefusal, string> = {
  already_had: "You've had your free taste. Subscribe to carry on.",
  has_after_dark: "You already have, or had, After Dark, so there's no taste to start.",
  sold_out_today: "Today's free tastes are all taken. Try again tomorrow.",
};

/**
 * Starts a taste: records it (once per person, enforced by the key) and writes the pass with the 18+ declaration.
 * Returns when it ends, or the refusal.
 */
export async function startTaste(db: Db, userId: string, country: string | null, now: Date = new Date()): Promise<{ ok: true; ends: Date } | { ok: false; why: TasteRefusal }> {
  const refused = await tasteRefusal(db, userId, now);
  if (refused) return { ok: false, why: refused };
  const claimed = await db.query(`insert into adult_tastes (user_id, country, started_at) values ($1, $2, $3) on conflict (user_id) do nothing returning user_id`, [
    userId,
    country,
    now.toISOString(),
  ]);
  if (!claimed.rows.length) return { ok: false, why: "already_had" };
  const ends = new Date(now.getTime() + TASTE_HOURS * 60 * 60 * 1000);
  await db.query(
    `insert into adult_entitlements (user_id, subscription_status, period_end, provider, age_verified_at, age_method, age_country, updated_at)
     values ($1, 'active', $2, $3, $4, 'self_declared', $5, now())
     on conflict (user_id) do update set subscription_status = 'active', period_end = excluded.period_end, provider = excluded.provider,
       age_verified_at = coalesce(adult_entitlements.age_verified_at, excluded.age_verified_at),
       age_method = coalesce(adult_entitlements.age_method, excluded.age_method),
       age_country = coalesce(adult_entitlements.age_country, excluded.age_country), updated_at = now()
     where adult_entitlements.provider is null`,
    [userId, ends.toISOString(), TASTE_PROVIDER, now.toISOString(), country],
  );
  return { ok: true, ends };
}

/** Whether this person is on a taste that's still running. */
export async function isTasting(db: Db, userId: string): Promise<boolean> {
  const r = await db.query(
    `select 1 from adult_entitlements where user_id = $1 and provider = $2 and subscription_status = 'active' and (period_end is null or period_end > now())`,
    [userId, TASTE_PROVIDER],
  );
  return r.rows.length > 0;
}

/** What's left of a running taste: its scene steps and when it ends; null when the person isn't on one. */
export async function tasteLeft(db: Db, userId: string): Promise<{ steps: number; ends: Date } | null> {
  const r = (
    await db.query<{ writes: number; period_end: string | Date | null }>(
      `select t.writes, e.period_end from adult_tastes t join adult_entitlements e on e.user_id = t.user_id
       where t.user_id = $1 and e.provider = $2 and e.subscription_status = 'active' and e.period_end > now()`,
      [userId, TASTE_PROVIDER],
    )
  ).rows[0];
  if (!r?.period_end) return null;
  return { steps: Math.max(0, TASTE_WRITES - r.writes), ends: new Date(r.period_end) };
}
