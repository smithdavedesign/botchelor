import { CURRENCY, type CatalogItem } from "./catalog";
import type { Db } from "./db";

/**
 * Orders and what they unlock (M3, M4). This is the only table purchases write: nothing here reads or
 * writes predictions, so buying can't change anyone's points or rank (points are derived from
 * predictions on aired episodes, lib/game.ts). Paid episode packs are read by lib/allowance.ts.
 */
export const ORDER_STATUSES = ["pending", "paid", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** SKUs the user owns: one paid order each. A refunded order (set by hand) no longer counts. */
export async function ownedSkus(db: Db, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const { rows } = await db.query<{ sku: string }>(
    "select distinct sku from orders where user_id = $1 and status = 'paid' order by sku",
    [userId],
  );
  return rows.map((r) => r.sku);
}

export async function ownsSku(db: Db, userId: string, sku: string): Promise<boolean> {
  const { rows } = await db.query(
    "select 1 from orders where user_id = $1 and sku = $2 and status = 'paid' limit 1",
    [userId, sku],
  );
  return rows.length > 0;
}

/**
 * A pending order priced from the catalog; its random id is what Stripe sees. An episode pack's
 * order also records how many dates it adds, so a later catalog change can't alter a past purchase.
 */
export async function createPendingOrder(db: Db, userId: string, item: CatalogItem): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes)
     values ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, userId, item.sku, item.kind, item.price_cents, CURRENCY, item.episodes ?? null],
  );
  return id;
}

export async function attachCheckoutSession(db: Db, orderId: string, sessionId: string): Promise<void> {
  await db.query("update orders set stripe_session_id = $2 where id = $1", [orderId, sessionId]);
}

/** Undo a checkout that never reached Stripe. Only ever removes a still-pending order. */
export async function deletePendingOrder(db: Db, orderId: string): Promise<void> {
  await db.query("delete from orders where id = $1 and status = 'pending'", [orderId]);
}

/**
 * Marks a paid order refunded (after the refund is made in the Stripe dashboard); true if it was paid.
 * For an episode pack, the dates already used are capped at what the remaining paid packs cover, so a
 * refund removes the pack's dates and buying another pack later adds exactly its N again. One statement,
 * so the status and the counter can't disagree. Run it by hand (BUILD.md, "Refunds and restores").
 */
export async function refundOrder(db: Db, orderId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `with refunded as (
       update orders set status = 'refunded' where id = $1 and status = 'paid' returning user_id, kind
     ),
     capped as (
       update pack_episode_usage u
          set used = least(u.used, (select coalesce(sum(o.episodes), 0)::int from orders o
                                     where o.user_id = u.user_id and o.kind = 'episode_pack'
                                       and o.status = 'paid' and o.id <> $1))
         from refunded r
        where u.user_id = r.user_id and r.kind = 'episode_pack'
     )
     select count(*)::int as n from refunded`,
    [orderId],
  );
  return rows[0].n > 0;
}

export type PaidSession = {
  orderId: string | null;
  sessionId: string;
  amountTotal: number | null;
  currency: string | null;
};
export type GrantOutcome = "granted" | "already_paid" | "unknown_order" | "mismatch";

/**
 * Marks an order paid, once. The single UPDATE is the idempotency check: a duplicate or late
 * delivery finds no pending row. It must be the session we created for this order (its URL only
 * reaches the browser after attachCheckoutSession), at the amount and currency we priced, so a
 * session that isn't ours, or was changed, grants nothing.
 */
export async function grantOrder(db: Db, paid: PaidSession): Promise<GrantOutcome> {
  if (!paid.orderId || !ORDER_ID.test(paid.orderId)) return "unknown_order";
  const { rows } = await db.query(
    `update orders set status = 'paid', paid_at = now()
      where id = $1 and status = 'pending' and stripe_session_id = $2 and amount_cents = $3 and currency = $4
      returning id`,
    [paid.orderId, paid.sessionId, paid.amountTotal, paid.currency],
  );
  if (rows.length) return "granted";
  const existing = (
    await db.query<{ status: OrderStatus }>("select status from orders where id = $1", [paid.orderId])
  ).rows[0];
  if (!existing) return "unknown_order";
  return existing.status === "pending" ? "mismatch" : "already_paid";
}
