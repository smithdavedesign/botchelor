/**
 * What a viewer can say about an After Dark picture or video (David, 2026-10-24: "allow users to score … and use that as
 * training data for the next run on the same character"), and what each says to the next picture of that character
 * (lib/adult/steering.ts). Fixed choices, never typed: a fix is a fixed phrase, so nothing a viewer writes reaches an image
 * model. Pure data, no server imports: the page's buttons and the server share it.
 */

/** "What's off" on a picture. */
export const PICTURE_TAGS = {
  face: "Doesn't look like them",
  body: "Wrong body",
  outfit: "Wrong outfit",
  pose: "Odd pose",
  anatomy: "Extra fingers or limbs",
  blurry: "Blurry",
  too_tame: "Not explicit enough",
  too_explicit: "Too explicit",
} as const;

/** "What's off" on a video (a night's shot, or a clip). */
export const VIDEO_TAGS = {
  wrong_person: "Wrong person",
  motion: "Jerky or morphing",
  anatomy: "Extra fingers or limbs",
  blurry: "Blurry",
  voice: "Wrong voice",
  too_tame: "Not explicit enough",
  too_explicit: "Too explicit",
} as const;

export type PictureTag = keyof typeof PICTURE_TAGS;
export type VideoTag = keyof typeof VIDEO_TAGS;
export type RatingTag = PictureTag | VideoTag;

/**
 * What a tag does to that viewer's next pictures of the character: words added to the picture's prompt (`positive`), to
 * what it steers away from (`negative`), and to a video shot's negative prompt (`video`). "Not explicit enough" and
 * "Wrong voice" change nothing here: how explicit a picture is follows the night's stage and the pair's limits, never a
 * rating, and a voice is a setting. They're kept for the record all the same.
 */
export const TAG_FIXES: Record<RatingTag, { positive?: string; negative?: string; video?: string }> = {
  face: { positive: "a consistent, distinctive face" },
  wrong_person: { video: "a different person, a face swap, a changing face" },
  body: { positive: "the body exactly as described" },
  outfit: { positive: "the clothing exactly as described" },
  pose: { positive: "a natural, relaxed pose", negative: "awkward pose, contorted body, impossible pose" },
  anatomy: { negative: "extra fingers, missing fingers, fused fingers, deformed hands, extra limbs, malformed anatomy", video: "extra limbs, deformed hands" },
  blurry: { positive: "sharp focus, fine detail", negative: "blurry, out of focus, low resolution", video: "blurry, out of focus" },
  motion: { video: "morphing, warping, flickering, jittery motion, melting faces" },
  voice: {},
  too_tame: {},
  too_explicit: { positive: "tasteful, more implied than shown" },
};

/**
 * The picture presets the per-character test tries (lib/adult/steering.ts choosePreset): the light and the lens, the
 * part of a picture no scene decides. `light` replaces a baseline's "natural light"; a scene picture gets `words`.
 */
export const PICTURE_PRESETS = [
  { id: "natural", label: "Natural light", light: "natural light", words: "Natural light, candid and unposed." },
  { id: "warm", label: "Warm and moody", light: "warm low-key light, shallow depth of field", words: "Warm low-key light, shallow depth of field." },
  { id: "studio", label: "Soft studio", light: "soft even studio light, crisp detail", words: "Soft even studio light, crisp detail." },
] as const;
export type PresetId = (typeof PICTURE_PRESETS)[number]["id"];

/** A picture can be rated with these tags; a video with those. */
export const tagsFor = (kind: string): Record<string, string> => (kind === "video" ? VIDEO_TAGS : PICTURE_TAGS);
