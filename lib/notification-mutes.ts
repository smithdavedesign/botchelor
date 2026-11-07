/**
 * Muting a notification type (David 2026-11-07, UX round: "mute a type"). A muted type (lib/notification-types.ts)
 * still lands in the inbox so the history is whole, but already read: it doesn't light the bell, push, email, or join
 * the daily digest (lib/notifications.ts notify). One row a muted type a person; no row = on.
 */
import type { Db } from "./db";
import { NOTIFICATION_TYPES, type NotificationType } from "./notification-types";

/** The types someone has muted, in the catalogue's order. */
export async function mutedTypes(db: Db, userId: string): Promise<NotificationType[]> {
  const { rows } = await db.query<{ type: string }>(`select type from notification_mutes where user_id = $1`, [userId]);
  const set = new Set(rows.map((r) => r.type));
  return NOTIFICATION_TYPES.filter((t) => set.has(t));
}

/** Mutes (or unmutes) one type for someone. */
export async function setMuted(db: Db, userId: string, type: NotificationType, muted: boolean): Promise<NotificationType[]> {
  if (muted) await db.query(`insert into notification_mutes (user_id, type) values ($1, $2) on conflict do nothing`, [userId, type]);
  else await db.query(`delete from notification_mutes where user_id = $1 and type = $2`, [userId, type]);
  return mutedTypes(db, userId);
}
