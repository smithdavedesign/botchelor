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
 * Kept on the roleplay's own row (creator_roleplays.card, card_at), so it's drafted once. A scene takes a copy when it
 * starts (lib/adult/roleplays.ts OwnRoleplay), and never reads this again.
 *
 * Server only: it carries the content filter's word lists (lib/studio/library.ts, lib/scene-card-check.ts).
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import type { ChatMessage, Model } from "../model";
import { premiseForYou } from "../roleplays";
import { adultCardIssue, adultCardTextIssue } from "../scene-card-check";
import { CARD_BEAT_MAX, CARD_BEATS_MIN, CARD_ENDING, CARD_OPENING_MAX, CARD_SETUP_MAX, CARD_TONE_MAX, CARD_WANT_MAX, cardTexts, type SceneCard } from "../scene-cards";
import { checkRoleplay, USER_ROLEPLAY } from "../studio/library";
import { LIBRARY_MAX, type LibraryMode } from "../studio/library-limits";
import { jsonOf } from "./facts";
import { adultModel } from "./mode";
import { ownAsRoleplay, storedCard, type OwnRoleplay, type Roleplay } from "./roleplays";
import { rolloutOn } from "./rollout";
import type { SceneCategory } from "./scene-catalog";
import { getAdultSettings } from "./settings";

/** How many times a card is drafted before the roleplay goes without one: once, and once more with what was wrong. */
export const OWN_CARD_DRAFTS = 2;
/** Room for a card: about 150 words of JSON. */
const OWN_CARD_TOKENS = 800;
/** After a roleplay's card couldn't be drafted, how long before a scene starting in it asks again (so each start doesn't wait on two calls). */
export const OWN_CARD_RETRY_MINUTES = 60;

/** What the person wrote: all a card is drafted from. */
export type OwnRoleplayText = { title: string; premise: string; roles: readonly [string, string] | null };

/**
 * The call's two messages. The rules are a house card's own (lib/scene-cards.ts, and the note above DATE_ROLEPLAYS in
 * lib/roleplays.ts on reading right from either side): {a} and {b} for the two, each straight before its verb and never
 * "he" or "she", a want each, beats that are turns and not an ending, nothing explicit. `issue`: why the last draft
 * couldn't be used, said back once.
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
        // The never-list reads words, not meanings ("the score is tied", "a lesson in patience"): said up front, a first
        // draft rarely has to be drawn again for a word it used innocently.
        "A checker reads the card word by word, so leave these words out even where they'd be innocent: young, girl, boy, kid, child, son, daughter, sister, brother, teacher, student, lesson, school, intern, drunk, asleep, paid, force, tied.",
        `- "setup": how it starts, the first minute, in one or two sentences that name both {a} and {b}. Under ${CARD_SETUP_MAX} characters.`,
        `- "wants": two sentences. The first begins "{a} wants" and says what {a} wants from the evening and what is in the way; the second begins "{b} wants" and does the same for {b}. Under ${CARD_WANT_MAX} characters each.`,
        `- "beats": three or four turns the story can take, in order, one sentence each, under ${CARD_BEAT_MAX} characters: things that happen between the two (something gets admitted, a dare is made, an excuse runs out). The last is one more turn, never how it ends.`,
        `- "tone": its tone in a few words, with no {a} or {b} in it. Under ${CARD_TONE_MAX} characters.`,
        `- "openings": three different ways the first line can go, one sentence each with {a} or {b} in it, under ${CARD_OPENING_MAX} characters.`,
        'Reply with a JSON object: {"setup": "...", "wants": ["...", "..."], "beats": ["...", "...", "..."], "tone": "...", "openings": ["...", "...", "..."]}',
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
  const o = jsonOf(raw);
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const c = o as Record<string, unknown>;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(tidy).filter(Boolean).slice(0, max) : []);
  const wants = list(c.wants, 2);
  const openings = list(c.openings, 3);
  return storedCard({ setup: tidy(c.setup), wants, beats: list(c.beats, 4), tone: tidy(c.tone), openings });
}

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
  for (const { field, text } of cardTexts(card)) {
    if (HE_OR_SHE.test(text)) return `${field}: it says "he" or "she" for one of them, and either of them may be played by anyone: write {a} or {b} again instead`;
    for (const side of ["a", "b"] as const) {
      const told = premiseForYou(text, side, "Mara");
      if (YOU_VERB.test(told) || YOU_ADVERB_VERB.test(told)) return `${field}: put {a} or {b} straight before its verb, in the present tense, with no word between them`;
    }
  }
  return null;
}

/**
 * Drafts the card: up to OWN_CARD_DRAFTS calls. A draft that isn't a card, or that the check refuses, is asked for
 * again with the reason; one that only reads wrong as "you" is asked for again too, and kept if nothing better comes.
 * Null when no draft could be kept, or the model didn't answer. Never throws.
 */
