/**
 * The SFW twin (the creator suite; David, 2026-10-26): one of their After Dark pictures made again safe for work, the
 * same people, place and light, fully dressed, the pose made an everyday one, for a public post. Drawn in Venice's safe
 * mode on the PG Studio's edit model (a picture its safe mode blurs is never kept) and passed by the PG check
 * (checkRating: pg or suggestive), like any PG Studio picture.
 *
 * Where it lands: a picture of their own character alone goes to the PG Studio's gallery (its rating, a link back to
 * the picture it's the twin of), where it can be a profile picture; one of two (or of the house cast) stays in After
 * Dark, also through the output check, rated pg or suggestive (lib/content-rating.ts: brought down by a check that
 * just passed). `prices.sfw_twin` tokens, admins free, given back when nothing came through. The owner's own only.
 */
import type { Db } from "../db";
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { fitRatio } from "../media-tools/image";
import { keepBytes } from "../object-store";
import { loadCharacter, type Character } from "../character";
import { isAdmin } from "../admins";
import { drawPg, pgAccess } from "../studio/pg";
import { PG_TAIL } from "../studio/pg-catalog";
import { mediaByIds, outputCheckReady, PICTURES_OFF_NOTE, signedMediaUrl, type Media } from "./media";
import { checkMedia, checkRating } from "./moderation";
import { reelCast } from "./reels";
import { adultKeys, getAdultSettings } from "./settings";
import { nounOf } from "./studio";

export type TwinResult =
  | { ok: true; where: "pg"; picture: { id: string; rating: "pg" | "suggestive" }; character_id: string; original: string }
  | { ok: true; where: "after_dark"; picture: Media; original: string }
  | { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): TwinResult => ({ ok: false, status, error, message });

/** The twin's prompt: Picture 1 again, the same people, place, light and framing, everyone dressed, an everyday pose. */
export function twinPrompt(tags: readonly string[]): string {
  const who = tags.length === 2 ? `the same two people, ${tags[0]} and ${tags[1]}` : `the same person, ${tags[0]}`;
  const faces = tags.length === 2 ? "the very same faces, hair and skin tones" : "the very same face, hair and skin tone";
  const pose = tags.length === 2 ? "a warm, everyday pose together, side by side or an arm around each other" : "a relaxed, natural, everyday pose";
  return [
    `Make Picture 1 again as a safe-for-work photograph: ${who}, ${faces}, in the same place and light, framed the same way.`,
    `Everyone in tasteful everyday clothes that suit the place, and ${pose}.`,
    tags.length === 2 ? "Two people only." : "One person only.",
    PG_TAIL,
  ].join(" ");
}

/** Who's in a twin, as its prompt names them: the one character, or the two as a reel names them (lib/adult/reels.ts). */
export function twinTags(people: readonly Character[], viewer: string): string[] {
  return people.length === 2 ? reelCast(people[0], people[1], viewer).map((p) => p.tag) : [`the ${nounOf(people[0])}`];
}

/** What a twin kept before 2026-10-29 says instead of its prompt (lib/showcase-made.ts puts the real one back). */
export const TWIN_PLACEHOLDERS: readonly string[] = ["An SFW twin of an After Dark picture", "An SFW twin"];

