/**
 * Scene cards (David, 2026-11-17, after comparing Botchelor's roleplay with Chub's character cards: "add this level of
 * context behind the scenes when someone chooses it for both companions, and after dark, and the show"). A roleplay was a
 * title, a premise and two roles. Its card is the context behind it, which the person never has to read: how it starts,
 * what each of them wants and what's in the way, a few turns the story can take, its tone, and three ways it can open.
 * Picking the roleplay puts the card into the prompts: lib/roleplays.ts on a show date, lib/companion.ts in a companion's
 * scene, lib/adult/roleplays.ts in After Dark (docs/scene-cards.md says which field goes where).
 *
 * A card is framing, like the roleplay it belongs to. Its beats are possibilities, never a script, and nothing in a card
 * says or implies how the night ends: the show's engine alone decides that, and After Dark's own writer and stage rules
 * decide how far a night goes. Every card is two adults who both want to be there. The show's are PG. After Dark's are
 * story cards (stakes, wants, banter, what's in the way) with no explicit word in them. tests/scene-cards.test.ts holds
 * every card to the function for its side (lib/scene-card-check.ts showCardIssue, adultCardIssue).
 *
 * Pure and client-safe, like lib/roleplays.ts. Holding a text to the content filter is the server's
 * (lib/scene-card-check.ts), so its word lists stay out of the pickers' code in the browser (2026-11-22 audit).
 */
import { dateRoleplayById, premiseForYou, withoutLeaningVerbs, type RoleplayTerms } from "./roleplays";

export type SceneCard = {
  /** How it starts: the first minute, one or two sentences, with {a} and {b} like a premise. */
  setup: string;
  /** What each of them wants from the evening and what's in the way, [for {a}, for {b}]. One sentence each. */
  wants: readonly [string, string];
  /** Three or four turns the story can take, in order. Possibilities, never a script, and never an ending. */
  beats: readonly string[];
  /** The tone in a few words ("slow burn, dry banter, a dare under everything"). */
  tone: string;
  /** Three ways it can open, each one sentence with {a} and {b}: the person picks one, and the first line plays it. */
  openings: readonly [string, string, string];
};

/** How long each part of a card may be. An opening a person writes is held to CARD_OPENING_MAX too. */
export const CARD_SETUP_MAX = 240;
export const CARD_WANT_MAX = 200;
export const CARD_BEAT_MAX = 160;
export const CARD_BEATS_MIN = 3;
export const CARD_BEATS_MAX = 4;
export const CARD_TONE_MAX = 80;
export const CARD_OPENING_MAX = 160;

/**
 * Three openings for a scene with no roleplay: PG, with no place in them (they play anywhere the show has a set), {a}
 * and {b} as in a card.
 */
