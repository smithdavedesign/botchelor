/**
 * The show's own sets (docs/PRDs/styles-and-storylines.md, phase 3): where the show happens between the dates, drawn
 * empty so anyone can be put in front of them. Like the venue backdrops (lib/portraits.ts) they're reviewed files in
 * `public/cast`, drawn free on Workers AI with the backdrop-v3 prompt (scripts/prompts.mjs freeBackdropPrompt), and
 * `tests/show-sets.test.ts` checks each file is on disk.
 *
 * - **The stage:** the rose ceremony's lead and suitors (app/watch/BotchelorCard.tsx).
 * - **The blind-date booth:** a date still being filmed: the two of them, not met yet (app/episodes/[id]).
 * - **The confessional:** behind the confessionals, on the episode and season pages.
 * - **Elimination:** the rose on its pedestal, behind the last ceremony's verdict.
 *
 * Client-safe: pure constants, no server imports.
 */

export const SHOW_SETS = ["stage", "booth", "confessional", "elimination"] as const;
export type ShowSet = (typeof SHOW_SETS)[number];

/** Each set, empty, as it was drawn (the plate goes into freeBackdropPrompt). No people and no lettering. */
export const SHOW_SET_PLATES: Record<ShowSet, string> = {
  stage:
    "an empty reality dating-show stage, a large curved neon heart in pink and gold hanging above it, three spotlights on a glossy black floor, a deep red velvet curtain, tiered studio audience seating in soft shadow",
  booth:
    "an empty blind-date booth on a dating-show set, two velvet armchairs facing each other on either side of a tall frosted glass screen, a small table with two cocktails, a heart-shaped spotlight on the floor, moody magenta and teal light",
  confessional:
    "an empty cosy reality-show confessional room, one plush armchair facing the camera, warm practical lamps, a bookshelf and a potted plant, a soft rose-coloured wall, shallow depth of field",
  elimination:
    "an empty dramatic dark stage, a single red rose on a slim pedestal in a hard white spotlight, light haze drifting through the beam, the rest of the stage in deep shadow",
};

/** The version in the files' names: a redrawn set gets a new one, so a cached old picture is never shown for it. */
export const SHOW_SET_VERSION = "v3";

export const showSetPath = (set: ShowSet): string => `/cast/set-${set}-${SHOW_SET_VERSION}.webp`;

/**
 * A set as a CSS background, darkened so light words read on it: `scrim` is how dark the top is (the bottom is darker
 * still, where the words sit).
 */
export const showSetBackground = (set: ShowSet, scrim = 0.5): string =>
  `linear-gradient(180deg, rgba(14,8,20,${scrim}) 0%, rgba(14,8,20,${Math.min(0.94, Math.round((scrim + 0.3) * 100) / 100)}) 100%), url(${showSetPath(set)})`;
