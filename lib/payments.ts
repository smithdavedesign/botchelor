import { catalogItem, CURRENCY, isRepeatable, type CatalogItem, type ItemKind } from "./catalog";
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
 * A pending order at the catalog's list price; its random id is what Stripe sees (as the Payment Link's
 * client_reference_id). An episode pack's order also records how many dates it adds, so a later catalog
 * change can't alter a past purchase.
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
                                       and o.status = 'paid' and o.id <> $1)
                                   + (select coalesce(sum(g.episodes), 0)::int from token_grants g where g.user_id = u.user_id))
         from refunded r
        where u.user_id = r.user_id and r.kind = 'episode_pack'
     )
     select count(*)::int as n from refunded`,
    [orderId],
  );
  return rows[0].n > 0;
}

export type RefundOutcome = "refunded" | "partial" | "unknown_payment" | "already_refunded";

/**
 * A refund made in the Stripe dashboard (charge.refunded): a full refund marks the order refunded and takes back the
 * pack's dates that haven't been used (refundOrder); a partial one changes nothing (logged for a decision by hand).
 * The terms promise refunds within 14 days, so this keeps the pack and the money in step without anyone remembering.
 */
export async function refundForPayment(
  db: Db,
  charge: { paymentIntent: string | null; refunded: boolean },
): Promise<RefundOutcome> {
  if (!charge.paymentIntent) return "unknown_payment";
  if (!charge.refunded) return "partial";
  const order = (
    await db.query<{ id: string; status: OrderStatus }>(
      "select id, status from orders where stripe_payment_intent = $1 order by paid_at desc limit 1",
      [charge.paymentIntent],
    )
  ).rows[0];
  if (!order) return "unknown_payment";
  if (order.status === "refunded") return "already_refunded";
  return (await refundOrder(db, order.id)) ? "refunded" : "already_refunded";
}

/** A paid Checkout Session, as the signed webhook reports it. */
export type PaidSession = {
  orderId: string | null;
  sessionId: string;
  /** The Payment Link that created the session (plink_…); null for a session made any other way. */
  paymentLink: string | null;
  amountTotal: number | null;
  currency: string | null;
  /** The PaymentIntent the session settled (pi_…), kept so a later refund finds this order. */
  paymentIntent?: string | null;
};
export type GrantOutcome = "granted" | "already_paid" | "unknown_order" | "mismatch";

type OrderRow = { user_id: string; sku: string; kind: ItemKind; status: OrderStatus; episodes: number | null };

/**
 * Grants what one paid Stripe session bought, exactly once per session. The session must come from a
 * Payment Link and pay at least the item's list price in our currency: the link's price is set in Stripe,
 * so this is the floor that keeps a cheaper payment from unlocking it.
 *
 * - The first payment on an order fills in the pending row (one UPDATE … WHERE status = 'pending').
 * - A Payment Link URL can be paid again (Back, then pay). That second session gets its own paid order,
 *   cloned from the first, for repeatable items (packs); a one-time item is never granted twice.
 * - A duplicate or late delivery of a session finds its id already recorded (`stripe_session_id` is
 *   unique), so nothing doubles, even when two deliveries race.
 */
export async function grantOrder(db: Db, paid: PaidSession): Promise<GrantOutcome> {
  if (!paid.orderId || !ORDER_ID.test(paid.orderId)) return "unknown_order";
  const order = (
    await db.query<OrderRow>("select user_id, sku, kind, status, episodes from orders where id = $1", [paid.orderId])
  ).rows[0];
  if (!order) return "unknown_order";
  const item = catalogItem(order.sku);
  const priced =
    item !== undefined && paid.paymentLink !== null && paid.currency === CURRENCY && (paid.amountTotal ?? 0) >= item.price_cents;
  if (!priced) return "mismatch";

  const filled = await db.query(
    `update orders set status = 'paid', paid_at = now(), stripe_session_id = $2, amount_cents = $3, stripe_payment_intent = $4
      where id = $1 and status = 'pending'
        and not exists (select 1 from orders where stripe_session_id = $2)
      returning id`,
    [paid.orderId, paid.sessionId, paid.amountTotal, paid.paymentIntent ?? null],
  );
  if (filled.rows.length) return "granted";
  if (await sessionRecorded(db, paid.sessionId)) return "already_paid";
  if (!isRepeatable(order.kind)) return "already_paid";

  const cloned = await db.query(
    `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes, stripe_session_id, stripe_payment_intent, paid_at)
     values ($1, $2, $3, $4, $5, $6, 'paid', $7, $8, $9, now())
     on conflict (stripe_session_id) do nothing
     returning id`,
    [crypto.randomUUID(), order.user_id, order.sku, order.kind, paid.amountTotal, CURRENCY, order.episodes, paid.sessionId, paid.paymentIntent ?? null],
  );
  return cloned.rows.length ? "granted" : "already_paid";
}

async function sessionRecorded(db: Db, sessionId: string): Promise<boolean> {
  return (await db.query("select 1 from orders where stripe_session_id = $1", [sessionId])).rows.length > 0;
}
