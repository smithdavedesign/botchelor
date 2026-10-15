/**
 * A character's optional details — the dating-profile layer on top of the sheet: what they do, where they're
 * from, their style, hobbies, quirks, what a good date looks like to them, and a few Hinge-style profile
 * prompts. All optional, all public (shown on the contestant card), all content-filtered like the sheet.
 *
 * They reach the date's models as the character's own knowledge of itself (lib/character.ts), and what's
 * visible at a glance (style, a signature item) is what the other character "can see". They flavour the
 * dialogue; they never touch the engine, so editing them changes how future dates sound, never how any date
 * ends. Pure data + zod, no server imports: the builder (a client component) and the API share this file.
 */
import { z } from "zod";

export const STAR_SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
  "Doesn't believe in it",
] as const;

export const LOVE_LANGUAGES = ["Words of affirmation", "Quality time", "Gifts", "Acts of service", "Physical touch"] as const;

/** Hinge-style profile prompts: a creator picks up to three and answers them. */
export const PROFILE_PROMPTS = [
  { id: "win_me_over", label: "The way to win me over is…" },
  { id: "irrational_fear", label: "My most irrational fear…" },
  { id: "weirdly_attracted", label: "I'm weirdly attracted to…" },
  { id: "two_truths", label: "Two truths and a lie…" },
  { id: "simple_pleasures", label: "My simple pleasures…" },
  { id: "fall_for_you", label: "I'll fall for you if…" },
  { id: "dating_me_is_like", label: "Dating me is like…" },
  { id: "geek_out", label: "I geek out on…" },
  { id: "worst_first_date", label: "My worst first-date story…" },
  { id: "shower_thought", label: "A shower thought I recently had…" },
  { id: "together_we_could", label: "Together, we could…" },
  { id: "unpopular_opinion", label: "My most unpopular opinion…" },
] as const;
export type PromptId = (typeof PROFILE_PROMPTS)[number]["id"];
const PROMPT_IDS = PROFILE_PROMPTS.map((p) => p.id) as [PromptId, ...PromptId[]];
export const MAX_PROMPTS = 3;
export const MAX_HOBBIES = 5;

/** The free-text details, with their limits and labels (also the order they're shown in). */
export const TEXT_DETAILS = {
  occupation: { label: "Occupation", max: 60 },
  hometown: { label: "Hometown", max: 60 },
  style: { label: "Style", max: 80 },
  signature_item: { label: "Signature item", max: 60 },
  go_to_order: { label: "Go-to order", max: 60 },
  walk_on_music: { label: "Walk-on music", max: 80 },
  quirk: { label: "Quirk", max: 120 },
  catchphrase: { label: "Catchphrase", max: 80 },
  hidden_talent: { label: "Hidden talent", max: 80 },
  pet_peeve: { label: "Pet peeve", max: 80 },
  guilty_pleasure: { label: "Guilty pleasure", max: 80 },
  ideal_first_date: { label: "Ideal first date", max: 120 },
  green_flag: { label: "Green flag", max: 80 },
  red_flag: { label: "Red flag they ignore", max: 80 },
} as const;
export type TextDetail = keyof typeof TEXT_DETAILS;
export const TEXT_DETAIL_KEYS = Object.keys(TEXT_DETAILS) as TextDetail[];

const opt = (max: number) => z.string().trim().max(max, `At most ${max} characters.`).optional();

export const ExtrasInput = z
  .object({
    ...(Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, opt(TEXT_DETAILS[k].max)])) as Record<TextDetail, ReturnType<typeof opt>>),
    star_sign: z.enum(STAR_SIGNS).optional(),
    love_language: z.enum(LOVE_LANGUAGES).optional(),
    hobbies: z.array(z.string().trim().min(1).max(30)).max(MAX_HOBBIES, `At most ${MAX_HOBBIES} hobbies.`).optional(),
    prompts: z
      .array(z.object({ id: z.enum(PROMPT_IDS), answer: z.string().trim().min(1).max(160) }))
      .max(MAX_PROMPTS, `At most ${MAX_PROMPTS} prompts.`)
      .optional(),
  })
  .strict();
export type ExtrasInputType = z.infer<typeof ExtrasInput>;

