/**
 * After Dark learning from its viewers (David, 2026-10-24: "allow users to score … and use that as training data for the
 * next run on the same character … we need to train to get better results"). Not a dataset and not a trained model (the
 * privacy page promises After Dark never goes into one: docs/data-plan.md): a viewer's own ratings steer that viewer's own
 * next pictures and videos of the same character, and go when the picture or the character does.
 *
 *  - A rating is 👍/👎 on one of their pictures or videos, with what was off (lib/adult/rating-tags.ts).
 *  - The face they keep: the one they picked ("Use this face"), else their own best-rated baseline, else the admins'
 *    newest (faceReferenceId). Every keyframe and video of the character starts from it (lib/adult/reels.ts baselines),
 *    and fal's face-reference pictures too (lib/adult/media.ts).
 *  - What was off becomes fixed words (steeringFor): a tag on any 👎 among their last dozen ratings of the character's
 *    pictures adds its fix to the next picture's prompt or negative prompt; on their videos, to the next shot's.
 *  - Which light and lens suits the character (choosePreset): a Thompson-sampling test over PICTURE_PRESETS, scored by
 *    their 👍 and 👎 on that character's pictures, and by the faces they pick from "Draw three" (the two passed over
 *    count half a 👎 each).
 *  - What it's learned shows on the page (steerSummary), and "Start fresh" (resetSteering) sets it aside without deleting
 *    a rating: those from before stop counting for that character.
 */
import { loadCharacter } from "../character";
import type { Db } from "../db";
import { nudeSql, wearsSomething } from "./attire";
import { PICTURE_PRESETS, TAG_FIXES, tagsFor, type PresetId, type RatingTag } from "./rating-tags";

/** How many of a viewer's newest ratings of a character's pictures (and, apart, of their videos) steer the next one. */
export const STEER_WINDOW = 12;

export type Steering = { tags: RatingTag[]; positive: string[]; negative: string[]; video: string[] };
export const NO_STEERING: Steering = { tags: [], positive: [], negative: [], video: [] };

/** A picture or video the viewer may rate or pick: theirs, or anyone's for an admin. `$1` is the media id, `$2` the viewer. */
const MEDIA_FOR_VIEWER = `select kind, character_id, character_b, status, (kind = 'baseline' and ${nudeSql("adult_images")}) as nude from adult_images
  where id = $1 and (owner_id = $2 or exists (select 1 from admins a where a.user_id = $2))`;

export type RateResult = { ok: true; rating: -1 | 0 | 1; tags: string[] } | { ok: false; status: number; error: string; message: string };

/**
 * Sets the viewer's rating of one of their pictures or videos: 1 (👍) or -1 (👎) with what was off, or 0 to take it back.
 * Tags outside the picture's or video's own list are dropped; a 👍 keeps none.
 */
export async function rateMedia(db: Db, viewerId: string, mediaId: string, rating: -1 | 0 | 1, tags: string[] = []): Promise<RateResult> {
  const m = (await db.query<{ kind: string; status: string }>(MEDIA_FOR_VIEWER, [mediaId, viewerId])).rows[0];
  if (!m || m.status !== "ready" || !["baseline", "scene", "video"].includes(m.kind)) return { ok: false, status: 404, error: "not_found", message: "No picture or video of yours with that id." };
  if (rating === 0) {
    await db.query(`delete from adult_media_thumbs where owner_id = $1 and media_id = $2`, [viewerId, mediaId]);
    return { ok: true, rating: 0, tags: [] };
  }
  const allowed = tagsFor(m.kind);
  const kept = rating < 0 ? [...new Set(tags.filter((t) => t in allowed))] : [];
  await db.query(
    `insert into adult_media_thumbs (owner_id, media_id, rating, tags) values ($1, $2, $3, $4::jsonb)
     on conflict (owner_id, media_id) do update set rating = excluded.rating, tags = excluded.tags, updated_at = now()`,
    [viewerId, mediaId, rating, JSON.stringify(kept)],
  );
  return { ok: true, rating, tags: kept };
}

/** The viewer's ratings of these pictures and videos, by id. */
export async function ratingsFor(db: Db, viewerId: string, mediaIds: string[]): Promise<Map<string, { rating: -1 | 1; tags: string[] }>> {
  if (!mediaIds.length) return new Map();
  const { rows } = await db.query<{ media_id: string; rating: -1 | 1; tags: string[] }>(
    `select media_id, rating, tags from adult_media_thumbs where owner_id = $1 and media_id = any($2)`,
    [viewerId, mediaIds],
  );
  return new Map(rows.map((r) => [r.media_id, { rating: r.rating, tags: r.tags ?? [] }]));
}