export async function sfwTwin(db: Db, viewer: string, mediaId: string, baseUrl: string): Promise<TwinResult> {
  const row = (
    await db.query<{ id: string; character_id: string | null; character_b: string | null; aspect: string | null; prompt: string | null }>(
      `select id, character_id, character_b, aspect, prompt from adult_images where id = $1 and owner_id = $2 and status = 'ready' and kind in ('scene', 'baseline') and mime like 'image/%'`,
      [mediaId, viewer],
    )
  ).rows[0];
  if (!row?.character_id) return fail(404, "not_found", "There's no picture of yours with that id.");
  const people = (await Promise.all([row.character_id, row.character_b].filter((x): x is string => Boolean(x)).map((id) => loadCharacter(db, id)))).filter((c): c is Character => Boolean(c));
  if (people.length !== (row.character_b ? 2 : 1)) return fail(404, "not_found", "That picture's characters aren't there any more.");
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "The SFW twin needs the Venice key in After Dark's settings.");
  // A solo picture of a character the PG Studio is open to them for goes to its gallery; anything else stays here.
  const toPg = people.length === 1 && (await pgAccess(db, viewer, people[0].id)).ok;
  if (!toPg && !(await outputCheckReady(db))) return fail(409, "not_set_up", PICTURES_OFF_NOTE);
  const settings = await getAdultSettings(db);
  const price = settings.studio.prices.sfw_twin;
  const pays = price > 0 && !(await isAdmin(db, viewer));
  if (pays && !(await spendBoughtTokens(db, viewer, price))) return fail(402, "needs_tokens", `An SFW twin is ${price} token${price === 1 ? "" : "s"}. Get more on the shop page.`);
  const back = async (status: number, error: string, message: string) => {
    if (pays) await refundBoughtTokens(db, viewer, price);
    return fail(status, error, `${message}${pays ? " Your tokens are back." : ""}`);
  };
  const prompt = twinPrompt(twinTags(people, viewer));
  const ratio = row.aspect ?? "3:4";
  let file: { bytes: Buffer; mime: string };
  try {
    file = await fitRatio(await drawPg(keys.venice, settings.studio.pg, prompt, [signedMediaUrl(row.id, baseUrl)], ratio), ratio);
  } catch (err) {
    return back(502, "not_made", `The twin couldn't be made (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
  }
  const checkable = { base64: file.bytes.toString("base64"), mime: file.mime };
  const v = await checkRating(db, checkable);
  if (!v.ok) return back(422, "not_pg", `The PG check didn't pass it (${v.reason}), so it wasn't kept.`);
  if (toPg) {
    const id = crypto.randomUUID();
    const kept = await keepBytes("studio-pg", id, file.bytes, file.mime);
    await db.query(
      `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, object_key, content_rating, clothing, model, aspect, twin_of, tags)
       values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [id, viewer, people[0].id, prompt, file.mime, kept.data, kept.object_key, v.rating, v.clothing, settings.studio.pg.edit_model, ratio, row.id, JSON.stringify([{ kind: "made", value: "twin" }])],
    );
    return { ok: true, where: "pg", picture: { id, rating: v.rating }, character_id: people[0].id, original: row.id };
  }
  // Staying in After Dark: through its output check too, like every picture it keeps.
  const verdict = await checkMedia(db, checkable, "image", { owner: viewer });
  if (!verdict.ok) return back(422, "discarded", `The safety check discarded it (${verdict.reason}).`);
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, model, level, aspect, nsfw_score, content_rating, twin_of)
     values ($1, $2, $3, $4, 'scene', $5, $6, $7, $8, 'ready', 'venice', $9, 0, $10, $11, $12, $13)`,
    [id, viewer, row.character_id, row.character_b, prompt, file.mime, kept.data, kept.object_key, settings.studio.pg.edit_model, ratio, verdict.nsfw ?? null, v.rating, row.id],
  );
  // What it shows, as it's made: who and where from the original, dressed now (stage 0); never its act or a view.
  await db.query(
    `insert into adult_media_tags (media_id, owner_id, kind, value, source)
     select $2, $3, kind, value, 'derived' from adult_media_tags where media_id = $1 and not removed and kind in ('who', 'place', 'light')
     union all select $2, $3, 'stage', '0', 'choice'
     on conflict (media_id, kind, value) do nothing`,
    [row.id, id, viewer],
  );
  await db.query(`update adult_images set tagged_at = now() where id = $1`, [id]);
  const [picture] = await mediaByIds(db, [id], viewer);
  return { ok: true, where: "after_dark", picture, original: row.id };
}
