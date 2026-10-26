/**
 * After Dark's captions (lib/studio/captions.ts): for one of the owner's own pictures or clips, three captions in their
 * own character's voice (the one of theirs in it; for a picture of two, theirs, not their date's), from what it shows
 * (its tags), held to After Dark's lines; a safe line held to the show's. After Dark's text model (the settings'
 * `text_model`: fast, not the scene writer). Kept on the picture; counted against the month's captions.
 */
import type { Db } from "../db";
import { checkAdultText, checkPgPictureText } from "../safety";
import { captionMessages, holdCaptions, parseCaptions, type CaptionResult, type Captions } from "../studio/captions";
import { crossesTaboo } from "./acts";
import { adultModel } from "./mode";
import { showsLabel } from "./tag-labels";
import { countUse, overCap } from "./usage";
import { sceneCharacter, voiceKitLines } from "./voice";

const fail = (status: number, error: string, message: string): CaptionResult => ({ ok: false, status, error, message });

export async function adultCaptions(db: Db, ownerId: string, mediaId: string, opts: { fresh?: boolean } = {}): Promise<CaptionResult> {
  const row = (
    await db.query<{ id: string; character_id: string | null; character_b: string | null; kind: string; captions: Captions | null; a_owner: string | null; b_owner: string | null }>(
      `select i.id, i.character_id, i.character_b, i.kind, i.captions, ca.owner_id as a_owner, cb.owner_id as b_owner
         from adult_images i left join characters ca on ca.id = i.character_id left join characters cb on cb.id = i.character_b
        where i.id = $1 and i.owner_id = $2 and i.status = 'ready' and i.kind in ('scene', 'baseline', 'video')`,
      [mediaId, ownerId],
    )
  ).rows[0];
  if (!row) return fail(404, "not_found", "There's no picture of yours with that id.");
  if (row.captions && !opts.fresh) return { ok: true, captions: row.captions };
  const capped = await overCap(db, ownerId, "captions");
  if (capped) return fail(429, "capped", capped);
  // Their own character speaks; a house character (an admin's) when that's who's in it.
  const speaker = row.character_b && row.b_owner === ownerId && row.a_owner !== ownerId ? row.character_b : row.character_id;
  const c = speaker ? await sceneCharacter(db, speaker) : null;
  if (!c) return fail(404, "not_found", "That picture's character isn't there any more.");
  const tags = (await db.query<{ kind: string; value: string }>(`select kind, value from adult_media_tags where media_id = $1 and not removed`, [row.id])).rows;
  const level = Math.max(0, ...tags.filter((t) => t.kind === "stage").map((t) => Number(t.value)).filter((n) => Number.isFinite(n)));
  const shows = showsLabel(tags) ?? (row.kind === "video" ? "a short clip" : "a photo");
  const ok = (t: string) => checkAdultText({ t }).ok && !crossesTaboo(t);
  const safeOk = (t: string) => checkPgPictureText({ t }).ok;
  const fallbackSafe = `New one of ${c.name} ✨`;
  const model = await adultModel(db);
  let held: ReturnType<typeof holdCaptions> = null;
  for (const note of [undefined, "The last reply couldn't be used: reply with the JSON object only, every caption within the rules."]) {
    const raw = await model.complete(captionMessages({ name: c.name, voice: voiceKitLines(c), shows, together: Boolean(row.character_b), spicy: level >= 1, note }), { temperature: 0.8, maxTokens: 500 }).catch(() => "");
    const parsed = parseCaptions(raw);
    held = parsed ? holdCaptions(parsed, ok, safeOk, fallbackSafe) : null;
    if (held) break;
  }
  if (!held) return fail(422, "not_written", "No captions came out that hold to the lines. Try again.");
  const captions: Captions = { ...held, voice: c.id, written_at: new Date().toISOString() };
  await db.query(`update adult_images set captions = $2::jsonb where id = $1`, [row.id, JSON.stringify(captions)]);
  await countUse(db, ownerId, "captions");
  return { ok: true, captions };
}
