/**
 * The names of the people in a show character's life (docs/PRDs/social-network.md section 6.2, Phase 2b), as the show
 * writes them. The backfill (scripts/social/backfill-circles.mjs) renames by these rules before it sends a circle, and
 * the site's own check of every circle (lib/social/circles.ts planCircle) renames by them again, so a newcomer's circle
 * from the season generator keeps them too.
 *
 * The first production run (2026-11-20, 121 characters) is why: 24 Eleanors and 16 Lilas among 338 people, "Maeve
 * Thorne" in two different characters' lives, and people outside the family with show characters' surnames (11
 * Thornes, who read as Barnaby Thorne's family).
 *
 * - A first name is used at most FIRST_NAME_MAX times across the show's people, and a full name once (never a
 *   character's).
 * - Close family (parents, full siblings, children, grandchildren) has the character's own surname; the rest of the
 *   family has it or one of its own, never another show character's. Anyone else never has a show character's surname,
 *   the character's own included. (The site's other characters' surnames are anyone's: a common surname on someone's
 *   character doesn't make every Chen on the show its family.)
 * - A person who breaks a rule is renamed from the OC name generator's lists in the character's style
 *   (lib/oc-name-pools.ts), and a note that says their old first name says the new one.
 *
 * No imports but types, so the plain-JS backfill loads it as it is.
 */
import type { NameKind, OcNameStyle } from "../oc-name-pools";

/** How many of the show's people may share a first name. */
export const FIRST_NAME_MAX = 3;

/** What the rules read: how often a first name is used, whether a full name is taken, whether a surname is a character's. */
export type NameBook = { firstCount(first: string): number; hasFull(name: string): boolean; surnameTaken(last: string): boolean };
/** Where new names come from (lib/oc-name-pools.ts nameDraws). */
export type NameDraws = {
  first(kind: NameKind, ok: (first: string) => boolean): string | null;
  last(ok: (last: string) => boolean): string | null;
  kindOf(first: string): NameKind | null;
};

