/**
 * A chapter's unasked pictures, all kinds together, held to `pictures_per_chapter` (David, 2026-10-25: "I am fine
 * allowing 1-3 generated images for each chapter as long as each chapter cost 1 token"): its own and each new place's
 * (lib/adult/auto-pictures.ts, keys "<chapter>:<place>"), one its lines ask for ("<chapter>#asked:<line>"), and its
 * moments drawn when it closes ("<chapter>#beat:<id>", lib/adult/beats.ts). Each is claimed on the scene
 * (adult_scenes.auto_pictures) before it's drawn, so a retry never draws it twice and the budget can't be overspent by
 * two steps at once. A picture the viewer asks for (Picture this, the shot menu) isn't one of these.
 */
import type { Db } from "../db";

/**
 * Claims a picture of the chapter: false when this one is claimed already, or the chapter has had its `budget`.
 * One statement, so two claims at once can't both take the last one.
 */
export async function claimChapterPicture(db: Db, sceneId: string, chapter: number, key: string, budget: number): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `update adult_scenes set auto_pictures = auto_pictures || jsonb_build_array($2::text)
      where id = $1 and not (auto_pictures @> jsonb_build_array($2::text))
        and (select count(*) from jsonb_array_elements_text(auto_pictures) k where k ~ $3) < $4
      returning id`,
    [sceneId, key, `^${Math.floor(chapter)}[:#]`, Math.max(0, Math.floor(budget))],
  );
  return rows.length > 0;
}

/** Gives a claim back (a picture that didn't come), so the chapter can still have it. */
export async function releaseChapterPicture(db: Db, sceneId: string, key: string): Promise<void> {
  await db.query(`update adult_scenes set auto_pictures = auto_pictures - $2::text where id = $1`, [sceneId, key]);
}
