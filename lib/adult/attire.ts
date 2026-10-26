/**
 * Whether a baseline is nude or dressed (David, 2026-10-24: "if we have our character set up with underwear, their sex
 * scenes and baselines have it on no matter the situation … in sex scenes we need a new baseline since they are supposed
 * to be naked"). A baseline is drawn in the outfit its character picked (lib/adult/media.ts baselinePrompt), and every
 * picture of the two of them is an edit of their baselines, which keeps what they wear. So a character who wears
 * something gets a second, nude baseline for undressed moments (lib/adult/reels.ts nudeBaselines).
 *
 * Stored on a baseline as `attire` since 2026-10-24. Older rows are read from their prompt: a nude baseline's says
 * ". Nude, alone," and a dressed one's says "Wearing …".
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { looksPictureWords } from "../looks";

export type Attire = "nude" | "dressed";

/** Whether a character's baseline is drawn in something (an outfit they picked), so they need a nude one too. */
export const wearsSomething = (c: Character, viewer?: string | null): boolean => Boolean(looksPictureWords(c.extras?.looks, Boolean(viewer) && c.ownerId === viewer).outfit);

/** The words only a nude baseline's prompt has (baselinePrompt). */
const NUDE_WORDS = /\.\s*Nude, alone,/;

/** A new picture's attire: a baseline's, from its prompt; null for anything else. */
export const attireOf = (kind: string, prompt: string): Attire | null => (kind === "baseline" ? (NUDE_WORDS.test(prompt) ? "nude" : "dressed") : null);

/** SQL: the row of adult_images aliased `a` is a nude baseline's (stored, or read from the prompt for older rows). */
export const nudeSql = (a: string) => `coalesce(${a}.attire, case when ${a}.prompt like '%. Nude, alone,%' then 'nude' else 'dressed' end) = 'nude'`;

/** What a picture's prompt says when it shows them nude, and when it kept or put them in clothes. */
const NUDE_PROMPT = /\b(?:fully nude|nude|naked)\b/i;
const CLOTHED_PROMPT = /\bthe clothes too\b|\bwearing (?!(?:fully )?nude\b)/i;

/**
 * Whether a picture shows them nude, from what made it: a nude baseline, or a prompt that says nude and no clothes. An
 * upscale is read through to the picture it came from. Unknown is dressed (2026-10-26: Sweet's body reference was a
 * waist-up picture in a camisole, and every picture of her from sex on kept the camisole on).
 */
export async function shownNude(db: Db, id: string): Promise<boolean> {
  let at: string | null = id;
  for (let hop = 0; at && hop < 4; hop++) {
    const row: { prompt: string; attire: string | null } | undefined = (await db.query<{ prompt: string; attire: string | null }>(`select prompt, attire from adult_images where id = $1`, [at])).rows[0];
    if (!row) return false;
    if (row.attire) return row.attire === "nude";
    const from: string | null = /^Picture ([0-9a-f-]{36}), upscaled\b/.exec(row.prompt)?.[1] ?? null;
    if (!from) return NUDE_PROMPT.test(row.prompt) && !CLOTHED_PROMPT.test(row.prompt);
    at = from;
  }
  return false;
}
