/**
 * The portrait prompt template (v1), kept here so the generator and its test share one copy. The
 * human-readable version of the same thing lives in docs/image-strategy.md; `PROMPT_VERSION` is what
 * gets written to character_assets.prompt_version, so an image can always be traced to the wording
 * that produced it.
 *
 * The constraints block is not decoration: the product bans real people, minors and named franchise
 * characters, so every prompt carries that in-band, and the generated file still has to pass a human
 * review before anything can serve it (lib/assets.ts).
 */
export const PROMPT_VERSION = "portrait-v1";

const CONSTRAINTS = [
  "Original character design.",
  "No named franchise characters, no real-person likeness, no celebrity resemblance.",
  "Clearly an adult. No text, captions, watermarks or signatures.",
].join(" ");

const STYLE = [
  "Original illustrated romance-game character portrait.",
  "Consistent line weight, soft studio lighting, painterly rendering, clean framing.",
].join(" ");

/** The portrait prompt for one house character, built from its sheet (lib/house.ts). */
export function portraitPrompt(c) {
  return [
    `STYLE: ${STYLE}`,
    `CHARACTER: adult fictional character, age ${c.age}. ${c.appearance}. ${c.archetype}; ${c.traits.join(", ")}.`,
    "COMPOSITION: head and shoulders, centred face, simple uncluttered background, vertical 3:4 crop.",
    `CONSTRAINTS: ${CONSTRAINTS}`,
  ].join("\n");
}

/** The backdrop prompt for one date venue (lib/venues.ts). Empty sets: no people in a backdrop. */
export function backdropPrompt(v) {
  return [
    `STYLE: ${STYLE.replace("character portrait", "background plate")}`,
    `SCENE: ${v.prompt}. Empty of people.`,
    "COMPOSITION: wide establishing shot, 16:9, room in the frame for a dialogue overlay.",
    `CONSTRAINTS: ${CONSTRAINTS.replace("Original character design.", "Original design.")} No readable signage.`,
  ].join("\n");
}

/** A stable per-job seed, so re-running the batch reproduces the same images. */
export function jobSeed(id) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Every image the first release needs: one portrait per house character (free and premium) and one
 * backdrop per venue. Pure, so the plan can be inspected and tested without a model installed.
 */
export function buildBatch({ house, venues }) {
  const portraits = house.map((c) => ({
    id: `portrait-${c.id}`,
    kind: "portrait",
    character_id: c.id,
    label: `${c.name} — ${c.archetype}`,
    file: `${c.id}.png`,
    prompt: portraitPrompt(c),
    seed: jobSeed(`portrait-${c.id}`),
    aspect: "3:4",
  }));
  const backdrops = venues.map((v) => ({
    id: `backdrop-${v.id}`,
    kind: "background",
    character_id: null,
    label: v.name,
    file: `venue-${v.id}.png`,
    prompt: backdropPrompt(v),
    seed: jobSeed(`backdrop-${v.id}`),
    aspect: "16:9",
  }));
  return [...portraits, ...backdrops];
}
