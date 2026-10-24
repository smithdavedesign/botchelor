/**
 * Who's around to answer (docs/swipes.md "While they're away", David 2026-10-24: "we don't just have dead characters who
 * don't do anything"). A like waits on the character's owner: a person on the site, or an agent over MCP. Agents come for
 * a session and leave, and people may not come back, so a like on their characters used to wait forever.
 *
 *  - When the owner was last here: a person's last page view (owner_activity, touched at most every TOUCH_EVERY_MS) or
 *    an agent's last MCP call (mcp_sessions.last_seen), whichever is later.
 *  - What a character does while its owner is away (characters.while_away; null is the default for its kind):
 *      adopt    answers its likes and match questions itself after AWAY_ANSWER_HOURS, and after ADOPT_DAYS the show
 *               plays it (texts back too), until its agent returns. The default for agents' characters.
 *      answer   answers its likes and match questions itself after AWAY_ANSWER_HOURS. Opt-in for people's characters.
 *      nothing  waits for its owner (the default for people's characters).
 *  - What a deck card says about replies (replyHint), and how far the deck ranks it down (AWAY_PENALTY) when nobody
 *    will answer.
 *
 * The answering itself is lib/away.ts; it's always the character's own call, by how well the two suit each other
 * (seeded, $0), and every answer it gives is labelled (swipes.auto, matches.answer_source 'away').
 */
import type { Db } from "./db";

export type WhileAway = "adopt" | "answer" | "nothing";
export const WHILE_AWAY_MODES: readonly WhileAway[] = ["adopt", "answer", "nothing"];

/** An owner gone this long: their character answers its own likes and match questions (adopt or answer). */
export const AWAY_ANSWER_HOURS = 24;
/** An agent gone this long: the show plays its character (adopt). */
export const ADOPT_DAYS = 7;
/** Seen this recently: the card says its owner is active. */
export const LIVE_HOURS = 48;
/** How far the deck ranks down a card nobody will answer (the deck's scores run about -5 to +10). */
export const AWAY_PENALTY = 4;
/** A person's page views touch owner_activity at most this often. */
const TOUCH_EVERY_MS = 10 * 60 * 1000;

/** A character's while-away mode: its own setting, else the default for how it was made. */
export const whileAwayOf = (c: { while_away?: string | null; created_via?: string | null }): WhileAway =>
  WHILE_AWAY_MODES.includes(c.while_away as WhileAway) ? (c.while_away as WhileAway) : c.created_via === "mcp" ? "adopt" : "nothing";

const touched = new Map<string, number>();

/** A person was here (a page view). Best effort and throttled: at most one write per person every TOUCH_EVERY_MS. */
export async function touchOwner(db: Db, userId: string | null | undefined, now = Date.now()): Promise<void> {
  if (!userId) return;
  const last = touched.get(userId);
  if (last !== undefined && now - last < TOUCH_EVERY_MS) return;
  if (touched.size > 10_000) touched.clear(); // one-off identities (directory checks) mustn't grow it forever
  touched.set(userId, now);
  await db
    .query(`insert into owner_activity (user_id, last_seen) values ($1, now()) on conflict (user_id) do update set last_seen = now()`, [userId])
    .catch(() => touched.delete(userId));
}

/** Tests: forget the in-memory throttle. */
export function forgetTouchesForTests(): void {
  touched.clear();
}

/** SQL for when an owner (`ownerSql`) was last here: their page views or their agent's MCP calls, whichever is later. */
export const ownerSeenSql = (ownerSql: string): string =>
  `greatest((select a.last_seen from owner_activity a where a.user_id = ${ownerSql}),
            (select max(s.last_seen) from mcp_sessions s where s.agent_id = ${ownerSql}))`;

/**
 * SQL for when a character's owner was last here, for character alias `c`: the owner's last page view or MCP call, and
 * never earlier than the character's own creation (so a character made before owner_activity existed, by someone who
 * never came back, reads as away rather than unknown, and one made a minute ago reads as active).
 */
export const characterSeenSql = (c: string): string => `greatest(${ownerSeenSql(`${c}.owner_id`)}, ${c}.created_at)`;

/** Whether a character answers for itself right now: its mode isn't "nothing" and its owner has been gone long enough. */
export const answersItself = (c: { while_away?: string | null; created_via?: string | null; seen: Date | null }, now = Date.now()): boolean =>
  whileAwayOf(c) !== "nothing" && c.seen !== null && now - c.seen.getTime() >= AWAY_ANSWER_HOURS * 60 * 60 * 1000;

/** When each owner was last here (absent: never seen). */
export async function ownersLastSeen(db: Db, ownerIds: readonly string[]): Promise<Map<string, Date>> {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; seen: string | Date | null }>(`select o.id, ${ownerSeenSql("o.id")} as seen from unnest($1::text[]) as o(id)`, [ids]);
  return new Map(rows.filter((r) => r.seen).map((r) => [r.id, new Date(r.seen!)]));
}

export type Replies = "instant" | "house_run" | "adopted" | "active" | "answers_itself" | "away";
export type ReplyHint = { replies: Replies; replies_note: string };

const HOUR = 60 * 60 * 1000;

/**
 * What a deck card says about whether a like will be answered, from what kind of character it is and when its owner was
 * last here. Never who liked whom: only this card's own state.
 */
export function replyHint(
  c: { house: boolean; house_bot: boolean; created_via: string | null; while_away: string | null; seen: Date | null; adopted?: boolean },
  now = Date.now(),
): ReplyHint {
  if (c.house) return { replies: "instant", replies_note: "On this season's house cast: always likes back." };
  if (c.house_bot) return { replies: "house_run", replies_note: "Played by the show: usually likes back within the hour." };
  if (c.adopted) return { replies: "adopted", replies_note: "House cast while its agent is away: always likes back, and the show texts for it." };
  const since = c.seen ? now - c.seen.getTime() : Infinity;
  if (since < LIVE_HOURS * HOUR) return { replies: "active", replies_note: c.created_via === "mcp" ? "Its agent was here recently." : "Its creator was here recently." };
  if (whileAwayOf(c) !== "nothing") return { replies: "answers_itself", replies_note: c.created_via === "mcp" ? "Its agent is away, so it answers likes on its own." : "Its creator is away, so it answers likes on its own." };
  const days = Number.isFinite(since) ? Math.floor(since / (24 * HOUR)) : null;
  return { replies: "away", replies_note: days !== null && days >= 2 ? `Its creator hasn't been here for ${days} days: a like may wait.` : "Its creator is away: a like may wait." };
}

/** Whether nobody will answer a like on this card soon: the deck ranks these down. */
export const nobodyAnswers = (h: ReplyHint): boolean => h.replies === "away";
