/**
 * After Dark's own tokens (David, 2026-11-04: "I agree with your price analysis, lets do it"). The show's tokens are
 * bought through Stripe, whose rules bar paying for adult content, so After Dark's extras (the video of the night, clips,
 * talking moments, Studio shoots…) get a balance of their own, bought only through the adult processors as one-time packs
 * of about $1 a token: a video at 8 tokens then pays for what it costs to make ($3.25–6.40) even on the biggest pack.
 *
 * Built complete and off. The wallet runs once a processor can sell a pack (adTokensOn); until then every After Dark
 * spend and refund goes to the show's bought tokens, as before, so the beta keeps working, and the day a processor goes
 * live it switches over by itself. Real use before launch was about nil, so no balance moves.
 *
 * The balance: grants (a paid pack's, once per order, or an admin's top-up) not revoked, minus what's spent
 * (adult_token_usage, a running count like the show's pack_episode_usage). A refund or chargeback revokes its pack's grant
 * and takes back what's left unspent of it, never more (lib/adult/billing.ts).
 */
import { randomUUID } from "node:crypto";
import { episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "../allowance";
import type { Db } from "../db";
import { ccbillConfig } from "./billing-ccbill";
import { segpayConfig, segpayTokenPricePoints } from "./billing-segpay";
import { verotelConfig } from "./billing-verotel";

type Env = Record<string, string | undefined>;
type Processor = "ccbill" | "segpay" | "verotel";

export type TokenPack = { tokens: number; usd: number };

/** David's packs (2026-11-04): about $1 a token, a little off the bigger ones, never so much a video costs more to make than it brings. */
export const DEFAULT_TOKEN_PACKS: readonly TokenPack[] = [
  { tokens: 10, usd: 9.99 },
  { tokens: 25, usd: 22.99 },
  { tokens: 50, usd: 42.99 },
];

/** The packs on sale: AD_TOKEN_PACKS ("10:9.99,25:22.99,50:42.99"), else the defaults. Smallest first. */
export function tokenPacks(env: Env = process.env): TokenPack[] {
  const packs: TokenPack[] = [];
  for (const pair of (env.AD_TOKEN_PACKS ?? "").split(",")) {
    const m = /^\s*(\d{1,4})\s*:\s*(\d{1,3}(?:\.\d{1,2})?)\s*$/.exec(pair);
    if (!m) continue;
    const tokens = Number(m[1]);
    const usd = Number(m[2]);
    if (tokens > 0 && usd >= 1 && !packs.some((p) => p.tokens === tokens)) packs.push({ tokens, usd });
  }
  return (packs.length ? packs : [...DEFAULT_TOKEN_PACKS]).sort((a, b) => a.tokens - b.tokens);
}

/** The pack that buys exactly `tokens`, or null. */
export const tokenPack = (tokens: number, env: Env = process.env): TokenPack | null => tokenPacks(env).find((p) => p.tokens === tokens) ?? null;

/**
 * The processors that can sell this pack (any pack, without one), in the subscription's order. CCBill and Verotel price
 * each order themselves; Segpay only through a price point set up for that pack in its portal.
 */
export function tokenProcessors(env: Env = process.env, pack?: TokenPack): Processor[] {
  const segpayPoints = segpayConfig(env) ? segpayTokenPricePoints(env) : new Map<number, string>();
  const segpay = pack ? segpayPoints.has(pack.tokens) : tokenPacks(env).some((p) => segpayPoints.has(p.tokens));
  return [...(ccbillConfig(env) ? (["ccbill"] as const) : []), ...(segpay ? (["segpay"] as const) : []), ...(verotelConfig(env) ? (["verotel"] as const) : [])];
}

/** Whether After Dark spends its own tokens: once a processor can sell a pack. Until then it spends the show's. */
export const adTokensOn = (env: Env = process.env): boolean => tokenProcessors(env).length > 0;

/** Tokens bought or given, not revoked. `who` is the user id SQL. */
const AD_TOKENS_GRANTED = (who: string) =>
  `(select coalesce(sum(g.tokens), 0)::int from adult_token_grants g where g.user_id = ${who} and g.revoked_at is null)`;

/** After Dark's balance for this person: its own tokens once they're on, the show's bought tokens until then. */
export async function adTokenBalance(db: Db, userId: string, env: Env = process.env): Promise<number> {
  if (!adTokensOn(env)) return (await episodeAllowance(db, userId)).pack_left;
  const { rows } = await db.query<{ left: number }>(
    `select greatest(0, ${AD_TOKENS_GRANTED("$1")} - coalesce((select used from adult_token_usage where user_id = $1), 0))::int as left`,
    [userId],
  );
  return rows[0]?.left ?? 0;
}

/** Spends `n` of After Dark's tokens if the person has them; false (nothing spent) when not. One conditional upsert. */
export async function spendAdTokens(db: Db, userId: string, n: number, env: Env = process.env): Promise<boolean> {
  if (!adTokensOn(env)) return spendBoughtTokens(db, userId, n);
  const { rows } = await db.query(
    `insert into adult_token_usage as u (user_id, used)
     select $1, $2::int where ${AD_TOKENS_GRANTED("$1")} >= $2::int
     on conflict (user_id) do update set used = u.used + $2::int where u.used + $2::int <= ${AD_TOKENS_GRANTED("$1")}
     returning used`,
    [userId, n],
  );
  return rows.length > 0;
}

/** Gives back `n` of After Dark's tokens (something paid for that never came). Never below zero. */
export async function refundAdTokens(db: Db, userId: string, n: number, env: Env = process.env): Promise<void> {
  if (!adTokensOn(env)) return refundBoughtTokens(db, userId, n);
  await db.query(`update adult_token_usage set used = greatest(0, used - $2::int) where user_id = $1`, [userId, n]);
}

/** An admin's top-up of After Dark tokens (to test the extras without buying). */
export async function grantAdTokens(db: Db, userId: string, tokens: number, grantedBy: string): Promise<void> {
  await db.query(`insert into adult_token_grants (id, user_id, tokens, granted_by) values ($1, $2, $3, $4)`, [randomUUID(), userId, tokens, grantedBy]);
}

/** A paid pack's tokens, once per order however often the processor says so. True when this call granted them. */
export async function grantOrderTokens(db: Db, userId: string, orderId: string, tokens: number, processor: Processor): Promise<boolean> {
  const r = await db.query(
    `insert into adult_token_grants (id, user_id, tokens, order_id, granted_by) values ($1, $2, $3, $4, $5) on conflict (order_id) do nothing returning id`,
    [randomUUID(), userId, tokens, orderId, processor],
  );
  return r.rows.length > 0;
}

/**
 * A refunded or charged-back pack: its grant is revoked, and what was spent is capped at what's left granted, so the
 * unspent part of the pack goes and the tokens already spent aren't taken out of the next pack bought.
 */
export async function revokeOrderTokens(db: Db, userId: string, orderId: string): Promise<void> {
  const r = await db.query(`update adult_token_grants set revoked_at = now() where order_id = $1 and revoked_at is null returning id`, [orderId]);
  if (!r.rows.length) return;
  await db.query(`update adult_token_usage set used = least(used, ${AD_TOKENS_GRANTED("$1")}) where user_id = $1`, [userId]);
}
