/**
 * The margin guard (docs/after-dark.md #5): a monthly cap on each person's scene writes, pictures, clips and voiced lines
 * (lib/adult/voice-lines.ts: a line made once, a replay free), so a subscriber can't cost more than they pay. Admins
 * aren't capped. The caps are in after dark's settings (cap_writes 300, cap_pictures 30, cap_clips 5, cap_voice_lines 2000).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";

export type UsageKind = "writes" | "pictures" | "clips" | "voice_lines";
const LABEL: Record<UsageKind, string> = { writes: "scene steps", pictures: "pictures", clips: "clips", voice_lines: "voiced lines" };

export const monthOf = (d: Date = new Date()) => d.toISOString().slice(0, 7);

/** Null when there's room; otherwise the sentence to show. Admins always have room. */
export async function overCap(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date()): Promise<string | null> {
  if (await isAdmin(db, ownerId)) return null;
  const cap = (await db.query<Record<string, number>>(`select cap_${kind} as cap from adult_settings where id = 1`)).rows[0]?.cap ?? 0;
  const used = (await db.query<{ n: number }>(`select ${kind} as n from adult_usage where owner_id = $1 and month = $2`, [ownerId, monthOf(now)])).rows[0]?.n ?? 0;
  return used >= cap ? `You've used this month's ${cap} ${LABEL[kind]}. They reset on the 1st.` : null;
}

/** How many of a kind are left this month: null for an admin (never capped). */
export async function usageLeft(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date()): Promise<number | null> {
  if (await isAdmin(db, ownerId)) return null;
  const cap = (await db.query<Record<string, number>>(`select cap_${kind} as cap from adult_settings where id = 1`)).rows[0]?.cap ?? 0;
  const used = (await db.query<{ n: number }>(`select ${kind} as n from adult_usage where owner_id = $1 and month = $2`, [ownerId, monthOf(now)])).rows[0]?.n ?? 0;
  return Math.max(0, cap - used);
}

export async function countUse(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date()): Promise<void> {
  await db.query(
    `insert into adult_usage (owner_id, month, ${kind}) values ($1, $2, 1)
     on conflict (owner_id, month) do update set ${kind} = adult_usage.${kind} + 1`,
    [ownerId, monthOf(now)],
  );
}