/** Stored details: only what was filled in. */
export type CharacterExtras = Partial<Record<TextDetail, string>> & {
  star_sign?: (typeof STAR_SIGNS)[number];
  love_language?: (typeof LOVE_LANGUAGES)[number];
  hobbies?: string[];
  prompts?: { id: PromptId; answer: string }[];
};

/** Drops blanks and duplicates, so an emptied field is removed rather than stored as "". */
export function normaliseExtras(input: ExtrasInputType | null | undefined): CharacterExtras {
  const out: CharacterExtras = {};
  if (!input) return out;
  for (const k of TEXT_DETAIL_KEYS) {
    const v = input[k]?.trim();
    if (v) out[k] = v;
  }
  if (input.star_sign) out.star_sign = input.star_sign;
  if (input.love_language) out.love_language = input.love_language;
  const hobbies = [...new Set((input.hobbies ?? []).map((h) => h.trim()).filter(Boolean))];
  if (hobbies.length) out.hobbies = hobbies;
  const seen = new Set<string>();
  const prompts = (input.prompts ?? []).filter((p) => p.answer.trim() && !seen.has(p.id) && seen.add(p.id));
  if (prompts.length) out.prompts = prompts.map((p) => ({ id: p.id, answer: p.answer.trim() }));
  return out;
}

export const hasExtras = (e: CharacterExtras | null | undefined): boolean => Boolean(e && Object.keys(e).length);

/** Every free-text detail, for the content filter (lib/safety.ts checkFields). */
export function extrasFields(e: CharacterExtras): Record<string, string | readonly string[] | undefined> {
  return {
    ...Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, e[k]])),
    hobbies: e.hobbies,
    prompts: e.prompts?.map((p) => p.answer),
  };
}

export const promptLabel = (id: string): string => PROFILE_PROMPTS.find((p) => p.id === id)?.label ?? id;

/** How the details read to the character itself on a date (its own knowledge; anything it may bring up). */
export function extrasForPrompt(e: CharacterExtras): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_DETAIL_KEYS) if (e[k]) out[k] = e[k];
  if (e.star_sign) out.star_sign = e.star_sign;
  if (e.love_language) out.love_language = e.love_language;
  if (e.hobbies?.length) out.hobbies = e.hobbies;
  if (e.prompts?.length) out.profile_answers = e.prompts.map((p) => `${promptLabel(p.id)} ${p.answer}`);
  return out;
}

/** What the other character can see at a glance: only the visible details. */
export function extrasVisible(e: CharacterExtras): string[] {
  return [e.style ? `dressed: ${e.style}` : null, e.signature_item ? `has ${e.signature_item}` : null].filter((s): s is string => Boolean(s));
}

/** Text worth searching (lib/dating.ts): everything public. */
export function extrasText(e: CharacterExtras): string {
  return [...TEXT_DETAIL_KEYS.map((k) => e[k] ?? ""), ...(e.hobbies ?? []), ...(e.prompts ?? []).map((p) => p.answer)].join(" ");
}

