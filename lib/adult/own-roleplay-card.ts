/**
 * The story card of a roleplay someone wrote themselves (David, 2026-11-23: "story beats for your own roleplays").
 *
 * Each of the show's roleplays comes with a scene card (lib/scene-cards.ts): how it starts, what each of the two wants,
 * three or four beats the story can take, a tone and three openings. Step in's story is read off that card
 * (lib/adult/step-in-story.ts): the goal the viewer sees is their side's want, the dots are its beats, and the ending
 * is offered once the last has played. A roleplay from the Create library (lib/studio/library.ts) is a title, a
 * situation and two roles, so it had no goal and no ending; and until now Step in couldn't play one at all.
 *
 * So its card is drafted: one small call on After Dark's own model, from what the person wrote, when the roleplay is
 * saved (app/api/library/route.ts, past the response) or, for one saved earlier, the first time a scene starts in it.
 * A drafted card is held to exactly what a card of the show's is (lib/scene-card-check.ts adultCardIssue: its shape,
 * After Dark's lines, the roleplays' never-list, and nothing explicit, because a card is a story card whatever the
 * roleplay behind it says); one that fails is drafted once more with the reason said back, and when neither can be
 * kept the roleplay simply plays without a story, as it would have. A card is also read from each side as "you"
 * (lib/roleplays.ts premiseForYou), so a draft that would read wrong there ("You still has the key") is asked for
 * again too, but kept if the second is no better: it's inside every line, and a clumsy sentence beats no story.
 *
 * The same draft says where the story is set (David, 2026-11-23, of the show's own: "A place for each card"): a place
 * as the show's roleplays have one (lib/adult/roleplays.ts RoleplayPlace: what a prompt says after "at", and a short
 * heading), held to what theirs are (tests/roleplay-places.test.ts) and to a card's lines. The first live check of a
 * roleplay of someone's own, a story at a night market, opened in a living room under "Their place". A draft whose
 * place can't be kept still gives its card, and a scene in it starts at the character's place.
 *
 * Kept on the roleplay's own row (creator_roleplays.card, with the place inside it, and card_at), so it's drafted
 * once. A scene takes a copy when it starts (lib/adult/roleplays.ts OwnRoleplay), and never reads this again. A
 * roleplay saved before any of this gets its card when a scene starts in it, or past the response of Step in's front
 * page, two at a visit (draftMissingOwnCards).
 *
 * Server only: it carries the content filter's word lists (lib/studio/library.ts, lib/scene-card-check.ts).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import type { ChatMessage, Model } from "../model";
import { leaningVerbAt, premiseForYou } from "../roleplays";
import { checkShowText } from "../safety";
import { adultCardIssue, adultCardTextIssue } from "../scene-card-check";
import { CARD_BEAT_MAX, CARD_BEATS_MIN, CARD_ENDING, CARD_OPENING_MAX, CARD_SETUP_MAX, CARD_TONE_MAX, CARD_WANT_MAX, cardTexts, type SceneCard } from "../scene-cards";
import { checkRoleplay, USER_ROLEPLAY } from "../studio/library";
import { LIBRARY_MAX, type LibraryMode } from "../studio/library-limits";
import { jsonOf } from "./facts";
import { adultModel } from "./mode";
import { ownAsRoleplay, ROLEPLAY_PLACE_MAX, ROLEPLAY_PLACE_TITLE_MAX, storedCard, storedPlace, type OwnRoleplay, type Roleplay, type RoleplayPlace } from "./roleplays";
import { rolloutOn } from "./rollout";
import type { SceneCategory } from "./scene-catalog";
import { getAdultSettings } from "./settings";
import { normalizeScene } from "../venues";

/** How many times a card is drafted before the roleplay goes without one: once, and once more with what was wrong. */
export const OWN_CARD_DRAFTS = 2;
/** Room for a card and its place: about 180 words of JSON. */
const OWN_CARD_TOKENS = 900;
/** After a roleplay's card couldn't be drafted, how long before a scene starting in it asks again (so each start doesn't wait on two calls). */
export const OWN_CARD_RETRY_MINUTES = 60;
/** How many of a person's roleplays that have no card yet get one drafted past the response of one visit to Step in's front page. */
export const OWN_CARDS_PER_VISIT = 2;
/**
 * What a kept card is marked with (its `v`): 2 since a place is drafted with it. One kept before that still plays as
 * it is; it's drafted again, once, the next time the front page is visited, so it gets its place too.
 */
