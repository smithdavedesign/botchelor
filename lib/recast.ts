/**
 * The recast (David, 2026-11-02: "clean up the agent-made characters, make sure they're all very unique, have a soul and
 * extra personality, have a base image and body … fun roleplay, e.g. Pirate, President, Alien … then have them all go on
 * dates"). The show's own agent-made characters (our sims', loops' and checks' agents, never an outside visitor's, and
 * never one taken off the show) are rewritten, drawn and dated through the app's own paths, as their owner:
 *
 *  - **The sheet:** the ordinary owner edit (PATCH /api/characters/[id]), so the PG sheet check, the name rule, the soul's
 *    check and the Go deeper secrets all hold exactly as for any owner.
 *  - **The portrait:** drawn from their written look in Venice's safe mode and passed by the show's PG picture check
 *    (checkMedia "pg_image": Hive or the alternatives, as `pg_via` says), like a season newcomer's (lib/season-gen.ts),
 *    and rated clothed by the show portraits' rating check, then kept in the asset ledger as the show's own drawing. Their
 *    newest approved portrait is their face.
 *  - **The body:** the PG Studio's full-body identity view from that face (lib/studio/pg.ts showIdentityViews).
 *  - **Dates:** the deck's own ranking (lib/dating.ts findMatches) picks who suits whom; a like is the ordinary swipe
 *    (lib/swipes.ts), an answer the ordinary answer_match, and the booking /api/admin/book-date.
 */
import { recordAsset, reviewAsset } from "./assets";
import { checkMedia, checkRating, mediaGate } from "./adult/moderation";
import { venicePicture } from "./adult/media";
import { loadCharacter } from "./character";
import type { Db } from "./db";
import { lookFor } from "./agent-portraits";
import { DELETED_OWNER } from "./rules";
import { checkPgPictureText } from "./safety";
import { portraitPrompt } from "./season-gen";

export const RECAST_PORTRAIT_VERSION = "recast-portrait-v1";
/** How long a written look (characters.look: pictures only, never shown) may be. */
export const RECAST_LOOK_MAX = 300;

/**
 * The owner of a character the recast may act on: agent-made, not the house's, still on the show. Null otherwise (a
 * person's character, a house one, or one kept only for its old dates).
 */
export async function recastOwner(db: Db, characterId: string): Promise<string | null> {
  const r = await db.query<{ owner_id: string | null }>(
    `select owner_id from characters where id = $1 and created_via = 'mcp' and not is_house and owner_id is not null and owner_id <> $2`,
    [characterId, DELETED_OWNER],
  );
  return r.rows[0]?.owner_id ?? null;
}

export type RecastPortrait =
  | { ok: true; character_id: string; asset_id: string; via: string[]; prompt: string }
  | { ok: false; character_id: string; reason: string; again: boolean };

/**
 * A recast character's portrait: their look (saved first when given, PG words only), drawn in safe mode, checked by the
 * show's PG picture check, kept and approved. Never throws; `again` says a retry later may work (a busy provider, the
 * check paused) rather than the picture having been refused.
 */
export async function drawRecastPortrait(db: Db, characterId: string, look?: string | null): Promise<RecastPortrait> {
  const no = (reason: string, again = false): RecastPortrait => ({ ok: false, character_id: characterId, reason, again });
  const written = look?.trim();
  if (written) {
    if (written.length > RECAST_LOOK_MAX) return no(`the look is over ${RECAST_LOOK_MAX} characters`);
    if (!checkPgPictureText({ look: written }).ok) return no("the look's words don't pass the show's PG word check");
    await db.query(`update characters set look = $2 where id = $1`, [characterId, written]);
  }
  const c = await loadCharacter(db, characterId);
  if (!c) return no("no such character");
  const who = lookFor(c);
  if (!who) return no("nothing written about them to draw from");
  const prompt = portraitPrompt(who, c.age);
  if (!checkPgPictureText({ prompt }).ok) return no("their words don't pass the show's PG word check");
  const gate = await mediaGate(db, { pg: true });
  if (!gate.ok) return no(gate.reason, true);
  let pic: { bytes: Buffer; mime: string };
  try {
    pic = await venicePicture(db, prompt, { safe: true });
  } catch (err) {
    return no(err instanceof Error ? err.message.slice(0, 160) : "error", true);
  }
  const verdict = await checkMedia(db, { base64: pic.bytes.toString("base64"), mime: pic.mime }, "pg_image");
  if (!verdict.ok) return no(`the PG check: ${verdict.reason}`.slice(0, 200));
  // A face on every public page: clothed, not just "not nude" (the show portraits' own rating check, lib/agent-portraits.ts).
  const rated = await checkRating(db, { base64: pic.bytes.toString("base64"), mime: pic.mime });
  if (!rated.ok) return no(rated.reason, !rated.checked);
  if (rated.rating !== "pg") return no("the PG check rated it suggestive");
  const assetId = await recordAsset(db, {
    character_id: characterId,
    kind: "portrait",
    source_type: "generated",
    source_model: "venice",
    prompt,
    prompt_version: RECAST_PORTRAIT_VERSION,
    url: `data:${pic.mime};base64,${pic.bytes.toString("base64")}`,
    content_rating: "pg",
  });
  await reviewAsset(db, assetId, "approved", "the show's own portrait for the recast: drawn from their look in safe mode, PG-checked");
  return { ok: true, character_id: characterId, asset_id: assetId, via: verdict.via ?? [], prompt };
}
