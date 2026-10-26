/**
 * The margin guard (docs/after-dark.md #5): a monthly cap on each person's scene writes, pictures, clips and voiced lines
 * (lib/adult/voice-lines.ts: a line made once, a replay free), so a subscriber can't cost more than they pay. Admins
 * aren't capped. The caps are in after dark's settings (cap_writes 300, cap_pictures 30, cap_clips 5, cap_voice_lines 2000,
 * cap_monologues 20: two sides of a night written, lib/adult/monologues.ts; reading one already written doesn't count).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";

export const USAGE_KINDS = ["writes", "pictures", "clips", "voice_lines", "monologues", "studio", "studio_byok", "upscales", "moments"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];
const LABEL: Record<UsageKind, string> = {
  writes: "scene steps",
  pictures: "pictures",
  clips: "clips",
  voice_lines: "voiced lines",
  monologues: "nights told from both sides",
  // The Studio (lib/adult/studio.ts): pictures on our models, on the owner's own key, and upscales.
  studio: "Studio pictures",
  studio_byok: "Studio pictures on your own key",
  upscales: "upscales",
  // A clip's moments (lib/adult/moments.ts): stills saved from it, and its boomerangs and loops. Free, but each still
  // takes a check, so they're counted.
  moments: "moments saved from clips",
};
/** The caps' defaults (the columns' own), for the settings page. */
export const DEFAULT_CAPS: Record<UsageKind, number> = { writes: 300, pictures: 30, clips: 5, voice_lines: 2000, monologues: 20, studio: 400, studio_byok: 1000, upscales: 50, moments: 100 };

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

export async function countUse(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date(), n = 1): Promise<void> {
  await db.query(
    `insert into adult_usage (owner_id, month, ${kind}) values ($1, $2, $3::int)
     on conflict (owner_id, month) do update set ${kind} = adult_usage.${kind} + $3::int`,
    [ownerId, monthOf(now), n],
  );
}
