/**
 * Who may use after dark (docs/after-dark.md #2; David, 2026-10-18: "the switch only turns on with an active
 * subscription, that's how I make money"). An admin always may. Anyone else needs a signed-in account with an active
 * subscription AND a passed age check (adult_entitlements, written by the payment processor's and the age-verification
 * provider's webhooks once they exist). A lapsed subscription closes it again. Checked server-side on every action.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";

export type Entitlement =
  | { ok: true; why: "admin" | "subscribed" }
  | { ok: false; why: "signed_out" | "needs_subscription" | "needs_age_check" };

export async function canAfterDark(db: Db, auth: { userId: string; authenticated: boolean } | null, now: Date = new Date()): Promise<Entitlement> {
  if (!auth?.authenticated) return { ok: false, why: "signed_out" };
  if (await isAdmin(db, auth.userId)) return { ok: true, why: "admin" };
  const e = (
    await db.query<{ subscription_status: string; period_end: string | Date | null; age_verified_at: string | Date | null }>(
      `select subscription_status, period_end, age_verified_at from adult_entitlements where user_id = $1`,
      [auth.userId],
    )
  ).rows[0];
  const active = e?.subscription_status === "active" && (!e.period_end || new Date(e.period_end).getTime() > now.getTime());
  if (!active) return { ok: false, why: "needs_subscription" };
  if (!e?.age_verified_at) return { ok: false, why: "needs_age_check" };
  return { ok: true, why: "subscribed" };
}
