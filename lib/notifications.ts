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
  | "date_agreed" // a match where both characters said yes to a date: book it
  | "second_date_yes" // the other owner said yes to a second date, and is waiting for yours
  | "second_date_booked" // a second date was booked with your character
  | "stage_up" // a couple you're part of (or follow) moved up a stage
  | "couple_date" // a couple you follow went on another date
  | "arc_resolved" // a prediction you made about a couple's arc came true (or didn't)
  | "partner_style" // your character settled one partner or more, or closed to dates because they're taken
  | "date_proposal" // another owner proposed a date between their character and yours
  | "date_proposal_declined" // the other owner said not this time to your proposal
  | "date_accepted" // the other owner accepted your proposal: the date is booked
  | "own_date_invite" // (agents) another agent started a two-agent date with your character: perform its side
  | "own_date_turn" // (agents) it's your move in a two-agent date (one unread at a time per date)
  | "own_date_handed_over" // (agents) you went quiet on a two-agent date, so the show's model took your side
  | "own_date_declined" // (agents) the other agent passed on your two-agent date
  | "own_date_ready" // (agents) a two-agent date you were in is done
  | "after_dark_request"; // (admins) an agent asked for after dark (lib/adult)

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
  booked?: { episode_id: string; status: "generating" | "ready" };
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
 * plan_second_date, a two-agent date): their owners' "Book it" notices are done. A private date only clears the
 * booker's, so the other owner doesn't learn of a date they can't see.
 */
export async function resolvePairNotices(db: Db, x: string, y: string, opts: { bookedBy: string; private?: boolean }): Promise<void> {
  const others = opts.private ? [] : [...(await ownersOf(db, [x, y]).catch(() => new Map<string, string | null>())).values()];
  for (const owner of new Set([opts.bookedBy, ...others])) if (owner) await markPairNotices(db, owner, x, y);
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
      n.body ? n.body.slice(0, 300) : null,
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

export async function listNotifications(db: Db, userId: string, limit = 50): Promise<Notification[]> {
  const { rows } = await db.query<{ id: string; kind: NotificationKind; title: string; body: string | null; link: string | null; created_at: Date | string; read_at: Date | string | null }>(
    `select id, kind, title, body, link, created_at, read_at from notifications where user_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
  const items: Notification[] = rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, created_at: new Date(r.created_at).toISOString(), read: r.read_at !== null }));
  return withBookings(db, userId, items);
}

/** What a stale "Book it" notice says instead. */
export const bookedBody = (status: "generating" | "ready") => (status === "generating" ? "Booked: their date is being filmed." : "Booked: their date is ready to watch.");

/**
 * The render-time half of stale notices: a matched / date_agreed notice whose pair has a date (being filmed or ready,
 * not a Sliding Doors replay, and one this person may open) booked at or after the notice says so, and is read.
 */
export async function withBookings(db: Db, userId: string, items: Notification[]): Promise<Notification[]> {
  const pairs = items.map((n) => pairOfNotice(n));
  const ids = [...new Set(pairs.flatMap((p) => p ?? []))];
  if (!ids.length) return items;
  const { rows } = await db.query<{ id: string; status: "generating" | "ready"; a: string; b: string; created_at: Date | string }>(
    `select id, status, character_a as a, character_b as b, created_at from episodes
      where character_a = any($1) and character_b = any($1) and status in ('generating', 'ready') and varies_episode_id is null
        and (visibility <> 'private' or creator_id = $2 or partner_performer = $2)
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
    return { ...n, body: bookedBody(date.status), read: true, booked: { episode_id: date.id, status: date.status } };
  });
  if (stale.length) await markRead(db, userId, stale).catch(() => 0);
  return out;
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
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
