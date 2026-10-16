/**
 * Notifications: what happened between dates that a player would come back for ("Ira texted Mira", "Cass asked
 * Ira out again", "Mira and Rafe are now dating"). Every one lands in the in-app inbox (/notifications, the bell in
 * the nav), and in the browser too when the player turned on push (lib/push.ts). No email: accounts don't collect
 * one, and sending mail needs a provider the owner hasn't chosen.
 *
 * Best effort and never in the way: a notification that can't be stored or pushed never fails the thing it's about.
 */
import type { Db } from "./db";
import { pushToUser } from "./push";

export type NotificationKind =
  | "texted" // a couple's daily text
  | "second_date_yes" // the other owner said yes to a second date, and is waiting for yours
  | "second_date_booked" // a second date was booked with your character
  | "stage_up" // a couple you're part of (or follow) moved up a stage
  | "couple_date" // a couple you follow went on another date
  | "arc_resolved"; // a prediction you made about a couple's arc came true (or didn't)

export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
};

/** Notifies one person: stored for the inbox, then pushed to their browsers. Never throws. */
export async function notify(
  db: Db,
  userId: string | null | undefined,
  n: { kind: NotificationKind; title: string; body?: string | null; link?: string | null },
): Promise<void> {
  if (!userId || userId === "deleted") return;
  try {
    await db.query(`insert into notifications (id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6)`, [
      crypto.randomUUID(),
      userId,
      n.kind,
      n.title.slice(0, 140),
      n.body ? n.body.slice(0, 300) : null,
      n.link ?? null,
    ]);
    await pushToUser(db, userId, { title: n.title, body: n.body ?? "", url: n.link ?? "/notifications" });
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
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, created_at: new Date(r.created_at).toISOString(), read: r.read_at !== null }));
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]);
  return rows[0]?.n ?? 0;
}

/** Marks some (or all) of a person's notifications read. */
export async function markRead(db: Db, userId: string, ids: string[] | "all"): Promise<number> {
  const { rows } =
    ids === "all"
      ? await db.query(`update notifications set read_at = now() where user_id = $1 and read_at is null returning id`, [userId])
      : await db.query(`update notifications set read_at = now() where user_id = $1 and id = any($2) and read_at is null returning id`, [userId, ids]);
  return rows.length;
}
