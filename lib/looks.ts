/**
 * The looks builder (David, 2026-10-19: "allow more custom characters… following exactly the same flow as" candy.ai's
 * onboarding). A character's look is picked step by step from picture tiles: gender, style, ethnicity, age, eyes, hair
 * style, hair colour, body, then bust (women) or facial hair (men), then an outfit. The same flow has an After Dark tab
 * whose body steps show explicit tiles and add one more step; it's blurred for anyone who can't open After Dark.
 *
 * What's picked is stored in extras.looks (lib/extras.ts) and turned into the character's appearance line
 * (looksAppearance), which every picture prompt already reads, the show's and After Dark's alike. The After Dark picks
 * (looks.after_dark) are private: never on a card, and kept only for an account that can open After Dark.
 *
 * Each tile is one picture, drawn once (lib/looks-draw.ts) from the prompts here: one model held fixed (the defaults)
 * with only the step's own option changed, so a row of tiles compares like for like. The prompts are written out in full
 * so each tile comes out right the first time and nothing is redrawn. Pure data, no server imports: the builder (a
 * client component) and the API share this file.
 */
import { z } from "zod";
import type { KindId } from "./kinds";

export const GENDERS = ["woman", "man"] as const;
export type Gender = (typeof GENDERS)[number];

/** One option of a step: its id, its label (per gender where it differs) and the words it puts in a prompt. */
export type LookOption = { id: string; label: string; labelMan?: string; prompt: string; promptMan?: string; anime?: true };

/** A step: which genders it's for, and whether it's After Dark only. */
export type LookStep = {
  id: LookStepId;
  title: string;
  /** Who the step is for; both when unset. */
  only?: Gender;
  /** After Dark only: shown on that tab, never on the normal one. */
  afterDark?: true;
  /** Options per gender, where the two differ. */
  options: readonly LookOption[];
  optionsMan?: readonly LookOption[];
};

export const LOOK_STEP_IDS = ["gender", "style", "ethnicity", "age", "eyes", "hair_style", "hair_color", "body", "breasts", "butt", "facial_hair", "outfit"] as const;
export type LookStepId = (typeof LOOK_STEP_IDS)[number];

/** The youngest a character can look. Pictures are drawn at no younger than IMAGE_MIN_AGE (stricter than the show's 18). */
export const LOOK_MIN_AGE = 18;
export const LOOK_MAX_AGE = 60;
export const IMAGE_MIN_AGE = 21;
export const LOOK_AGES: readonly number[] = Array.from({ length: LOOK_MAX_AGE - LOOK_MIN_AGE + 1 }, (_, i) => LOOK_MIN_AGE + i);

