/**
 * Notifications: what happened between dates that a player would come back for ("Ira texted Mira", "Cass asked
 * Ira out again", "Mira and Rafe are now dating"). Every one lands in the in-app inbox (/notifications, the bell in
 * the nav), in the browser too when the player turned on push (lib/push.ts), and by email when they opted in
 * (lib/email.ts: at once for what's waiting on them, the rest in a daily digest).
 *
 * Best effort and never in the way: a notification that can't be stored or pushed never fails the thing it's about.
 */
import type { Db } from "./db";
import { emailNow } from "./email";
import { pushToUser } from "./push";

export type NotificationKind =
  | "texted" // a couple's text: the show's daily one, or one they sent themselves (one unread per couple)
  | "matched" // your character matched someone in the swipe deck (lib/swipes.ts)
  | "matchmaker_pick" // the house matchmaker proposed a pair with your character (lib/house-matchmaker.ts)
  | "scheduled_date" // a date booked for later ran: booked, or why not (lib/scheduled-dates.ts)
  | "double_invite" // another couple proposed a double date with yours (lib/group-dates.ts)
  | "double_date" // how a double date went: booked, declined, or one table fell through (lib/group-dates.ts)
  | "mixer" // a speed-dating mixer ran, was called off, or wrapped with a reflect nudge (lib/group-dates-run.ts)
  | "group_reflect" // a group night's last date aired: who did your character like? (lib/group-dates.ts notifyNightAired)
  | "date_link" // someone took your character's date link: a match with the date agreed (lib/date-invites.ts)
  | "date_agreed" // a match where both characters said yes to a date: book it
  | "second_date_yes" // the other owner said yes to a second date, and is waiting for yours
  | "second_date_booked" // a second date was booked with your character
  | "date_booked_with_yours" // someone else booked a date with your character, private ones included (#563)
  | "stage_up" // a couple you're part of (or follow) moved up a stage
  | "couple_date" // a couple you follow went on another date
  | "arc_resolved" // a prediction you made about a couple's arc came true (or didn't)
  | "prediction_scored" // a date you predicted aired: what your pick scored (lib/air.ts notifyPredictors, #851)
  | "partner_style" // your character settled one partner or more, or closed to dates because they're taken
  | "match_taken" // a character you matched went exclusive with someone else (one partner) and closed to other dates (#514)
  | "exclusive_soon" // your one-partner character is one date from a Dating couple, after which it closes to other dates (2.4.2)
  | "date_proposal" // another owner proposed a date between their character and yours
  | "date_proposal_declined" // the other owner said not this time to your proposal
  | "date_accepted" // the other owner accepted your proposal: the date is booked
  | "own_date_invite" // (agents) another agent started a two-agent date with your character: perform its side
  | "own_date_turn" // (agents) it's your move in a two-agent date (one unread at a time per date)
  | "own_date_handed_over" // (agents) you went quiet on a two-agent date, so the show's model took your side
  | "own_date_declined" // (agents) the other agent passed on your two-agent date
  | "showcase_request" // someone wants to publish a picture with your character on the showcase (lib/showcase-social.ts)
  | "showcase_post" // a creator you follow published (at most one a day per creator; lib/showcase-social.ts)
  | "showcase_answer" // the other owner said yes (it's live) or no to your showcase post
  | "own_date_lapsed" // (agents) a self-performed date lapsed unfinished (written already read: a record for a late line, #551)
  | "own_date_ready" // (agents) a two-agent date you were in is done
  | "after_dark_request" // (admins) an agent asked for after dark (lib/adult)
  | "after_dark_share" // something was shared with you in After Dark (lib/adult/shares.ts): neutral words, no picture
  | "key_usage" // your own key's job is at 80% of its monthly cap (lib/connections.ts noteSpend)
  | "key_capped" // your own key's job reached its monthly cap: the free model stands in, or it waits
  | "key_failed" // your own key stopped working (invalid, out of credit): what to do, and what happens meanwhile
  | "likes_waiting" // your characters have likes waiting and don't answer for themselves while you're away (never who; lib/away.ts)
  | "while_away"; // (agents) back after a while: what your characters did on their own, and that they're yours again (lib/away.ts)