/**
 * What this viewer's ratings say to their next picture or video of these characters (one, or a pair): every tag on a 👎
 * among their newest STEER_WINDOW ratings, with its fix (lib/adult/rating-tags.ts TAG_FIXES). Pictures steer pictures
 * and videos steer videos: a picture's fixes come from their ratings of pictures with any of them in, a shot's from their
 * ratings of videos, so picking a face (a 👍 on a picture) never quiets what they said about a video. A 👎 keeps steering
 * past a 👍 on the next one (the fix worked) until a dozen newer ratings push it out, or it's changed.
 */
export async function steeringFor(db: Db, viewerId: string, characterIds: (string | null | undefined)[]): Promise<Steering> {
  const ids = characterIds.filter((x): x is string => Boolean(x));
  if (!ids.length) return NO_STEERING;
  const { rows } = await db.query<{ video: boolean; rating: number; tags: string[] }>(
    `select video, rating, tags from (
       select i.kind = 'video' as video, r.rating, r.tags, row_number() over (partition by i.kind = 'video' order by r.updated_at desc) as n
         from adult_media_thumbs r join adult_images i on i.id = r.media_id
         ${SINCE_RESETS}
        where r.owner_id = $1 and (i.character_id = any($2) or i.character_b = any($2)) and ${COUNTS_SINCE_RESETS}
     ) newest where n <= $3`,
    [viewerId, ids, STEER_WINDOW],
  );
  const off = (video: boolean) => new Set(rows.filter((r) => r.video === video && r.rating < 0).flatMap((r) => r.tags ?? []));
  const [pictures, videos] = [off(false), off(true)];
  const all = Object.keys(TAG_FIXES) as RatingTag[];
  const fixes = (on: Set<string>, k: "positive" | "negative" | "video") => all.filter((t) => on.has(t)).map((t) => TAG_FIXES[t][k]).filter((x): x is string => Boolean(x));
  return { tags: all.filter((t) => pictures.has(t) || videos.has(t)), positive: fixes(pictures, "positive"), negative: fixes(pictures, "negative"), video: fixes(videos, "video") };
}

/**
 * "Start fresh" (resetSteering): a rating counts only if it was made after the viewer's reset of every character in the
 * picture. SQL for a query over `adult_media_thumbs r join adult_images i`.
 */
const SINCE_RESETS = `left join adult_steer_resets ra on ra.owner_id = r.owner_id and ra.character_id = i.character_id
         left join adult_steer_resets rb on rb.owner_id = r.owner_id and rb.character_id = i.character_b`;
const COUNTS_SINCE_RESETS = `r.updated_at > coalesce(ra.reset_at, '-infinity'::timestamptz) and r.updated_at > coalesce(rb.reset_at, '-infinity'::timestamptz)`;

/** Whether the viewer 👎'd this picture or video (a beat picture they 👎'd doesn't start a shot: lib/adult/beats.ts). */
export async function thumbsDown(db: Db, viewerId: string, mediaId: string): Promise<boolean> {
  return (await db.query(`select 1 from adult_media_thumbs where owner_id = $1 and media_id = $2 and rating < 0`, [viewerId, mediaId])).rows.length > 0;
}

/** "Start fresh": what this viewer's ratings of the character steer is set aside from now (nothing is deleted). */
export async function resetSteering(db: Db, viewerId: string, characterId: string): Promise<void> {
  await db.query(
    `insert into adult_steer_resets (owner_id, character_id) values ($1, $2) on conflict (owner_id, character_id) do update set reset_at = now()`,
    [viewerId, characterId],
  );
}

export type SteerSummary = { avoid: RatingTag[]; light: PresetId | null };

/**
 * What the viewer's ratings steer for each character, for the page (David's competitor research, 2026-10-24: show it,
 * and let them reset it): the tags it steers away from, and the light that has done best (a preset with a 👍, by its
 * mean), or null while there's nothing to go on.
 */