export const LOOK_STEPS: readonly LookStep[] = [
  {
    id: "gender",
    title: "Who are they?",
    options: [
      { id: "woman", label: "Woman", prompt: "" },
      { id: "man", label: "Man", prompt: "" },
    ],
  },
  {
    id: "style",
    title: "Choose a style",
    options: [
      { id: "realistic", label: "Realistic", prompt: "photorealistic" },
      { id: "anime", label: "Anime", prompt: "anime", anime: true },
    ],
  },
  {
    id: "ethnicity",
    title: "Choose an ethnicity",
    options: [
      { id: "caucasian", label: "Caucasian", prompt: "Caucasian {who} with fair skin and European features" },
      { id: "asian", label: "Asian", prompt: "East Asian {who} with light golden skin and East Asian features" },
      { id: "black", label: "Black / Afro", prompt: "Black {who} with deep brown skin and African features" },
      { id: "latina", label: "Latina", labelMan: "Latino", prompt: "Latin American {who} with warm tan skin and Latin features" },
      { id: "arab", label: "Arab", prompt: "Arab {who} with olive skin and Middle Eastern features" },
    ],
  },
  // The age step is a row of numbers (it sets the sheet's age), not pictures.
  { id: "age", title: "How old do they look?", options: [] },
  {
    id: "eyes",
    title: "Choose an eye colour",
    options: [
      { id: "brown", label: "Brown", prompt: "warm dark brown eyes" },
      { id: "blue", label: "Blue", prompt: "bright clear blue eyes" },
      { id: "green", label: "Green", prompt: "vivid green eyes" },
      { id: "hazel", label: "Hazel", prompt: "hazel eyes, green-gold with brown flecks" },
      { id: "grey", label: "Grey", prompt: "pale steel-grey eyes" },
    ],
  },
  {
    id: "hair_style",
    title: "Choose a hair style",
    options: [
      { id: "straight", label: "Straight", prompt: "long straight {color}hair falling past the shoulders" },
      { id: "bangs", label: "Bangs", prompt: "shoulder-length {color}hair with full blunt bangs across the forehead" },
      { id: "curly", label: "Curly", prompt: "long voluminous curly {color}hair" },
      { id: "bun", label: "Bun", prompt: "{color}hair pulled up into a neat high bun" },
      { id: "short", label: "Short", prompt: "a short chin-length {color}bob" },
      { id: "ponytail", label: "Ponytail", prompt: "{color}hair tied back in a long high ponytail" },
    ],
    optionsMan: [
      { id: "short", label: "Short", prompt: "short neat textured {color}hair" },
      { id: "buzz", label: "Buzz cut", prompt: "a very short even {color}buzz cut" },
      { id: "slicked", label: "Slicked back", prompt: "medium-length {color}hair slicked back neatly" },
      { id: "curly", label: "Curly", prompt: "short thick curly {color}hair" },
      { id: "long", label: "Long", prompt: "shoulder-length loose wavy {color}hair" },
      { id: "bun", label: "Man bun", prompt: "long {color}hair tied up in a loose bun" },
    ],
  },
  {
    id: "hair_color",
    title: "Choose a hair colour",
    options: [
      { id: "brunette", label: "Brunette", prompt: "rich chocolate-brown" },
      { id: "blonde", label: "Blonde", prompt: "golden blonde" },
      { id: "black", label: "Black", prompt: "glossy jet-black" },
      { id: "red", label: "Red", prompt: "copper-red" },
      { id: "silver", label: "Silver", prompt: "silver-grey" },
      { id: "pink", label: "Pink", prompt: "pastel pink" },
      { id: "blue", label: "Blue", prompt: "deep blue" },
    ],
  },
  {
    id: "body",
    title: "Choose a body type",
    options: [
      { id: "slim", label: "Slim", prompt: "a slim slender build" },
      { id: "athletic", label: "Athletic", prompt: "a toned athletic build" },
      { id: "average", label: "Average", prompt: "an average medium build" },
      { id: "curvy", label: "Curvy", prompt: "a curvy hourglass figure with full hips" },
      { id: "plus", label: "Plus-size", prompt: "a plus-size full-figured build" },
    ],
    optionsMan: [
      { id: "slim", label: "Slim", prompt: "a slim lean build" },
      { id: "athletic", label: "Athletic", prompt: "a toned athletic build with defined shoulders" },
      { id: "average", label: "Average", prompt: "an average medium build" },
      { id: "muscular", label: "Muscular", prompt: "a broad heavily muscular build" },
      { id: "stocky", label: "Stocky", prompt: "a stocky solid build with a soft middle" },
    ],
  },
  {
    id: "breasts",
    title: "Choose a bust size",
    only: "woman",
    options: [
      { id: "small", label: "Small", prompt: "a small bust" },
      { id: "medium", label: "Medium", prompt: "a medium bust" },
      { id: "large", label: "Large", prompt: "a large full bust" },
      { id: "xl", label: "Extra large", prompt: "a very large full bust" },
    ],
  },
  {
    id: "butt",
    title: "Choose a butt size",
    only: "woman",
    afterDark: true,
    options: [
      { id: "small", label: "Small", prompt: "a small pert butt" },
      { id: "medium", label: "Medium", prompt: "a round medium butt" },
      { id: "large", label: "Large", prompt: "a large full round butt" },
    ],
  },
  {
    id: "facial_hair",
    title: "Choose facial hair",
    only: "man",
    options: [
      { id: "clean", label: "Clean-shaven", prompt: "a clean-shaven face" },
      { id: "stubble", label: "Stubble", prompt: "light even stubble" },
      { id: "short_beard", label: "Short beard", prompt: "a short neatly trimmed beard" },
      { id: "full_beard", label: "Full beard", prompt: "a full thick beard" },
      { id: "moustache", label: "Moustache", prompt: "a groomed moustache and no beard" },
    ],
  },
  {
    id: "outfit",
    title: "Choose an outfit",
    options: [
      { id: "casual", label: "Casual", prompt: "a fitted white t-shirt and blue jeans" },
      { id: "smart", label: "Smart", prompt: "a tailored blazer over a silk blouse and trousers" },
      { id: "sporty", label: "Sporty", prompt: "a matching sports top and leggings" },
      { id: "evening", label: "Evening", prompt: "an elegant floor-length satin evening dress" },
      { id: "street", label: "Streetwear", prompt: "an oversized hoodie, cargo trousers and sneakers" },
      { id: "swim", label: "Swimwear", prompt: "a one-piece swimsuit" },
    ],
    optionsMan: [
      { id: "casual", label: "Casual", prompt: "a fitted white t-shirt and blue jeans" },
      { id: "smart", label: "Smart", prompt: "a tailored navy suit with an open-collar shirt" },
      { id: "sporty", label: "Sporty", prompt: "a fitted training t-shirt and joggers" },
      { id: "evening", label: "Evening", prompt: "a black tuxedo with a bow tie" },
      { id: "street", label: "Streetwear", prompt: "an oversized hoodie, cargo trousers and sneakers" },
      { id: "swim", label: "Swimwear", prompt: "swim shorts, shirtless" },
    ],
  },
];