export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
  /**
   * A "matched" or "date_agreed" notice whose pair has had a date booked since (being filmed or ready): the date, so the
   * notice says it's booked instead of "Book it". Old notices fix themselves this way.
   */
  booked?: { episode_id: string; status: "generating" | "ready"; performed: BookedBy };
  /**
   * An own_date_turn / own_date_invite notice whose date isn't waiting on this person any more (#529): it finished, was
   * called off or lapsed, or the show's model plays their side now. The notice says so and is read.
   */
  resolved?: { episode_id: string; why: TurnResolution };
};

/** The notices that ask an owner to book a pair's date, and so go stale once one is booked. */
export const PAIR_NOTICE_KINDS = ["matched", "date_agreed"] as const;
export type PairNoticeKind = (typeof PAIR_NOTICE_KINDS)[number];

/** The pair's ids, lower first (lib/relationships.ts pairKey, inlined: this file stays free of the date code). */
const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

/** Every link a matched or date_agreed notice has carried for a pair. */
export function pairNoticeLinks(x: string, y: string): string[] {
  const [lo, hi] = pairOf(x, y);
  return [`/messages/${lo}/${hi}`, `/couples/${lo}/${hi}`, `/couples/${lo}/${hi}#texts`];
}

/** The pair a matched or date_agreed notice is about, from its link; null for anything else. */
export function pairOfNotice(n: { kind: string; link: string | null }): [string, string] | null {
  if (!(PAIR_NOTICE_KINDS as readonly string[]).includes(n.kind) || !n.link) return null;
  const m = /^\/(?:messages|couples)\/([^/#?]+)\/([^/#?]+)/.exec(n.link);
  return m ? pairOf(decodeURIComponent(m[1]), decodeURIComponent(m[2])) : null;
}

/** Marks one person's matched / date_agreed notices about a pair read (lib/inbox.ts markPairNoticesRead calls this). */
export async function markPairNotices(db: Db, userId: string, x: string, y: string, kinds: readonly PairNoticeKind[] = PAIR_NOTICE_KINDS): Promise<void> {
  await db
    .query(`update notifications set read_at = now() where user_id = $1 and kind = any($2) and read_at is null and link = any($3)`, [userId, [...kinds], pairNoticeLinks(x, y)])
    .catch(() => {});
}

/**
 * A date between the pair was booked, by any path (the web's book buttons, the thread's Book date, go_on_date,
 * plan_second_date, a two-agent date): their owners' "Book it" notices are done. Since #563 (David, 2026-10-21) the
 * other owner hears of every date booked with their character, private ones too (they can open it: a private date is
 * its two owners'), so a private date clears both owners' as well.
 */
export async function resolvePairNotices(db: Db, x: string, y: string, opts: { bookedBy: string; private?: boolean }): Promise<void> {
  const others = [...(await ownersOf(db, [x, y]).catch(() => new Map<string, string | null>())).values()];
  for (const owner of new Set([opts.bookedBy, ...others])) if (owner) await markPairNotices(db, owner, x, y);
}

/**
 * #563 (David, 2026-10-21): another agent or person booked a date with your character, public or private, and you
 * hear of it: in the inbox (/notifications, my_notifications, my_status) and by email when you've turned email on
 * (lib/email.ts IMMEDIATE_KINDS; a verified address only, capped, one-click unsubscribe). It says who booked it, with
 * which character, whether it's private (you can still open it: a private date is its two owners'), and links to it.
 * Never to the booker, never for a house character (no owner), never to a creator who left.
 */
export async function notifyDateBooked(
  db: Db,
  d: {
    episodeId: string;
    bookedBy: string;
    booker: { id: string; name: string };
    yours: { id: string; name: string };
    visibility: string;
    /** Who performs it: the show's model, or the agents themselves (an own date). */
    performedBy: "show" | "agents";
  },
): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; owner_id: string | null; created_via: string | null }>(
      `select id, owner_id, created_via from characters where id = any($1)`,
      [[d.booker.id, d.yours.id]],
    );
    const owner = rows.find((r) => r.id === d.yours.id)?.owner_id;
    if (!owner || owner === d.bookedBy || owner === "deleted") return;
    const by = rows.find((r) => r.id === d.booker.id)?.created_via === "mcp" ? "an agent" : "a person";
    const first = (n: string) => n.trim().split(/\s+/)[0] || n;
    const isPrivate = d.visibility === "private";
    await notify(db, owner, {
      kind: "date_booked_with_yours",
      title: `📅 ${first(d.booker.name)} booked a${isPrivate ? " private" : ""} date with ${first(d.yours.name)}`,
      body: [
        `Booked by ${d.booker.name}'s creator (${by}), with your ${d.yours.name}.`,
        d.performedBy === "show" ? "The show's model performs it." : null,
        isPrivate
          ? "It's private: it never airs, and only its two owners can open it, you included."
          : d.visibility === "unlisted"
            ? "It's unlisted: anyone with the link can watch it."
            : "It's public: it airs once it's ready.",
        `Episode ${d.episodeId}.`,
      ]
        .filter(Boolean)
        .join(" "),
      link: `/episodes/${d.episodeId}`,
    });
  } catch (err) {
    console.error("[notify] could not tell the owner of a booking:", err instanceof Error ? err.message : "unknown");
  }
}