const wordsOf = (name: string | null | undefined): string[] => (name ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
/** A name's first word. */
export const firstNameOf = (name: string | null | undefined): string => wordsOf(name)[0] ?? "";
/** A name's surname: its last word, or null for a one-word name. */
export function surnameOf(name: string | null | undefined): string | null {
  const w = wordsOf(name);
  return w.length > 1 ? w[w.length - 1] : null;
}
const withFirst = (name: string, first: string): string => [first, ...wordsOf(name).slice(1)].join(" ");
const withLast = (name: string, last: string): string => {
  const w = wordsOf(name);
  return [...(w.length > 1 ? w.slice(0, -1) : w), last].join(" ");
};

/**
 * The style a character's own words put it in (bio, archetype, job, hometown, traits): a starship or a cyborg is
 * sci-fi, an elf or a mage fantasy, a vampire or a crypt gothic, a cottage or a bakery cozy, and anyone else modern.
 * Words ordinary bios use ("a knight in shining armour", "saving the planet", "fairy lights", "spells trouble") are left
 * out, so a modern character isn't given a mage's family.
 */
const STYLE_WORDS: readonly (readonly [OcNameStyle, RegExp])[] = [
  ["scifi", /\b(starships?|spaceships?|space stations?|interstellar|hyperspace|asteroids?|cyborgs?|droids?|cybernetic|light-years?)\b/i],
  ["fantasy", /\b(elf|elves|elven|mages?|wizards?|sorcer(?:er|ers|ess|esses|y)|dragons?|fae|faerie|enchant(?:ed|ress|ment)|potions?|druids?|orcs?|dwarf|dwarves|centaurs?|mermaids?|nymphs?)\b/i],
  ["gothic", /\b(vampires?|vampiric|gothic|haunted|crypts?|cemeter(?:y|ies)|undead|necromancers?|occult|spectral|gargoyles?|coffins?|victorian)\b/i],
  ["cozy", /\b(cottages?|bakery|bakeries|bakers?|knit(?:s|ting|ter)?|small[- ]town|beekeep(?:er|ers|ing)|quilt(?:s|ing|er)?|tea ?shops?)\b/i],
];
export function nameStyleOf(words: string | null | undefined): OcNameStyle {
  for (const [style, re] of STYLE_WORDS) if (re.test(words ?? "")) return style;
  return "modern";
}

/** Family words in a relation as the writers say it ("their mother", "aunt or uncle", "half-sibling"): a tie in the kin layer. */
const FAMILY =
  /\b(parents?|mother|mum|mom|mama|father|dad|papa|step-?(?:mother|father|mum|mom|dad|parent|sister|brother|sibling|son|daughter|child)s?|half-?(?:sister|brother|sibling)s?|siblings?|sisters?|brothers?|twins?|sons?|daughters?|child(?:ren)?|grand\w*|gran|granny|nan|nana|nanna|cousins?|aunts?|aunties|auntie|aunty|uncles?|nieces?|nephews?|in-laws?|family)\b/i;
/** Whether a relation is family (lib/social/relations.ts kindFromWords puts it in the kin layer); a "family friend" isn't. */
export const isFamilyWords = (relation: string | null | undefined): boolean => !/friend/i.test(relation ?? "") && FAMILY.test(relation ?? "");

/** The kinds whose people share the character's surname (lib/social/kinds.ts): its parents, full siblings, children and grandchildren. */
export const SHARES_SURNAME_KINDS: readonly string[] = ["parent", "sibling", "child", "grandchild"];
const CLOSE_FAMILY = /\b(parents?|mother|mum|mom|mama|father|dad|papa|siblings?|sisters?|brothers?|twins?|sons?|daughters?|child(?:ren)?|grand(?:son|daughter|child)s?|grandchildren)\b/i;
/**
 * Whether a relation is close family who share the character's surname ("their mother", "younger brother", "twin"), as
 * kindFromWords reads it into SHARES_SURNAME_KINDS: never a step-, half- or in-law, a godparent or a grandparent.
 */
export const sharesSurnameWords = (relation: string | null | undefined): boolean => {
  const r = relation ?? "";
  return isFamilyWords(r) && CLOSE_FAMILY.test(r) && !/\b(step|half|in-?laws?|god)/i.test(r);
};

/**
 * The surname a character's close family shares: its name's last word, unless the name reads as a title or epithet
 * ("Papiros The Inevitable", "Duke of Brine") or the word isn't a name.
 */
export function familySurnameOf(name: string | null | undefined): string | null {
  const w = wordsOf(name);
  if (w.length < 2 || w.some((x) => /^(the|of)$/i.test(x))) return null;
  const last = w[w.length - 1];
  return /^\p{Lu}[\p{L}'’-]*$/u.test(last) ? last : null;
}

const FEMININE = /\b(mother|mum|mom|mama|mommy|mummy|stepmother|stepmum|stepmom|grandmother|grandma|gran|granny|nan|nana|nanna|sisters?|stepsister|daughters?|stepdaughter|granddaughter|aunts?|auntie|aunty|nieces?|godmother|wife|girlfriend)\b/i;
const MASCULINE = /\b(father|dad|daddy|papa|stepfather|stepdad|grandfather|grandpa|gramps|brothers?|stepbrother|sons?|stepson|grandson|uncles?|nephews?|godfather|husband|boyfriend)\b/i;
/** The kind of first name a person's relation or pronouns call for ("their mother": feminine), or null when neither says. */
export function personNameKind(relation: string | null | undefined, pronouns: string | null | undefined): NameKind | null {
  const r = relation ?? "";
  if (FEMININE.test(r) && !MASCULINE.test(r)) return "feminine";
  if (MASCULINE.test(r) && !FEMININE.test(r)) return "masculine";
  const p = (pronouns ?? "").toLowerCase();
  if (/^\s*she\b/.test(p)) return "feminine";
  if (/^\s*he\b/.test(p)) return "masculine";
  if (/^\s*they\b/.test(p)) return "neutral";
  return null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A text with one first name changed for another, whole words only ("Eleanor's" too, never "Eleanora"). */
function renamedIn(text: string | null | undefined, from: string, to: string): string | null {
  if (!text) return text ?? null;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from)}(?![\\p{L}\\p{N}])`, "gu"), to);
}

export type PersonName = { ok: true; name: string; note: string | null; why: string[] } | { ok: false; reason: string };

/**
 * One person's name by the rules, against what `book` says is used (the caller adds the name to it once kept): the
 * same name, or a new one with why, or why none would do. `kin`: the tie is family; `shares`: close family, who share
 * the character's surname; `holderLast`: the character's own surname (its name's last word); `familyLast`: the surname
 * its family shares (familySurnameOf: none for a title or an epithet).
 */
export function personName(
  p: { name: string; relation?: string | null; pronouns?: string | null; note?: string | null },
  o: { kin: boolean; shares?: boolean; holderLast: string | null; familyLast?: string | null; book: NameBook; draws: NameDraws },
): PersonName {
  const { kin, book, draws } = o;
  const own = o.holderLast?.toLowerCase() ?? null;
  const familyLast = o.familyLast === undefined ? o.holderLast : o.familyLast;
  const before = wordsOf(p.name).join(" ");
  let name = before;
  const why: string[] = [];
  const kind = (): NameKind => personNameKind(p.relation, p.pronouns) ?? draws.kindOf(firstNameOf(before)) ?? "neutral";
  const freeSurname = (n: string) => (x: string) => x.toLowerCase() !== own && !book.surnameTaken(x) && !book.hasFull(withLast(n, x));
  const freeFirst = (n: string) => (x: string) => book.firstCount(x) < FIRST_NAME_MAX && !book.hasFull(withFirst(n, x));

  // Surnames: close family has the character's; family never has another character's; anyone else never has a
  // character's at all. (A one-word name has no surname to change.)
  const last = surnameOf(name)?.toLowerCase() ?? null;
  if (last && kin && last !== own && book.surnameTaken(last)) {
    const to = familyLast ?? draws.last(freeSurname(name));
    if (!to) return { ok: false, reason: "another character's surname, and none free" };
    name = withLast(name, to);
    why.push(familyLast ? "family: their surname, not another character's" : "family: not another character's surname");
  } else if (last && kin && o.shares && familyLast && last !== familyLast.toLowerCase()) {
    name = withLast(name, familyLast);
    why.push("close family: their surname");
  } else if (last && !kin && (last === own || book.surnameTaken(last))) {
    const to = draws.last(freeSurname(name));
    if (!to) return { ok: false, reason: "a character's surname, and none free" };
    name = withLast(name, to);
    why.push(last === own ? "not family: not their surname" : "not family: not a character's surname");
  }
  // First names: never a fourth.
  const first = firstNameOf(name);
  if (book.firstCount(first) >= FIRST_NAME_MAX) {
    const to = draws.first(kind(), freeFirst(name));
    if (!to) return { ok: false, reason: `${FIRST_NAME_MAX} called ${first} already` };
    name = withFirst(name, to);
    why.push(`${FIRST_NAME_MAX} called ${first} already`);
  }
  // A full name someone has: anyone else takes a surname of their own; family keeps the surname and changes first name.
  if (book.hasFull(name)) {
    const to = !kin && surnameOf(name) ? draws.last(freeSurname(name)) : null;
    const f = to ? null : draws.first(kind(), freeFirst(name));
    if (!to && !f) return { ok: false, reason: "a name someone has already" };
    name = to ? withLast(name, to) : withFirst(name, f!);
    why.push("a name someone has already");
  }
  const note = firstNameOf(name) !== firstNameOf(before) ? renamedIn(p.note, firstNameOf(before), firstNameOf(name)) : (p.note ?? null);
  return { ok: true, name, note, why };
}
