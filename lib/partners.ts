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
import { loadRelationship, type Relationship } from "./relationships";

import { REOPEN_FIELDS, type DecidedStyle, type PartnerStyle } from "./partners-shared";
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

/**
 * Which of these characters are taken (takenSql), each with who it's with, newest first: what the pickers on /swipe and
 * /matches mark (app/CharacterTabs.tsx). One query for any number; a character that isn't taken isn't in the map.
 */
export async function takenWith(db: Db, ids: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>();
  if (!ids.length) return out;
  const { rows } = await db.query<{ id: string; partner_id: string; partner_name: string }>(
    `select c.id, p.id as partner_id, p.name as partner_name
       from characters c
       join relationships r on (r.character_a = c.id or r.character_b = c.id) and r.stage in ('dating', 'going_steady')
       join characters p on p.id = case when r.character_a = c.id then r.character_b else r.character_a end
      where c.id = any($1) and ${takenSql("c")}
      order by r.last_at desc nulls last, p.id`,
    [ids],
  );
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), { id: r.partner_id, name: r.partner_name }]);
  return out;
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
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean; partner_style: PartnerStyle | null; partner_style_decided: DecidedStyle | null; open_to_dates: boolean; created_via: string }>(
    `select id, name, owner_id, is_house, partner_style, partner_style_decided, open_to_dates, created_via from characters where id = any($1)`,
    [[lo, hi]],
  );
  for (const c of rows) {
    if (c.is_house) continue;
    // #553: the partner by full name (first names collide), and whether it's one of the house cast.
    const other = rows.find((r) => r.id !== c.id);
    const partner = other ? partnerLabel(other) : "someone";
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
    // #514 (d): what happened and how to reopen, by field, so an agent isn't surprised by the closed card.
    await notify(db, c.owner_id, {
      kind: "partner_style",
      title:
        style === "open"
          ? `🌈 ${first} is seeing ${partner}, and wants to keep dating others too`
          : `💍 ${first} is with ${partner}: just the two of them`,
      body: [
        other ? `Partner: ${partner}, character ${other.id}.` : null,
        decidedNow ? "They decided this for themselves." : null,
        closing && c.created_via === "mcp"
          ? `A Dating couple and ${first} wants one partner, so go_on_date with anyone else is refused (open_to_dates: false). To reopen: ${REOPEN_FIELDS} (${c.id}).`
          : closing
            ? `A Dating couple and ${first} wants one partner, so they've closed to other dates. To reopen them, set them to more than one partner on their card and open them to dates.`
            : c.created_via === "mcp"
            ? `You can change it: update_character with partner_style: "open" (${c.id}).`
            : "You can change it on their card.",
      ]
        .filter(Boolean)
        .join(" "),
      link: `/characters/${c.id}`,
    });
    if (closing) await tellMatchesItClosed(db, c, other ?? null);
  }
}

/** #553: a partner as notices name it: full name, and "(house cast)" when it's one of the show's own characters. */
export const partnerLabel = (p: { name: string; is_house: boolean }): string => `${p.name}${p.is_house ? " (house cast)" : ""}`;

/**
 * The owner's heads-up before exclusivity (2.4.2, the 2026-10-21-0319 run: a character closed to other dates with no
 * warning). A couple that has just become Sparks (a date ending in a second date) is one more such date from a Dating
 * couple, and a one-partner character closes to other dates then (settleCommitment). Each owner whose character would
 * close hears it now, with the opt-out: partner_style "open" (more than one partner), which keeps it open. A character
 * already open, already closed, or set to more than one partner isn't told. The rule itself doesn't change.
 * `since` (2.9.0): an owner already told about this partner since then (a warning 2.7.0 sent when the date was written)
 * isn't told again.
 */
