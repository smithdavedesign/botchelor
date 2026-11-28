/**
 * What creators earn and what they're owed (David, 2026-11-28: "make an earnings view and tie it into an earnings view
 * for me too"). One set of numbers, read two ways: a creator's own (app/earnings) and the owner's across every creator
 * (app/admin/earnings). Nothing here moves money: payouts stay by hand (docs/money-decisions.md), and the owner records
 * each one so a creator's balance goes down.
 *
 * The split is the terms' (app/legal/sections.tsx, "Tips and character templates"):
 *  - a tip goes to its creator after Stripe's fees;
 *  - a template sale pays its creator 70% of the price (CREATOR_SHARE); the show's 30% covers Stripe's fee.
 * Stripe's fee is estimated at its standard card rate (2.9% + 30¢), since the order rows don't carry the real one.
 * Only paid orders count; a refunded one stops counting, as everywhere else (lib/payments.ts).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db";

export const CREATOR_SHARE = 0.7;
export const PAYOUT_METHODS = ["paypal", "wise", "bank", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const PAYOUT_HANDLE_MAX = 120;
/** Below this, a balance waits for next month (one payout of a few cents costs more than it's worth). */
export const PAYOUT_MINIMUM_CENTS = 1000;

/** Stripe's standard card fee on one payment, in cents. */
export const stripeFeeCents = (amountCents: number): number => Math.round(amountCents * 0.029) + 30;
/** A tip's creator share: the tip less Stripe's fee, never below zero. */
export const tipShareCents = (amountCents: number): number => Math.max(0, amountCents - stripeFeeCents(amountCents));
/** A template sale's creator share: 70% of the price. */
export const saleShareCents = (amountCents: number): number => Math.floor(amountCents * CREATOR_SHARE);

export type EarningLine = { kind: "tip" | "sale"; character: { id: string; name: string } | null; gross_cents: number; share_cents: number; note: string; at: string };
export type Payout = { id: string; amount_cents: number; note: string; paid_at: string };
export type Earnings = {
  tips: { count: number; gross_cents: number; share_cents: number };
  sales: { count: number; gross_cents: number; share_cents: number };
  earned_cents: number;
  paid_out_cents: number;
  owed_cents: number;
  method: { method: PayoutMethod; handle: string } | null;
  recent: EarningLine[];
  payouts: Payout[];
};

type Row = { kind: "tip" | "sale"; user_id: string; character_id: string | null; name: string | null; amount_cents: number; note: string; paid_at: Date | string };

/** Every paid tip and sale, for one creator or for all (newest first). */
async function lines(db: Db, userId: string | null): Promise<Row[]> {
  const who = userId === null ? "" : "and t.to_user = $1";
  const whoSale = userId === null ? "" : "and p.seller_user = $1";
  const { rows } = await db.query<Row>(
    `select 'tip' as kind, t.to_user as user_id, t.character_id, c.name, o.amount_cents, t.message as note, o.paid_at
       from tips t join orders o on o.id = t.order_id left join characters c on c.id = t.character_id
      where o.status = 'paid' ${who}
     union all
     select 'sale' as kind, p.seller_user as user_id, l.character_id, c.name, o.amount_cents, '' as note, o.paid_at
       from market_purchases p join orders o on o.id = p.order_id
       left join market_listings l on l.id = p.listing_id left join characters c on c.id = l.character_id
      where o.status = 'paid' ${whoSale}
     order by paid_at desc`,
    userId === null ? [] : [userId],
  );
  return rows;
}

const shareOf = (r: { kind: "tip" | "sale"; amount_cents: number }) => (r.kind === "tip" ? tipShareCents(r.amount_cents) : saleShareCents(r.amount_cents));