/** After Dark's outfits, which replace the outfit step's options on that tab. */
export const AFTER_DARK_OUTFITS: readonly LookOption[] = [
  { id: "lingerie", label: "Lingerie", prompt: "black lace lingerie" },
  { id: "bikini", label: "Bikini", prompt: "a tiny string bikini" },
  { id: "robe", label: "Robe", prompt: "an open silk robe" },
  { id: "nude", label: "Nude", prompt: "fully nude" },
];
export const AFTER_DARK_OUTFITS_MAN: readonly LookOption[] = [
  { id: "briefs", label: "Briefs", prompt: "only tight black briefs" },
  { id: "towel", label: "Towel", prompt: "only a white towel around the waist" },
  { id: "robe", label: "Robe", prompt: "an open silk robe" },
  { id: "nude", label: "Nude", prompt: "fully nude" },
];

/** The steps a gender walks through on a tab, in order. */
export function stepsFor(gender: Gender, afterDark: boolean): LookStep[] {
  return LOOK_STEPS.filter((s) => (!s.only || s.only === gender) && (!s.afterDark || afterDark));
}

/** A step's options for a gender on a tab (the After Dark outfits replace the normal ones there). */
export function optionsFor(step: LookStep, gender: Gender, afterDark = false): readonly LookOption[] {
  if (step.id === "outfit" && afterDark) return gender === "man" ? AFTER_DARK_OUTFITS_MAN : AFTER_DARK_OUTFITS;
  return (gender === "man" && step.optionsMan) || step.options;
}

export const optionLabel = (o: LookOption, gender: Gender): string => (gender === "man" && o.labelMan) || o.label;
export const optionPrompt = (o: LookOption, gender: Gender): string => (gender === "man" && o.promptMan) || o.prompt;

/* ------------------------------------------ the finer details ------------------------------------------ */

/**
 * The finer details (David, 2026-10-24: "can we add more customization allowed before generating the baseline
 * images?"): fixed choices picked as chips on the look's summary, no picture tiles and nothing typed. None is needed;
 * each one picked goes into the character's pictures like a step's pick (looksPictureWords: After Dark's baseline and
 * every picture after it; the portrait; the appearance line while it fits). What a baseline frames stays fixed
 * (waist-up, facing the camera, face clear): a detail changes who's in it, never the shot.
 */
export const LOOK_DETAIL_IDS = ["skin_tone", "marks", "makeup", "glasses", "piercings", "tattoos", "body_hair", "grooming"] as const;
export type LookDetailId = (typeof LOOK_DETAIL_IDS)[number];
export type LookDetail = { id: LookDetailId; title: string; only?: Gender; afterDark?: true; options: readonly LookOption[] };

