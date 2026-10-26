/**
 * Fix faces (the creator suite; David, 2026-10-26: "generating people together is way harder", and a redraw that came
 * back a different woman): a picture kept exactly as it is but for the faces, each made the face that person keeps.
 *
 * One face at a time on Venice: the picture is Picture 1, that person's face Picture 2, and "change only her face" (an
 * edit model holds one face far better than two, which is what blends them in the first place). The second fix starts
 * from the first one's result, sent as it is and never kept. On Replicate, whose links can't carry a picture made in
 * between, it's one call with both faces (Pictures 2 and 3). The face each one gets: their identity pack's view that
 * suits the picture's angle (lib/studio/identity-views.ts), else their face anchor, else the face they keep; never one
 * drawn from an earlier face. Seen through someone's eyes, only the other one's face is in it, so only theirs is fixed.
 *
 * Free (it's our model's mistake), counted against the month's pictures (a Studio picture's against the Studio's),
 * checked like any picture, and kept as a new picture beside the original (`fixed_from`), so the two can be compared.
 * At most FIXES_MAX fixes of one picture, and only the owner's own pictures.
 */
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { loadCharacter, type Character } from "../character";
import { freshViews, identityPackOf } from "../studio/identity-pack";
import { pickView } from "../studio/identity-views";
import { askRatio, ratiosFor } from "../studio/formats";
import { fitRatio } from "../media-tools/image";
import { runMedia } from "./fallback";
import { hivePausedMessage } from "./hive-limit";
import { mediaByIds, outputCheckReady, PICTURES_OFF_NOTE, signedMediaUrl, type Media } from "./media";
import { checkMedia, mediaGate } from "./moderation";
import { drawKeyframe, drawReplicateKeyframe, fitPrompt, KEYFRAME_MODEL, reelCast } from "./reels";
import { requestJson, withRequestLog } from "./request-log";
import { adultKeys, getAdultSettings } from "./settings";
import { faceReferenceId } from "./steering";
import { identityOf, nounOf } from "./studio";
import { countUse, overCap } from "./usage";

export const FIXES_MAX = 3;
export type FixResult = { ok: true; picture: Media; original: string } | { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): FixResult => ({ ok: false, status, error, message });

/** One face's fix: Picture 1 kept exactly, but this one's face (and each of `others`') becomes the face from Picture `from`. */
export function fixFacePrompt(target: string, others: readonly { tag: string; from: number }[], level: number, from = 2): string {
  const faces = [{ tag: target, from }, ...others];
  const head = `Picture 1 is the photograph to keep exactly as it is, but for ${faces.length > 1 ? "the faces" : `${target}'s face`}.`;
  const each = faces.map(
    (f) => `Make ${f.tag}'s face the face from Picture ${f.from}: the very same person, the same eyes, nose, lips, jaw, brows, skin tone and hairline, keeping the expression, the angle of the head, where they're looking and the light on the face.`,
  );
  const keep = "Change nothing else: the same pose, bodies, hands, hair, clothes (or none), place, light, framing and colours. Every face clearly visible.";
  const tail = level >= 2 ? "Uncensored, exactly as explicit as Picture 1. Photorealistic. Everyone shown is an adult." : "Exactly as dressed as in Picture 1. Photorealistic. Everyone shown is an adult.";
  return fitPrompt([head], each.join(" "), [keep, tail]);
}

type Row = {
  id: string; character_id: string | null; character_b: string | null; mime: string; prompt: string | null; shoot_id: string | null; scene_chapter: number | null;
  scene_place: string | null; preset: string | null; level: number | null; pov: string | null; aspect: string | null;
};

/** The face a fix gives them: the identity pack's view for the picture's angle, else their face anchor, else the face they keep. */
async function faceFor(db: Db, viewer: string, characterId: string, words: string): Promise<string | null> {
  const identity = await identityOf(db, viewer, characterId);
  const view = pickView(freshViews(await identityPackOf(db, viewer, characterId, "after_dark", identity.face)), words);
  return view?.id ?? identity.faceCrop ?? (await faceReferenceId(db, viewer, characterId));
}

