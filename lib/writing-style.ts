/**
 * Who gets which writing style (lib/narration.ts), and what it costs them. David, 2026-11-17: "figure out how to increase
 * the token charge or cost for the user. keep it admin for now".
 *
 * Each person picks a style per side of the site, kept with their account (writing_prefs):
 *  - `show`: their show dates and their companion's scenes (PG).
 *  - `adult`: their After Dark scenes.
 * Anyone can be on "script" (it's what everyone has had); "narrated" is admins only while it's tested (stylesOpen), and a
 * stored "narrated" reads as "script" for anyone it isn't open to.
 *
 * What narrated costs (docs/writing-styles.md, "What it costs"; each pass logs its usage: episodes.generated_with
 * .narration, adult_steps.flags.narration): one extra call per 8 lines (the lines in, a beat per line out), on top of a
 * date's per-line calls, or of an After Dark step whose lines are short (so the prose is most of what comes out). The
 * prices round that up, since tokens are whole:
 *  - a narrated show date: NARRATED_DATE_EXTRA_TOKENS (1) bought token on top of the date, given back if it fails;
 *  - a story of a show date: STORY_TOKENS (1) bought token, once per date (it's kept, and free to read after);
 *  - a narrated After Dark step: NARRATED_WRITE_WEIGHT (2) of the month's scene steps (lib/adult/usage.ts cap_writes),
 *    and twice chapter_tokens for anyone who pays by the chapter;
 *  - a story of an After Dark chapter: ADULT_STORY_WRITES (2) scene steps, once per chapter;
 *  - a narrated companion scene reply: NARRATED_REPLY_WEIGHT (2) of the free day's replies (the plan stays unlimited).
 * Admins pay none of it, as with everything else.
 */
import { isAdmin } from "./admins";
import type { Db } from "./db";
import { styleOf, type WritingStyle } from "./narration";

export const STYLE_SIDES = ["show", "adult"] as const;
export type StyleSide = (typeof STYLE_SIDES)[number];
export const isStyleSide = (x: unknown): x is StyleSide => typeof x === "string" && (STYLE_SIDES as readonly string[]).includes(x);

export const NARRATED_DATE_EXTRA_TOKENS = 1;
export const STORY_TOKENS = 1;
export const NARRATED_WRITE_WEIGHT = 2;
export const ADULT_STORY_WRITES = 2;
export const NARRATED_REPLY_WEIGHT = 2;

/** Whether the narrated style (and stories) are open to this person: admins only while it's tested. */
export async function stylesOpen(db: Db, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  return isAdmin(db, userId).catch(() => false);
}

/** Their styles as stored (script where they never picked). */
export async function storedStyles(db: Db, userId: string): Promise<Record<StyleSide, WritingStyle>> {
  const r = (await db.query<{ show_style: string | null; adult_style: string | null }>(`select show_style, adult_style from writing_prefs where user_id = $1`, [userId])).rows[0];
  return { show: styleOf(r?.show_style), adult: styleOf(r?.adult_style) };
}

/** The style their new dates or scenes on `side` are written in: what they picked, while it's open to them. */
export async function styleFor(db: Db, userId: string | null | undefined, side: StyleSide): Promise<WritingStyle> {
  if (!userId) return "script";
  const stored = (await storedStyles(db, userId).catch(() => null))?.[side] ?? "script";
  if (stored === "script") return "script";
  return (await stylesOpen(db, userId)) ? stored : "script";
}

/** Sets their style on one side. False when it isn't open to them (script is always allowed). */
export async function setStyle(db: Db, userId: string, side: StyleSide, style: WritingStyle): Promise<boolean> {
  if (style !== "script" && !(await stylesOpen(db, userId))) return false;
  const col = side === "show" ? "show_style" : "adult_style";
  await db.query(
    `insert into writing_prefs (user_id, ${col}) values ($1, $2) on conflict (user_id) do update set ${col} = excluded.${col}, updated_at = now()`,
    [userId, style],
  );
  return true;
}

/** What narrating costs this person on top, in bought tokens or weight: none for an admin. */
export async function extraFor(db: Db, userId: string, n: number): Promise<number> {
  if (n <= 0) return 0;
  return (await isAdmin(db, userId).catch(() => false)) ? 0 : n;
}

/** What one of their steps counts against the month's scene steps, in this style. */
export const writeWeight = (style: WritingStyle): number => (style === "narrated" ? NARRATED_WRITE_WEIGHT : 1);
/** What one of their companion scene replies counts against the free day's replies, in this style. */
export const replyWeight = (style: WritingStyle): number => (style === "narrated" ? NARRATED_REPLY_WEIGHT : 1);
