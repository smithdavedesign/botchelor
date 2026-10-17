/**
 * One partner or more than one. Each character has a relationship style: "one" (monogamous), "open"
 * (consensual non-monogamy / polyamory), or "decide" (the default): the character settles it itself, from its
 * own temperament, the first time it's in a relationship. Deterministic, like everything that shapes a date.
 *
 * In a relationship means the couple's stage (lib/relationships.ts, every date counted) is dating or going steady.
 * A one-partner character in a relationship is taken: it closes to new dates, leaves blind matching, and only
 * dates its partner until the relationship cools. An open character stays on the market. House characters are the
 * season's shared cast, so they're never taken.
 */
import { shortName } from "./names";
import type { Db } from "./db";
import { loadCharacter } from "./character";
import { notify } from "./notifications";

import { type DecidedStyle, type PartnerStyle } from "./partners-shared";
export { PARTNER_STYLE_LABELS, PARTNER_STYLES, type DecidedStyle, type PartnerStyle } from "./partners-shared";

/** Stages that count as being in a relationship. */
export const COMMITTED_STAGES = ["dating", "going_steady"] as const;

/** How a character settles it for itself: open and unguarded plays the field; anyone else wants one person. */
export function decideFromTemperament(signals: { openness: number; guardedness: number }): DecidedStyle {
  return signals.openness >= 0.65 && signals.guardedness <= 0.4 ? "open" : "one";
}

/**
 * SQL for a character's effective style (`alias` is the characters row): its owner's choice, else what it decided;
 * null while it's still undecided (never taken: it decides at its next date or stage change, lib/partners settle).
 */
export const styleSql = (alias: string) => `coalesce(nullif(${alias}.partner_style, 'decide'), ${alias}.partner_style_decided)`;

/**
 * SQL that's true when the character is taken: one-partner, not house, and in a relationship with someone other
 * than `exceptParam` (a SQL expression, e.g. "$3", for the partner a date is with; "null" for nobody).
 */
export const takenSql = (alias: string, exceptParam = "null") => `(
  not ${alias}.is_house and coalesce(${styleSql(alias)} = 'one', false)
  and exists (
    select 1 from relationships r
     where (r.character_a = ${alias}.id or r.character_b = ${alias}.id)
       and r.stage in ('dating', 'going_steady')
       and (${exceptParam}::text is null or (r.character_a <> ${exceptParam}::text and r.character_b <> ${exceptParam}::text))))`;

/** SQL that's true when the character (`alias`) is in a relationship with `otherParam` (a SQL expression). */
export const coupledSql = (alias: string, otherParam: string) => `exists (
  select 1 from relationships r
   where r.stage in ('dating', 'going_steady')
     and ((r.character_a = ${alias}.id and r.character_b = ${otherParam}::text) or (r.character_b = ${alias}.id and r.character_a = ${otherParam}::text)))`;

/** Who a character is in a relationship with right now (names), for the badge and the messages. */
export async function currentPartners(db: Db, id: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name
       from relationships r
       join characters c on c.id = case when r.character_a = $1 then r.character_b else r.character_a end
      where (r.character_a = $1 or r.character_b = $1) and r.stage in ('dating', 'going_steady')
      order by r.last_at desc nulls last`,
    [id],
  );
  return rows;
}

/** A character's style, as its owner and the card see it. */
export async function partnerStyleOf(
  db: Db,
  id: string,
): Promise<{ choice: PartnerStyle; decided: DecidedStyle | null; effective: DecidedStyle | null; taken: boolean; partners: { id: string; name: string }[] } | null> {
  const row = (
    await db.query<{ choice: PartnerStyle | null; decided: DecidedStyle | null; effective: DecidedStyle | null; taken: boolean }>(
      `select c.partner_style as choice, c.partner_style_decided as decided, ${styleSql("c")} as effective, ${takenSql("c")} as taken
         from characters c where c.id = $1`,
      [id],
    )
  ).rows[0];
  if (!row) return null;
  return { choice: row.choice ?? "decide", decided: row.decided, effective: row.effective, taken: row.taken, partners: await currentPartners(db, id) };
}

/** Settles every relationship a character is in right now (before it goes on a date: it decides when it needs to). */
export async function settleCharacter(db: Db, id: string): Promise<void> {
  for (const p of await currentPartners(db, id)) {
    const [lo, hi] = id < p.id ? [id, p.id] : [p.id, id];
    await settleCommitment(db, lo, hi);
  }
}

/**
 * After a couple's stage changes (lib/relationship-events.ts): each side now in a relationship settles its style if
 * it was left to it, and a one-partner side closes to new dates, with a note to its owner.
 */
export async function settleCommitment(db: Db, lo: string, hi: string): Promise<void> {
  const rel = (await db.query<{ stage: string | null }>(`select stage from relationships where character_a = $1 and character_b = $2`, [lo, hi])).rows[0];
  if (!rel || !(COMMITTED_STAGES as readonly string[]).includes(rel.stage ?? "")) return;
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean; partner_style: PartnerStyle | null; partner_style_decided: DecidedStyle | null; open_to_dates: boolean }>(
    `select id, name, owner_id, is_house, partner_style, partner_style_decided, open_to_dates from characters where id = any($1)`,
    [[lo, hi]],
  );
  for (const c of rows) {
    if (c.is_house) continue;
    const partner = shortName(rows.find((r) => r.id !== c.id)?.name) || "someone";
    let style: DecidedStyle | null = c.partner_style === "one" || c.partner_style === "open" ? c.partner_style : c.partner_style_decided;
    const decidedNow = !style;
    if (!style) {
      const loaded = await loadCharacter(db, c.id);
      style = loaded ? decideFromTemperament(loaded.signals) : "one";
      await db.query(`update characters set partner_style_decided = $2 where id = $1`, [c.id, style]);
    }
    const first = shortName(c.name);
    const closing = style === "one" && c.open_to_dates;
    if (closing) await db.query(`update characters set open_to_dates = false where id = $1`, [c.id]);
    if (!decidedNow && !closing) continue;
    await notify(db, c.owner_id, {
      kind: "partner_style",
      title:
        style === "open"
          ? `🌈 ${first} is seeing ${partner}, and wants to keep dating others too`
          : `💍 ${first} is with ${partner}: just the two of them`,
      body: [
        decidedNow ? "They decided this for themselves." : null,
        closing ? "One partner, so they've closed to new dates." : null,
        "You can change it on their card.",
      ]
        .filter(Boolean)
        .join(" "),
      link: `/characters/${c.id}`,
    });
  }
}
