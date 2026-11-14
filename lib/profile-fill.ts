/**
 * A dating profile from the sheet alone (2026-11-14 first-session plan, PR1). A first character is built in three steps
 * (identity, look, review): the Dating profile step moved off the quick track, because the swipe deck's two answered
 * prompts and two interests stood between a newcomer and their first date. The deck still needs a profile
 * (lib/extras.ts profileMissing), and so does a later date with another creator's character, so when the profile is
 * empty at Create this fills it from what the sheet already says: a prompt about who they are (the three traits), a
 * prompt about what they want (the want line) and two interests read off the traits. Deterministic from the sheet, so
 * the same sheet always gets the same profile, and nothing already written is ever touched.
 *
 * Pure and client-safe: the builder runs it before POST /api/characters; a test runs it on a bare sheet.
 */
import { MAX_HOBBIES, PROFILE_MIN_INTERESTS, PROFILE_MIN_PROMPTS, SUGGESTIONS, type CharacterExtras, type PromptId } from "./extras";
import { PROMPT_ANSWER_MAX } from "./field-limits";

export type ProfileSheet = { traits: readonly string[]; want: string; name?: string };

/**
 * An interest a trait suggests. A trait is a word about character, an interest is something they do, so this is a
 * reading, not a translation: "bookish" reads as Reading, "bold" as Climbing. Lowercase keys, matched word by word (so
 * "fiercely loyal" reads as loyal); a trait with no word we read gets a seeded pick from the builder's suggestions.
 */
const TRAIT_INTERESTS: Record<string, string> = {
  bookish: "Reading", literary: "Reading", nerdy: "Trivia nights", clever: "Puzzles", witty: "Comedy shows", curious: "Museums",
  mystic: "Tarot", spiritual: "Meditation", dreamy: "Stargazing", romantic: "Old films", poetic: "Poetry", artistic: "Sketching",
  creative: "Pottery", musical: "Live music", loud: "Karaoke", dramatic: "Theatre", theatrical: "Theatre", funny: "Stand-up",
  bold: "Climbing", brave: "Climbing", adventurous: "Hiking", sporty: "Running", athletic: "Running", competitive: "Chess",
  restless: "Road trips", wild: "Night swimming", energetic: "Dancing", playful: "Board games", cheeky: "Pranks",
  calm: "Gardening", gentle: "Gardening", patient: "Baking", kind: "Volunteering", warm: "Cooking for friends", caring: "Cooking for friends",
  generous: "Hosting dinners", loyal: "Pub quizzes", honest: "Long walks", quiet: "Birdwatching", shy: "Birdwatching", thoughtful: "Journaling",
  precise: "Model making", organised: "Spreadsheets", organized: "Spreadsheets", practical: "Woodwork", stubborn: "Marathons", ambitious: "Marathons",
  stylish: "Thrifting", vain: "Thrifting", moody: "Rainy walks", sarcastic: "Bad movie nights", dry: "Crosswords", blunt: "Debating",
  grumpy: "Crosswords", anxious: "Knitting", nervous: "Knitting", sentimental: "Scrapbooking", nostalgic: "Record shopping",
  flirty: "Salsa", charming: "Wine tasting", mysterious: "Ghost stories", dark: "Horror films", morbid: "True crime podcasts",
  optimistic: "Sunrise swims", cheerful: "Picnics", chaotic: "Improv", impulsive: "Improv", lazy: "Naps", hungry: "Food markets",
};

/** A small stable hash, so a trait with no reading still gets the same interest every time. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The interest a trait reads as, or a seeded pick from the builder's own suggestions. */
export function interestFor(trait: string): string {
  const key = trait.trim().toLowerCase();
  for (const word of key.split(/[\s,/-]+/)) {
    const read = TRAIT_INTERESTS[word];
    if (read) return read;
  }
  const pool = SUGGESTIONS.hobbies ?? ["Reading"];
  return pool[hashOf(key) % pool.length];
}

/** Lowercase the first letter of a want line for mid-sentence use, unless it looks like a name (two capitals in a row). */
function midSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^[A-Z][A-Z]/.test(t)) return t;
  return t[0].toLowerCase() + t.slice(1);
}

const clip = (s: string) => (s.length > PROMPT_ANSWER_MAX ? `${s.slice(0, PROMPT_ANSWER_MAX - 1).trimEnd()}…` : s);
const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** "a, b and c" from the filled traits. */
function listWords(xs: string[]): string {
  if (xs.length < 2) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * The two prompt answers the sheet can stand behind: "Dating me is like…" from the traits and "I'll fall for you if…"
 * from the want. Only the ones the sheet has words for; a sheet with no traits and no want gives none.
 */
export function promptsFromSheet(sheet: ProfileSheet): { id: PromptId; answer: string }[] {
  const traits = sheet.traits.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const out: { id: PromptId; answer: string }[] = [];
  if (traits.length >= 3) {
    const article = /^[aeiou]/.test(traits[2]) ? "an" : "a";
    out.push({ id: "dating_me_is_like", answer: clip(`Equal parts ${traits[0]} and ${traits[1]}, with ${article} ${traits[2]} streak.`) });
  }
  else if (traits.length) out.push({ id: "dating_me_is_like", answer: clip(`${listWords(traits).replace(/^./, (c) => c.toUpperCase())}, start to finish.`) });
  const want = sheet.want.trim();
  if (want) out.push({ id: "fall_for_you", answer: clip(sentence(`You're ${midSentence(want)}`)) });
  return out;
}

/**
 * The extras with a complete dating profile: what's already there stays; prompts and interests are added from the sheet
 * only up to what the deck needs (PROFILE_MIN_PROMPTS, PROFILE_MIN_INTERESTS). Returns the same object when nothing was
 * missing, so a caller can tell whether it filled anything.
 */
export function fillProfile(extras: CharacterExtras, sheet: ProfileSheet): CharacterExtras {
  const prompts = (extras.prompts ?? []).filter((p) => p.answer?.trim());
  const hobbies = (extras.hobbies ?? []).map((h) => h.trim()).filter(Boolean);
  if (prompts.length >= PROFILE_MIN_PROMPTS && hobbies.length >= PROFILE_MIN_INTERESTS) return extras;

  const out: CharacterExtras = { ...extras };
  if (prompts.length < PROFILE_MIN_PROMPTS) {
    const used = new Set(prompts.map((p) => p.id));
    const add = promptsFromSheet(sheet).filter((p) => !used.has(p.id));
    out.prompts = [...prompts, ...add.slice(0, PROFILE_MIN_PROMPTS - prompts.length)];
  }
  if (hobbies.length < PROFILE_MIN_INTERESTS) {
    const seen = new Set(hobbies.map((h) => h.toLowerCase()));
    const picks = [...hobbies];
    // Each trait reads as one interest; when traits repeat a reading, the seeded pool fills the gap.
    const candidates = [...sheet.traits.filter((t) => t.trim()).map(interestFor), ...(SUGGESTIONS.hobbies ?? [])];
    for (const c of candidates) {
      if (picks.length >= PROFILE_MIN_INTERESTS || picks.length >= MAX_HOBBIES) break;
      if (seen.has(c.toLowerCase())) continue;
      seen.add(c.toLowerCase());
      picks.push(c);
    }
    out.hobbies = picks;
  }
  return out;
}
