/**
 * A character's tags, the parts a page can run (lib/tags.ts has the vocabulary; lib/character-tags.ts the table;
 * docs/tags.md). A character carries `type` tags only: what kind of person they are. Setups belong to a pair and a
 * roleplay, themes to a story; status comes from the relationship graph and is never chosen.
 *
 * Three sources, the first that has any wins:
 *  - owner: the character's owner picked them (on /create, the edit page, or MCP update_character);
 *  - house: the show's own hand tags for its code-defined cast (HOUSE_TAGS);
 *  - auto: read from the character's traits (and a few telling words in the bio) by autoTags below, so every
 *    character is findable before anyone picks anything.
 * Pure and client-safe: /create shows the auto ones as suggestions while you type.
 */
import { isTagId, TAGS, tagById, type TagId } from "./tags";

/** The most tags a character carries: enough to describe, few enough that each one means something. */
export const CHARACTER_TAGS_MAX = 4;
/** The most an automatic read gives: it's a guess, so it says less. */
export const AUTO_TAGS_MAX = 3;

export type TagSource = "owner" | "house" | "auto";
export const TAG_SOURCES: readonly TagSource[] = ["owner", "house", "auto"];
export type CharacterTag = { tag: TagId; source: TagSource };

/** The tags a character may carry: the type facet. */
export const CHARACTER_TAG_IDS: readonly TagId[] = TAGS.filter((t) => t.facet === "type").map((t) => t.id);
export const isCharacterTag = (id: unknown): id is TagId => isTagId(id) && tagById(id)?.facet === "type";

/**
 * An owner's pick as sent (a page or MCP): known type tags only, no repeats, at most CHARACTER_TAGS_MAX. An unknown one
 * is an error rather than dropped, so an agent learns the vocabulary instead of losing a tag without a word.
 */
export function parseOwnerTags(v: unknown): { ok: true; tags: TagId[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "tags is a list of tag ids." };
  const tags = [...new Set(v.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : x)))];
  const bad = tags.filter((t) => !isCharacterTag(t));
  if (bad.length) return { ok: false, error: `Unknown tag${bad.length > 1 ? "s" : ""}: ${bad.map(String).join(", ")}. A character's tags are: ${CHARACTER_TAG_IDS.join(", ")}.` };
  if (tags.length > CHARACTER_TAGS_MAX) return { ok: false, error: `At most ${CHARACTER_TAGS_MAX} tags.` };
  return { ok: true, tags: tags as TagId[] };
}

/**
 * Words in a trait that read as a type. A trait is the owner's own word for the character ("Unflappable", "dry-witted",
 * "allergic to small talk"), so each pattern is a handful of plain synonyms, matched whole-word.
 */
