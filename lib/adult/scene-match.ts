/**
 * Theater matching pictures (David, 2026-10-24: "in after dark we should show images in the theater mode if we have an
 * existing image that matches the scene or keyword. Example 'blow job' — if we have an image tagged that for the
 * character we show it"). As a scene runs, if the pair already has a Studio picture of what's happening now, the theater
 * offers it — no drawing, no spend. The match is by the act: the scene's current act (the latest position the lines
 * name, or undressing/sex by the stage; lib/adult/beats.ts positionIn) against a pair shoot's stored act
 * (adult_studio_shoots.choices.act; the two share lib/adult/acts.ts ids). The picture is a ready pair scene picture of
 * these two the owner can see, the same place preferred, newest first. Nothing fuzzy: a miss just shows nothing.
 */
import type { Db } from "../db";
import { positionIn } from "./beats";
import { eligiblePair } from "./scenes";

const UNDRESSING = 3;
const SEX = 4;
/** How many of the most recent lines to read for the act happening now. */
const RECENT = 8;

/** The act happening now: the latest position the recent lines name, else undressing or sex by the stage, else none. */
export function currentAct(lines: readonly { text: string }[], stage: number): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - RECENT); i--) {
    const p = positionIn(lines[i]?.text ?? "");
    if (p) return p;
  }
  if (stage >= SEX) return "face_to_face";
  if (stage >= UNDRESSING) return "undress";
  return null;
}

export type SceneMatch = { image_id: string; act: string } | null;

/** What's happening in the pair's scene right now: the two of them, the current act, and where (for the same-place preference). */
async function sceneNow(db: Db, ownerId: string, x: string, y: string): Promise<{ a: string; b: string; act: string; place: string | null } | null> {
  const pair = await eligiblePair(db, ownerId, x, y);
  if (!pair) return null;
  const [a, b] = pair;
  const scene = (await db.query<{ lines: { text: string }[]; stage: number; place: string | null }>(`select lines, stage, place from adult_scenes where owner_id = $1 and character_a = $2 and character_b = $3`, [ownerId, a, b])).rows[0];
  if (!scene) return null;
  const act = currentAct(scene.lines ?? [], scene.stage ?? 0);
  if (!act) return null;
  return { a, b, act, place: scene.place };
}

/**
 * A picture the pair already has of what's happening now, if any: a ready pair scene picture of these two whose pair
 * shoot was of the current act. The owner's own, or an admin's anyone's; the same place first, then newest. Null when
 * there's nothing happening yet, no scene, or no such picture.
 */
export async function sceneMatch(db: Db, ownerId: string, x: string, y: string): Promise<SceneMatch> {
  const now = await sceneNow(db, ownerId, x, y);
  if (!now) return null;
  const { a, b, act, place } = now;
  // A picture of the act the pair already has: a Studio "Together" shoot of it, OR one they drew in the theater (a beat
  // picture, lib/adult/beats.ts). Either is a ready scene picture of these two; the same place first, then newest.
  const img = (
    await db.query<{ id: string }>(
      `select id from (
         select i.id, i.scene_place as place, i.created_at
           from adult_images i join adult_studio_shoots s on s.id = i.shoot_id
          where i.kind = 'scene' and i.status = 'ready' and i.character_b is not null
            and ((i.character_id = $2 and i.character_b = $3) or (i.character_id = $3 and i.character_b = $2))
            and s.kind = 'pair' and s.choices->>'act' = $4
            and (i.owner_id = $1 or exists (select 1 from admins a where a.user_id = $1))
         union all
         select bi.id, be.place, bi.created_at
           from adult_beats be join adult_images bi on bi.id = be.picture_id
          where be.status = 'drawn' and be.act = $4 and bi.status = 'ready'
            and ((be.character_a = $2 and be.character_b = $3) or (be.character_a = $3 and be.character_b = $2))
            and (be.owner_id = $1 or exists (select 1 from admins a where a.user_id = $1))
       ) m
       order by (m.place is not distinct from $5) desc, m.created_at desc
       limit 1`,
      [ownerId, a, b, act, place],
    )
  ).rows[0];
  return img ? { image_id: img.id, act } : null;
}

export type SceneClip = { media_id: string; act: string } | null;

/**
 * A short clip the pair already has of the current act (lib/adult/clips.ts, an act-menu clip whose stored act matches),
 * for the theater to loop muted behind the scene as a living backdrop instead of the drawn set (David, 2026-10-24:
 * "if they have a short reel like blowjob it can repeat in the background"). A ready, in (not archived) clip shot of
 * these two the owner can see; the same place first, then newest. Null when nothing's happening or there's no such clip.
 */
export async function sceneClip(db: Db, ownerId: string, x: string, y: string): Promise<SceneClip> {
  const now = await sceneNow(db, ownerId, x, y);
  if (!now) return null;
  const { a, b, act, place } = now;
  const row = (
    await db.query<{ media_id: string }>(
      `select s->>'media_id' as media_id
         from adult_reels r cross join lateral jsonb_array_elements(r.shots) s
        where r.kind = 'clip' and r.status = 'ready' and r.clip->>'act' = $4
          and ((r.character_a = $2 and r.character_b = $3) or (r.character_a = $3 and r.character_b = $2))
          and (r.owner_id = $1 or exists (select 1 from admins a where a.user_id = $1))
          and s->>'status' = 'ready' and s->>'media_id' is not null and (s->>'archived_at') is null
        order by (r.clip->>'place' is not distinct from $5) desc, r.created_at desc
        limit 1`,
      [ownerId, a, b, act, place],
    )
  ).rows[0];
  return row?.media_id ? { media_id: row.media_id, act } : null;
}