export const LOOK_DETAILS: readonly LookDetail[] = [
  {
    id: "skin_tone",
    title: "Skin shade",
    options: [
      { id: "lighter", label: "Lighter", prompt: "a lighter skin tone" },
      { id: "deeper", label: "Deeper", prompt: "a deeper skin tone" },
    ],
  },
  {
    id: "marks",
    title: "Freckles or a beauty mark",
    options: [
      { id: "freckles", label: "Freckles", prompt: "a light dusting of freckles across the nose and cheeks" },
      { id: "lots", label: "Lots of freckles", prompt: "lots of freckles across the face and shoulders" },
      { id: "beauty_mark", label: "Beauty mark", prompt: "a small beauty mark above the lip" },
    ],
  },
  {
    id: "makeup",
    title: "Makeup",
    options: [
      { id: "natural", label: "Natural", prompt: "natural barely-there makeup" },
      { id: "glam", label: "Glam", prompt: "glamorous makeup with winged eyeliner and red lipstick" },
      { id: "smoky", label: "Smoky eyes", prompt: "dark smoky eye makeup" },
    ],
  },
  {
    id: "glasses",
    title: "Glasses",
    options: [
      { id: "wire", label: "Wire frames", prompt: "thin round wire-framed glasses" },
      { id: "thick", label: "Thick frames", prompt: "thick black-framed glasses" },
    ],
  },
  {
    id: "piercings",
    title: "Piercings",
    options: [
      { id: "ears", label: "Earrings", prompt: "small gold hoop earrings" },
      { id: "nose", label: "Nose stud", prompt: "a small nose stud" },
      { id: "several", label: "Several", prompt: "several ear piercings and a small nose ring" },
    ],
  },
  {
    id: "tattoos",
    title: "Tattoos",
    options: [
      { id: "small", label: "One small", prompt: "one small fine-line tattoo on the inner wrist" },
      { id: "few", label: "A few", prompt: "a few small tattoos on the arms" },
      { id: "sleeve", label: "Sleeve", prompt: "a full sleeve tattoo covering one arm" },
    ],
  },
  {
    id: "body_hair",
    title: "Chest hair",
    only: "man",
    options: [
      { id: "smooth", label: "Smooth", prompt: "a smooth hairless chest" },
      { id: "light", label: "Light", prompt: "a lightly hairy chest" },
      { id: "hairy", label: "Hairy", prompt: "a hairy chest" },
    ],
  },
  {
    id: "grooming",
    title: "Grooming",
    afterDark: true,
    options: [
      { id: "shaved", label: "Shaved", prompt: "a completely shaved pubic area" },
      { id: "trimmed", label: "Trimmed", prompt: "neatly trimmed pubic hair" },
      { id: "natural", label: "Natural", prompt: "natural untrimmed pubic hair" },
    ],
  },
];

/** The details a gender picks on a tab (After Dark's own only there). */
export function detailsFor(gender: Gender, afterDark: boolean): LookDetail[] {
  return LOOK_DETAILS.filter((d) => (!d.only || d.only === gender) && (!d.afterDark || afterDark));
}

const detailIds = (id: LookDetailId) => LOOK_DETAILS.find((d) => d.id === id)!.options.map((o) => o.id) as [string, ...string[]];
const detailWords = (id: LookDetailId, option: string | undefined): string | undefined =>
  option ? LOOK_DETAILS.find((d) => d.id === id)?.options.find((o) => o.id === option)?.prompt : undefined;

/** The details anyone sees, as words, after the body (the skin's shade goes with the ethnicity): marks, makeup, glasses, piercings, tattoos. */
const shownDetailWords = (l: Looks): string[] =>
  (["marks", "makeup", "glasses", "piercings", "tattoos"] as const).map((id) => detailWords(id, l[id])).filter((x): x is string => Boolean(x));

/* ------------------------------------------- what's stored ------------------------------------------- */

const ids = (step: LookStepId, extra: readonly LookOption[] = []) => {
  const s = LOOK_STEPS.find((x) => x.id === step)!;
  return [...new Set([...s.options, ...(s.optionsMan ?? []), ...extra].map((o) => o.id))] as [string, ...string[]];
};

