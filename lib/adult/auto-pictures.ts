/**
 * A picture for each chapter and each place (David, 2026-10-23: a pair five chapters in had three pictures, two of them
 * baselines, and nothing drawn when the balloon became a rainy garden). Each time a chapter's first lines are written,
 * and each time the place changes in a chapter (an agreed move, or Set the scene), one picture of the two of them is
 * drawn where they are, at the stage they're at, from the last few lines. It goes through makePicture
 * (lib/adult/media.ts) like any scene picture: the provider in the settings, the output check (Hive) on the bytes
 * before they're stored, the month's picture cap. The baselines (one per character, the face reference) are never
 * redrawn.
 *
 * At most one per chapter and place: each is claimed on the scene (adult_scenes.auto_pictures) before it's drawn, so a
 * retry, a rewind and a redo, or the same place twice in a chapter, never draws it twice. The drawing runs after the
 * response (lib/sets.ts inBackground) and never fails or slows a step: a picture that doesn't come is only logged.
 * Off when the setting is (auto_scene_pictures), or when pictures can't be made (no Hive key, or the provider's key).
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { inBackground } from "../sets";
import { makePicture, outputCheckReady, pictureKeyReady, recentActions, scenePrompt, type Media } from "./media";
import { getAdultSettings } from "./settings";

/** What an automatic picture needs from the scene: which one, its chapter, where they are, how far it's gone, the lines. */
export type AutoPictureScene = { id: string; chapter: number; place: string | null; set_place: string | null; stage: number; lines: readonly { text: string }[] };

/** The claim for a chapter's picture at a place: "5:the rainy garden". */
export const autoPictureKey = (chapter: number, where: string | null): string =>
  `${chapter}:${(where ?? "").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()}`;

/** Whether automatic pictures can run: the setting on, the output check's key and the picture provider's key saved. */
export async function autoPicturesReady(db: Db): Promise<boolean> {
  const { auto_scene_pictures } = await getAdultSettings(db);
  return auto_scene_pictures && (await outputCheckReady(db)) && (await pictureKeyReady(db));
}

/** Claims the scene's picture for this chapter and place; false when it has been claimed already. */
async function claim(db: Db, sceneId: string, key: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `update adult_scenes set auto_pictures = auto_pictures || jsonb_build_array($2::text)
      where id = $1 and not (auto_pictures @> jsonb_build_array($2::text)) returning id`,
    [sceneId, key],
  );
  return rows.length > 0;
}

/** What the picture shows: the two of them, where the scene stands. The stage, the place and the lines do the rest. */
const DESCRIPTION = "The two of them together, as their night stands right now";

/** Draws the picture (makePicture: the provider, the output check, the cap). */
export async function drawAutoPicture(db: Db, ownerId: string, scene: AutoPictureScene, a: Character, b: Character): Promise<Media> {
  const where = scene.set_place ?? scene.place;
  const prompt = scenePrompt(a, b, "both", DESCRIPTION, { place: where, stage: scene.stage, recent: recentActions([...scene.lines].slice(-6)) }, ownerId);
  // A picture of both goes without a face reference: the face model reads one face (lib/adult/media.ts FACE_MODEL).
  return makePicture(db, ownerId, { prompt, kind: "scene", character_id: a.id, character_b: b.id, face_of: null, scene_chapter: scene.chapter, scene_place: where });
}

const pending = new Set<Promise<unknown>>();

/** Waits for the automatic pictures still drawing (tests). */
export async function autoPicturesSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/**
 * Starts the chapter's picture at this place, when it's on and not drawn yet: true when one was started (it arrives in
 * the gallery a little later). Never throws.
 */
export async function kickAutoPicture(db: Db, ownerId: string, scene: AutoPictureScene, a: Character | null, b: Character | null): Promise<boolean> {
  try {
    if (!a || !b || !(await autoPicturesReady(db))) return false;
    if (!(await claim(db, scene.id, autoPictureKey(scene.chapter, scene.set_place ?? scene.place)))) return false;
    const snapshot: AutoPictureScene = { ...scene, lines: scene.lines.slice(-6) };
    inBackground(() => {
      const work = drawAutoPicture(db, ownerId, snapshot, a, b).catch((err) => {
        console.warn(`[after-dark] chapter ${snapshot.chapter}'s picture didn't come: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
      });
      pending.add(work);
      void work.finally(() => pending.delete(work));
      return work;
    });
    return true;
  } catch (err) {
    console.warn(`[after-dark] a scene picture couldn't start: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return false;
  }
}
