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
 * response (lib/sets.ts inBackground) and never fails or slows a step. A picture that doesn't come (2026-10-23: Hive
 * busy, so the output check couldn't run) gives its claim back, so a later step draws it, but not for RETRY_AFTER_MS:
 * a busy Hive isn't asked again at once, and a failed draw isn't paid for step after step. While Hive is over its daily
 * limit (lib/adult/hive-limit.ts) none is claimed or drawn: the step after the pause draws it.
 * Off when the setting is (auto_scene_pictures), or when pictures can't be made (no Hive key, or the provider's key).
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { inBackground } from "../sets";
import { hivePausedUntil } from "./hive-limit";
import { isPublicPlace } from "./continuity";
import { repairPlacePronouns } from "./craft";
import { makePicture, outputCheckReady, pictureKeyReady, recentActions, scenePrompt, type Media } from "./media";
import { venueSituation } from "./scene-catalog";
import { getAdultSettings } from "./settings";
import { mediaAllowedFor } from "./place";

/** What an automatic picture needs from the scene: which one, its chapter, where they are, how far it's gone, the lines. */
export type AutoPictureScene = {
  id: string;
  chapter: number;
  place: string | null;
  set_place: string | null;
  stage: number;
  lines: readonly { text: string }[];
  /** Whose home they're in (the night's last stop), so "his apartment" with two women reads as hers. */
  home?: "a" | "b" | null;
};

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

/** Gives a claim back, so a later step draws the picture that didn't come. */
async function release(db: Db, sceneId: string, key: string): Promise<void> {
  await db.query(`update adult_scenes set auto_pictures = auto_pictures - $2::text where id = $1`, [sceneId, key]);
}

/** How long a picture that didn't come waits before a step asks for it again. */
export const RETRY_AFTER_MS = 3 * 60_000;
/** When each scene's picture last failed ("sceneId|key"), in this process. */
const failedAt = new Map<string, number>();
let clock = () => Date.now();
/** Tests move the clock past RETRY_AFTER_MS. */
export function setAutoPictureClockForTests(f: (() => number) | null): void {
  clock = f ?? (() => Date.now());
  if (!f) failedAt.clear();
}

/** What the picture shows: the two of them, where the scene stands. The stage, the place and the lines do the rest. */
const DESCRIPTION = "The two of them together, as their night stands right now";

/**
 * The picture's prompt, as the scene stands (also what the admin preview shows: app/api/admin/after-dark/picture-prompt):
 * where they are, its pronouns put right for the two of them, what the place puts them in, dressed for it, and what they
 * just did, whole (David, 2026-10-25: "not enough context of the scene and what they're wearing … common sense").
 */
export function autoPicturePrompt(scene: AutoPictureScene, a: Character, b: Character, ownerId: string): string {
  const raw = scene.set_place ?? scene.place;
  const home = scene.home ?? null;
  const place = repairPlacePronouns(raw, { a: a.pronouns, b: b.pronouns }, { a: a.name, b: b.name }, home).text;
  const situation = venueSituation(raw);
  const publicPlace = !home && (isPublicPlace(raw, home) || Boolean(situation));
  return scenePrompt(a, b, "both", DESCRIPTION, { place, stage: scene.stage, recent: recentActions([...scene.lines].slice(-6), 3), situation, publicPlace }, ownerId);
}

/** Draws the picture (makePicture: the provider, the output check, the cap). */
export async function drawAutoPicture(db: Db, ownerId: string, scene: AutoPictureScene, a: Character, b: Character): Promise<Media> {
  const where = scene.set_place ?? scene.place;
  const prompt = autoPicturePrompt(scene, a, b, ownerId);
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
    // Text only where the viewer last connected from (lib/adult/place.ts): no picture is drawn for them.
    if (!(await mediaAllowedFor(db, ownerId))) return false;
    const key = autoPictureKey(scene.chapter, scene.set_place ?? scene.place);
    const failed = failedAt.get(`${scene.id}|${key}`);
    if (failed !== undefined && clock() - failed < RETRY_AFTER_MS) return false;
    // Hive over its daily limit: not claimed, so the first step after the pause draws it (makePicture probes Hive first).
    if (await hivePausedUntil(db)) return false;
    if (!(await claim(db, scene.id, key))) return false;
    const snapshot: AutoPictureScene = { ...scene, lines: scene.lines.slice(-6) };
    inBackground(() => {
      const work = drawAutoPicture(db, ownerId, snapshot, a, b).then(
        () => void failedAt.delete(`${scene.id}|${key}`),
        async (err) => {
          console.warn(`[after-dark] chapter ${snapshot.chapter}'s picture didn't come (asked again on a later step): ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
          failedAt.set(`${scene.id}|${key}`, clock());
          await release(db, scene.id, key).catch(() => {});
        },
      );
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