/** The notices that ask an agent to play a self-performed date, and so go stale once the date isn't waiting on it (#529). */
export const TURN_NOTICE_KINDS = ["own_date_turn", "own_date_invite"] as const;
/**
 * Why a turn notice no longer asks anything: the date is done, called off or lapsed (gone), the show plays that side, or
 * (2.4.2) the agent has made that move since the notice came (moved).
 */
export type TurnResolution = "done" | "gone" | "show_plays" | "moved";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** The date a turn notice is about (its body names it); null for any other notice. */
export function dateOfTurnNotice(n: { kind: string; body: string | null }): string | null {
  if (!(TURN_NOTICE_KINDS as readonly string[]).includes(n.kind) || !n.body) return null;
  return UUID.exec(n.body)?.[0] ?? null;
}

/**
 * The write half of stale turn notices, the way resolvePairNotices does "Book it" (#527): a self-performed date finished,
 * was called off or lapsed, or the show's model took a side, so its "Your move…" and invite notices are done. `userIds`:
 * only these agents' (a hand-over clears just the quiet side's); left out, both agents'.
 */
export async function resolveTurnNotices(db: Db, episodeId: string, userIds?: (string | null | undefined)[]): Promise<void> {
  if (!episodeId) return;
  const only = userIds ? userIds.filter((u): u is string => Boolean(u)) : null;
  if (only && !only.length) return;
  await db
    .query(`update notifications set read_at = now() where kind = any($1) and read_at is null and body like $2 and ($3::text[] is null or user_id = any($3))`, [
      [...TURN_NOTICE_KINDS],
      `%${episodeId}%`,
      only,
    ])
    .catch(() => {});
}

type TurnDate = { status: string; creator_id: string; partner_performer: string | null; handed_over: string | null; autoplay: boolean; last_move_at?: Date | string | null };

/**
 * Whether a self-performed date (its episodes row) still waits on `userId`: null while it does, else why it doesn't.
 * `notice` (2.4.2, the 2026-10-21-0319 run): a "Your move" notice is about the move it announced, so a line handed in on
 * that date after the notice came (last_move_at) means that move is made, whatever happens next.
 */
export function turnResolution(e: TurnDate | undefined, userId: string, notice?: { kind: string; created_at: string }): TurnResolution | null {
  if (!e) return "gone";
  if (e.status !== "generating") return "done";
  if (e.autoplay) return "show_plays";
  // Side a is the agent that started it; side b the invited agent (or the same agent, between its own two characters).
  const sides = [e.creator_id === userId ? "a" : null, (e.partner_performer ?? e.creator_id) === userId ? "b" : null].filter(Boolean);
  if (!sides.some((side) => side !== e.handed_over)) return "show_plays";
  // Turns alternate, so the line after a "your move" notice was this agent's (a side the show took is caught above).
  const moved = notice?.kind === "own_date_turn" && e.last_move_at && notice.created_at && new Date(e.last_move_at).getTime() > new Date(notice.created_at).getTime();
  return moved ? "moved" : null;
}

/** What a stale turn notice says instead. */
export const resolvedTurnBody = (why: TurnResolution): string =>
  why === "done"
    ? "Resolved: that date is finished, so nothing waits on you."
    : why === "gone"
      ? "Resolved: that date was called off or lapsed, so nothing waits on you."
      : why === "moved"
        ? "Resolved: you've made that move since, so nothing waits on you."
        : "Resolved: the show's model plays your side of that date now.";

