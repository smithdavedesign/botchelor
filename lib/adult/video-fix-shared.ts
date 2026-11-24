/**
 * 🩹 Fix for a video (David, 2026-11-24: "There is no way to fix a video, often there might be a issue with it"; "go
 * for it"). A video can't be mended in place the way a picture can (no model here edits part of a clip), so a fix
 * films it again from the very start it had, steered by what was wrong (these chips, fixed phrases) and, if they like,
 * new words for what happens. The first fix of a video marked broken is free, once; the rest cost what making it did.
 * Making a video costs us $0.65 (5 s) to $1.30 (10 s) on Venice, so one free fix still leaves each sale ahead
 * (docs/costs.md), and unlimited free ones wouldn't.
 *
 * Where: a Studio animation (lib/adult/video-fix.ts: a new version, kept like a fixed picture) and a shot of a night's
 * video (lib/adult/reels.ts refilmShot: the shot filmed again in place). Pure data and words, no server imports: the
 * sheet and the server share it.
 */

/** What can be wrong with a video, each with what the fix tells the model (`lead`, in the prompt) and keeps out (`negative`). */
export const VIDEO_PROBLEMS = {
  wrong_person: {
    label: "Face changed or wrong person",
    lead: "Their faces stay exactly as in the picture from the first frame to the last: the very same people throughout, never turning into anyone else.",
    negative: "a different person, a face swap, a changing face, morphing face",
  },
  extra: {
    label: "Someone else showed up",
    lead: "Nobody else appears at any moment: only the people in the picture.",
    negative: "extra people, an extra person, a stranger walking in, a crowd",
  },
  still: {
    label: "Barely moves",
    lead: "Clear, continuous movement all the way through: they move from the very first second.",
    negative: "static, frozen, still image, barely moving, slideshow",
  },
  action: {
    label: "Didn't do what I asked",
    lead: "What's asked happens clearly in this clip, from start to finish: it's the point of the shot.",
    negative: "",
  },
  motion: {
    label: "Jerky or morphing",
    lead: "Smooth, steady, natural motion: faces and bodies stay solid.",
    negative: "morphing, warping, flickering, jittery motion, melting faces",
  },
  anatomy: {
    label: "Extra fingers or limbs",
    lead: "Natural hands and bodies: five fingers on each hand, two arms and two legs each.",
    negative: "extra fingers, extra limbs, fused fingers, deformed hands",
  },
  blurry: {
    label: "Blurry",
    lead: "Sharp and in focus throughout.",
    negative: "blurry, out of focus",
  },
} as const;

export type VideoProblem = keyof typeof VIDEO_PROBLEMS;
export const VIDEO_PROBLEM_IDS = Object.keys(VIDEO_PROBLEMS) as VideoProblem[];

/** Fixes one video can have across its versions: each films it again, so they're counted. */
export const VIDEO_FIXES_MAX = 3;

/** The chips as the sheet shows them. */
export const videoProblemChips = (): { id: VideoProblem; label: string }[] => VIDEO_PROBLEM_IDS.map((id) => ({ id, label: VIDEO_PROBLEMS[id].label }));

/** Known problems only, each once, in the chips' order. */
export function cleanProblems(v: unknown): VideoProblem[] {
  const asked = new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return VIDEO_PROBLEM_IDS.filter((id) => asked.has(id));
}

/** What the fix tells the video model, after what's asked to happen. Empty when nothing's marked. */
export const fixLead = (problems: readonly VideoProblem[]): string =>
  problems
    .map((p) => VIDEO_PROBLEMS[p]?.lead)
    .filter(Boolean)
    .join(" ");

/** What the fix keeps out, for the video's negative prompt: each term once. Empty when nothing's marked. */
export function fixNegative(problems: readonly VideoProblem[]): string {
  const terms = problems.flatMap((p) => (VIDEO_PROBLEMS[p]?.negative ?? "").split(",").map((x) => x.trim())).filter(Boolean);
  return [...new Set(terms)].join(", ");
}

/** What a 👎 said was off with the video (lib/adult/rating-tags.ts VIDEO_TAGS), as the chips the sheet starts on. */
export const problemsFromTags = (tags: readonly string[]): VideoProblem[] => cleanProblems(tags);

/** A fix's line in its version list and on its row (adult_images.fix_note): what was wrong, and the words it was given. */
export function fixNote(problems: readonly VideoProblem[], words: string | null | undefined): string | null {
  const said = problems.map((p) => VIDEO_PROBLEMS[p].label).join(" · ");
  const w = words?.trim() ?? "";
  const note = [said, w ? `“${w}”` : ""].filter(Boolean).join(" — ");
  return note ? note.slice(0, 240) : null;
}

/** A fix as its shoot (or shot) records it: the original, the version it was made from, what was wrong, and whether it was the free one. */
export type VideoFixMark = { root: string; from: string; problems: VideoProblem[]; note: string | null; free: boolean };

/** The Fix sheet's view of a Studio animation (lib/adult/video-fix.ts videoFixState). */
export type VideoFixVersion = { id: string; note: string | null; shown: boolean; created_at: string };
export type VideoFixState = {
  root: string;
  /** The original first, then its fixes, oldest to newest. */
  versions: VideoFixVersion[];
  /** Fixes left for the original. */
  left: number;
  /** A fix of it is being made now: it lands in the gallery in a few minutes. */
  making: boolean;
  /** The free fix is still to be had: the next one is free when something's marked wrong. */
  free: boolean;
  /** What a fix costs otherwise: Animate's price for its length (0 for an admin). */
  price: number;
  seconds: number;
  /** What it was asked to do, in their words (to start the words box on), and the chip's motion when it was one. */
  words: string;
  motion: string | null;
  /** The picture it was animated from, when that's one of their gallery's pictures (🩹 Fix mends it first): else null. */
  start: string | null;
  problems: { id: VideoProblem; label: string }[];
  words_max: number;
  /** The version Keep last made the one shown, or null before any Keep. */
  kept: string | null;
};
