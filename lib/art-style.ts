/**
 * How a character is drawn (PRD styles-and-storylines, phase 2): photographed (realistic), anime, or 2.5D, a painterly
 * semi-realistic illustration and the show's house look (the pilot, 2026-11-17). It's kept in extras.looks.style, the
 * looks builder's style step (lib/looks.ts). A character with no style, or one this file doesn't know, is realistic.
 *
 * Every picture of a character follows its style: the portrait, the recast, PG Studio, the identity views and the
 * face kit. After Dark only draws photographs, so both drawn styles stay out of it until the PRD's phase 8 gates are met
 * (notDrawnSql, lib/adult/characters.ts): a character made in a drawn style on purpose is never drawn as a real-looking
 * person (David, 2026-11-13).
 *
 * Pure data, no server imports: the builder, the companions browser and the API share it.
 */

export const ART_STYLES = ["realistic", "anime", "semi_real"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

/** The drawn styles: anything but a photograph. */
export type DrawnStyle = Exclude<ArtStyle, "realistic">;
export const DRAWN_STYLES: readonly DrawnStyle[] = ["anime", "semi_real"];

/** Each style's name on a page. */
export const ART_STYLE_LABEL: Record<ArtStyle, string> = { realistic: "Realistic", anime: "Anime", semi_real: "2.5D" };

export const isArtStyle = (v: unknown): v is ArtStyle => typeof v === "string" && (ART_STYLES as readonly string[]).includes(v);

/** The style a stored value names; realistic for anything else. */
export const artStyleFrom = (v: unknown): ArtStyle => (isArtStyle(v) ? v : "realistic");

/** A character's style, from its looks. */
export const artStyleOf = (c: { extras?: { looks?: { style?: string } | null } | null } | null | undefined): ArtStyle => artStyleFrom(c?.extras?.looks?.style);

/** Drawn rather than photographed: anime or 2.5D. */
export const isDrawnStyle = (s: ArtStyle): s is DrawnStyle => s !== "realistic";

/** A drawn style as a sentence names it: "drawn in anime", "drawn in 2.5D". */
export const DRAWN_IN: Record<DrawnStyle, string> = { anime: "anime", semi_real: "2.5D" };

/** SQL on `alias`: the character's style, realistic when unset or unknown. */
export const artStyleSql = (alias: string): string =>
  `(case when ${alias}.extras->'looks'->>'style' in (${DRAWN_STYLES.map((s) => `'${s}'`).join(", ")}) then ${alias}.extras->'looks'->>'style' else 'realistic' end)`;

/**
 * The house look's portraits (PRD styles-and-storylines phase 3, look A of the pilot, David's pick): a house character
 * redrawn in 2.5D from their own portrait, kept in the asset ledger with this prompt_version. Their own style
 * (extras.looks.style) stays unset, so After Dark keeps them and keeps drawing them from the portrait before
 * (lib/adult/media.ts showPortrait), until phase 8's gates let drawn styles in.
 */
export const HOUSE_LOOK_VERSION = "house-look-a";

/** SQL on `alias`: the character is photographed, not drawn, so After Dark may draw them. */
export const notDrawnSql = (alias: string): string => `coalesce(${alias}.extras->'looks'->>'style', '') not in (${DRAWN_STYLES.map((s) => `'${s}'`).join(", ")})`;

/**
 * The 2.5D house look, in words (look A of the pilot: the brief's style tokens). Every 2.5D picture carries them, so
 * the cast reads as one show.
 */
export const HOUSE_LOOK_WORDS =
  "semi-realistic digital illustration, painterly 2.5D, soft cinematic rim light, warm key light, shallow depth of field, rich but controlled colour, clean linework on faces, expressive eyes";

/**
 * What every drawn picture says about age. Drawings read young (anime most of all), and the PG checks refuse anyone who
 * might be under 18, so a drawn style asks for an adult's face and proportions outright.
 */
export const DRAWN_ADULT_WORDS = "a clearly grown adult with mature adult features and proportions";

/** The words that make a picture one style or another. */
export type StyleWords = {
  /** What a new picture is, leading its prompt: "Photorealistic studio photograph". */
  medium: string;
  /** What an edit makes, after "Make one": "photograph", "anime illustration". */
  noun: string;
  /** How a new picture is finished: lens and skin for a photograph, line and light for a drawing (with the age words). */
  finish: string;
  /** The style in one sentence, closing an edit's or a shoot's prompt: "Photorealistic." */
  short: string;
  /** How a face edit is finished, in the drawing style of the picture it starts from (lib/face-kit.ts); null for a photograph. */
  editFinish: string | null;
  /** The style in a character's appearance line (lib/looks.ts looksAppearance): "" for a photograph. */
  appearance: string;
};

export const STYLE_WORDS: Record<ArtStyle, StyleWords> = {
  realistic: {
    medium: "Photorealistic studio photograph",
    noun: "photograph",
    finish: "85mm lens, sharp focus, natural skin texture",
    short: "Photorealistic.",
    editFinish: null,
    appearance: "",
  },
  anime: {
    medium: "Clean modern anime illustration",
    noun: "anime illustration",
    finish: "Cel shading, a clearly grown adult character with mature adult proportions",
    short: "Clean modern anime illustration, cel shading, mature adult proportions.",
    editFinish: "Clean modern anime illustration in the same drawing style as Picture 1: cel shading, clean linework, a clearly grown adult with mature adult proportions.",
    appearance: "anime-style",
  },
  semi_real: {
    medium: "Semi-realistic painterly 2.5D digital illustration",
    noun: "2.5D illustration",
    finish: `Soft cinematic rim light, warm key light, shallow depth of field, rich but controlled colour, clean linework on faces, expressive eyes, ${DRAWN_ADULT_WORDS}`,
    short: "Semi-realistic painterly 2.5D digital illustration, soft cinematic light, clean linework on the face, mature adult features and proportions.",
    editFinish: `Semi-realistic painterly 2.5D digital illustration in the same style as Picture 1: soft cinematic light, clean linework on the face, ${DRAWN_ADULT_WORDS}.`,
    appearance: "painterly 2.5D-style",
  },
};

/** The style some words ask for (a sentence on /create's quick start): anime or manga, 2.5D or semi-realistic, else realistic. */
export function artStyleInWords(words: string): ArtStyle {
  const w = ` ${words.toLowerCase()} `;
  if (/\banime\b|\bmanga\b/.test(w)) return "anime";
  if (/\b2\.5d\b|\bsemi-?realistic\b|\bsemi-?real\b|\bpainterly\b/.test(w)) return "semi_real";
  return "realistic";
}