/**
 * The render-time half (old notices fix themselves, like withBookings): a turn notice whose date no longer waits on this
 * person says why, and is read.
 */
export async function withTurnState(db: Db, userId: string, items: Notification[]): Promise<Notification[]> {
  const dates = items.map((n) => dateOfTurnNotice(n));
  const ids = [...new Set(dates.filter((d): d is string => Boolean(d)))];
  if (!ids.length) return items;
  const { rows } = await db.query<TurnDate & { id: string }>(
    `select id, status, creator_id, partner_performer, handed_over, autoplay, last_move_at from episodes where id = any($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stale: string[] = [];
  const out = items.map((n, i) => {
    const date = dates[i];
    if (!date) return n;
    const why = turnResolution(byId.get(date), userId, n);
    if (!why) return n;
    if (!n.read) stale.push(n.id);
    return { ...n, body: resolvedTurnBody(why), read: true, resolved: { episode_id: date, why } };
  });
  if (stale.length) await markRead(db, userId, stale).catch(() => 0);
  return out;
}

/** Marks this person's unread turn notices whose date no longer waits on them read (before counting what's unread). */
export async function sweepStaleTurnNotices(db: Db, userId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; kind: NotificationKind; body: string | null; created_at: Date | string }>(
    `select id, kind, body, created_at from notifications where user_id = $1 and read_at is null and kind = any($2)`,
    [userId, [...TURN_NOTICE_KINDS]],
  );
  if (!rows.length) return;
  await withTurnState(db, userId, rows.map((r) => ({ id: r.id, kind: r.kind, title: "", body: r.body, link: null, created_at: new Date(r.created_at).toISOString(), read: false })));
}

/** The most of a body the inbox stores (the 2026-10-23-0610 run: 300 cut exclusive_soon's instruction off mid-word). */
export const NOTIFICATION_BODY_MAX = 600;

/** A body cut to `max` at the last space inside it, with an ellipsis, never mid-word. */
export function clipBody(body: string, max = NOTIFICATION_BODY_MAX): string {
  if (body.length <= max) return body;
  const head = body.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:(—–-]+$/, "")}…`;
}

/** Notifies one person: stored for the inbox, then pushed to their browsers. Never throws. */
export async function notify(
  db: Db,
  userId: string | null | undefined,
  n: { kind: NotificationKind; title: string; body?: string | null; link?: string | null },
): Promise<void> {
  if (!userId || userId === "deleted") return;
  try {
    const id = crypto.randomUUID();
    await db.query(`insert into notifications (id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6)`, [
      id,
      userId,
      n.kind,
      n.title.slice(0, 140),
      n.body ? clipBody(n.body) : null,
      n.link ?? null,
    ]);
    await pushToUser(db, userId, { title: n.title, body: n.body ?? "", url: n.link ?? "/notifications" });
    // Email only for what's waiting on them, if they turned it on (lib/email.ts); the rest is in the daily digest.
    await emailNow(db, userId, { ...n, id }).catch(() => false);
  } catch (err) {
    console.error("[notify] could not notify:", err instanceof Error ? err.message : "unknown");
  }
}

/** Notifies several people (deduplicated), each once. */
export async function notifyAll(db: Db, userIds: (string | null | undefined)[], n: Parameters<typeof notify>[2]): Promise<void> {
  for (const id of new Set(userIds.filter((x): x is string => Boolean(x)))) await notify(db, id, n);
}

/** The owners of two characters (house characters have none). */
export async function ownersOf(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const { rows } = await db.query<{ id: string; owner_id: string | null }>(`select id, owner_id from characters where id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.owner_id]));
}

/** How many notifications someone has (or how many unread), for the /notifications pager. */
export async function countNotifications(db: Db, userId: string, opts: { unread?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from notifications where user_id = $1${opts.unread ? " and read_at is null" : ""}`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

/** Someone's notifications, newest first: `limit` of them from `offset` (the /notifications page passes a page's worth). */
export async function listNotifications(db: Db, userId: string, limit = 50, offset = 0): Promise<Notification[]> {
  const { rows } = await db.query<{ id: string; kind: NotificationKind; title: string; body: string | null; link: string | null; created_at: Date | string; read_at: Date | string | null }>(
    `select id, kind, title, body, link, created_at, read_at from notifications where user_id = $1 order by created_at desc, id desc limit $2 offset $3`,
    [userId, limit, Math.max(0, offset)],
  );
  const items: Notification[] = rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, created_at: new Date(r.created_at).toISOString(), read: r.read_at !== null }));
  return withTurnState(db, userId, await withBookings(db, userId, items));
}

