/**
 * Who gets which writing style (lib/narration.ts), and what it costs them.
 *
 * Each person picks a style per side of the site, kept with their account (writing_prefs):
 *  - `show`: their show dates and their companion's scenes (PG).
 *  - `adult`: their After Dark scenes.
 * Anyone can be on "script" (it's what everyone has had). "Narrated", and making a story, are depth, and depth is sold
 * with a plan, never by the line (David, 2026-11-17: "I trust your judgment for pricing"; the roleplay audit that day:
 * everywhere else, what people pay for is a longer memory and a better writer, not per-message surcharges):
 *  - the show: the Companion Plan includes Narrated on your dates and scenes, stories of your dates, and a longer memory
 *    (lib/companion.ts DEEP_TURNS). Without the plan a date's own people can still have its story for STORY_TOKENS
 *    bought dates, like a clip; reading one that exists is free for everyone who can see the date.
 *  - After Dark: Narrated nights and chapter stories come with the subscription, at the same one scene step each as
 *    any other step (its "narrated" rollout switch opens them; admins only until then, like every new piece there).
 * The first version (2026-11-17, admins only) charged a second token a narrated date and double weight a step. Measured
 * live, narration adds about 30% to a date's or a step's model spend (docs/writing-styles.md): too little to meter.
 *
 * WRITING_STYLES (the show's switch; docs/hosting.md): unset or "members" is the plan's members and admins; "admins"
 * is admins only; "0" turns Narrated and new stories off for everyone on both sides (kept stories still read).
 */
import { isAdmin } from "./admins";
import type { Db } from "./db";
import { styleOf, type WritingStyle } from "./narration";
import { planState } from "./paid-plans";

export const STYLE_SIDES = ["show", "adult"] as const;
export type StyleSide = (typeof STYLE_SIDES)[number];

/** What a story of a show date costs someone without the plan, in bought dates (once a date; then free to read). */
export const STORY_TOKENS = 1;

type Env = Record<string, string | undefined>;
export type StylesAudience = "off" | "admins" | "members";

/** Who the show's Narrated style is open to (WRITING_STYLES). */
export function stylesAudience(env: Env = process.env): StylesAudience {
  const v = (env.WRITING_STYLES ?? "").trim().toLowerCase();
  return v === "0" || v === "off" ? "off" : v === "admins" ? "admins" : "members";
}

/** Whether they have the depth the Companion Plan sells (Narrated, stories, the longer memory): the plan, or an admin. */
export async function hasDepth(db: Db, userId: string | null | undefined, now: Date = new Date()): Promise<boolean> {
  if (!userId) return false;
  if (await isAdmin(db, userId).catch(() => false)) return true;
  return (await planState(db, userId, "companion", now).catch(() => null))?.active === true;
}

/**
 * Whether the narrated style is open to this person on a side.
 * The show: by WRITING_STYLES (the plan's members and admins, admins only, or nobody).
 * After Dark: admins, and everyone it's open to once its "narrated" rollout switch says so (`adultOpenToAll`: the caller
 * reads the switch, lib/adult/rollout.ts, since this file is the show's and never reads After Dark's settings).
 */
export async function stylesOpen(db: Db, userId: string | null | undefined, side: StyleSide = "show", opts: { adultOpenToAll?: boolean; env?: Env } = {}): Promise<boolean> {
  if (!userId) return false;
  const audience = stylesAudience(opts.env);
  if (audience === "off") return false;
  const admin = await isAdmin(db, userId).catch(() => false);
  if (admin) return true;
  if (side === "adult") return opts.adultOpenToAll === true;
  return audience === "members" && (await hasDepth(db, userId));
}

/** Their styles as stored (script where they never picked). */
export async function storedStyles(db: Db, userId: string): Promise<Record<StyleSide, WritingStyle>> {
  const r = (await db.query<{ show_style: string | null; adult_style: string | null }>(`select show_style, adult_style from writing_prefs where user_id = $1`, [userId])).rows[0];
  return { show: styleOf(r?.show_style), adult: styleOf(r?.adult_style) };
}

/** The style their new dates or scenes on `side` are written in: what they picked, while it's open to them. */
export async function styleFor(db: Db, userId: string | null | undefined, side: StyleSide, opts: { adultOpenToAll?: boolean } = {}): Promise<WritingStyle> {
  if (!userId) return "script";
  const stored = (await storedStyles(db, userId).catch(() => null))?.[side] ?? "script";
  if (stored === "script") return "script";
  return (await stylesOpen(db, userId, side, opts)) ? stored : "script";
}

/** Sets their style on one side. False when it isn't open to them (script is always allowed). */
export async function setStyle(db: Db, userId: string, side: StyleSide, style: WritingStyle, opts: { adultOpenToAll?: boolean } = {}): Promise<boolean> {
  if (style !== "script" && !(await stylesOpen(db, userId, side, opts))) return false;
  const col = side === "show" ? "show_style" : "adult_style";
  await db.query(
    `insert into writing_prefs (user_id, ${col}) values ($1, $2) on conflict (user_id) do update set ${col} = excluded.${col}, updated_at = now()`,
    [userId, style],
  );
  return true;
}

/** What making a show date's story costs this person, in bought dates: nothing with the plan (or for an admin). */
export async function storyPrice(db: Db, userId: string): Promise<number> {
  return (await hasDepth(db, userId)) ? 0 : STORY_TOKENS;
}