export async function draftOwnCard(model: Model, rp: OwnRoleplayText): Promise<SceneCard | null> {
  let issue: string | null = null;
  let spare: SceneCard | null = null;
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
    const reads = ownCardReadingIssue(card);
    if (!reads) return card;
    spare ??= card;
    issue = reads;
  }
  return spare;
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

/** A kept card that may still be used: it has a card's parts and passes what a new one must (a check can get stricter). */
const usable = (raw: unknown): SceneCard | null => {
  const card = storedCard(raw);
  return card && !adultCardIssue(card) ? card : null;
};

async function ownRow(db: Db, owner: string, uid: string): Promise<Row | null> {
  if (!USER_ROLEPLAY.test(uid)) return null;
  return (await db.query<Row>(`select ${COLUMNS} from creator_roleplays where id = $1 and owner_id = $2`, [uid.slice(2), owner])).rows[0] ?? null;
}

/**
 * The roleplay's card: the one kept, else drafted now and kept. A draft that came to nothing is remembered too
 * (card_at with no card), so the next OWN_CARD_RETRY_MINUTES of starts don't each wait on it again.
 */
async function cardFor(db: Db, row: Row, now: Date): Promise<SceneCard | null> {
  const kept = usable(row.card);
  if (kept) return kept;
  const tried = row.card_at ? new Date(row.card_at).getTime() : 0;
  if (row.card === null && tried && now.getTime() - tried < OWN_CARD_RETRY_MINUTES * 60_000) return null;
  const card = await adultModel(db)
    .then((model) => draftOwnCard(model, { title: row.title, premise: row.premise, roles: rolesOf(row) }))
    .catch(() => null);
  await db.query(`update creator_roleplays set card = $2::jsonb, card_at = $3 where id = $1`, [row.id, card ? JSON.stringify(card) : null, now.toISOString()]);
  return card;
}

/**
 * The story card of one of a person's own roleplays ("u:<id>", only theirs): the one kept, else drafted now, kept and
 * returned. Null when the roleplay isn't theirs, or no card could be kept. Never throws.
 */
export async function ensureOwnCard(db: Db, owner: string, uid: string, now: Date = new Date()): Promise<SceneCard | null> {
  try {
    const row = await ownRow(db, owner, uid);
    return row ? await cardFor(db, row, now) : null;
  } catch {
    return null;
  }
}

let draftsOnSave = true;
/**
 * Tests start with the draft at save switched off (tests/setup-no-live-checks.ts): saving a roleplay would otherwise
 * ask whatever model a test has scripted for a card, behind its back. A test of the draft switches it on.
 */
export function setOwnCardOnSaveForTests(on: boolean): void {
  draftsOnSave = on;
}

/**
 * A roleplay has just been saved (app/api/library/route.ts runs this past the response, for someone ownStoriesOpen is
 * true for): its card is drafted and kept now, so the first scene started in it doesn't wait on that.
 */
export async function draftOwnCardOnSave(db: Db, owner: string, uid: string): Promise<SceneCard | null> {
  return draftsOnSave ? ensureOwnCard(db, owner, uid) : null;
}

export type OwnForScene = { ok: true; own: OwnRoleplay } | { ok: false; message: string };

/**
 * One of a person's own roleplays as a scene starting in it keeps it (lib/adult/roleplays.ts OwnRoleplay): what they
 * wrote, and the card it has so far (nothing is drafted here: ensureOwnCard does that, once the start has passed
 * everything else). Only theirs; either kind plays in After Dark (a safe one is held to more, not less). What they
 * wrote is read again as it's used: saved before a check got stricter, it isn't played.
 */
export async function ownForScene(db: Db, owner: string, uid: string): Promise<OwnForScene> {
  const row = await ownRow(db, owner, uid);
  if (!row) return { ok: false, message: "Pick a roleplay from the list, or none." };
  const roles = rolesOf(row);
  const wrong = checkRoleplay({ title: row.title, premise: row.premise, roles }, row.mode);
  if (wrong) return { ok: false, message: wrong.replace("can't be saved", "can't be played") };
  return { ok: true, own: { title: row.title, premise: row.premise, roles, category: row.category, card: usable(row.card) } };
}

/**
 * A person's own roleplays as Step in's front page lists them (app/after-dark/step-in: the shelf's cards and the
 * set-up's picker), the newest first, each shaped like one of the show's with the card it has so far. One read, and
 * nothing is drafted here: a roleplay with no card yet is listed without a goal, and gets its card when a scene starts
 * in it. One that a check has since turned against is left out.
 */
export async function ownRoleplays(db: Db, owner: string): Promise<Roleplay[]> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from creator_roleplays where owner_id = $1 order by created_at desc limit ${LIBRARY_MAX}`, [owner]);
  return rows
    .filter((r) => !checkRoleplay({ title: r.title, premise: r.premise, roles: rolesOf(r) }, r.mode))
    .map((r) => ownAsRoleplay(`u:${r.id}`, { title: r.title, premise: r.premise, roles: rolesOf(r), category: r.category, card: usable(r.card) }));
}
