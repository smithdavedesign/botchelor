/**
 * The image prompt templates, kept here so the generator and its test share one copy. The
 * human-readable version lives in docs/image-strategy.md. Each job carries its own `prompt_version`,
 * which is written to character_assets.prompt_version, so an image can always be traced to the exact
 * wording that produced it.
 *
 * The constraints block is not decoration: the product bans real people, minors and named franchise
 * characters, so every prompt carries that in-band, and the generated file still has to pass a human
 * review before anything can serve it (lib/assets.ts).
 *
 * portrait-v1 was rejected in review, all seventeen. It passed the model an age number, the clothing
 * line and the personality, but no presentation and no physical description, in an anime style that
 * defaults to young faces — so the whole cast came out as one young man with black hair, most of the
 * women rendered as men, nobody over thirty looked it, and several faces (one in what read as a school
 * uniform) looked like teenagers. v2 describes each character from the chest up (lib/house.ts `look`),
 * states age as it shows on a face, moves to a less youth-biased style, and negates what went wrong.
 */
export const PORTRAIT_PROMPT_VERSION = "portrait-v2";
export const BACKDROP_PROMPT_VERSION = "backdrop-v1";

/**
 * What an image must not contain, passed to the model as a negative prompt. The safety half (no
 * minors, no real-person likeness, no franchise characters, nothing revealing) restates the
 * CONSTRAINTS block on purpose. It is a nudge, not a guarantee: the human review is what keeps an
 * image out.
 */
export const NEGATIVE_PROMPT = [
  "child, children, minor, teenager, adolescent, youthful face, baby face, chibi",
  "school uniform, student, schoolboy, schoolgirl, necktie with cardigan",
  "celebrity, real person, recognisable public figure",
  "text, caption, watermark, signature, logo",
  "deformed hands, extra fingers, extra limbs, distorted face, cropped head",
  "nudity, bare chest, open shirt, cleavage, shirtless, revealing clothing, suggestive pose",
  "blurry, low detail, oversaturated",
].join(", ");

const CONSTRAINTS = [
  "Original character design.",
  "No named franchise characters, no real-person likeness, no celebrity resemblance.",
  "A mature adult with age-appropriate features; fully clothed. No text, captions, watermarks or signatures.",
].join(" ");

const PORTRAIT_STYLE = [
  "Semi-realistic painted portrait for a premium visual novel for adults.",
  "Grounded, mature character design; soft studio lighting; painterly rendering; clean framing.",
].join(" ");

const BACKDROP_STYLE = [
  "Original illustrated romance-game background plate.",
  "Consistent line weight, soft lighting, painterly rendering, clean framing.",
].join(" ");

/** The portrait prompt for one house character, built from its sheet and its `look` (lib/house.ts). */
export function portraitPrompt(c) {
  return [
    `STYLE: ${PORTRAIT_STYLE}`,
    `SUBJECT: ${c.look}. Clearly ${c.age} years old.`,
    `EXPRESSION: ${c.archetype.toLowerCase()} — ${c.traits.join(", ")}.`,
    "COMPOSITION: head and shoulders portrait, chest up, centred face, hands not in frame, simple uncluttered background, vertical 3:4 crop.",
    `CONSTRAINTS: ${CONSTRAINTS}`,
  ].join("\n");
}

/** The backdrop prompt for one date venue (lib/venues.ts). Empty sets: no people in a backdrop. */
export function backdropPrompt(v) {
  return [
    `STYLE: ${BACKDROP_STYLE}`,
    `SCENE: ${v.prompt}. Empty of people.`,
    "COMPOSITION: wide establishing shot, 16:9, room in the frame for a dialogue overlay.",
    `CONSTRAINTS: ${CONSTRAINTS.replace("Original character design.", "Original design.").replace("A mature adult with age-appropriate features; fully clothed. ", "")} No readable signage.`,
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
 * backdrop per venue. The prompt version is in each portrait's file name, so a regenerated version
 * never overwrites — or inherits the ledger row of — a rejected one. Pure, so the plan can be inspected
 * and tested without a model installed.
 */
export function buildBatch({ house, venues }) {
  const v = PORTRAIT_PROMPT_VERSION.replace("portrait-", "");
  const portraits = house.map((c) => ({
    id: `portrait-${c.id}`,
    kind: "portrait",
    character_id: c.id,
    label: `${c.name} — ${c.archetype}`,
    file: `${c.id}-${v}.png`,
    prompt: portraitPrompt(c),
    prompt_version: PORTRAIT_PROMPT_VERSION,
    seed: jobSeed(`portrait-${c.id}-${v}`),
    negative: NEGATIVE_PROMPT,
    aspect: "3:4",
  }));
  const backdrops = venues.map((venue) => ({
    id: `backdrop-${venue.id}`,
    kind: "background",
    character_id: null,
    label: venue.name,
    file: `venue-${venue.id}.png`,
    prompt: backdropPrompt(venue),
    prompt_version: BACKDROP_PROMPT_VERSION,
    seed: jobSeed(`backdrop-${venue.id}`),
    negative: `${NEGATIVE_PROMPT}, people, crowd, faces`,
    aspect: "16:9",
  }));
  return [...portraits, ...backdrops];
}
