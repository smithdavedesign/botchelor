/**
 * Unmatching (David, 2026-10-31: "dont allow users to undo a match when swiping they have to do that in their
 * messages"). The deck's Undo takes back an unanswered like only; a match ends from its thread, by either owner, while
 * the two haven't been on a date. Once they have, they're a couple (their dates are the show's), and a block from that
 * date's page is how to stop them meeting.
 *
 * It's for good: the match goes, and the pair is kept in `unmatches`, so they don't text, can't book a date or a
 * roleplay, aren't dealt to each other again and can't match again by any path (a swipe, a date link). Their thread
 * leaves both owners' Matches, and its notices are read. Nobody is told, as on any dating app: the match is just gone.
 *
 * No imports from lib/swipes.ts (whose match paths check it), so every gate can import it.
 */
import type { Db } from "./db";
import { pairNames } from "./names";
import { pairKey } from "./relationships";
import { haveDated } from "./swipe-gate";

export type UnmatchResult = { ok: true; with: { id: string; name: string } } | { ok: false; status: number; error: string; message: string };

const refuse = (status: number, error: string, message: string): UnmatchResult => ({ ok: false, status, error, message });

/** SQL: true when the two characters (SQL expressions, text ids) have unmatched. */
export const unmatchedSql = (x: string, y: string) =>
  `exists (select 1 from unmatches um where (um.character_lo = ${x} and um.character_hi = ${y}) or (um.character_lo = ${y} and um.character_hi = ${x}))`;

export async function areUnmatched(db: Db, x: string, y: string): Promise<boolean> {
  const [lo, hi] = pairKey(x, y);
  return (await db.query(`select 1 from unmatches where character_lo = $1 and character_hi = $2`, [lo, hi])).rows.length > 0;
}

/** What a gate says when the pair has unmatched (the booking route, texting, roleplays, proposals, own dates). */
export const unmatchedMessage = (x: string, y: string) => `${x} and ${y} unmatched, so they don't text or go on dates any more.`;

/** Ends the match between one of the user's characters and another, for good. */
export async function unmatch(db: Db, userId: string, characterId: string, withId: string): Promise<UnmatchResult> {
  const mine = (await db.query<{ id: string; name: string }>(`select id, name from characters where id::text = $1 and owner_id = $2 and not is_house`, [characterId, userId])).rows[0];
  if (!mine) return refuse(404, "not_your_character", "Unmatch one of your own characters.");
  const them = (await db.query<{ id: string; name: string; owner_id: string | null }>(`select id, name, owner_id from characters where id::text = $1`, [withId])).rows[0];
  if (!them || them.id === mine.id) return refuse(404, "not_found", "No character has that id.");
  const [lo, hi] = pairKey(mine.id, them.id);
  const [x, y] = pairNames(mine.name, them.name);
  const matched = (await db.query(`select 1 from matches where character_lo = $1 and character_hi = $2`, [lo, hi])).rows.length > 0;
  if (!matched) {
    return (await areUnmatched(db, lo, hi)) ? refuse(409, "already_unmatched", `${x} and ${y} have already unmatched.`) : refuse(404, "no_match", `${x} and ${y} haven't matched.`);
  }
  if (await haveDated(db, lo, hi)) {
    return refuse(409, "dated", `${x} and ${y} have been on a date, so they're a couple now, not just a match. To stop them meeting, block from that date's page.`);
  }
  const filming = await db.query(`select 1 from episodes where status = 'generating' and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1)) limit 1`, [lo, hi]);
  if (filming.rows.length) {
    return refuse(409, "date_booked", `${x} and ${y} have a date being filmed. Once it's on they're a couple, and stopping them meeting is a block from that date's page.`);
  }
  // Kept first: from here on every path that could match or pair them again refuses, whatever happens next.
  await db.query(`insert into unmatches (character_lo, character_hi, by_character) values ($1, $2, $3) on conflict do nothing`, [lo, hi, mine.id]);
  await db.query(`delete from matches where character_lo = $1 and character_hi = $2`, [lo, hi]);
  // A roleplay waiting for their next date goes with it.
  await db.query(`update date_roleplays set status = 'withdrawn', decided_at = now() where character_lo = $1 and character_hi = $2 and status in ('pending', 'agreed')`, [lo, hi]);
  // Their notices (the match, texts, a roleplay) are read for both owners, so no count still points at a thread that's gone.
  const prefixes = [`/messages/${lo}/${hi}`, `/couples/${lo}/${hi}`];
  for (const owner of new Set([userId, them.owner_id].filter((o): o is string => Boolean(o)))) {
    await db
      .query(`update notifications set read_at = now() where user_id = $1 and read_at is null and (starts_with(link, $2) or starts_with(link, $3))`, [owner, ...prefixes])
      .catch(() => {});
  }
  return { ok: true, with: { id: them.id, name: them.name } };
}

/**
 * For the thread page: the pair has unmatched and the viewer owns one of them. Whose side to tell it from (`as` when
 * it's one of the viewer's, else theirs) and the two names, that one's first.
 */
export async function unmatchedFor(db: Db, viewerId: string | null, x: string, y: string, as?: string): Promise<{ self: string; names: [string, string] } | null> {
  if (!viewerId) return null;
  const [lo, hi] = pairKey(x, y);
  if (!(await areUnmatched(db, lo, hi))) return null;
  const cs = (await db.query<{ id: string; name: string; owner_id: string | null }>(`select id, name, owner_id from characters where id = any($1)`, [[lo, hi]])).rows;
  const mine = cs.filter((c) => c.owner_id === viewerId).map((c) => c.id);
  if (!mine.length) return null;
  const self = as && mine.includes(as) ? as : mine[0];
  const name = (id: string) => cs.find((c) => c.id === id)?.name;
  return { self, names: pairNames(name(self), name(self === lo ? hi : lo)) };
}