/** The picks, as stored in extras.looks. Every field optional: a half-finished look still describes someone. */
export const LooksInput = z
  .object({
    gender: z.enum(GENDERS).optional(),
    style: z.enum(ids("style")).optional(),
    ethnicity: z.enum(ids("ethnicity")).optional(),
    age: z.number().int().min(LOOK_MIN_AGE).max(LOOK_MAX_AGE).optional(),
    eyes: z.enum(ids("eyes")).optional(),
    hair_style: z.enum(ids("hair_style")).optional(),
    hair_color: z.enum(ids("hair_color")).optional(),
    body: z.enum(ids("body")).optional(),
    breasts: z.enum(ids("breasts")).optional(),
    facial_hair: z.enum(ids("facial_hair")).optional(),
    outfit: z.enum(ids("outfit")).optional(),
    /** The finer details (LOOK_DETAILS). */
    skin_tone: z.enum(detailIds("skin_tone")).optional(),
    marks: z.enum(detailIds("marks")).optional(),
    makeup: z.enum(detailIds("makeup")).optional(),
    glasses: z.enum(detailIds("glasses")).optional(),
    piercings: z.enum(detailIds("piercings")).optional(),
    tattoos: z.enum(detailIds("tattoos")).optional(),
    body_hair: z.enum(detailIds("body_hair")).optional(),
    /** After Dark's picks: private, and kept only for an account that can open After Dark. */
    after_dark: z
      .object({
        butt: z.enum(ids("butt")).optional(),
        outfit: z.enum(ids("outfit", [...AFTER_DARK_OUTFITS, ...AFTER_DARK_OUTFITS_MAN])).optional(),
        grooming: z.enum(detailIds("grooming")).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Looks = z.infer<typeof LooksInput>;

/** Drops picks that don't fit the gender (a beard on a woman's look) and empty groups. */
export function normaliseLooks(l: Looks | null | undefined): Looks | undefined {
  if (!l) return undefined;
  const out: Looks = { ...l };
  const g = out.gender;
  for (const step of LOOK_STEPS) {
    const k = step.id as keyof Looks;
    if (step.afterDark || step.id === "gender" || step.id === "age" || out[k] === undefined) continue;
    const valid = g ? (!step.only || step.only === g) && optionsFor(step, g).some((o) => o.id === out[k]) : !step.only;
    if (!valid) delete out[k];
  }
  for (const d of LOOK_DETAILS) {
    const k = d.id as keyof Looks;
    if (d.afterDark || out[k] === undefined) continue;
    if (d.only && d.only !== g) delete out[k];
  }
  if (out.after_dark) {
    const ad = { ...out.after_dark };
    if (ad.butt && g !== "woman") delete ad.butt;
    if (ad.outfit && (!g || !optionsFor(LOOK_STEPS.find((s) => s.id === "outfit")!, g, true).some((o) => o.id === ad.outfit))) delete ad.outfit;
    if (Object.keys(ad).length) out.after_dark = ad;
    else delete out.after_dark;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The picks anyone but the owner may see: everything but After Dark's. */
export function publicLooks(l: Looks | undefined): Looks | undefined {
  if (!l?.after_dark) return l;
  const { after_dark: _ad, ...rest } = l;
  return Object.keys(rest).length ? rest : undefined;
}

/** "{who}" in an ethnicity's words becomes woman or man; with none picked, just that. */
export function ethnicityWords(gender: Gender, id: string | undefined): string {
  const who = gender === "man" ? "man" : "woman";
  return (pick("ethnicity", gender, id)?.prompt ?? "{who}").replace("{who}", who);
}

/** The hair: the style's words with the colour put in ("long voluminous curly copper-red hair"). */
export function hairWords(gender: Gender, style: string | undefined, color: string | undefined): string {
  const c = pick("hair_color", gender, color)?.prompt;
  const st = pick("hair_style", gender, style)?.prompt;
  if (!st) return c ? `${c} hair` : "";
  return st.replace("{color}", c ? `${c} ` : "");
}

const pick = (step: LookStepId, gender: Gender, id: string | undefined, afterDark = false): LookOption | undefined => {
  const s = LOOK_STEPS.find((x) => x.id === step);
  return s && id ? optionsFor(s, gender, afterDark).find((o) => o.id === id) : undefined;
};

/**
 * The look as an appearance line for the sheet (≤ 140 characters, like the field): "Latina, long voluminous curly
 * copper-red hair, vivid green eyes, a curvy hourglass figure". Never After Dark's picks, never the outfit's skin.
 */
export function looksAppearance(l: Looks | undefined): string {
  if (!l?.gender) return "";
  const g = l.gender;
  const parts = [
    l.style === "anime" ? "anime-style" : "",
    l.ethnicity ? optionLabel(pick("ethnicity", g, l.ethnicity)!, g).replace(" / Afro", "") : "",
    detailWords("skin_tone", l.skin_tone) ?? "",
    hairWords(g, l.hair_style, l.hair_color),
    pick("eyes", g, l.eyes)?.prompt ?? "",
    pick("facial_hair", g, l.facial_hair)?.prompt ?? "",
    pick("body", g, l.body)?.prompt ?? "",
    ...shownDetailWords(l),
  ].filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) if ([...kept, p].join(", ").length <= 140) kept.push(p);
  return kept.join(", ");
}

/**
 * Every pick, for After Dark's pictures (lib/adult/media.ts): the body's words, and the outfit apart so a picture can
 * leave it out once they undress (null: nude, or none picked). The After Dark picks (butt, outfit) are private, so
 * `own` says whether the picture is the owner's; the After Dark outfit wins over the show's. Realistic only: After
 * Dark never draws anime.
 */
export function looksPictureWords(l: Looks | undefined, own: boolean): { body: string; outfit: string | null; everyday: string | null; undressed: string | null } {
  if (!l?.gender) return { body: "", outfit: null, everyday: null, undressed: null };
  const g = l.gender;
  const body = [
    l.ethnicity ? optionLabel(pick("ethnicity", g, l.ethnicity)!, g).replace(" / Afro", "") : "",
    detailWords("skin_tone", l.skin_tone),
    hairWords(g, l.hair_style, l.hair_color),
    pick("eyes", g, l.eyes)?.prompt,
    pick("facial_hair", g, l.facial_hair)?.prompt,
    pick("body", g, l.body)?.prompt,
    pick("breasts", g, l.breasts)?.prompt,
    own ? pick("butt", g, l.after_dark?.butt, true)?.prompt : undefined,
    ...shownDetailWords(l),
    g === "man" ? detailWords("body_hair", l.body_hair) : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  // What shows only once they've undressed: the private grooming pick, in the owner's own pictures.
  const undressed = (own && detailWords("grooming", l.after_dark?.grooming)) || null;
  const outfit = pick("outfit", g, l.outfit);
  // What they wear out (the show's pick): out in public, or before anything's started, After Dark's outfit (lingerie)
  // would be wrong (David, 2026-10-25: "if they were just at a bar they wouldn't be in underwear").
  const everyday = outfit ? optionPrompt(outfit, g) : null;
  const adOutfit = own ? pick("outfit", g, l.after_dark?.outfit, true) : undefined;
  if (adOutfit) return { body, outfit: adOutfit.id === "nude" ? null : optionPrompt(adOutfit, g), everyday, undressed };
  return { body, outfit: everyday, everyday, undressed };
}

/* ---------------------------------------------- the tiles ---------------------------------------------- */

export type TileVariant = "pg" | "nsfw";

/** One tile to draw: its id (also its URL), and the full prompt. */
export type TileSpec = { id: string; variant: TileVariant; gender: Gender; step: string; option: string; prompt: string; seed: number };

/** The model every tile holds fixed, apart from the step's own option. */
const DEFAULTS: Record<Gender, Required<Pick<Looks, "ethnicity" | "eyes" | "hair_style" | "hair_color" | "body">> & { age: number; outfit: string; facial_hair?: string }> = {
  woman: { ethnicity: "caucasian", eyes: "brown", hair_style: "straight", hair_color: "brunette", body: "slim", age: 27, outfit: "casual" },
  man: { ethnicity: "caucasian", eyes: "brown", hair_style: "short", hair_color: "brunette", body: "athletic", age: 30, outfit: "casual", facial_hair: "stubble" },
};

/** One seed per gender, so every tile is the same person as far as the model allows. */
const SEEDS: Record<Gender, number> = { woman: 270_119, man: 300_119 };

/** How each step's tile is framed: the part of them the step is about. */
const FRAMING: Partial<Record<LookStepId | "baseline", string>> = {
  style: "Head-and-shoulders portrait, facing the camera, gentle smile",
  ethnicity: "Head-and-shoulders portrait, facing the camera, gentle smile",
  eyes: "Tight close-up of the face from the brows to the lips, both eyes sharp and the main subject, looking into the lens",
  hair_style: "Head-and-shoulders portrait in three-quarter view so the whole hairstyle shows",
  hair_color: "Head-and-shoulders portrait in three-quarter view so the hair colour shows clearly",
  facial_hair: "Head-and-shoulders portrait, facing the camera, the jaw and chin clearly lit",
  body: "Full-length shot, standing relaxed, facing the camera, the whole figure from head to feet in frame",
  breasts: "Waist-up portrait, facing the camera, face clearly visible",
  butt: "Full-length shot from behind in three-quarter view, looking back over her shoulder at the camera, face visible",
  outfit: "Full-length fashion shot, standing, facing the camera, the whole outfit from head to feet in frame",
  baseline: "Waist-up portrait, facing the camera, face clearly visible, relaxed confident expression",
};

type Subject = { gender: Gender; looks: Looks & { age: number }; outfit: string };

function subjectWords({ gender, looks }: Subject): string {
  return [
    `a ${Math.max(IMAGE_MIN_AGE, looks.age)}-year-old ${ethnicityWords(gender, looks.ethnicity)}`,
    detailWords("skin_tone", looks.skin_tone),
    hairWords(gender, looks.hair_style, looks.hair_color),
    pick("eyes", gender, looks.eyes)?.prompt,
    gender === "man" ? pick("facial_hair", gender, looks.facial_hair)?.prompt : undefined,
    pick("body", gender, looks.body)?.prompt,
    gender === "woman" && looks.breasts ? pick("breasts", gender, looks.breasts)?.prompt : undefined,
    looks.after_dark?.butt ? pick("butt", gender, looks.after_dark.butt, true)?.prompt : undefined,
    ...shownDetailWords(looks),
  ]
    .filter(Boolean)
    .join(", ");
}

/** A show (PG) tile's prompt: a clean studio photograph, fully dressed. */
export function pgPrompt(s: Subject, framing: string, anime = false, detail?: string): string {
  const [medium, finish] = anime
    ? ["Clean modern anime illustration", "Cel shading, a clearly grown adult character with mature adult proportions"]
    : ["Photorealistic studio photograph", "85mm lens, sharp focus, natural skin texture"];
  return [
    `${medium} of ${subjectWords(s)}.`,
    ...(detail ? [`${detail}.`] : []),
    `Wearing ${s.outfit}.`,
    `${framing}.`,
    `${finish}. Soft even studio lighting, plain warm light-grey backdrop, a single person, tasteful, no nudity, no text, no watermark.`,
  ].join(" ");
}

/** An After Dark tile's prompt: explicit, adult, the same studio, and said to be an adult twice over. */
export function nsfwPrompt(s: Subject, framing: string): string {
  return [
    `Explicit, uncensored adult photograph of ${subjectWords(s)}.`,
    `${s.outfit === "fully nude" ? "Fully nude" : `Wearing ${s.outfit}`}.`,
    `${framing}.`,
    "Photorealistic, 85mm lens, soft warm studio lighting, plain dark backdrop, a single person, natural skin texture. Everyone shown is an adult.",
  ].join(" ");
}

const outfitWords = (gender: Gender, id: string, afterDark: boolean) =>
  optionPrompt(pick("outfit", gender, id, afterDark) ?? { id, label: id, prompt: "a fitted white t-shirt and blue jeans" }, gender);

/**
 * Every tile the builder shows: for each gender, every option of every picture step on the normal tab (drawn PG), and
 * on the After Dark tab every option of its body steps and outfits (drawn explicit). Plus After Dark's stock baselines.
 */
export function tileSpecs(): TileSpec[] {
  const out: TileSpec[] = [];
  for (const gender of GENDERS) {
    const d = DEFAULTS[gender];
    const base: Looks & { age: number } = { ...d, outfit: undefined } as Looks & { age: number };
    for (const step of stepsFor(gender, false)) {
      if (step.id === "gender" || step.id === "age") continue;
      for (const o of optionsFor(step, gender)) {
        const looks = { ...base, [step.id]: o.id } as Looks & { age: number };
        const outfit = outfitWords(gender, step.id === "outfit" ? o.id : d.outfit, false);
        const framing = FRAMING[step.id] ?? FRAMING.style!;
        out.push({ id: `pg-${gender}-${step.id}-${o.id}`, variant: "pg", gender, step: step.id, option: o.id, seed: SEEDS[gender], prompt: pgPrompt({ gender, looks, outfit }, framing, o.anime) });
      }
    }
    // After Dark: the steps whose pictures change there. Nude for the body steps, the outfit for the outfit step.
    for (const step of stepsFor(gender, true).filter((s) => ["body", "breasts", "butt", "outfit"].includes(s.id))) {
      for (const o of optionsFor(step, gender, true)) {
        const looks = (step.id === "butt" ? { ...base, after_dark: { butt: o.id } } : { ...base, [step.id]: o.id }) as Looks & { age: number };
        const outfit = step.id === "outfit" ? outfitWords(gender, o.id, true) : "fully nude";
        out.push({ id: `nsfw-${gender}-${step.id}-${o.id}`, variant: "nsfw", gender, step: step.id, option: o.id, seed: SEEDS[gender], prompt: nsfwPrompt({ gender, looks, outfit }, FRAMING[step.id]!) });
      }
    }
  }
  for (const b of BASELINES) out.push(baselineSpec(b.gender, b.ethnicity, b.body));
  return out;
}

/**
 * After Dark's stock baselines (David: "a few baselines… so if they do pay for NSFW we have good baseline images to
 * work with"): one nude, face-forward waist-up picture per gender, ethnicity and a few body types. A character whose
 * own baseline isn't made yet can start from the nearest one (nearestBaseline).
 */
const BASELINE_BODIES: Record<Gender, readonly string[]> = { woman: ["slim", "athletic", "curvy"], man: ["athletic", "average"] };
export const BASELINES: readonly { gender: Gender; ethnicity: string; body: string }[] = GENDERS.flatMap((gender) =>
  ids("ethnicity").flatMap((ethnicity) => BASELINE_BODIES[gender].map((body) => ({ gender, ethnicity, body }))),
);

function baselineSpec(gender: Gender, ethnicity: string, body: string): TileSpec {
  const looks = { ...DEFAULTS[gender], outfit: undefined, ethnicity, body } as Looks & { age: number };
  return {
    id: `nsfw-${gender}-baseline-${ethnicity}-${body}`,
    variant: "nsfw",
    gender,
    step: "baseline",
    option: `${ethnicity}-${body}`,
    seed: SEEDS[gender] + 1,
    prompt: nsfwPrompt({ gender, looks, outfit: "fully nude" }, FRAMING.baseline!),
  };
}

/** The stock baseline nearest a look: same gender and ethnicity, the closest body type listed. Null without a gender. */
export function nearestBaseline(l: Looks | undefined): string | null {
  if (!l?.gender) return null;
  const bodies = BASELINE_BODIES[l.gender];
  const body = l.body && bodies.includes(l.body) ? l.body : l.body === "plus" || l.body === "average" ? bodies.at(-1)! : l.body === "muscular" ? "athletic" : bodies[0];
  return `nsfw-${l.gender}-baseline-${l.ethnicity ?? DEFAULTS[l.gender].ethnicity}-${body}`;
}

/** The tile for an option on a tab: After Dark's own where it has one, else the show's. */
export function tileId(gender: Gender, step: LookStepId, option: string, afterDark: boolean): string {
  const nsfw = afterDark && ["body", "breasts", "butt", "outfit"].includes(step);
  return `${nsfw ? "nsfw" : "pg"}-${gender}-${step}-${option}`;
}
/** The gender tiles have no picture of their own: they borrow the ethnicity step's default. */
export const genderTileId = (g: Gender): string => `pg-${g}-style-realistic`;

export const isTileId = (id: string): boolean => /^(pg|nsfw)-(woman|man)-[a-z_]+-[a-z0-9_-]+$/.test(id);

/* --------------------------------------------- the portrait --------------------------------------------- */

/**
 * What a character's kind (lib/kinds.ts) looks like in its portrait: fixed words, like every other part of the prompt
 * (nothing typed reaches the image model). A human, or "something else", adds nothing.
 */
const KIND_LOOK_WORDS: Partial<Record<KindId, string>> = {
  vampire: "A vampire: very pale skin, faintly red eyes, a small hint of fangs in the smile, an elegant old-world air",
  werewolf: "A werewolf in human form: thick untamed hair, amber eyes, a faint wildness about them",
  ghost: "A ghost: pale and softly translucent, with a faint silvery glow and an old-fashioned air",
  robot: "A friendly humanoid robot: a sculpted metal face with a warm expression, visible mechanical seams and joints, softly glowing eyes",
  alien: "A humanoid alien: softly coloured otherworldly skin, large luminous eyes, subtle markings at the temples",
  witch: "A witch: silver rings, a few dried herbs tucked into the hair, a knowing look",
  fae: "One of the fae: delicate pointed ears, a few leaves woven into the hair, faintly luminous skin",
  merfolk: "A merperson on land: faint iridescent scales along the neck and cheekbones, sea-glass eyes, damp hair",
  monster: "A friendly monster: an unusual but charming non-human face, kind eyes",
  animal: "A talking animal: an anthropomorphic animal character with expressive eyes",
};

/**
 * A character's portrait from its picks (lib/looks-draw.ts drawLooksPortrait): head and shoulders, dressed, PG. The age
 * is the look's own pick, else the character's capped at the oldest look (a 212-year-old vampire is drawn 60 at most,
 * not 212), and its kind adds its own fixed words.
 */
export function looksPortraitPrompt(l: Looks, age: number, kind?: KindId | null): string | null {
  if (!l.gender) return null;
  const d = DEFAULTS[l.gender];
  const looks = { ...d, ...l, breasts: undefined, after_dark: undefined, age: l.age ?? Math.min(age, LOOK_MAX_AGE) } as Looks & { age: number };
  return pgPrompt(
    { gender: l.gender, looks, outfit: outfitWords(l.gender, l.outfit ?? d.outfit, false) },
    "Head-and-shoulders portrait, facing the camera, warm natural smile",
    l.style === "anime",
    kind ? KIND_LOOK_WORDS[kind] : undefined,
  );
}