export const GENERIC_OPENINGS: readonly [string, string, string] = [
  "{a} got there first and has been pretending not to watch the door when {b} walks in.",
  "{a} and {b} arrive at the same moment from opposite directions, and both pretend that was the plan.",
  "{b} is late and a little out of breath, and {a} has already decided not to mention it.",
];

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** A card with every text put through `fn` (names in, or one side's point of view). */
export function mapCard(card: SceneCard, fn: (text: string) => string): SceneCard {
  return {
    setup: fn(card.setup),
    wants: [fn(card.wants[0]), fn(card.wants[1])],
    beats: card.beats.map(fn),
    tone: fn(card.tone),
    openings: [fn(card.openings[0]), fn(card.openings[1]), fn(card.openings[2])],
  };
}

/** One text of a card with their first names in for {a} and {b}. */
export function fillCardText(text: string, names: { a: string; b: string }): string {
  return text.replaceAll("{a}", firstName(names.a)).replaceAll("{b}", firstName(names.b));
}

/** The card with their first names in for {a} and {b}. */
export function fillCard(card: SceneCard, names: { a: string; b: string }): SceneCard {
  return mapCard(card, (t) => fillCardText(t, names));
}

/**
 * The card from a person's side, when one of the two is the person themselves (a companion's scene): their place is
 * "you" with the verbs agreeing, the other is `them` (lib/roleplays.ts premiseForYou, on every field). The cards are
 * written so that reads right from either side (tests/scene-cards.test.ts).
 */
export function cardForYou(card: SceneCard, youAre: "a" | "b", them: string): SceneCard {
  return mapCard(card, (t) => premiseForYou(t, youAre, them));
}

/**
 * The card as a page shows it to the person playing one side: cardForYou, with nothing left that reads wrong as "you".
 * The show's own cards never do (tests/scene-cards.test.ts). A card drafted for a roleplay someone wrote themselves
 * (lib/adult/own-roleplay-card.ts) can keep a verb leaning on a name ("You want to ask, but worries Mara will laugh"):
 * what's shown stops before that clause (lib/roleplays.ts withoutLeaningVerbs). A writer is always given the card whole.
 */
export function cardShownToYou(card: SceneCard, youAre: "a" | "b", them: string): SceneCard {
  return mapCard(cardForYou(card, youAre, them), (t) => withoutLeaningVerbs(t, them));
}

/**
 * A premise told to the person playing one side, where it stands as a card's text (a roleplay someone wrote themselves
 * and has no card for yet): premiseForYou, and a capital first letter however they began it ("the last ferry of the
 * night, …"). Their own sentence, so nothing of it is cut.
 */
export function premiseShownToYou(premise: string, youAre: "a" | "b", them: string): string {
  const told = premiseForYou(premise, youAre, them).trim();
  return told ? told[0].toUpperCase() + told.slice(1) : told;
}

/** A small stable hash of a string (FNV-1a): the same seed always gives the same number. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Which of three openings a seed takes when nobody picked: stable, and not always the first. */
export function openingIndex(seed: string): 0 | 1 | 2 {
  return (hash(seed) % 3) as 0 | 1 | 2;
}

/**
 * The chosen opening's text, with its {a} and {b} still in it. A number picks one of the card's three; a string is one a
 * person wrote (the caller has already checked it); nothing picked takes one of the three by a stable hash of `seed` (a
 * date's id, a thread's), so the same date always opens the same way and not always on the first. Null when there's no
 * card and nothing was written.
 */
export function openingOf(card: Pick<SceneCard, "openings"> | null | undefined, pick: number | string | null | undefined, seed?: string): string | null {
  if (typeof pick === "string" && pick.trim()) return pick.trim();
  if (!card) return null;
  if (typeof pick === "number" && Number.isInteger(pick) && pick >= 0 && pick <= 2) return card.openings[pick];
  return card.openings[seed ? openingIndex(seed) : 0];
}

/**
 * A date's or a scene's terms with the opening it plays settled: the one that came with the terms, else one of the
 * roleplay's card by `seed` (openingOf). A roleplay someone wrote has no card, so without an opening of its own it comes
 * back as it was.
 */
export function openedTerms<T extends RoleplayTerms>(rp: T, seed: string): T {
  if (rp.opening) return rp;
  const opening = openingOf(dateRoleplayById(rp.id)?.card, null, seed);
  return opening ? { ...rp, opening } : rp;
}

/* ------------------------------------------------ what a card may say ------------------------------------------------ */

/** Every text in a card, with the field it is. */
export function cardTexts(card: SceneCard): { field: string; text: string }[] {
  return [
    { field: "setup", text: card.setup },
    { field: "wants[0]", text: card.wants[0] },
    { field: "wants[1]", text: card.wants[1] },
    ...card.beats.map((text, i) => ({ field: `beats[${i}]`, text })),
    { field: "tone", text: card.tone },
    ...card.openings.map((text, i) => ({ field: `openings[${i}]`, text })),
  ];
}

/**
 * Words that say how the night ends. A card frames a night and never decides it: on the show the engine alone does
 * (lib/engine.ts), so a beat like "they end up together" would promise what the date may not deliver.
 */
export const CARD_ENDING =
  /\b(end(?:s|ed|ing)? up|by the end|in the end|happily ever after|(?:fall|falls|falling|fell) in love|(?:fall|falls|falling|fell) for each other|(?:go|goes|going|went) home together|(?:leave|leaves|leaving|left) together|walks? away for good|never see(?:s)? each other again|(?:get|gets|getting|got) together|lives? happily)\b/i;

/**
 * The never-list for an After Dark card: the one its roleplays answer to (lib/studio/library.ts ROLEPLAY_NEVER and
 * tests/after-dark-roleplays.test.ts: no family or step-family, no babysitter, teacher or school, nobody young, paid,
 * drunk, trapped or kept from saying no).
 */
export const ADULT_CARD_NEVER =
  /\b(sister|brother|sibling|mother|father|mom|mum|mommy|mummy|dad|daddy|daughter|son|step\w*|aunt|uncle|cousin|niece|nephew|babysit\w*|nanny|au pair|teacher|student|pupil|professor|tutor|lesson|classroom|school|campus|dorm|teen\w*|young|younger|girl|boy|kid|child|drunk|tipsy|wasted|asleep|unconscious|sedated|drugged|forced|force|kidnap\w*|captive|hostage|tied|against (?:her|his|their) will|blackmail\w*|paid|pays|payment|prostitut\w*|escort|intern)\b/i;

/**
 * Explicit words. An After Dark card is a story card: it never describes a sex act and has no use for any of these (the
 * scene's own writer and its stage rules decide how far a night goes, never the card).
 */
export const CARD_EXPLICIT =
  /\b(fuck\w*|cock|cocks|dick|dicks|pussy|cunt|clit\w*|tits?|titties|nipples?|cum|cumming|blow ?jobs?|hand ?jobs?|orgasm\w*|climax\w*|moan\w*|thrust\w*|grind(?:s|ing)?|straddl\w*|grop(?:e|es|ed|ing)|fondl(?:e|es|ed|ing)|lick\w*|suck\w*|penetrat\w*|erect\w*|hard-on|aroused?|arousal|horny|naked|nude|nudity|bare skin|crotch|groin|genital\w*|sex|sexual\w*|sexy|kink\w*|bondage|bdsm|fetish\w*|panties|unbutton\w*|unzip\w*|strip(?:s|ped|ping)?)\b/i;

const STRAY_BRACE = /\{(?![ab]\})|(?<!\{[ab])\}/;

/**
 * What's wrong with a card's shape, or null: the lengths above, {a} and {b} where a writer needs them (both in the
 * setup, each want naming whose it is, someone in every opening), three or four beats, three different openings, and no
 * word that names an ending (CARD_ENDING).
 */
export function cardShapeIssue(card: SceneCard): string | null {
  const max: Record<string, number> = { setup: CARD_SETUP_MAX, wants: CARD_WANT_MAX, beats: CARD_BEAT_MAX, tone: CARD_TONE_MAX, openings: CARD_OPENING_MAX };
  for (const { field, text } of cardTexts(card)) {
    if (!text.trim()) return `${field}: empty`;
    const limit = max[field.replace(/\[\d\]$/, "")];
    if (text.length > limit) return `${field}: ${text.length} characters, over ${limit}`;
    if (STRAY_BRACE.test(text)) return `${field}: a brace that isn't {a} or {b}`;
    const ending = CARD_ENDING.exec(text)?.[0];
    if (ending) return `${field}: names an ending ("${ending}")`;
  }
  if (!card.setup.includes("{a}") || !card.setup.includes("{b}")) return "setup: needs both {a} and {b}";
  if (!card.wants[0].includes("{a}")) return "wants[0]: is {a}'s, and should say so";
  if (!card.wants[1].includes("{b}")) return "wants[1]: is {b}'s, and should say so";
  if (card.beats.length < CARD_BEATS_MIN || card.beats.length > CARD_BEATS_MAX) return `beats: ${card.beats.length}, not ${CARD_BEATS_MIN} to ${CARD_BEATS_MAX}`;
  if (/[{}]/.test(card.tone)) return "tone: no names in the tone";
  if (card.openings.some((o) => !/\{[ab]\}/.test(o))) return "openings: each needs {a} or {b}";
  if (new Set(card.openings).size !== 3) return "openings: three different ones";
  return null;
}