function summarise(rows: Row[], paidOut: number, method: Earnings["method"], payouts: Payout[], limit: number): Earnings {
  const sum = (kind: "tip" | "sale") => {
    const of = rows.filter((r) => r.kind === kind);
    return { count: of.length, gross_cents: of.reduce((s, r) => s + r.amount_cents, 0), share_cents: of.reduce((s, r) => s + shareOf(r), 0) };
  };
  const tips = sum("tip");
  const sales = sum("sale");
  const earned = tips.share_cents + sales.share_cents;
  return {
    tips,
    sales,
    earned_cents: earned,
    paid_out_cents: paidOut,
    owed_cents: Math.max(0, earned - paidOut),
    method,
    recent: rows.slice(0, limit).map((r) => ({
      kind: r.kind,
      character: r.character_id && r.name ? { id: r.character_id, name: r.name } : null,
      gross_cents: r.amount_cents,
      share_cents: shareOf(r),
      note: r.note,
      at: new Date(r.paid_at).toISOString(),
    })),
    payouts,
  };
}

/** A creator's earnings: what their characters made, their share, what's been paid out and what's still owed. */
export async function earningsOf(db: Db, userId: string, limit = 25): Promise<Earnings> {
  const [rows, paid, method] = await Promise.all([
    lines(db, userId),
    db.query<{ id: string; amount_cents: number; note: string; paid_at: Date | string }>(
      `select id, amount_cents, note, paid_at from creator_payouts where user_id = $1 order by paid_at desc`,
      [userId],
    ),
    payoutMethodOf(db, userId),
  ]);
  const payouts = paid.rows.map((p) => ({ id: p.id, amount_cents: p.amount_cents, note: p.note, paid_at: new Date(p.paid_at).toISOString() }));
  return summarise(rows, payouts.reduce((s, p) => s + p.amount_cents, 0), method, payouts, limit);
}

export async function payoutMethodOf(db: Db, userId: string): Promise<Earnings["method"]> {
  const { rows } = await db.query<{ method: PayoutMethod; handle: string }>(`select method, handle from creator_payout_methods where user_id = $1`, [userId]);
  return rows[0] ?? null;
}

type Fail = { ok: false; code: string; error: string };

/** Where a creator wants their money sent: a PayPal or Wise email, or a short note for a bank or anything else. */
export async function setPayoutMethod(db: Db, userId: string, input: { method: unknown; handle: unknown }): Promise<{ ok: true } | Fail> {
  const method = PAYOUT_METHODS.find((m) => m === input.method);
  if (!method) return { ok: false, code: "method", error: "Pick PayPal, Wise, a bank transfer or other." };
  const handle = typeof input.handle === "string" ? input.handle.replace(/\s+/g, " ").trim() : "";
  if (!handle) return { ok: false, code: "handle", error: "Say where to send it." };
  if (handle.length > PAYOUT_HANDLE_MAX) return { ok: false, code: "handle", error: `Keep it to ${PAYOUT_HANDLE_MAX} characters.` };
  if ((method === "paypal" || method === "wise") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle)) {
    return { ok: false, code: "handle", error: "PayPal and Wise pay to an email address." };
  }
  await db.query(
    `insert into creator_payout_methods (user_id, method, handle) values ($1, $2, $3)
     on conflict (user_id) do update set method = excluded.method, handle = excluded.handle, updated_at = now()`,
    [userId, method, handle],
  );
  return { ok: true };
}

export type CreatorBalance = { user_id: string; handle: string | null; earned_cents: number; paid_out_cents: number; owed_cents: number; tips: number; sales: number; method: Earnings["method"] };
export type ShowEarnings = {
  gross_cents: number;
  fees_cents: number;
  creators_cents: number;
  show_cents: number;
  paid_out_cents: number;
  owed_cents: number;
  creators: CreatorBalance[];
  recent: (EarningLine & { user_id: string })[];
};

/**
 * The owner's view: every paid tip and sale, Stripe's estimated fees, the creators' share and the show's, what's been
 * paid out, and each creator's balance (most owed first). One query per table, joined in memory.
 */