export async function warnBeforeExclusive(db: Db, lo: string, hi: string, opts: { since?: string } = {}): Promise<number> {
  const { rows } = await db.query<{ id: string; name: string; owner_id: string | null; is_house: boolean; partner_style: PartnerStyle | null; partner_style_decided: DecidedStyle | null; open_to_dates: boolean; created_via: string }>(
    `select id, name, owner_id, is_house, partner_style, partner_style_decided, open_to_dates, created_via from characters where id = any($1)`,
    [[lo, hi]],
  );
  let told = 0;
  for (const c of rows) {
    const other = rows.find((r) => r.id !== c.id);
    if (c.is_house || !c.owner_id || !other || !c.open_to_dates || c.partner_style === "open") continue;
    // Its own choice, else what it decided, else what it would decide now (the same deterministic rule settle uses).
    let style: DecidedStyle | null = c.partner_style === "one" ? "one" : c.partner_style_decided;
    if (!style) {
      const loaded = await loadCharacter(db, c.id);
      style = loaded ? decideFromTemperament(loaded.signals) : "one";
    }
    if (style !== "one") continue;
    const first = shortName(c.name);
    if (opts.since) {
      const told = await db.query(
        `select 1 from notifications where user_id = $1 and kind = 'exclusive_soon' and link = $2 and position($3 in title) > 0 and created_at >= $4::timestamptz limit 1`,
        [c.owner_id, `/characters/${c.id}`, `with ${other.name}`, opts.since],
      );
      if (told.rows.length) continue;
    }
    const why = c.partner_style === "one" ? "you set them to one partner" : "they want one partner (their own call, from their temperament)";
    await notify(db, c.owner_id, {
      kind: "exclusive_soon",
      title: `⏳ ${first} is one date from going exclusive with ${other.name}`,
      // What to do comes first, so a long pair of names can't push it out of a short preview (the 2026-10-23-0610 run).
      body:
        (c.created_via === "mcp"
          ? `To keep ${first} open: update_character with partner_style: "open" (character ${c.id}). `
          : `To keep ${first} open, set them to more than one partner on their card. `) +
        `${c.name} and ${partnerLabel(other)} are Sparks: one more date that ends in a second date makes them a Dating couple, and ${why}, ` +
        `so ${first} would then close to other dates.`,
      link: `/characters/${c.id}`,
    });
    told++;
  }
  return told;
}

/**
 * When exclusive_soon goes out (2.9.0, the 2026-10-22-0610 run: "heads_up said Thaddeus was one date from going exclusive
 * with Nell before the first date had even aired"). 2.7.0 sent it when the date that made the couple Sparks was written,
 * because on airing the couple was Sparks already; that ran ahead of the date the owner could point to. Now it goes when
 * that date is out: when it airs (refreshAndAnnounce), or, for a private date, which never airs and whose owners see its
 * ending at once, when it's written (rememberDate) or made private. Once per couple and date: relationships.
 * exclusive_warned_for holds the date it went out for, claimed in one update, so it never repeats. The rule doesn't change:
 * Sparks is one second date, Dating two in a row (lib/relationships.ts stageOf), and a one-partner side closes at Dating.
 */
export async function warnWhenSparksOut(db: Db, x: string, y: string, rel?: Relationship | null): Promise<number> {
  const [lo, hi] = x < y ? [x, y] : [y, x];
  const r = rel === undefined ? await loadRelationship(db, lo, hi) : rel;
  if (!r || r.all.stage !== "sparks") return 0;
  // Sparks means the newest date ended in a second date, the first of a streak: that's the date that made it so.
  const last = r.history.at(-1);
  if (!last || last.ending !== "second_date" || (last.aired_at === null && last.private !== true)) return 0;
  const claimed = await db.query(
    `update relationships set exclusive_warned_for = $3 where character_a = $1 and character_b = $2 and exclusive_warned_for is distinct from $3 returning 1`,
    [lo, hi, last.episode_id],
  );
  if (!claimed.rows.length) return 0;
  return warnBeforeExclusive(db, lo, hi, { since: last.at });
}

/**
 * #514 (c): a character that just went exclusive closed to other dates, so the owners of its other matches hear it
 * (a match's date would otherwise just never happen). Not its partner's owner, nor its own.
 */
async function tellMatchesItClosed(db: Db, c: { id: string; name: string; owner_id: string | null }, partner: { id: string; name: string; is_house: boolean } | null): Promise<void> {
  const { rows } = await db.query<{ owner_id: string | null; other: string; other_name: string }>(
    `select o.owner_id, o.id as other, o.name as other_name
       from matches m
       join characters o on o.id = case when m.character_lo = $1 then m.character_hi else m.character_lo end
      where (m.character_lo = $1 or m.character_hi = $1) and o.id is distinct from $2 and not o.is_house`,
    [c.id, partner?.id ?? null],
  );
  // #553: who took the match, by full name and id, and whether it's one of the house cast ("dating Orin" named nobody).
  const who = partner ? partnerLabel(partner) : "someone";
  const whoId = partner ? ` (character ${partner.id})` : "";
  const told = new Set<string>();
  for (const r of rows) {
    if (!r.owner_id || r.owner_id === c.owner_id || told.has(r.owner_id)) continue;
    told.add(r.owner_id);
    await notify(db, r.owner_id, {
      kind: "match_taken",
      title: `💍 ${c.name} is now dating ${who} and closed to other dates`,
      body: `${c.name} (character ${c.id}) matched ${r.other_name}, but wants one partner and is with ${who}${whoId} now, so a date with them won't happen unless their owner reopens them.`,
      link: `/characters/${c.id}`,
    });
  }
}