export const OWN_STORY_VERSION = 2;

/** A drafted story: its card, and where it's set when the draft's place could be kept. */
export type OwnStory = { card: SceneCard; at: RoleplayPlace | null };

/** What the person wrote: all a card is drafted from. */
export type OwnRoleplayText = { title: string; premise: string; roles: readonly [string, string] | null };

/**
 * The call's two messages. The rules are a house card's own (lib/scene-cards.ts, and the note above DATE_ROLEPLAYS in
 * lib/roleplays.ts on reading right from either side): {a} and {b} for the two, each straight before its verb and never
 * "he" or "she", every verb of theirs straight after the name (never leaning on a name a clause back: the first live
 * draft's goal read "You want to finally admit …, but worries Wally might not feel the same"), a want each, beats that
 * are turns and not an ending, nothing explicit; and where it's set, as the show's own places are written. `issue`:
 * why the last draft couldn't be used, said back once.
 */
export function ownCardMessages(rp: OwnRoleplayText, issue: string | null = null): ChatMessage[] {
  const sides = /\{[ab]\}/.test(rp.premise) ? "" : " The situation doesn't say which of them is {a} and which is {b}: the first person it mentions is {a}.";
  return [
    {
      role: "system",
      content:
        "You write the story card behind a roleplay for two adults in a piece of interactive fiction: the context its writer reads so that the roleplay plays as a story. " +
        "A card is a story card: stakes, what each of the two wants and what stands in the way, banter, a few turns the evening can take. " +
        "It never describes anything sexual or anyone undressing, names no part of a body, and never says how the evening ends, whatever the roleplay itself says. " +
        "Both people are adults who want to be there: nobody is anyone's family, nobody is young or at school, and nobody is paid, drunk, asleep, trapped or kept from saying no. " +
        "You answer with JSON and nothing else.",
    },
    {
      role: "user",
      content: [
        "The roleplay, as its author wrote it:",
        `Title: ${rp.title}`,
        `The situation: ${rp.premise}`,
        rp.roles ? `{a} plays ${rp.roles[0]}; {b} plays ${rp.roles[1]}.` : `It has no named roles: {a} and {b} are the two people in it.${sides}`,
        "",
        'Write its card. Everywhere, the two people are written {a} and {b}, exactly like that: never a name, and never "he", "she", "him", "her" or "his" for either of them (write {a} or {b} again). ' +
          'Put {a} or {b} straight before its verb, in the present tense, with no word in between ("{a} knocks twice", not "{a} quietly knocks"). Plain words, no quotation marks.',
        'Every verb that is {a}\'s or {b}\'s comes straight after the name: write the name again rather than leave it understood ("{a} wants to ask, and {a} keeps putting it off", never "{a} wants to ask but keeps putting it off"), ' +
          'or say what is in the way in a clause of its own after a semicolon ("{a} wants to find out whether the Thursday orders mean what they seem to; asking a customer is not done").',
        // The never-list reads words, not meanings ("the score is tied", "a lesson in patience"): said up front, a first
        // draft rarely has to be drawn again for a word it used innocently.
        "A checker reads the card word by word, so leave these words out even where they'd be innocent: young, girl, boy, kid, child, son, daughter, sister, brother, teacher, student, lesson, school, intern, drunk, asleep, paid, force, tied.",
        `- "setup": how it starts, the first minute, in one or two sentences that name both {a} and {b}. Under ${CARD_SETUP_MAX} characters.`,
        `- "wants": two sentences. The first begins "{a} wants" and says what {a} wants from the evening and what is in the way; the second begins "{b} wants" and does the same for {b}. Under ${CARD_WANT_MAX} characters each.`,
        `- "beats": three or four turns the story can take, in order, one sentence each, under ${CARD_BEAT_MAX} characters: things that happen between the two (something gets admitted, a dare is made, an excuse runs out). The last is one more turn, never how it ends.`,
        `- "tone": its tone in a few words, with no {a} or {b} in it. Under ${CARD_TONE_MAX} characters.`,
        `- "openings": three different ways the first line can go, one sentence each with {a} or {b} in it, under ${CARD_OPENING_MAX} characters.`,
        `- "place": where the story is set, written so that it can follow the word "at": it starts with a small letter, names the place and a detail or two of what it is like at that moment, and has no {a} or {b} and no name of a person or of a real place in it. Under ${ROLEPLAY_PLACE_MAX} characters ("the night market at closing time, lanterns going out").`,
        `- "place_title": the same place as a short heading that starts with a capital. Under ${ROLEPLAY_PLACE_TITLE_MAX} characters ("The night market, closing time").`,
        'Reply with a JSON object: {"setup": "...", "wants": ["...", "..."], "beats": ["...", "...", "..."], "tone": "...", "openings": ["...", "...", "..."], "place": "...", "place_title": "..."}',
        ...(issue ? ["", `Your last card couldn't be used: ${issue}. Write the whole card again without that.`] : []),
      ].join("\n"),
    },
  ];
}

