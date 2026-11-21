/**
 * Short silent loops of the show's cast, for the faces people pick from (David 2026-11-20: "go ahead with the $5 face
 * loops"; the visual audit's pass 3). Each is cut from the character's OmniHuman intro (lib/cast-intros.ts), re-rendered
 * that day from their house-look-a portrait: two seconds forward then back so it never jumps, no sound. Two cuts: 320 px
 * square (~60 KB) for faces on lists, and 360×480 tall (~80 KB, the intro's own 3:4 frame) for a season's lead on its
 * hero, so the loop matches the portrait it plays over. A character without one keeps their still portrait
 * (app/FaceLoop.tsx).
 *
 * The file name carries the look ("-a"): a new look gets new files, so a year-long cache never shows an old face.
 */
/** A loop's two cuts: square for a face on a list, tall (3:4, the intro's own frame) for a poster-sized portrait. */
export type FaceLoopShape = "square" | "tall";

const cuts = (name: string): Record<FaceLoopShape, string> => ({ square: `/cast/house-${name}-loop-a.mp4`, tall: `/cast/house-${name}-loop-tall-a.mp4` });

const LOOPS: Readonly<Record<string, Record<FaceLoopShape, string>>> = {
  "house-barnaby": cuts("barnaby"),
  "house-juniper": cuts("juniper"),
  "house-nell": cuts("nell"),
  "house-sable": cuts("sable"),
};

/** The character's face loop in that shape, or null. */
export function faceLoopOf(id: string, shape: FaceLoopShape = "square"): string | null {
  return Object.hasOwn(LOOPS, id) ? LOOPS[id][shape] : null;
}

/** Everyone with a loop (for the test that each file is there). */
export const FACE_LOOP_IDS: readonly string[] = Object.keys(LOOPS);
