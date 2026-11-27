/**
 * Tips (Agent World phase 6, behind MONEY_TIPS, off until the owner says): a viewer who liked a character tips its
 * creator $2, $3 or $5, with an optional short note. A tip is an ordinary order (lib/payments.ts): this makes the
 * pending order and a tips row saying who it is for, and the signed Stripe webhook marks the order paid. Nothing here
 * reads a tip as counted until its order is paid, and a refunded order stops counting the same way.
 *
 * Rules:
 *  - only a public, listed character someone else owns, never a house character (nobody to tip) or your own;
 *  - the note: up to TIP_NOTE_MAX characters, the show's PG filter, no links; the creator sees it, the public page shows
 *    the count only (tipsFor), and the tipper is "A viewer" to the creator, never a name or an id;
 *  - the money goes to the owner's Stripe account: paying creators out is a decision still open (docs/money-decisions.md),
 *    so tipsReceived reports what a creator is owed and nothing is paid out automatically.
 */
import { catalogItem, TIP_ITEMS } from "../catalog";
import type { Db } from "../db";
import { createPendingOrder } from "../payments";
import { listedCharacterSql } from "../public-cast";
import { CHARACTER_REJECTION_MESSAGES, checkShowText } from "../safety";
import { paymentLinkFromEnv, paymentLinkUrl } from "../stripe";
import { moneyOn } from "./switches";

type Env = Record<string, string | undefined>;
type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

export const TIP_NOTE_MAX = 140;
export const TIP_SKUS = TIP_ITEMS.map((i) => i.sku);
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|xyz|co|gg|me|app|dev|link)\b)/i;

/** A tip's note as it will be stored, or why not. */
export function readTipNote(raw: unknown): { ok: true; note: string } | Fail {
  const note = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (note.length > TIP_NOTE_MAX) return fail("note", `Keep the note to ${TIP_NOTE_MAX} characters.`);
  if (LINKISH.test(note)) return fail("link", "No links in a tip's note.");
  if (note) {
    const check = checkShowText({ note });
    if (!check.ok) return fail("filtered", CHARACTER_REJECTION_MESSAGES[check.reason] ?? "That isn't something the show can pass on.");
  }
  return { ok: true, note };
}

/** Starts a tip: a pending order and the Payment Link to pay it. Off, it fails as not_found (the API answers 404). */
export async function startTip(
  db: Db,
  fromUser: string,
  input: { character_id: string; sku: string; note?: unknown },
  env: Env = process.env,
): Promise<{ ok: true; url: string; order_id: string } | Fail> {
  if (!moneyOn("tips", env)) return fail("not_found", "Not found.");
  const item = catalogItem(input.sku);
  if (!item || item.kind !== "tip") return fail("sku", "Pick a $2, $3 or $5 tip.");
  const note = readTipNote(input.note);
  if (!note.ok) return note;
  const c = (
    await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean; visibility: string }>(
      `select id, name, owner_id, is_house, visibility from characters c where c.id::text = $1 and ${listedCharacterSql("c")}`,
      [input.character_id],
    )
  ).rows[0];
  if (!c || c.visibility !== "public") return fail("no_character", "No such character.");
  if (c.is_house || !c.owner_id) return fail("house", `${c.name} is one of the show's own: there's no creator to tip.`);
  if (c.owner_id === fromUser) return fail("own", "You can't tip yourself.");
  const link = paymentLinkFromEnv(env, item.sku);
  if (!link) return fail("unavailable", "Tips aren't open yet. Nothing was charged.");
  const orderId = await createPendingOrder(db, fromUser, item);
  await db.query(`insert into tips (order_id, character_id, from_user, to_user, message) values ($1, $2, $3, $4, $5)`, [orderId, c.id, fromUser, c.owner_id, note.note]);
  return { ok: true, url: paymentLinkUrl(link, orderId), order_id: orderId };
}

/** What a character's public page may show: how many paid tips it has had. */
export async function tipsFor(db: Db, characterId: string): Promise<{ tips: number }> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from tips t join orders o on o.id = t.order_id where t.character_id = $1 and o.status = 'paid'`,
    [characterId],
  );
  return { tips: rows[0]!.n };
}

export type TipReceived = { character: { id: string; name: string }; amount_cents: number; note: string; from: "A viewer"; at: string };

/** A creator's paid tips, newest first, and what they add up to (what they're owed until payouts are decided). */
export async function tipsReceived(db: Db, userId: string, limit = 50): Promise<{ total_cents: number; count: number; tips: TipReceived[] }> {
  const { rows } = await db.query<{ character_id: string; name: string; amount_cents: number; message: string; paid_at: Date | string }>(
    `select t.character_id, c.name, o.amount_cents, t.message, o.paid_at
       from tips t join orders o on o.id = t.order_id join characters c on c.id = t.character_id
      where t.to_user = $1 and o.status = 'paid' order by o.paid_at desc`,
    [userId],
  );
  return {
    total_cents: rows.reduce((s, r) => s + r.amount_cents, 0),
    count: rows.length,
    tips: rows.slice(0, limit).map((r) => ({ character: { id: r.character_id, name: r.name }, amount_cents: r.amount_cents, note: r.message, from: "A viewer", at: new Date(r.paid_at).toISOString() })),
  };
}