/** One text of a draft as a card keeps it: on one line, and {A} or {B} as the {a} and {b} every reader of a card looks for. */
const tidy = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/\{A\}/g, "{a}").replace(/\{B\}/g, "{b}").trim() : "");

/**
 * A draft read as a card: null unless it's a JSON object with a setup, two wants, some beats, a tone and three openings
 * (anything past a fourth beat or a third opening is left off). What its words say, and whether there are enough
 * beats, is the check's to judge (adultCardIssue), so its answer can be said back. Pure.
 */
export function parseOwnCard(raw: string): SceneCard | null {
  const c = draftObject(raw);
  if (!c) return null;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(tidy).filter(Boolean).slice(0, max) : []);
  const wants = list(c.wants, 2);
  const openings = list(c.openings, 3);
  // storedCard also ends each sentence the model left without its full stop (lib/adult/roleplays.ts).
  return storedCard({ setup: tidy(c.setup), wants, beats: list(c.beats, 4), tone: tidy(c.tone), openings });
}

/** A draft's JSON object, or null when it isn't one. */
function draftObject(raw: string): Record<string, unknown> | null {
  const o = jsonOf(raw);
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

/** A place's words as they're kept: no quotes around them, no full stop after them. */
const bare = (v: unknown): string =>
  tidy(v)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.!?\s]+$/, "");

/**
 * Why a drafted place can't be kept, or null: exactly what the show's own places are held to
 * (tests/roleplay-places.test.ts: a phrase that follows "at", small letter first, ROLEPLAY_PLACE_MAX at most, no
 * braces, quotes or full stop, inside After Dark's lines and the show's, since a set is only drawn for a place the
 * show's check passes; a heading with a capital that fits beside the pin), and a card's own lines on top (the
 * never-list, nothing explicit: lib/scene-card-check.ts adultCardTextIssue). Pure.
 */
