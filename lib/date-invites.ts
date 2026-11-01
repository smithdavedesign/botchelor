/**
 * "Date my OC" links (David 2026-10-25: growth without paid marketing; the loop that turns every user into a recruiter).
 * A character's owner shares botchelor.com/date/<code>; whoever opens it sees the character, makes one of their own if
 * they have none (the create wizard comes back here), and with one click the two are matched with the date agreed:
 * the shared link is the inviting character's yes, the click is the visitor's. Then everything is the usual flow (the
 * two text, either books the date). Each link counts what it brings in (date_invite_accepts), so the loop is measured.
 *
 * Rules: never a house character or a private one; never your own characters; never across a block; never a character
 * that's settled on one partner (taken), on either side. A link takes at most ACCEPTS_PER_DAY a day (a link posted
 * somewhere big can't flood one character's inbox), and its owner can turn it off.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import { shortName } from "./names";
import { notify } from "./notifications";
import { takenSql } from "./partners";
import { pairKey } from "./relationships";
import { scheduleMatchChat } from "./swipes";
import { areUnmatched } from "./unmatch";

/** New dates one link can start in a day. */
export const ACCEPTS_PER_DAY = 25;
/** A code: unguessable enough not to be walked, short enough to paste. */
const newCode = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const dateLinkPath = (code: string): string => `/date/${code}`;

type Refusal = { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/** The character's link, made the first time it's asked for (one live link per character). Owner only. */
export async function ensureDateLink(db: Db, userId: string, characterId: string): Promise<{ ok: true; code: string; accepted: number } | Refusal> {
  const c = (
    await db.query<{ id: string; is_house: boolean; private: boolean; taken: boolean }>(
      `select c.id, c.is_house, c.visibility = 'private' as private, ${takenSql("c")} as taken from characters c where c.id = $1 and c.owner_id = $2`,
      [characterId, userId],
    )
  ).rows[0];
  if (!c || c.is_house) return refuse(404, "character_not_found", "Share a link for one of your own characters.");
  if (c.private) return refuse(409, "private", "A private character can't have a date link: make it public first.");
  if (c.taken) return refuse(409, "taken", "They're with someone and only date them right now, so a date link would go nowhere.");
  const live = (
    await db.query<{ code: string; accepted: number }>(`select code, accepted from date_invites where character_id = $1 and revoked_at is null`, [characterId])
  ).rows[0];
  if (live) return { ok: true, code: live.code, accepted: live.accepted };
  const code = newCode();
  await db.query(`insert into date_invites (code, character_id, owner_id) values ($1, $2, $3)`, [code, characterId, userId]);
  return { ok: true, code, accepted: 0 };
}

/** Turn a link off (a new one can be made after). */
export async function revokeDateLink(db: Db, userId: string, characterId: string): Promise<boolean> {
  const r = await db.query(`update date_invites set revoked_at = now() where character_id = $1 and owner_id = $2 and revoked_at is null returning code`, [
    characterId,
    userId,
  ]);
  return r.rows.length > 0;
}

export type DateInvite = { code: string; character_id: string; owner_id: string; name: string; live: boolean };

/** A live link's character (never a private or house one, never one that's since been taken or retired). */
export async function loadDateLink(db: Db, code: string): Promise<DateInvite | null> {
  const r = (
    await db.query<DateInvite>(
      `select i.code, i.character_id, i.owner_id, c.name, (i.revoked_at is null and c.visibility <> 'private' and not c.is_house
              and c.owner_id = i.owner_id and not ${takenSql("c")}) as live
         from date_invites i join characters c on c.id = i.character_id where i.code = $1`,
      [code],
    )
  ).rows[0];
  return r ?? null;
}

export type AcceptResult = { ok: true; thread: string; already: boolean } | Refusal;

/**
 * Accept a date link with one of your characters: the two are matched and the date is agreed. Idempotent: accepting
 * again (or a pair that already matched) goes to their thread. A pair that matched before and someone said no stays
 * as it was: a link doesn't overrule an answer.
 */
export async function acceptDateLink(db: Db, userId: string, code: string, myCharacterId: string): Promise<AcceptResult> {
  const invite = await loadDateLink(db, code);
  if (!invite || !invite.live) return refuse(404, "link_not_found", "This date link isn't open any more.");
  const mine = (
    await db.query<{ id: string; name: string; is_house: boolean; taken: boolean }>(
      `select c.id, c.name, c.is_house, ${takenSql("c", "$3")} as taken from characters c where c.id = $1 and c.owner_id = $2`,
      [myCharacterId, userId, invite.character_id],
    )
  ).rows[0];
  if (!mine || mine.is_house) return refuse(404, "character_not_found", "Accept with one of your own characters.");
  if (invite.owner_id === userId) return refuse(409, "own_link", "That's your own character's link: share it with someone else.");
  if (mine.taken) return refuse(409, "taken", `${shortName(mine.name)} is with someone and only dates them right now.`);
  const blocked = await db.query(
    `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`,
    [userId, invite.owner_id],
  );
  if (blocked.rows.length) return refuse(404, "link_not_found", "This date link isn't open any more.");
  // A pair that unmatched (lib/unmatch.ts) doesn't match again by a link either: told as a block is.
  if (await areUnmatched(db, mine.id, invite.character_id)) return refuse(404, "link_not_found", "This date link isn't open any more.");

  const [lo, hi] = pairKey(mine.id, invite.character_id);
  const thread = `/messages/${mine.id}/${invite.character_id}?as=${encodeURIComponent(mine.id)}`;
  const existing = (await db.query(`select 1 from matches where character_lo = $1 and character_hi = $2`, [lo, hi])).rows.length > 0;
  if (existing) return { ok: true, thread, already: true };
  const today = (
    await db.query<{ n: number }>(`select count(*)::int as n from date_invite_accepts where code = $1 and accepted_at > now() - interval '1 day'`, [code])
  ).rows[0].n;
  if (today >= ACCEPTS_PER_DAY) return refuse(429, "link_busy", "This link has had a lot of dates today: try again tomorrow.");

  // The link is the inviting character's yes ('invite', its owner's choice); the click is the visitor's ('person').
  const inviterIsLo = lo === invite.character_id;
  const made = await db.query(
    `insert into matches (character_lo, character_hi, yes_lo, yes_hi, answer_source_lo, answer_source_hi, agreed_at)
     values ($1, $2, true, true, $3, $4, now()) on conflict do nothing returning matched_at`,
    [lo, hi, inviterIsLo ? "invite" : "person", inviterIsLo ? "person" : "invite"],
  );
  if (!made.rows.length) return { ok: true, thread, already: true };
  await db.query(`insert into date_invite_accepts (code, character_id) values ($1, $2) on conflict do nothing`, [code, mine.id]);
  await db.query(`update date_invites set accepted = accepted + 1 where code = $1`, [code]);
  await notify(db, invite.owner_id, {
    kind: "date_link",
    title: `💌 ${shortName(mine.name)} took ${shortName(invite.name)}'s date link`,
    body: `It's a match, and the date's agreed: the two can text, and either of you can book it.`,
    link: `/messages/${invite.character_id}/${mine.id}?as=${encodeURIComponent(invite.character_id)}`,
  }).catch(() => {});
  track("date_link_accepted", { code, inviter: invite.character_id, guest: mine.id });
  await scheduleMatchChat(db, mine.id, invite.character_id).catch(() => {});
  return { ok: true, thread, already: false };
}
