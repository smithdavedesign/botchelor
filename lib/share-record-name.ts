/**
 * The sharer's name on a shared record (lib/share-record.ts; polish, 2026-11-02). /calls used to say "Someone's calls"
 * whoever shared it. Now a sharer with a display name that's theirs alone — #1238's rule: one person per display name,
 * trimmed and case-blind, the name the best-callers board already shows publicly — shares a link that carries it.
 *
 *  - The link carries the name (`by`) and `k`: an HMAC under SESSION_SECRET over the sharer's account, the name and the
 *    share's numbers. It reveals nothing (no id rides the link); it only lets the page check the claim.
 *  - /calls shows the name only when exactly one person goes by it now and the signature checks out for that person and
 *    these numbers. A forged name, an edited number, a rename since, or a name two people share (from before #1238)
 *    all read "Someone's calls", as does any link when the secret isn't set.
 *  - $0: one indexed read (profiles_name_lower) to sign, one to check. Server-only (node:crypto).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { recordShareKey, type RecordShare } from "./share-record";

export type Sharer = { user_id: string; name: string };

const secretOf = (env: Record<string, string | undefined>): string | null => env.SESSION_SECRET || null;
const fold = (name: string) => name.trim().toLowerCase();

function signature(secret: string, sharer: Sharer, share: RecordShare): string {
  return createHmac("sha256", secret).update(`share-record-name\n${sharer.user_id}\n${fold(sharer.name)}\n${recordShareKey(share)}`).digest("base64url").slice(0, 22);
}

/** The one person who goes by `name` now (trimmed, case-blind), or null when nobody does or more than one does. */
async function onlyOneCalled(db: Db, name: string): Promise<Sharer | null> {
  const { rows } = await db.query<Sharer>(`select user_id, name from profiles where lower(trim(name)) = lower(trim($1)) limit 2`, [name]);
  return rows.length === 1 ? { user_id: rows[0].user_id, name: rows[0].name.trim() } : null;
}

/** A viewer as a sharer: their display name when they have one and it's theirs alone; else null (the link stays nameless). */
export async function sharerOf(db: Db, userId: string | null): Promise<Sharer | null> {
  if (!userId) return null;
  const mine = (await db.query<{ name: string }>(`select name from profiles where user_id = $1`, [userId])).rows[0]?.name?.trim();
  if (!mine) return null;
  const only = await onlyOneCalled(db, mine);
  return only && only.user_id === userId ? only : null;
}

/** The share with its sharer's name and signature on it; unchanged without a sharer or a secret. Synchronous. */
export function signShare(share: RecordShare, sharer: Sharer | null, env: Record<string, string | undefined> = process.env): RecordShare {
  const secret = secretOf(env);
  if (!sharer || !secret) return share;
  return { ...share, by: sharer.name, k: signature(secret, sharer, share) };
}

/** The name a shared link may show: only the current one-and-only owner of it, signed for exactly these numbers. */
export async function verifiedSharerName(
  db: Db,
  share: RecordShare,
  claim: { by: string; k: string } | null,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const secret = secretOf(env);
  if (!claim || !secret) return null;
  const who = await onlyOneCalled(db, claim.by);
  if (!who) return null;
  const want = Buffer.from(signature(secret, who, share));
  const got = Buffer.from(claim.k);
  return want.length === got.length && timingSafeEqual(want, got) ? who.name : null;
}