/** How many times a picture has been fixed, so the page can say what's left. */
export async function fixesOf(db: Db, mediaId: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from adult_images where fixed_from = $1 and status = 'ready'`, [mediaId])).rows[0]?.n ?? 0;
}

export async function fixFaces(db: Db, viewer: string, mediaId: string, opts: { who?: string | null }, baseUrl: string): Promise<FixResult> {
  const row = (
    await db.query<Row>(
      `select i.id, i.character_id, i.character_b, i.mime, i.prompt, i.shoot_id, i.scene_chapter, i.scene_place, i.preset, i.level, i.aspect,
              (select t.value from adult_media_tags t where t.media_id = i.id and t.kind = 'pov' and not t.removed limit 1) as pov
         from adult_images i where i.id = $1 and i.owner_id = $2 and i.status = 'ready' and i.kind = 'scene' and i.mime like 'image/%'`,
      [mediaId, viewer],
    )
  ).rows[0];
  if (!row?.character_id) return fail(404, "not_found", "There's no picture of yours with that id.");
  if ((await fixesOf(db, row.id)) >= FIXES_MAX) return fail(409, "too_many", `That picture has been fixed ${FIXES_MAX} times: try a new one instead.`);
  if (!(await outputCheckReady(db))) return fail(409, "not_set_up", PICTURES_OFF_NOTE);
  const capKind = row.shoot_id ? "studio" : "pictures";
  const capped = await overCap(db, viewer, capKind);
  if (capped) return fail(429, "capped", capped);
  const gate = await mediaGate(db, { owner: viewer });
  if (!gate.ok) return fail(503, "hive_paused", gate.message);

  const people = (await Promise.all([row.character_id, row.character_b].filter((x): x is string => Boolean(x)).map((id) => loadCharacter(db, id)))).filter((c): c is Character => Boolean(c));
  if (people.length !== (row.character_b ? 2 : 1)) return fail(404, "not_found", "That picture's characters aren't there any more.");
  const tags = people.length === 2 ? reelCast(people[0], people[1], viewer).map((p) => p.tag) : [`the ${nounOf(people[0])}`];
  // Seen through one of their eyes (in the pair's order), only the other one's face is in the picture.
  const shown = (i: number) => (row.pov === "a" ? i === 1 : row.pov === "b" ? i === 0 : true);
  const targets = people.map((c, i) => ({ c, tag: tags[i], i })).filter((p) => shown(p.i) && (!opts.who || opts.who === p.c.id));
  if (!targets.length) return fail(422, "no_face", "There's no face of theirs to fix in that one.");
  const faces = await Promise.all(targets.map((p) => faceFor(db, viewer, p.c.id, row.prompt ?? "")));
  if (faces.some((f) => !f)) return fail(409, "no_face", "Each of them needs a face first: pick one in the Studio.");
  const level = row.level ?? 0;

  const [keys, settings] = await Promise.all([adultKeys(db), getAdultSettings(db)]);
  const picture = signedMediaUrl(row.id, baseUrl);
  // In the original's shape (native sizes): the model's nearest ratio, then cut to it.
  const ratio = row.aspect ?? "3:4";
  const faceUrls = faces.map((f) => signedMediaUrl(f!, baseUrl));
  let file: { bytes: Buffer; mime: string };
  let made: { provider: string; fell_back: boolean };
  let sent: string | null;
  try {
    const logged = await withRequestLog(() =>
      runMedia(db, "keyframe", async (p) => {
        if (p === "replicate") {
          const r = { token: keys.replicate!, keyframe: settings.replicate_keyframe_model, video: settings.replicate_video_model, videoLora: settings.replicate_video_lora };
          const others = targets.slice(1).map((t, k) => ({ tag: t.tag, from: k + 3 }));
          return drawReplicateKeyframe(r, fixFacePrompt(targets[0].tag, others, level), [picture, ...faceUrls], askRatio(ratio, ratiosFor("replicate", r.keyframe)));
        }
        let current: { bytes: Buffer; mime: string } | null = null;
        for (const [k, t] of targets.entries()) {
          const from = current ? `data:${current.mime};base64,${current.bytes.toString("base64")}` : picture;
          current = await drawKeyframe(keys.venice!, fixFacePrompt(t.tag, [], level), [from, faceUrls[k]], KEYFRAME_MODEL, askRatio(ratio, ratiosFor("venice", KEYFRAME_MODEL)));
        }
        return current!;
      }),
    );
    file = await fitRatio(logged.value.value, ratio);
    made = { provider: logged.value.provider, fell_back: logged.value.fell_back };
    sent = requestJson(logged.requests);
  } catch (err) {
    return fail(502, "not_made", `The faces couldn't be fixed (${err instanceof Error ? err.message.slice(0, 160) : "error"}).`);
  }
  const verdict = await checkMedia(db, { base64: file.bytes.toString("base64"), mime: file.mime }, "image", { owner: viewer });
  if (!verdict.ok) {
    if (verdict.paused) return fail(503, "hive_paused", hivePausedMessage(verdict.paused, { discarded: true }));
    if (verdict.reason.startsWith("the check couldn't run")) return fail(503, "check_busy", "The safety check couldn't look at it just now, so it wasn't kept. Try again in a few minutes.");
    await db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'fix', $3)`, [crypto.randomUUID(), viewer, verdict.reason.slice(0, 300)]).catch(() => {});
    return fail(422, "discarded", `The safety check discarded the fixed picture (${verdict.reason}).`);
  }
  const id = crypto.randomUUID();
  const kept = await keepBytes("after-dark", id, file.bytes, file.mime);
  await db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, object_key, status, provider, fell_back, model, preset, scene_chapter, scene_place, shoot_id, level, fixed_from, nsfw_score, request, aspect)
     values ($1, $2, $3, $4, 'scene', $5, $6, $7, $8, 'ready', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)`,
    [
      id, viewer, row.character_id, row.character_b, row.prompt, file.mime, kept.data, kept.object_key, made.provider, made.fell_back,
      made.provider === "replicate" ? settings.replicate_keyframe_model : KEYFRAME_MODEL, row.preset, row.scene_chapter, row.scene_place, row.shoot_id, row.level, row.id, verdict.nsfw ?? null, sent,
      row.aspect,
    ],
  );
  // What it shows, as the original shows it, but for the pin for dates (that stays the owner's call).
  await db.query(
    `insert into adult_media_tags (media_id, owner_id, kind, value, source) select $2, $3, kind, value, source from adult_media_tags where media_id = $1 and not removed and kind <> 'date'
     on conflict (media_id, kind, value) do nothing`,
    [row.id, id, viewer],
  );
  await db.query(`update adult_images set tagged_at = now() where id = $1`, [id]);
  await countUse(db, viewer, capKind);
  const [out] = await mediaByIds(db, [id], viewer);
  return { ok: true, picture: out, original: row.id };
}