export async function steerSummary(db: Db, viewerId: string, characterIds: string[]): Promise<Record<string, SteerSummary>> {
  const out: Record<string, SteerSummary> = {};
  for (const id of characterIds) {
    const [steer, tally] = await Promise.all([steeringFor(db, viewerId, [id]), presetTally(db, viewerId, id)]);
    const lit = PICTURE_PRESETS.filter((p) => tally[p.id].up > 0).sort((p, q) => mean(tally[q.id]) - mean(tally[p.id]));
    out[id] = { avoid: steer.tags, light: lit[0]?.id ?? null };
  }
  return out;
}
const mean = (t: { up: number; down: number }) => (1 + t.up) / (2 + t.up + t.down);

/** A picture prompt with the viewer's fixes in, before the closing words about adults (the prompt's last sentence). */
export function withSteering(prompt: string, steer: Steering, presetWords: string | null = null): string {
  const extra = [presetWords, steer.positive.length ? `${cap(steer.positive.join(", "))}.` : null].filter(Boolean).join(" ");
  if (!extra) return prompt;
  const closing = /\s*Everyone shown is an adult\.\s*$/;
  return closing.test(prompt) ? prompt.replace(closing, ` ${extra} Everyone shown is an adult.`) : `${prompt} ${extra}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------- the face ------------------------------------------------- */

/**
 * The picture of a character this viewer's pictures and videos keep the face from:
 *  1. the one they picked ("Use this face"), while it's still there;
 *  2. else their own 👍 baseline, newest first; else their own newest baseline they haven't 👎'd;
 *  3. else the admins' newest baseline they haven't 👎'd (a subscriber's redraw never changes anyone else's face);
 *  4. else any baseline, the newest.
 * A dressed baseline comes before a nude one in 2 to 4: a character who wears something keeps it on until they undress.
 * `nude`, for an undressed moment: only a nude baseline (lib/adult/attire.ts). The nude face they picked, else the face
 * they picked if it's nude, else the nude one edited from their face (lib/adult/media.ts ensureNudeBaseline makes it), and
 * never another: null when there's none yet, and the caller keeps the dressed face. With no face at all, or a nude one,
 * the same order among nude baselines.
 */
export async function faceReferenceId(db: Db, viewerId: string, characterId: string, opts: { nude?: boolean } = {}): Promise<string | null> {
  const nude = opts.nude === true;
  const onlyNude = nude ? ` and ${nudeSql("i")}` : "";
  const pickedIn = async (table: "adult_face_refs" | "adult_nude_refs") =>
    (
      await db.query<{ image_id: string }>(
        `select f.image_id from ${table} f join adult_images i on i.id = f.image_id and i.status = 'ready'${onlyNude}
          where f.owner_id = $1 and f.character_id = $2`,
        [viewerId, characterId],
      )
    ).rows[0]?.image_id ?? null;
  const picked = nude ? ((await pickedIn("adult_nude_refs")) ?? (await pickedIn("adult_face_refs"))) : await pickedIn("adult_face_refs");
  if (picked) return picked;
  // Undressed, next the nude one edited from the face they keep (lib/adult/media.ts ensureNudeBaseline), unless 👎'd.
  const face = nude ? await faceReferenceId(db, viewerId, characterId) : null;
  if (face) {
    const fromFace = (
      await db.query<{ id: string }>(
        `select i.id from adult_images i left join adult_media_thumbs r on r.media_id = i.id and r.owner_id = $1
          where i.source_image = $2 and i.kind = 'baseline' and i.status = 'ready' and ${nudeSql("i")} and coalesce(r.rating, 0) >= 0
          order by i.created_at desc limit 1`,
        [viewerId, face],
      )
    ).rows[0]?.id;
    if (fromFace) return fromFace;
    // Never another nude picture of them instead (one drawn from words is someone else; 2026-10-26): with none made from
    // their face, null, and the caller keeps the dressed face. The same person in their clothes beats a stranger.
    const faceNude = (await db.query<{ nude: boolean }>(`select ${nudeSql("i")} as nude from adult_images i where i.id = $1`, [face])).rows[0]?.nude;
    if (!faceNude) return null;
  }
  const { rows } = await db.query<{ id: string }>(
    `select i.id from adult_images i
      left join adult_media_thumbs r on r.media_id = i.id and r.owner_id = $1
      where i.character_id = $2 and i.character_b is null and i.kind = 'baseline' and i.status = 'ready'${onlyNude}
      order by (coalesce(r.rating, 0) < 0),
               ${nudeSql("i")},
               ((i.owner_id = $1) and coalesce(r.rating, 0) > 0) desc,
               (i.owner_id = $1) desc,
               exists (select 1 from admins a where a.user_id = i.owner_id) desc,
               i.created_at desc
      limit 1`,
    [viewerId, characterId],
  );
  return rows[0]?.id ?? null;
}

/** One character's faces for a viewer: the one everything keeps, and for a character who wears something, the nude one. */
export type FaceInfo = {
  image_id: string | null;
  picked: boolean;
  /** `from_face`: the nude one was made from the face above (an edit of it), so it's the same person. */
  nude: { image_id: string | null; picked: boolean; from_face: boolean } | null;
};

/** Each character's faces for this viewer (faceReferenceId), and whether they picked them, for the page's faces panel. */
export async function facesFor(db: Db, viewerId: string, characterIds: string[]): Promise<Record<string, FaceInfo>> {
  const pickedIn = async (table: "adult_face_refs" | "adult_nude_refs") =>
    new Set(
      (
        await db.query<{ character_id: string }>(
          `select f.character_id from ${table} f join adult_images i on i.id = f.image_id and i.status = 'ready' where f.owner_id = $1 and f.character_id = any($2)`,
          [viewerId, characterIds],
        )
      ).rows.map((r) => r.character_id),
    );
  const [picked, pickedNude] = [await pickedIn("adult_face_refs"), await pickedIn("adult_nude_refs")];
  const out: Record<string, FaceInfo> = {};
  for (const id of characterIds) {
    const c = await loadCharacter(db, id);
    const dressed = c ? wearsSomething(c, viewerId) : false;
    const face = await faceReferenceId(db, viewerId, id);
    const nudeId = dressed ? await faceReferenceId(db, viewerId, id, { nude: true }) : null;
    const fromFace = nudeId && face ? (await db.query(`select 1 from adult_images where id = $1 and source_image = $2`, [nudeId, face])).rows.length > 0 : false;
    out[id] = {
      image_id: face,
      picked: picked.has(id),
      nude: dressed ? { image_id: nudeId, picked: pickedNude.has(id), from_face: fromFace } : null,
    };
  }
  return out;
}

export type FaceResult = { ok: true; image_id: string | null; nude?: boolean } | { ok: false; status: number; error: string; message: string };

/**
 * "Use this face": one of the viewer's pictures of the character alone (a baseline, or a scene picture of just them)
 * becomes the face their pictures and videos of the character keep. Picking a face is also a 👍 on it. For a character
 * who wears something, a nude baseline picked is the face of their undressed moments instead (`adult_nude_refs`), and
 * the face for everything else stays. `imageId` null goes back to the default (faceReferenceId's 2 to 4), for the nude
 * face with `nude`.
 */
export async function setFaceReference(
  db: Db,
  viewerId: string,
  characterId: string,
  imageId: string | null,
  rivals: string[] = [],
  opts: { nude?: boolean } = {},
): Promise<FaceResult> {
  if (imageId === null) {
    await db.query(`delete from ${opts.nude ? "adult_nude_refs" : "adult_face_refs"} where owner_id = $1 and character_id = $2`, [viewerId, characterId]);
    return { ok: true, image_id: await faceReferenceId(db, viewerId, characterId, opts), nude: opts.nude === true };
  }
  const m = (await db.query<{ kind: string; character_id: string | null; character_b: string | null; status: string; nude: boolean }>(MEDIA_FOR_VIEWER, [imageId, viewerId])).rows[0];
  if (!m || m.status !== "ready" || !["baseline", "scene"].includes(m.kind) || m.character_id !== characterId || m.character_b) {
    return { ok: false, status: 404, error: "not_found", message: "Pick one of your pictures of them alone." };
  }
  const c = m.nude ? await loadCharacter(db, characterId) : null;
  const table = c && wearsSomething(c, viewerId) ? "adult_nude_refs" : "adult_face_refs";
  // A new face: the nude one picked before was of the old one, so it goes, and the nude face follows the new face.
  if (table === "adult_face_refs") await db.query(`delete from adult_nude_refs where owner_id = $1 and character_id = $2`, [viewerId, characterId]);
  await db.query(
    `insert into ${table} (owner_id, character_id, image_id) values ($1, $2, $3)
     on conflict (owner_id, character_id) do update set image_id = excluded.image_id, set_at = now()`,
    [viewerId, characterId, imageId],
  );
  await db.query(`insert into adult_media_thumbs (owner_id, media_id, rating) values ($1, $2, 1) on conflict (owner_id, media_id) do nothing`, [viewerId, imageId]);
  await recordLightPick(db, viewerId, characterId, imageId, rivals);
  return { ok: true, image_id: imageId, nude: table === "adult_nude_refs" };
}

/**
 * A face picked from "Draw three" is a ranking of the lights: the kept one's 👍 already counts, and each light passed over
 * counts half a 👎 (half, because the pick is of the face as much as the light). Only the viewer's own baselines of the
 * character alone, with a preset, count as rivals.
 */
async function recordLightPick(db: Db, viewerId: string, characterId: string, imageId: string, rivals: string[]): Promise<void> {
  const others = [...new Set(rivals.filter((r) => r !== imageId))].slice(0, 4);
  if (!others.length) return;
  const { rows } = await db.query<{ id: string; preset: string }>(
    `select id, preset from adult_images where id = any($1) and owner_id = $2 and character_id = $3 and character_b is null
        and kind = 'baseline' and status = 'ready' and preset is not null`,
    [[imageId, ...others], viewerId, characterId],
  );
  const picked = rows.find((r) => r.id === imageId)?.preset;
  if (!picked) return;
  const passed = [...new Set(rows.filter((r) => r.id !== imageId).map((r) => r.preset))].filter((p) => p !== picked);
  if (!passed.length) return;
  await db.query(`insert into adult_light_picks (owner_id, character_id, picked, passed) values ($1, $2, $3, $4::jsonb)`, [viewerId, characterId, picked, JSON.stringify(passed)]);
}

/* ------------------------------------------------- the presets ------------------------------------------------- */

/** A standard normal draw (Box-Muller), from `rng` (uniform in [0, 1)). */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
/** A Gamma(shape, 1) draw (Marsaglia and Tsang). */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
/** A Beta(a, b) draw. */
export function betaSample(a: number, b: number, rng: () => number = Math.random): number {
  const x = gamma(a, rng);
  return x / (x + gamma(b, rng));
}

/**
 * Each preset's 👍 and 👎 from this viewer on this character's pictures, plus half a 👎 for each light passed over in a
 * "Draw three" pick; since their last "Start fresh".
 */
export async function presetTally(db: Db, viewerId: string, characterId: string): Promise<Record<PresetId, { up: number; down: number }>> {
  const out = Object.fromEntries(PICTURE_PRESETS.map((p) => [p.id, { up: 0, down: 0 }])) as Record<PresetId, { up: number; down: number }>;
  const { rows } = await db.query<{ preset: string; rating: number }>(
    `select i.preset, r.rating from adult_media_thumbs r join adult_images i on i.id = r.media_id
       left join adult_steer_resets z on z.owner_id = r.owner_id and z.character_id = i.character_id
      where r.owner_id = $1 and i.character_id = $2 and i.character_b is null and i.kind in ('baseline', 'scene') and i.preset is not null
        and r.updated_at > coalesce(z.reset_at, '-infinity'::timestamptz)`,
    [viewerId, characterId],
  );
  for (const r of rows) {
    const p = out[r.preset as PresetId];
    if (p) p[r.rating > 0 ? "up" : "down"]++;
  }
  const picks = await db.query<{ passed: string[] }>(
    `select p.passed from adult_light_picks p left join adult_steer_resets z on z.owner_id = p.owner_id and z.character_id = p.character_id
      where p.owner_id = $1 and p.character_id = $2 and p.created_at > coalesce(z.reset_at, '-infinity'::timestamptz)`,
    [viewerId, characterId],
  );
  for (const pick of picks.rows) {
    for (const id of pick.passed ?? []) {
      const p = out[id as PresetId];
      if (p) p.down += 0.5;
    }
  }
  return out;
}

/** The preset for the viewer's next picture of the character: each one's Beta(1 + 👍, 1 + 👎) drawn once, the highest goes. */
export async function choosePreset(db: Db, viewerId: string, characterId: string, rng: () => number = Math.random): Promise<(typeof PICTURE_PRESETS)[number]> {
  const t = await presetTally(db, viewerId, characterId);
  let best: { p: (typeof PICTURE_PRESETS)[number]; draw: number } | null = null;
  for (const p of PICTURE_PRESETS) {
    const draw = betaSample(1 + t[p.id].up, 1 + t[p.id].down, rng);
    if (!best || draw > best.draw) best = { p, draw };
  }
  return best!.p;
}