export function ownPlaceIssue(at: RoleplayPlace): string | null {
  const { place, title } = at;
  if (place.length > ROLEPLAY_PLACE_MAX) return `place: ${place.length} characters, over ${ROLEPLAY_PLACE_MAX}`;
  if (!/^[a-z]/.test(place)) return "place: it starts with a small letter";
  if (!normalizeScene(place)) return "place: empty";
  if (title.length > ROLEPLAY_PLACE_TITLE_MAX) return `place_title: ${title.length} characters, over ${ROLEPLAY_PLACE_TITLE_MAX}`;
  if (!/^[A-Z]/.test(title)) return "place_title: it starts with a capital";
  for (const [field, text] of [["place", place], ["place_title", title]] as const) {
    if (/[{}"]|[.!?]$/.test(text)) return `${field}: a plain phrase, with no braces, quotes or full stop`;
    if (!checkShowText({ [field]: text }).ok) return `${field}: outside the show's own lines`;
    const issue = adultCardTextIssue(text);
    if (issue) return `${field}: ${issue}`;
  }
  return null;
}

/**
 * Where a draft says its story is set, tidied into the shape a place is kept in (the small letter first, the heading's
 * capital, a place that runs long cut back to its last whole detail), or null when it says nowhere that can be kept
 * (ownPlaceIssue). Pure.
 */
export function parseOwnPlace(raw: string): RoleplayPlace | null {
  const c = draftObject(raw);
  if (!c) return null;
  let place = bare(c.place);
  let title = bare(c.place_title);
  if (!place || !title) return null;
  place = place[0].toLowerCase() + place.slice(1);
  title = title[0].toUpperCase() + title.slice(1);
  // "the night market at closing time, lanterns going out, broth on the air": one detail fewer, not no place.
  while (place.length > ROLEPLAY_PLACE_MAX && place.includes(",")) place = place.slice(0, place.lastIndexOf(",")).trim();
  while (title.length > ROLEPLAY_PLACE_TITLE_MAX && title.includes(",")) title = title.slice(0, title.lastIndexOf(",")).trim();
  const at = { place, title };
  return ownPlaceIssue(at) ? null : at;
}

const DAYS = /\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/g;
/**
 * Whether a place of someone's own may have its picture drawn (lib/sets.ts ensureSet). A set is one picture for
 * everyone who is ever at a place of that name, and its name shows on a card in After Dark's place picker
 * (lib/adult/scene-catalog.ts sceneCatalog lists the drawn sets), so it's drawn only for a place with no name in it:
 * no capital letter but a day's ("late on a Thursday"). Any other still plays there, on the page's own gradient.
 */
export const ownPlaceDrawable = (place: string): boolean => !/[A-Z]/.test(place.replace(DAYS, ""));

/**
 * The card without the beats that can't be on one (a line crossed, an explicit word, an ending named, too long), when
 * enough are left to be a story: one bad beat out of four isn't a reason to throw the other three away. Pure.
 */
export function withoutBadBeats(card: SceneCard): SceneCard {
  const good = card.beats.filter((b) => b.length <= CARD_BEAT_MAX && !CARD_ENDING.test(b) && !adultCardTextIssue(b));
  return good.length >= CARD_BEATS_MIN && good.length < card.beats.length ? { ...card, beats: good } : card;
}

const HE_OR_SHE = /\b(he|she|him|her|hers|his|himself|herself)\b/i;
/** A verb left in the third person after "you" (tests/scene-cards.test.ts holds the show's own cards to the same two). */
const YOU_VERB = /\b[Yy]ou (is|has|was|does|isn't|hasn't|wasn't|doesn't|\w+[^s]s)\b/;
const YOU_ADVERB_VERB = /\b[Yy]ou (\w+ly|still|never|just|already|only|also|even|always) (is|has|was|does|\w+[^s ]s)\b/;

/**
 * Why a card would read wrong from one side as "you" (the shelf's card, the scene's goal: lib/scene-cards.ts
 * cardForYou), or null: "he" or "she" for one of the two, whoever plays them, or a verb that doesn't follow its {a} or
 * {b} directly and so stays in the third person. Worth one more draft, and never a reason to go without a card. Pure.
 */
export function ownCardReadingIssue(card: SceneCard): string | null {
  return ownCardReadingIssues(card)[0] ?? null;
}

/**
 * Every text of a card that would read wrong from one side as "you", each with why (one reason a text): "he" or "she"
 * for one of the two; a verb that doesn't follow its {a} or {b} directly ("{a} quietly knocks"); or a verb that leans
 * on a name a clause back ("{a} wants to ask, but worries {b} will laugh": lib/roleplays.ts leaningVerbAt), which from
 * that side reads "You want to ask, but worries…". Pure.
 */
export function ownCardReadingIssues(card: SceneCard): string[] {
  const out: string[] = [];
  for (const { field, text } of cardTexts(card)) {
    if (HE_OR_SHE.test(text)) {
      out.push(`${field}: it says "he" or "she" for one of them, and either of them may be played by anyone: write {a} or {b} again instead`);
      continue;
    }
    const told = (["a", "b"] as const).map((side) => premiseForYou(text, side, "Mara"));
    if (told.some((t) => YOU_VERB.test(t) || YOU_ADVERB_VERB.test(t))) out.push(`${field}: put {a} or {b} straight before its verb, in the present tense, with no word between them`);
    else if (told.some((t) => leaningVerbAt(t, "Mara") >= 0))
      out.push(`${field}: a verb leans on {a} or {b} without the name ("{a} wants to ask, but worries…"): write the name again before every verb of theirs, or say what is in the way after a semicolon`);
  }
  return out;
}

/**
 * Drafts the story: up to OWN_CARD_DRAFTS calls. A draft that isn't a card, or that the check refuses, is asked for
 * again with the reason; one that only reads wrong as "you" is asked for again too, and when neither reads right the
 * one with fewer such texts is kept (the first, when they're level). Its place comes with whichever draft is kept, when
 * that draft's place can be (a place is never a reason to ask again). Null when no draft could be kept, or the model
 * didn't answer. Never throws.
 */
export async function draftOwnStory(model: Model, rp: OwnRoleplayText): Promise<OwnStory | null> {
  let issue: string | null = null;
  let spare: { story: OwnStory; wrong: number } | null = null;
  for (let attempt = 0; attempt < OWN_CARD_DRAFTS; attempt++) {
    let raw: string;
    try {
      raw = await model.complete(ownCardMessages(rp, issue), { temperature: 0.7, maxTokens: OWN_CARD_TOKENS });
    } catch {
      break;
    }
    const read = parseOwnCard(raw);
    if (!read) {
      issue = "it wasn't the JSON object asked for, with every one of its five parts filled in";
      continue;
    }
    const card = withoutBadBeats(read);
    const refused = adultCardIssue(card);
    if (refused) {
      issue = refused;
      continue;
    }
    const story: OwnStory = { card, at: parseOwnPlace(raw) };
    const reads = ownCardReadingIssues(card);
    if (!reads.length) return story;
    if (!spare || reads.length < spare.wrong) spare = { story, wrong: reads.length };
    issue = reads[0];
  }
  return spare?.story ?? null;
}

/** The card alone (draftOwnStory's, without where it's set). */
export async function draftOwnCard(model: Model, rp: OwnRoleplayText): Promise<SceneCard | null> {
  return (await draftOwnStory(model, rp))?.card ?? null;
}

/* ------------------------------------------------ kept on the roleplay ------------------------------------------------ */

/**
 * Whether a person's roleplays get a story at all: only where Step in is open to them, since that's all a card is for.
 * The same answer as lib/adult/step-in.ts stepInOpen (tests/after-dark-step-in-own-roleplay.test.ts holds the two
 * together); said here because that module imports this one, and so the Create library's route (the show's code)
 * needs nothing else of After Dark's for it.
 */
export async function ownStoriesOpen(db: Db, owner: string): Promise<boolean> {
  const [admin, settings] = await Promise.all([isAdmin(db, owner).catch(() => false), getAdultSettings(db)]);
  return rolloutOn(settings.rollout, "companion", admin);
}

type Row = {
  id: string;
  title: string;
  premise: string;
  role_a: string | null;
  role_b: string | null;
  category: SceneCategory;
  mode: LibraryMode;
  card: unknown;
  card_at: string | Date | null;
};
const COLUMNS = "id, title, premise, role_a, role_b, category, mode, card, card_at";

const rolesOf = (r: Row): [string, string] | null => (r.role_a && r.role_b ? [r.role_a, r.role_b] : null);
const textOf = (r: Row): { title: string; premise: string; roles: [string, string] | null } => ({ title: r.title, premise: r.premise, roles: rolesOf(r) });

/** A kept card that may still be used: it has a card's parts and passes what a new one must (a check can get stricter). */
const usable = (raw: unknown): SceneCard | null => {
  const card = storedCard(raw);
  return card && !adultCardIssue(card) ? card : null;
};

/** Where a kept card says its story is set, when that may still be used; null for none. */
const placeKept = (raw: unknown): RoleplayPlace | null => {
  const at = raw && typeof raw === "object" ? storedPlace((raw as { at?: unknown }).at) : null;
  return at && !ownPlaceIssue(at) ? at : null;
};

/** Whether a kept card was drafted as cards are now (with where it's set): one from before is drafted again, once. */
const current = (raw: unknown): boolean => Boolean(raw && typeof raw === "object" && (raw as { v?: unknown }).v === OWN_STORY_VERSION);

/** Whether a draft was tried for this roleplay within the last OWN_CARD_RETRY_MINUTES. */
const triedLately = (row: Row, now: Date): boolean => {
  const tried = row.card_at ? new Date(row.card_at).getTime() : 0;
  return tried > 0 && now.getTime() - tried < OWN_CARD_RETRY_MINUTES * 60_000;
};

/**
 * Whether a roleplay is due a draft: it has no card that can be used (and none was tried in the last hour), or, when
 * `refresh` is asked (the front page's pass, never a scene's start: someone is waiting on that), the card it has is
 * from before places were drafted.
 */
const due = (row: Row, now: Date, refresh: boolean): boolean => {
  if (triedLately(row, now)) return !usable(row.card) && row.card !== null;
  return !usable(row.card) || (refresh && !current(row.card));
};

async function ownRow(db: Db, owner: string, uid: string): Promise<Row | null> {
  if (!USER_ROLEPLAY.test(uid)) return null;
  return (await db.query<Row>(`select ${COLUMNS} from creator_roleplays where id = $1 and owner_id = $2`, [uid.slice(2), owner])).rows[0] ?? null;
}

/**
 * The roleplay's story: the one kept, else drafted now and kept. A draft that came to nothing is remembered too
 * (card_at with no card), so the next OWN_CARD_RETRY_MINUTES of starts don't each wait on it again. A card from
 * before places were drafted is used as it is unless `refresh` is asked; drafted again and nothing better coming, it's
 * kept as it was and marked current, so it isn't tried a third time.
 */
async function storyFor(db: Db, row: Row, now: Date, refresh = false): Promise<{ card: SceneCard | null; at: RoleplayPlace | null }> {
  const kept = usable(row.card);
  if (!due(row, now, refresh)) return { card: kept, at: kept ? placeKept(row.card) : null };
  const drafted = await adultModel(db)
    .then((model) => draftOwnStory(model, textOf(row)))
    .catch(() => null);
  const story: OwnStory | null = drafted ?? (kept ? { card: kept, at: null } : null);
  await db.query(`update creator_roleplays set card = $2::jsonb, card_at = $3 where id = $1`, [row.id, story ? JSON.stringify({ ...story.card, at: story.at, v: OWN_STORY_VERSION }) : null, now.toISOString()]);
  return story ?? { card: null, at: null };
}

/**
 * The story of one of a person's own roleplays ("u:<id>", only theirs): the card kept and where it's set, else both
 * drafted now, kept and returned. Nothing when the roleplay isn't theirs, or no card could be kept. Never throws.
 */
export async function ensureOwnStory(db: Db, owner: string, uid: string, now: Date = new Date()): Promise<{ card: SceneCard | null; at: RoleplayPlace | null }> {
  try {
    const row = await ownRow(db, owner, uid);
    return row ? await storyFor(db, row, now) : { card: null, at: null };
  } catch {
    return { card: null, at: null };
  }
}

/** The story card alone (ensureOwnStory's). */
export async function ensureOwnCard(db: Db, owner: string, uid: string, now: Date = new Date()): Promise<SceneCard | null> {
  return (await ensureOwnStory(db, owner, uid, now)).card;
}

/**
 * The roleplays whose story is being drafted past a response right now, in this process: saving one and opening the
 * front page a second later, or the page loaded twice, would otherwise each ask for the same card.
 */
const drafting = new Set<string>();
/** Runs one draft past a response unless that roleplay's is already running here; null when it was. */
async function once<T>(id: string, work: () => Promise<T>): Promise<T | null> {
  if (drafting.has(id)) return null;
  drafting.add(id);
  try {
    return await work();
  } finally {
    drafting.delete(id);
  }
}

let draftsPastResponse = true;
/**
 * Tests start with the drafts that run past a response switched off (tests/setup-no-live-checks.ts): saving a
 * roleplay, or opening Step in's front page, would otherwise ask whatever model a test has scripted for a card, behind
 * its back. A test of them switches them on.
 */
export function setOwnCardOnSaveForTests(on: boolean): void {
  draftsPastResponse = on;
}

/**
 * A roleplay has just been saved (app/api/library/route.ts runs this past the response, for someone ownStoriesOpen is
 * true for): its card is drafted and kept now, so the first scene started in it doesn't wait on that.
 */
export async function draftOwnCardOnSave(db: Db, owner: string, uid: string): Promise<SceneCard | null> {
  return draftsPastResponse ? once(uid.slice(2), () => ensureOwnCard(db, owner, uid)) : null;
}

/**
 * The roleplays a person saved before cards were drafted (or whose draft never landed) get theirs: at most `max` of
 * them, the newest first, each a small call or two. Step in's front page runs this past its response
 * (app/after-dark/step-in/page.tsx), so the next visit shows their goal and where they're set, and a scene started in
 * one doesn't wait. A draft that came to nothing isn't tried again for OWN_CARD_RETRY_MINUTES; a card from before
 * places were drafted is drafted again once. How many were drafted. Never throws.
 */
export async function draftMissingOwnCards(db: Db, owner: string, now: Date = new Date(), max: number = OWN_CARDS_PER_VISIT): Promise<number> {
  if (!draftsPastResponse) return 0;
  try {
    const { rows } = await db.query<Row>(`select ${COLUMNS} from creator_roleplays where owner_id = $1 order by created_at desc limit ${LIBRARY_MAX}`, [owner]);
    const waiting = rows.filter((r) => !drafting.has(r.id) && due(r, now, true) && !checkRoleplay(textOf(r), r.mode)).slice(0, Math.max(0, max));
    let drafted = 0;
    for (const row of waiting) if ((await once(row.id, () => storyFor(db, row, now, true))) !== null) drafted++;
    return drafted;
  } catch {
    return 0;
  }
}

export type OwnForScene = { ok: true; own: OwnRoleplay } | { ok: false; message: string };

/**
 * One of a person's own roleplays as a scene starting in it keeps it (lib/adult/roleplays.ts OwnRoleplay): what they
 * wrote, and the card and the place it has so far (nothing is drafted here: ensureOwnStory does that, once the start
 * has passed everything else). Only theirs; either kind plays in After Dark (a safe one is held to more, not less).
 * What they wrote is read again as it's used: saved before a check got stricter, it isn't played.
 */
export async function ownForScene(db: Db, owner: string, uid: string): Promise<OwnForScene> {
  const row = await ownRow(db, owner, uid);
  if (!row) return { ok: false, message: "Pick a roleplay from the list, or none." };
  const roles = rolesOf(row);
  const wrong = checkRoleplay({ title: row.title, premise: row.premise, roles }, row.mode);
  if (wrong) return { ok: false, message: wrong.replace("can't be saved", "can't be played") };
  const card = usable(row.card);
  return { ok: true, own: { title: row.title, premise: row.premise, roles, category: row.category, card, at: card ? placeKept(row.card) : null } };
}

/**
 * A person's own roleplays as Step in's front page lists them (app/after-dark/step-in: the shelf's cards and the
 * set-up's picker), the newest first, each shaped like one of the show's with the card and the place it has so far.
 * One read, and nothing is drafted here: a roleplay with no card yet is listed without a goal, and gets its card when a
 * scene starts in it (or past this page's response: draftMissingOwnCards). One that a check has since turned against
 * is left out.
 */
export async function ownRoleplays(db: Db, owner: string): Promise<Roleplay[]> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from creator_roleplays where owner_id = $1 order by created_at desc limit ${LIBRARY_MAX}`, [owner]);
  return rows
    .filter((r) => !checkRoleplay(textOf(r), r.mode))
    .map((r) => {
      const card = usable(r.card);
      return ownAsRoleplay(`u:${r.id}`, { title: r.title, premise: r.premise, roles: rolesOf(r), category: r.category, card, at: card ? placeKept(r.card) : null });
    });
}
