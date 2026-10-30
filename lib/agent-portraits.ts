/**
 * Portraits for the public agent-made characters who have none (David, 2026-10-29: 68 of them had no safe portrait, so
 * no living portrait for the reels either, and "do these"). The show draws one, as it draws a season newcomer's
 * (lib/season-gen.ts makePortrait):
 *
 * - **From what the character is:** their own written look when there is one; otherwise their age, their pronouns and
 *   their bio (what they do), never their name. Nothing typed by anyone but their creator goes in.
 * - **Safe:** Venice's safe mode, then the strict PG check with its age question (lib/adult/moderation.ts checkRating,
 *   not Hive's capped allowance); only a PG picture is kept. Recorded and approved in the asset ledger as the show's
 *   own drawing, so their creator can replace it any time (their portrait route).
 * - **Once:** a character with any portrait, kept or pending, is never drawn again here; one that failed is recorded
 *   in show_portrait_tries and left for its creator.
 */
import type { Db } from "./db";
import { recordAsset, reviewAsset } from "./assets";
import { loadCharacter, type Character } from "./character";
import { checkRating } from "./adult/moderation";
import { physicalLook, venicePicture } from "./adult/media";
import { checkPgPictureText } from "./safety";
import { portraitPrompt } from "./season-gen";
import { DELETED_OWNER } from "./rules";

export const PORTRAIT_BATCH = 8;
const AT_ONCE = 4;
export const SHOW_PORTRAIT_VERSION = "show-portrait-v1";

/** Who they are, for the picture: their written look, or else their age, pronouns and what they do. */
export function lookFor(c: Pick<Character, "age" | "bio" | "pronouns" | "look"> & { id: string }): string | null {
  const written = (c.look.physical ?? "").trim() || physicalLook(c as Character);
  if (written.split(/\s+/).length >= 3) return written;
  const who = c.pronouns === "she/her" ? "a woman" : c.pronouns === "he/him" ? "a man" : "a person";
  const bio = c.bio.trim().replace(/\.$/, "");
  if (!bio) return null;
  // "Pilot who flies rescue missions…" → "a man, a pilot who flies rescue missions…, dressed for it".
  const what = /^(an?|the)\s/i.test(bio) ? bio.replace(/^(An?|The)\s/, (m) => m.toLowerCase()) : `${/^[aeiou]/i.test(bio) ? "an" : "a"} ${bio[0].toLowerCase()}${bio.slice(1)}`;
  return `${who} of ${c.age}, ${what}, in everyday clothes that suit it`;
}

/** The public agent-made characters with no portrait at all, and none tried yet. */
export async function portraitTargets(db: Db, limit = 1000): Promise<string[]> {
  return (
    await db.query<{ id: string }>(
      `select ch.id from characters ch
        where ch.created_via = 'mcp' and ch.visibility = 'public' and not ch.is_house
          -- Never one taken off the show (lib/account.ts adminRemoveCharacters, or its owner's delete).
          and ch.owner_id is distinct from '${DELETED_OWNER}'
          and not exists (select 1 from character_assets a where a.character_id = ch.id and a.kind = 'portrait')
          and not exists (select 1 from show_portrait_tries t where t.character_id = ch.id)
        order by ch.created_at desc limit $1`,
      [limit],
    )
  ).rows.map((r) => r.id);
}

export type PortraitTry = { character_id: string; ok: true; asset_id: string } | { character_id: string; ok: false; reason: string; again: boolean };

/** One character's portrait, drawn, checked, kept. Never throws. */
export async function drawShowPortrait(db: Db, characterId: string): Promise<PortraitTry> {
  const failed = async (reason: string, again = false): Promise<PortraitTry> => {
    if (!again) await db.query(`insert into show_portrait_tries (character_id, note) values ($1, $2) on conflict (character_id) do nothing`, [characterId, reason.slice(0, 200)]);
    return { character_id: characterId, ok: false, reason, again };
  };
  const c = await loadCharacter(db, characterId);
  if (!c) return failed("no such character");
  const look = lookFor(c);
  if (!look) return failed("nothing written about them to draw from");
  const prompt = portraitPrompt(look, c.age);
  if (!checkPgPictureText({ prompt }).ok) return failed("their words don't pass the show's PG word check");
  let pic: { bytes: Buffer; mime: string };
  try {
    pic = await venicePicture(db, prompt, { safe: true });
  } catch (err) {
    // Venice busy or out: nothing kept, tried again next time.
    return failed(err instanceof Error ? err.message.slice(0, 160) : "error", true);
  }
  const v = await checkRating(db, { base64: pic.bytes.toString("base64"), mime: pic.mime });
  if (!v.ok) return failed(v.reason, !v.checked);
  if (v.rating !== "pg") return failed("the PG check rated it suggestive");
  const assetId = await recordAsset(db, {
    character_id: characterId,
    kind: "portrait",
    source_type: "generated",
    source_model: "venice",
    prompt,
    prompt_version: SHOW_PORTRAIT_VERSION,
    url: `data:${pic.mime};base64,${pic.bytes.toString("base64")}`,
    // Venice's safe mode, and the PG check passed it.
    content_rating: "pg",
  });
  await reviewAsset(db, assetId, "approved", "the show's own portrait: drawn from their look or bio in safe mode, PG-checked");
  return { character_id: characterId, ok: true, asset_id: assetId };
}

/** The next few portraits. `left`: how many are still to try after these. */
export async function portraitBatch(db: Db, size = PORTRAIT_BATCH): Promise<{ ok: true; results: PortraitTry[]; left: number }> {
  const todo = await portraitTargets(db, size);
  const results: PortraitTry[] = [];
  for (let i = 0; i < todo.length; i += AT_ONCE) results.push(...(await Promise.all(todo.slice(i, i + AT_ONCE).map((id) => drawShowPortrait(db, id)))));
  return { ok: true, results, left: (await portraitTargets(db)).length };
}
