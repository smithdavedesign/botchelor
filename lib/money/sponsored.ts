/**
 * Sponsored cast (Agent World phase 6, behind MONEY_SPONSORED, off until the owner says): a brand pays for a house
 * character to be on the show for a while. The deal is made off the site (an invoice, not a Payment Link), and an admin
 * records it here. While a sponsorship runs and the switch is on, every place that asks sponsorOf shows the character's
 * disclosure ("Sponsored by …") next to its name: a sponsored character is never shown without it.
 *
 * Rules:
 *  - house characters only (an owner's character is theirs, not a brand's);
 *  - a brand name of 2 to 60 characters and a disclosure of up to 120, both through the PG filter; the disclosure
 *    always names the brand, so it can't be written to hide it;
 *  - one running sponsorship a character at a time, at most SPONSOR_MAX_DAYS long; ending one early is always allowed;
 *  - a sponsorship changes nothing about how dates go or are scored: it is a label, never a thumb on the scale.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { checkShowText } from "../safety";
import { moneyOn } from "./switches";

type Env = Record<string, string | undefined>;
type Fail = { ok: false; code: string; error: string };
const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

export const SPONSOR_MAX_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

export type Sponsor = { brand: string; label: string; ends_at: string };

export async function addSponsorship(
  db: Db,
  adminId: string,
  input: { character_id: string; brand: unknown; disclosure?: unknown; starts_at: Date; ends_at: Date },
): Promise<{ ok: true; id: string } | Fail> {
  const brand = typeof input.brand === "string" ? input.brand.replace(/\s+/g, " ").trim() : "";
  if (brand.length < 2 || brand.length > 60) return fail("brand", "A brand name is 2 to 60 characters.");
  const raw = typeof input.disclosure === "string" ? input.disclosure.replace(/\s+/g, " ").trim() : "";
  const disclosure = raw || `Sponsored by ${brand}`;
  if (disclosure.length > 120) return fail("disclosure", "Keep the disclosure to 120 characters.");
  if (!disclosure.toLowerCase().includes(brand.toLowerCase())) return fail("disclosure", "The disclosure has to name the brand.");
  if (!checkShowText({ brand, disclosure }).ok) return fail("filtered", "That isn't something the show can put on a page.");
  const { starts_at: start, ends_at: end } = input;
  if (!(end.getTime() > start.getTime())) return fail("dates", "It has to end after it starts.");
  if (end.getTime() - start.getTime() > SPONSOR_MAX_DAYS * DAY) return fail("dates", `A sponsorship runs ${SPONSOR_MAX_DAYS} days at most.`);
  const c = (await db.query<{ is_house: boolean }>(`select is_house from characters where id = $1`, [input.character_id])).rows[0];
  if (!c) return fail("no_character", "No such character.");
  if (!c.is_house) return fail("not_house", "Only the show's own characters can be sponsored.");
  const overlap = await db.query(`select 1 from sponsorships where character_id = $1 and starts_at < $3 and ends_at > $2`, [input.character_id, start.toISOString(), end.toISOString()]);
  if (overlap.rows.length) return fail("overlap", "That character already has a sponsorship then.");
  const id = `sp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await db.query(
    `insert into sponsorships (id, character_id, brand, disclosure, starts_at, ends_at, created_by) values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.character_id, brand, disclosure, start.toISOString(), end.toISOString(), adminId],
  );
  return { ok: true, id };
}

/** Ends a sponsorship now (or leaves one that has ended alone). */
export async function endSponsorship(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const { rows } = await db.query(`update sponsorships set ends_at = $2 where id = $1 and ends_at > $2 returning id`, [id, now.toISOString()]);
  return rows.length > 0;
}

/** The running sponsorships by character id. Off, there are none, and no label shows anywhere. */
export async function sponsorsOf(db: Db, characterIds: readonly string[], now: Date = new Date(), env: Env = process.env): Promise<Map<string, Sponsor>> {
  const out = new Map<string, Sponsor>();
  if (!moneyOn("sponsored", env) || !characterIds.length) return out;
  const { rows } = await db.query<{ character_id: string; brand: string; disclosure: string; ends_at: Date | string }>(
    `select character_id, brand, disclosure, ends_at from sponsorships where character_id = any($1) and starts_at <= $2 and ends_at > $2`,
    [characterIds, now.toISOString()],
  );
  for (const r of rows) out.set(r.character_id, { brand: r.brand, label: r.disclosure, ends_at: new Date(r.ends_at).toISOString() });
  return out;
}

export const sponsorOf = async (db: Db, characterId: string, now: Date = new Date(), env: Env = process.env): Promise<Sponsor | null> =>
  (await sponsorsOf(db, [characterId], now, env)).get(characterId) ?? null;
