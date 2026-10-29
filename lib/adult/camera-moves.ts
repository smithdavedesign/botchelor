/**
 * Camera moves (the creator suite; David, 2026-10-26): how the camera moves through a clip, picked from tiles instead of
 * the one "camera steady" every video prompt ended with. A fixed list, so no owner's words reach a video model through
 * it; each phrase takes that place in the prompt (lib/adult/studio-catalog.ts animatePrompt, lib/adult/reels.ts
 * shotPrompt). A first-person shot keeps its own camera (it moves as their eyes would). Pure: the page shows the tiles.
 */

export const CAMERA_MOVES = [
  { id: "steady", label: "Locked off", words: "the camera steady" },
  { id: "push_in", label: "Push in", words: "the camera pushing in slowly and smoothly" },
  { id: "pull_back", label: "Pull back", words: "the camera pulling back slowly and smoothly" },
  { id: "orbit_left", label: "Orbit left", words: "the camera circling slowly to the left around them" },
  { id: "orbit_right", label: "Orbit right", words: "the camera circling slowly to the right around them" },
  { id: "pan", label: "Pan", words: "the camera panning slowly across from one side" },
  { id: "tilt_up", label: "Tilt up", words: "the camera tilting slowly up" },
  { id: "crane_up", label: "Crane up", words: "the camera rising slowly, looking down at them" },
  { id: "handheld", label: "Handheld", words: "the camera handheld, a gentle natural sway" },
] as const;
export type CameraMoveId = (typeof CAMERA_MOVES)[number]["id"];
export const CAMERA_MOVE_IDS: CameraMoveId[] = CAMERA_MOVES.map((m) => m.id);
export const isCameraMove = (v: unknown): v is CameraMoveId => typeof v === "string" && (CAMERA_MOVE_IDS as string[]).includes(v);

/** A move's words for a video prompt; the steady camera for none or one that isn't on the list. */
export function cameraWords(id: string | null | undefined): string {
  return (CAMERA_MOVES.find((m) => m.id === id) ?? CAMERA_MOVES[0]).words;
}
