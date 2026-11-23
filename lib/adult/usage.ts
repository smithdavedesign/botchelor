/**
 * The margin guard (docs/after-dark.md #5): a monthly cap on each person's scene writes, pictures, clips and voiced lines
 * (lib/adult/voice-lines.ts: a line made once, a replay free), so a subscriber can't cost more than they pay. Admins
 * aren't capped. The caps are in after dark's settings (cap_writes 300, cap_pictures 60, cap_clips 5, cap_voice_lines 2000,
 * cap_monologues 20: two sides of a night written, lib/adult/monologues.ts; reading one already written doesn't count).
 *
 * Step in's replies have their own count and cap (cap_step_in 3,000; David, 2026-11-23: "Sure sounds good"). Until then
 * they shared the night's 300 scene steps, though a night's step is six lines (0.25 to 0.5¢) and a reply is one (about
 * 0.1¢): a long conversation used the month in two evenings, on every other site in the field text is unlimited, and a
 * person who talked a lot lost their nights with it. The number is fair use, not a countdown: it's said only when it's
 * nearly gone (lib/adult/step-in-shared.ts stepsLeftLine).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { isTasting, TASTE_WRITES } from "./taste";

/** What a free taste says when its steps are used. */
export const TASTE_DONE = "That's the end of your free taste. Subscribe to carry on where you left off.";

export const USAGE_KINDS = ["writes", "step_in", "pictures", "clips", "voice_lines", "monologues", "studio", "studio_byok", "upscales", "moments", "captions"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];
const LABEL: Record<UsageKind, string> = {
  writes: "scene steps",
  // Step in (lib/adult/step-in.ts): each reply the character writes or says, regenerate and Continue included.
  step_in: "Step in replies",
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
  // Captions in a character's voice (lib/adult/captions.ts): free, a text call each.
  captions: "captions written",
};
/** The caps' defaults (the columns' own), for the settings page. Pictures 60 (#1005, David 2026-10-30: "60 pictures a month" with a subscription). */
export const DEFAULT_CAPS: Record<UsageKind, number> = { writes: 300, step_in: 3000, pictures: 60, clips: 5, voice_lines: 2000, monologues: 20, studio: 400, studio_byok: 1000, upscales: 50, moments: 100, captions: 300 };

export const monthOf = (d: Date = new Date()) => d.toISOString().slice(0, 7);

/**
 * What a free taste's own small allowance covers (lib/adult/taste.ts): everything that's written for the person, a
 * night's steps and Step in's replies alike, counted together from when the taste started.
 */
const TASTED: readonly UsageKind[] = ["writes", "step_in"];
const tasteUsed = async (db: Db, ownerId: string) => (await db.query<{ n: number }>(`select writes as n from adult_tastes where user_id = $1`, [ownerId])).rows[0]?.n ?? 0;

/** Null when there's room; otherwise the sentence to show. Admins always have room. */
export async function overCap(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date()): Promise<string | null> {
  if (await isAdmin(db, ownerId)) return null;
  // A free taste (lib/adult/taste.ts) has its own small allowance, counted from when it started.
  if (TASTED.includes(kind) && (await isTasting(db, ownerId))) return (await tasteUsed(db, ownerId)) >= TASTE_WRITES ? TASTE_DONE : null;
  const cap = (await db.query<Record<string, number>>(`select cap_${kind} as cap from adult_settings where id = 1`)).rows[0]?.cap ?? 0;
  const used = (await db.query<{ n: number }>(`select ${kind} as n from adult_usage where owner_id = $1 and month = $2`, [ownerId, monthOf(now)])).rows[0]?.n ?? 0;
  return used >= cap ? capSentence(cap, kind) : null;
}

/** What a full cap says. */
export const capSentence = (cap: number, kind: UsageKind) => `You've used this month's ${cap} ${LABEL[kind]}. They reset on the 1st.`;

/** A kind's cap (the settings'), for a caller saying why it stopped. */
export async function capOf(db: Db, kind: UsageKind): Promise<number> {
  return (await db.query<Record<string, number>>(`select cap_${kind} as cap from adult_settings where id = 1`)).rows[0]?.cap ?? 0;
}

/** How many of a kind are left this month: null for an admin (never capped). */
export async function usageLeft(db: Db, ownerId: string, kind: UsageKind, now: Date = new Date()): Promise<number | null> {
  if (await isAdmin(db, ownerId)) return null;
  // On a free taste, what's left is the taste's own (the month's number would promise far more than it gives).
  if (TASTED.includes(kind) && (await isTasting(db, ownerId))) return Math.max(0, TASTE_WRITES - (await tasteUsed(db, ownerId)));
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
  // A free taste counts what's written for it (lib/adult/taste.ts); no row, nothing changes.
  if (TASTED.includes(kind)) await db.query(`update adult_tastes set writes = writes + $2::int where user_id = $1`, [ownerId, n]);
}

/**
 * A subscriber's included clips (#1005; David, 2026-10-30: "a subscription that includes an allowance, tokens for
 * extras"): the first `allowance` clips on demand each calendar month cost no tokens (lib/adult/pricing.ts). Counted in
 * adult_usage.included_clips, apart from the clips cap (which also counts presence loops, talking moments and Studio
 * clips), so only a clip that was given free uses one up.
 */
export async function includedClipsUsed(db: Db, ownerId: string, now: Date = new Date()): Promise<number> {
  return (await db.query<{ n: number }>(`select included_clips as n from adult_usage where owner_id = $1 and month = $2`, [ownerId, monthOf(now)])).rows[0]?.n ?? 0;
}

/**
 * Takes one of this month's included clips, if one is left: the month it was taken in (to give it back to), or null when
 * they're used up. One statement, so two clips asked for at once can't both take the last one.
 */
export async function takeIncludedClip(db: Db, ownerId: string, allowance: number, now: Date = new Date()): Promise<string | null> {
  if (allowance <= 0) return null;
  const month = monthOf(now);
  const r = await db.query(
    `insert into adult_usage (owner_id, month, included_clips) values ($1, $2, 1)
     on conflict (owner_id, month) do update set included_clips = adult_usage.included_clips + 1 where adult_usage.included_clips < $3::int
     returning included_clips`,
    [ownerId, month, allowance],
  );
  return r.rows.length ? month : null;
}

/** An included clip that didn't come through, given back to the month it was taken from. */
export async function giveBackIncludedClip(db: Db, ownerId: string, month: string): Promise<void> {
  await db.query(`update adult_usage set included_clips = greatest(0, included_clips - 1) where owner_id = $1 and month = $2`, [ownerId, month]);
}