/** The details as a JSON Schema (draft-07 compatible), for /character.schema.json and the MCP tools. */
export function extrasJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    description:
      "Optional public details that make a date specific: what they do, where they're from, how they dress, hobbies, quirks, and up to three profile prompts. All optional. They shape the dialogue, never the outcome.",
    properties: {
      ...Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, { type: "string", maxLength: TEXT_DETAILS[k].max, description: TEXT_DETAILS[k].label }])),
      star_sign: { type: "string", enum: [...STAR_SIGNS] },
      love_language: { type: "string", enum: [...LOVE_LANGUAGES] },
      hobbies: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: MAX_HOBBIES },
      prompts: {
        type: "array",
        maxItems: MAX_PROMPTS,
        description: `Profile prompts, answered in the character's voice. Prompt ids: ${PROFILE_PROMPTS.map((p) => `${p.id} ("${p.label}")`).join(", ")}.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "answer"],
          properties: { id: { type: "string", enum: PROFILE_PROMPTS.map((p) => p.id) }, answer: { type: "string", maxLength: 160 } },
        },
      },
    },
  };
}

/* ------------------------------------- 🎲 suggestions for the builder ------------------------------------- */

/** Fun, original, rule-safe ideas the builder's dice draw from (only ever into blank fields). */
export const SUGGESTIONS: Partial<Record<TextDetail | "hobbies", readonly string[]>> = {
  occupation: [
    "Lighthouse keeper", "Competitive cheese judge", "Night-shift museum guard", "Ferris wheel mechanic", "Professional apologizer for a theme park",
    "Cloud-shape consultant", "Fortune-cookie writer", "Ghost-tour guide who's scared of the dark", "Escape-room designer", "Zamboni driver",
    "Retired mime, now a podcaster", "Bespoke umbrella maker", "Hot-air balloon pilot", "Crossword constructor", "Train-station piano tuner",
  ],
  // Lower-case starts: the card reads "from <hometown>".
  hometown: [
    "a fishing village with one traffic light", "a desert town with a famous diner", "a city where it always seems to be raining", "a mountain hamlet famous for goats",
    "an island you can walk around in an hour", "a suburb that peaked in 1987", "a canal town full of bicycles", "somewhere with excellent bakeries",
  ],
  style: [
    "Thrifted cardigans and mismatched socks", "All black, one loud pair of shoes", "Linen everything, permanently creased", "Vintage suits two sizes too big",
    "Outdoor gear for a hike that never happens", "Pastels and a tote bag full of snacks", "Sharp blazer, sneakers, zero regrets",
  ],
  signature_item: [
    "a yellow raincoat", "a pocket watch that runs four minutes fast", "one enormous ring", "a bucket hat in every weather", "a fountain pen", "a thermos of soup",
    "a vintage camera", "a scarf longer than they are",
  ],
  go_to_order: [
    "Whatever the bartender is proudest of", "Two desserts, no main", "The spiciest thing on the menu", "Tea, extremely specific instructions", "Fries for the table",
  ],
  walk_on_music: [
    "A kazoo cover of a sea shanty", "Dramatic organ chords", "Lo-fi beats and rain sounds", "A marching band at half speed", "A one-person theremin solo",
  ],
  quirk: [
    "Narrates their own life in the third person when nervous", "Names every houseplant after a retired detective", "Keeps a ranked list of the city's best benches",
    "Can't walk past a dog without saying hello", "Collects free hotel pens, cross-referenced by city", "Answers questions with a different question",
  ],
  catchphrase: ["“That's a problem for future me.”", "“Let's make it weird.”", "“Bold of you to assume I have a plan.”", "“Say less.”", "“Hold that thought — snack break.”"],
  hidden_talent: [
    "Can identify any bird by its call", "Juggles, but only fruit", "Perfect handstand, terrible landing", "Can fold a fitted sheet", "Remembers every phone number they've ever seen",
  ],
  pet_peeve: ["People who clap when the plane lands", "Lukewarm tea", "Reply-all", "Chewing with confidence", "Stopping at the top of escalators"],
  guilty_pleasure: ["Reality TV with the volume all the way up", "Breakfast for dinner, every night", "Reading the last page first", "Karaoke alone in the car", "Online quizzes about which bread they are"],
  ideal_first_date: [
    "A night market with too many snacks", "Mini golf, competitively", "A long walk that accidentally becomes a short hike", "Stargazing with a thermos", "A cooking class where both are bad at it",
  ],
  green_flag: ["Tips well", "Remembers small details", "Laughs at their own jokes", "Asks follow-up questions", "Kind to waiters"],
  red_flag: ["Has opinions about fonts", "Owns a gong", "Rehearses arguments in the shower", "Says “literally” figuratively", "Brings a laminated itinerary"],
  hobbies: ["Birdwatching", "Pottery", "Bouldering", "Karaoke", "Baking", "Chess", "Night swimming", "Board games", "Thrifting", "Tarot", "Gardening", "Stargazing", "Roller skating"],
};

/** A deterministic pick when a seed is given (tests), else random. */
export function suggest(key: keyof typeof SUGGESTIONS, seed?: number): string {
  const list = SUGGESTIONS[key] ?? [];
  if (!list.length) return "";
  const i = seed === undefined ? Math.floor(Math.random() * list.length) : Math.abs(seed) % list.length;
  return list[i];
}