const TRAIT_WORDS: Readonly<Record<string, RegExp>> = {
  cold: /\b(stoic|aloof|reserved|detached|unreadable|icy|impassive|guarded|distant|cool-headed|unnervingly still)\b/,
  hard_to_get: /\b(prickly|sharp-tongued|standoffish|tsundere|sardonic|acerbic|haughty|proud|aloof)\b/,
  takes_charge: /\b(bold|commanding|confident|decisive|formidable|assertive|bossy|fearless|in charge|take-charge)\b/,
  rebel: /\b(rebel\w*|reckless|wild|impulsive|daring|chaotic|unpredictable|defiant|restless)\b/,
  moody: /\b(gloomy|brooding|moody|melanchol\w*|cynical|wistful|soulful|lonely|deeply-lonely)\b/,
  morally_grey: /\b(scheming|calculating|calculated|sly|cunning|ruthless|manipulative|devious)\b/,
  jealous: /\b(jealous|possessive|territorial|petty)\b/,
  dangerous: /\b(dangerous|menacing|intimidating|outlaw)\b/,
  high_flyer: /\b(ambitious|driven|wealthy|rich|visionary|grandiose|tycoon)\b/,
  loyal: /\b(loyal|steadfast|devoted|reliable|dependable|faithful|steady)\b/,
  nerd: /\b(bookish|nerd\w*|geek\w*|analytical|pedantic|studious|brilliant|methodical|meticulous|precise)\b/,
  not_human: /\b(vampir\w*|ghost\w*|draconic|alien|android|robotic|demonic|fae|ethereal|undead|immortal|fur-muffled)\b/,
  protective: /\b(protective|guardian|chivalrous|gentle giant|caretaker|practical caretaker)\b/,
  flirt: /\b(flirt\w*|charming|smooth|seductive|charismatic|suave|extremely charming)\b/,
  sweet: /\b(sweet|gentle|kind|shy|tender|soft-spoken|warm|big-hearted|stubbornly tender)\b/,
  sunshine: /\b(cheerful|bubbly|optimistic|sunny|upbeat|bouncy|hopeful|exuberant|perky|joyful)\b/,
  grump: /\b(grump\w*|gruff|curmudgeon\w*|cranky|surly|grouch\w*|sore)\b/,
  mysterious: /\b(mysterious|cryptic|enigmatic|secretive|evasive|esoteric)\b/,
  playful: /\b(playful|mischievous|teasing|whimsical|quirky|silly|funny|cheeky|goofy)\b/,
  romantic: /\b(romantic|sentimental|dreamy|idealistic|poetic|lovesick|secretly sentimental)\b/,
};

/**
 * Words in a bio that say what someone IS, read only for the types a bio says plainly ("a vampire who…", "runs a
 * smuggling ring"). Everyday words ("the kind of person who…") are never read from a bio: they'd tag half the cast.
 */
const BIO_WORDS: Readonly<Record<string, RegExp>> = {
  not_human: /\b(vampire|ghost|dragon|alien|android|robot|demon|faerie|fairy|mermaid|merman|werewolf|centuries[- ]old|from another planet|not quite human)\b/,
  dangerous: /\b(smuggl\w*|crime boss|mob boss|mafia|underworld|con artist|cat burglar|jewel thief)\b/,
  high_flyer: /\b(billionaire|millionaire|ceo|mogul|tycoon|heiress|heir to)\b/,
  protective: /\b(bodyguard|lifeguard|firefighter|paramedic|park ranger)\b/,
  nerd: /\b(physicist|astronomer|programmer|librarian|archivist|chess)\b/,
};

/**
 * The type tags a character's own words suggest, best first: a trait counts twice a bio, ties in the vocabulary's
 * order, at most AUTO_TAGS_MAX. Never a setup, theme or anything from After Dark.
 */
export function autoTags(sheet: { traits: readonly string[]; bio?: string | null }): TagId[] {
  const traits = sheet.traits.map((t) => t.toLowerCase());
  const bio = (sheet.bio ?? "").toLowerCase();
  const score = new Map<TagId, number>();
  for (const id of CHARACTER_TAG_IDS) {
    const t = TRAIT_WORDS[id];
    const b = BIO_WORDS[id];
    const n = (t ? traits.filter((w) => t.test(w)).length * 2 : 0) + (b && b.test(bio) ? 1 : 0);
    if (n) score.set(id, n);
  }
  return [...score.entries()]
    .sort((x, y) => y[1] - x[1] || CHARACTER_TAG_IDS.indexOf(x[0]) - CHARACTER_TAG_IDS.indexOf(y[0]))
    .slice(0, AUTO_TAGS_MAX)
    .map(([id]) => id);
}

/** A character's tags as they're shown: one source only (owner over house over auto), in vocabulary order. */
export function shownTags(rows: readonly CharacterTag[]): TagId[] {
  const src = TAG_SOURCES.find((s) => rows.some((r) => r.source === s));
  return src ? CHARACTER_TAG_IDS.filter((id) => rows.some((r) => r.source === src && r.tag === id)) : [];
}