export async function showEarnings(db: Db, limit = 50): Promise<ShowEarnings> {
  const [rows, paid, methods, handles] = await Promise.all([
    lines(db, null),
    db.query<{ user_id: string; total: number }>(`select user_id, sum(amount_cents)::int as total from creator_payouts group by user_id`),
    db.query<{ user_id: string; method: PayoutMethod; handle: string }>(`select user_id, method, handle from creator_payout_methods`),
    db.query<{ user_id: string; handle: string }>(`select user_id, handle from accounts`).catch(() => ({ rows: [] as { user_id: string; handle: string }[] })),
  ]);
  const paidBy = new Map(paid.rows.map((r) => [r.user_id, r.total]));
  const methodBy = new Map(methods.rows.map((r) => [r.user_id, { method: r.method, handle: r.handle }]));
  const handleBy = new Map(handles.rows.map((r) => [r.user_id, r.handle]));
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.user_id, [...(by.get(r.user_id) ?? []), r]);
  for (const u of paidBy.keys()) if (!by.has(u)) by.set(u, []);
  const creators: CreatorBalance[] = [...by.entries()].map(([user_id, mine]) => {
    const earned = mine.reduce((s, r) => s + shareOf(r), 0);
    const out = paidBy.get(user_id) ?? 0;
    return {
      user_id,
      handle: handleBy.get(user_id) ?? null,
      earned_cents: earned,
      paid_out_cents: out,
      owed_cents: Math.max(0, earned - out),
      tips: mine.filter((r) => r.kind === "tip").length,
      sales: mine.filter((r) => r.kind === "sale").length,
      method: methodBy.get(user_id) ?? null,
    };
  });
  creators.sort((a, b) => b.owed_cents - a.owed_cents || b.earned_cents - a.earned_cents);
  const gross = rows.reduce((s, r) => s + r.amount_cents, 0);
  const fees = rows.reduce((s, r) => s + Math.min(r.amount_cents, stripeFeeCents(r.amount_cents)), 0);
  const toCreators = rows.reduce((s, r) => s + shareOf(r), 0);
  const paidOut = creators.reduce((s, c) => s + c.paid_out_cents, 0);
  return {
    gross_cents: gross,
    fees_cents: fees,
    creators_cents: toCreators,
    show_cents: Math.max(0, gross - fees - toCreators),
    paid_out_cents: paidOut,
    owed_cents: creators.reduce((s, c) => s + c.owed_cents, 0),
    creators,
    recent: rows.slice(0, limit).map((r) => ({
      user_id: r.user_id,
      kind: r.kind,
      character: r.character_id && r.name ? { id: r.character_id, name: r.name } : null,
      gross_cents: r.amount_cents,
      share_cents: shareOf(r),
      note: r.note,
      at: new Date(r.paid_at).toISOString(),
    })),
  };
}

/** The owner records a payout made by hand (PayPal, Wise, a bank): it comes off the creator's balance. */
export async function recordPayout(db: Db, paidBy: string, input: { user_id: unknown; amount_cents: unknown; note?: unknown }): Promise<{ ok: true; id: string } | Fail> {
  const userId = typeof input.user_id === "string" ? input.user_id.trim() : "";
  const amount = typeof input.amount_cents === "number" && Number.isInteger(input.amount_cents) ? input.amount_cents : NaN;
  if (!userId) return { ok: false, code: "user", error: "Which creator?" };
  if (!(amount > 0)) return { ok: false, code: "amount", error: "A payout is a positive whole number of cents." };
  const { owed_cents } = await earningsOf(db, userId, 0);
  if (amount > owed_cents) return { ok: false, code: "over", error: `That's more than they're owed (${owed_cents} cents).` };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  const id = `po_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.query(`insert into creator_payouts (id, user_id, amount_cents, note, paid_by) values ($1, $2, $3, $4, $5)`, [id, userId, amount, note, paidBy]);
  return { ok: true, id };
}
