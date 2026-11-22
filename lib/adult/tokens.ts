/**
 * After Dark's own tokens (David, 2026-11-04: "I agree with your price analysis, lets do it"). The show's tokens are
 * bought through Stripe, whose rules bar paying for adult content, so After Dark's extras (the video of the night, clips,
 * talking moments, Studio shoots…) get a balance of their own, bought only through the adult processors as one-time packs
 * of about $1 a token: a video at 10 tokens (8 until 2026-11-19) then pays for what it costs to make (about $5.50) even on the biggest pack.
 *
 * Built complete and off. The wallet runs once a processor can sell a pack (adTokensOn); until then After Dark spends
 * and refunds the show's token balance, and the day a processor goes live it switches over by itself. Real use before
 * launch was about nil, so no balance moves.
 *
 * Until then, never a token bought through the show's checkout (the 2026-11-22 audit: Stripe must never fund adult
 * content). After Dark spends the show's balance only for an account that has never bought on the show, whose balance
 * is all given (an admin's grant, a processor reviewer's tokens: token_grants, never an order), and refuses anyone else
 * with "its own billing isn't open yet" (moreTokensLine). AD_SPEND_SHOW_TOKENS=1 brings back the behaviour before that,
 * every bought token spendable here too: one setting to reverse it.
 *
 * The balance: grants (a paid pack's, once per order, or an admin's top-up) not revoked, minus what's spent
 * (adult_token_usage, a running count like the show's pack_episode_usage). A refund or chargeback revokes its pack's grant
 * and takes back what's left unspent of it, never more (lib/adult/billing.ts).
 */
import { randomUUID } from "node:crypto";
import { episodeAllowance, packDatesSql, refundBoughtTokens, spendBoughtTokens } from "../allowance";
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

/**
 * AD_SPEND_SHOW_TOKENS=1: while After Dark's own tokens are off, it may spend every token of the show's balance, bought
 * ones included (the behaviour before the 2026-11-22 audit). Unset, it spends only an all-given balance (above).
 */
export const adSpendsShowTokens = (env: Env = process.env): boolean => env.AD_SPEND_SHOW_TOKENS?.trim() === "1";

/** Whether this account has bought on the show: a paid date pack (Stripe). A refunded one stops counting, as in lib/allowance.ts. */
const BOUGHT_ON_SHOW = (who: string) => `exists (select 1 from orders o where o.user_id = ${who} and o.kind = 'episode_pack' and o.status = 'paid')`;

const boughtOnShow = async (db: Db, userId: string): Promise<boolean> => (await db.query(`select 1 where ${BOUGHT_ON_SHOW("$1")}`, [userId])).rows.length > 0;

/** The show's balance as After Dark may spend it, without its own tokens: all of it, none, or only an all-given one. */
async function showBalanceHere(db: Db, userId: string, env: Env): Promise<number> {
  if (!adSpendsShowTokens(env) && (await boughtOnShow(db, userId))) return 0;
  return (await episodeAllowance(db, userId)).pack_left;
}

/**
 * Where this person's After Dark balance comes from, for the tokens page to say (the 2026-11-22 audit: no page did):
 * After Dark's own tokens; the show's whole balance (AD_SPEND_SHOW_TOKENS); a show balance that's all given; or none
 * After Dark may spend, because they've bought on the show.
 */
export type AdTokenSource = "own" | "show" | "given" | "bought_on_show";
export async function adTokenSource(db: Db, userId: string, env: Env = process.env): Promise<AdTokenSource> {
  if (adTokensOn(env)) return "own";
  if (adSpendsShowTokens(env)) return "show";
  return (await boughtOnShow(db, userId)) ? "bought_on_show" : "given";
}

/**
 * The end of a refused spend's message: where more tokens come from. Nowhere yet while After Dark's own billing is
 * closed, so it says that, and never points at the show's shop.
 */
export function moreTokensLine(env: Env = process.env): string {
  return adTokensOn(env) || adSpendsShowTokens(env) ? "Get more on the tokens page." : "After Dark's own billing isn't open yet, so there's no way to get more for now.";
}

/** Tokens bought or given, not revoked. `who` is the user id SQL. */
const AD_TOKENS_GRANTED = (who: string) =>
  `(select coalesce(sum(g.tokens), 0)::int from adult_token_grants g where g.user_id = ${who} and g.revoked_at is null)`;

/** After Dark's balance for this person: its own tokens once they're on, the show's as After Dark may spend it until then. */
export async function adTokenBalance(db: Db, userId: string, env: Env = process.env): Promise<number> {
  if (!adTokensOn(env)) return showBalanceHere(db, userId, env);
  const { rows } = await db.query<{ left: number }>(
    `select greatest(0, ${AD_TOKENS_GRANTED("$1")} - coalesce((select used from adult_token_usage where user_id = $1), 0))::int as left`,
    [userId],
  );
  return rows[0]?.left ?? 0;
}

/** Spends `n` of After Dark's tokens if the person has them; false (nothing spent) when not. One conditional upsert. */
export async function spendAdTokens(db: Db, userId: string, n: number, env: Env = process.env): Promise<boolean> {
  if (!adTokensOn(env)) {
    if (adSpendsShowTokens(env)) return spendBoughtTokens(db, userId, n);
    // The show's balance, but only an all-given one: the same conditional upsert as spendBoughtTokens, refused in the same
    // statement for an account that has bought on the show, so a purchase landing mid-spend can't slip through.
    const shown = packDatesSql("$1");
    const { rows } = await db.query(
      `insert into pack_episode_usage as u (user_id, used)
       select $1, $2::int where ${shown} >= $2::int and not ${BOUGHT_ON_SHOW("$1")}
       on conflict (user_id) do update set used = u.used + $2::int where u.used + $2::int <= ${shown} and not ${BOUGHT_ON_SHOW("$1")}
       returning used`,
      [userId, n],
    );
    return rows.length > 0;
  }
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
