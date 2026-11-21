/**
 * Short silent loops of the show's cast, for the faces people pick from (David 2026-11-20: "go ahead with the $5 face
 * loops"; the visual audit's pass 3). Each is cut from the character's OmniHuman intro (lib/cast-intros.ts), re-rendered
 * that day from their house-look-a portrait: two seconds forward then back so it never jumps, 320 px square, no sound,
 * about 60 KB. A character without one keeps their still portrait (app/FaceLoop.tsx).
 *
 * The file name carries the look ("-a"): a new look gets new files, so a year-long cache never shows an old face.
 */
const LOOPS: Readonly<Record<string, string>> = {
  "house-barnaby": "/cast/house-barnaby-loop-a.mp4",
  "house-juniper": "/cast/house-juniper-loop-a.mp4",
  "house-nell": "/cast/house-nell-loop-a.mp4",
  "house-sable": "/cast/house-sable-loop-a.mp4",
};

/** The character's face loop, or null. */
export function faceLoopOf(id: string): string | null {
  return Object.hasOwn(LOOPS, id) ? LOOPS[id] : null;
}

/** Everyone with a loop (for the test that each file is there). */
export const FACE_LOOP_IDS: readonly string[] = Object.keys(LOOPS);