/**
 * Who performs a booked date (#552): the show's model ("show"), or agents writing their own lines ("agents": a date one
 * agent performs between its characters, or a two-agent date); "you" when the reader is one of those agents.
 */
export type BookedBy = "show" | "agents" | "you";

/**
 * What a stale "Book it" notice says instead (#552: "being filmed" was said of a date the agents were performing
 * themselves, which read as the show booking a second date on its own).
 */
export const bookedBody = (status: "generating" | "ready", by: BookedBy = "show"): string =>
  status === "ready"
    ? "Booked: their date is ready to watch."
    : by === "you"
      ? "Booked: you're performing this date yourself (get_own_date_step has your move)."
      : by === "agents"
        ? "Booked: their agents are performing this date now."
        : "Booked: their date is being filmed on the show's model.";

/**
 * The render-time half of stale notices: a matched / date_agreed notice whose pair has a date (being filmed or ready,
 * not a Sliding Doors replay, and one this person may open) booked at or after the notice says so, and is read.
 */
export async function withBookings(db: Db, userId: string, items: Notification[]): Promise<Notification[]> {
  const pairs = items.map((n) => pairOfNotice(n));
  const ids = [...new Set(pairs.flatMap((p) => p ?? []))];
  if (!ids.length) return items;
  const { rows } = await db.query<{ id: string; status: "generating" | "ready"; a: string; b: string; created_at: Date | string; performed_by: string | null; creator_id: string | null; partner_performer: string | null }>(
    `select id, status, character_a as a, character_b as b, created_at, performed_by, creator_id, partner_performer from episodes
      where character_a = any($1) and character_b = any($1) and status in ('generating', 'ready') and varies_episode_id is null
        and (visibility <> 'private' or creator_id = $2 or partner_performer = $2
             or exists (select 1 from characters c where c.id in (episodes.character_a, episodes.character_b) and c.owner_id = $2))
      order by created_at desc`,
    [ids, userId],
  );
  if (!rows.length) return items;
  const stale: string[] = [];
  const out = items.map((n, i) => {
    const pair = pairs[i];
    if (!pair) return n;
    const at = new Date(n.created_at).getTime();
    const date = rows.find((e) => {
      const [lo, hi] = pairOf(e.a, e.b);
      return lo === pair[0] && hi === pair[1] && new Date(e.created_at).getTime() >= at;
    });
    if (!date) return n;
    if (!n.read) stale.push(n.id);
    const by: BookedBy = date.performed_by !== "agent" ? "show" : userId === date.creator_id || userId === date.partner_performer ? "you" : "agents";
    // The link follows the event: the booked date, not the thread that asked for it.
    return { ...n, body: bookedBody(date.status, by), link: `/episodes/${date.id}`, read: true, booked: { episode_id: date.id, status: date.status, performed: by } };
  });
  if (stale.length) await markRead(db, userId, stale).catch(() => 0);
  return out;
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  await sweepStaleTurnNotices(db, userId).catch(() => {});
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]);
  return rows[0]?.n ?? 0;
}

/** Clears (deletes) some, or all, of a person's notifications. Only ever their own. Returns how many went. */
export async function clearNotifications(db: Db, userId: string, ids: string[] | "all"): Promise<number> {
  const { rows } =
    ids === "all"
      ? await db.query(`delete from notifications where user_id = $1 returning id`, [userId])
      : await db.query(`delete from notifications where user_id = $1 and id = any($2) returning id`, [userId, ids]);
  return rows.length;
}

/** Marks some (or all) of a person's notifications read. */
export async function markRead(db: Db, userId: string, ids: string[] | "all"): Promise<number> {
  const { rows } =
    ids === "all"
      ? await db.query(`update notifications set read_at = now() where user_id = $1 and read_at is null returning id`, [userId])
      : await db.query(`update notifications set read_at = now() where user_id = $1 and id = any($2) and read_at is null returning id`, [userId, ids]);
  return rows.length;
}
