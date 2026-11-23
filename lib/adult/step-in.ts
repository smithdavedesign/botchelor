/**
 * Step in, After Dark (docs/after-dark.md "Step in"; David, 2026-11-17: "consider adding a NSFW companion date mode too
 * that has these themes and role play"). After Dark was two characters a viewer directs; this is the other shape: the
 * viewer is IN the scene with one character, on a date or in a roleplay, and the character's side is written as prose
 * (story mode, lib/narration.ts). After Dark's own engine, tables, checks and model: the PG companion
 * (lib/companion.ts) never handles any of it, and nothing here is read by the show.
 *
 * Closed: the "companion" rollout piece (lib/adult/rollout.ts), admins only until it's switched on. Everyone else gets
 * the same not-found as for any After Dark page.
 *
 * What the viewer sends is checked in this order, and what a check refuses is never stored or logged:
 *  1. the self-harm protocol (lib/crisis.ts, the maybes on After Dark's own model as the PG companion does them): the
 *     scene pauses with the resources, and nothing they said is kept;
 *  2. the lines that never move (lib/safety.ts checkAdultText): refused with the steers' own sentence; then Step in's
 *     own net over the same lines (lib/adult/step-in-lines.ts), because here a line can cross them just by saying who
 *     someone is ("You're my daughter." passes checkAdultText, which reads roleplay phrasing about two known adults);
 *  3. their own limits for the scene (lib/adult/limits.ts): a hard no asked for, or past their intensity.
 * What the character says is checked whole (checkReply): the lines that never move (both nets), the viewer's hard nos
 * and intensity, a public place's cap, the narrator's guard on the prose outside the quotes, and that it never writes
 * the viewer. A reply that fails is drawn once more with a note of what to avoid; if that fails too, a neutral
 * narrator's line stands in (ASIDES) and nothing of either draft is kept.
 *
 * Each reply counts one of the month's scene steps (lib/adult/usage.ts), regenerate and Continue included; flipping
 * through kept draws doesn't. Every reply and every refusal is a row in the step log (lib/adult/steps.ts, kind
 * "step_in"), with no word of either side in it. Memory, v1: the scene's own turns, a rolling recap once it's long, and
 * one line about each earlier scene with the character that the viewer ended. No fact extraction, no pictures or
 * video.
 *
 * Heard (2026-11-22): a line can be said out loud on a call (sendStepInLine's `call`), and the reply is then a few
 * spoken sentences (draw's `form: "call"`, parseCallReply, checkCallReply) kept in the scene as a call's; what any
 * reply says out loud can be heard in the character's voice (lib/adult/step-in-voice.ts).
 */
import { randomUUID } from "node:crypto";
import { isAdmin } from "../admins";
import type { Character } from "../character";
import { withoutStageDirections } from "../companion-live-shared";
import { repeatsEarlier } from "../companion-prompt";
import { countReferral, CRISIS_RESOURCES, crisisIntent, type CrisisResources, type CrisisSurface } from "../crisis";
import type { Db } from "../db";
import type { Model, ModelOptions, Usage } from "../model";
import { guardStory, hasWornPhrase, narrationGuard, parseStoryReply, speaksForThePerson, tellsThemInThirdPerson, thinksForThePerson } from "../narration";
import { getPersona, personaIssue, type ScenePersona } from "../persona";
import { portraitPathSql } from "../portrait-sql";
import { CHARACTER_REJECTION_MESSAGES, checkAdultText, type SafetyResult } from "../safety";
import { CARD_OPENING_MAX, cardForYou, GENERIC_OPENINGS, openingOf } from "../scene-cards";
import { adultCardTextIssue } from "../scene-card-check";
import { lineInCrisis } from "../step-in";
import { normalizeScene, setPath, venueName } from "../venues";
import { eligibleIds } from "./characters";
import { stageAsked } from "./director";
import { jsonOf } from "./facts";
import { limitOf } from "./fallback";
import { hardNoHit, hasHardNos, INTENSITY, intensityOf, overIntensity, OWN_LEN, OWN_MAX, storedHardNos, type HardNos, type PairLimits } from "./limits";
import { adultModel, adultModelId, adultViewer, adultViewerFromCookies } from "./mode";
import { consentRefusal, hasProfileConsent } from "./profile";
import { roleplayById, type Roleplay } from "./roleplays";
import { rolloutOn } from "./rollout";
import { sceneCatalog, venueSituation } from "./scene-catalog";
import { isPublicPlace, linesCrossed, recapFrom, samplingOf, type LimitsInput } from "./scenes";
import { getAdultSettings } from "./settings";
import { stageShown } from "./stage-floor";
import { STAGES } from "./stages";
import { STEP_IN_NEVER_SAID, stepInNever, stepInNeverIn, type StepInNever } from "./step-in-lines";
import { openingHasSides, STEP_IN_CALL_TOKENS, STEP_IN_REPLY_TOKENS, STEP_IN_TURNS, stepInMessages, type StepInTurn } from "./step-in-prompt";
import { placeInSentence, spokenPieces, STEP_IN_LINE_MAX, type StepInCharacter, type StepInMessageView, type StepInPlace, type StepInSceneRef, type StepInSceneView } from "./step-in-shared";
import { storySpeech } from "../story-reply";
import { logStep, STEP_IN_PARTNER } from "./steps";
import { countUse, overCap, usageLeft } from "./usage";
import { sceneCharacter } from "./voice";
import { writerChoice } from "./writer";
import { FALLBACK_WRITER } from "./writer-config";

export * from "./step-in-shared";

/* ------------------------------------------------ the switch ------------------------------------------------ */

/**
 * Whether Step in is open to someone After Dark already opens for: admins, and everyone once the "companion" rollout
 * piece is switched to everyone (lib/adult/rollout.ts).
 */
export async function stepInOpen(db: Db, viewer: string): Promise<boolean> {
  const [admin, settings] = await Promise.all([isAdmin(db, viewer).catch(() => false), getAdultSettings(db)]);
  return rolloutOn(settings.rollout, "companion", admin);
}

/** The viewer's id when After Dark opens for them (lib/adult/mode.ts adultViewer) and Step in does too; null otherwise. */
export async function stepInViewer(db: Db, req: Request): Promise<string | null> {
  const viewer = await adultViewer(db, req);
  return viewer && (await stepInOpen(db, viewer)) ? viewer : null;
}

/** The same, for a server page (its cookie store). */
export async function stepInViewerFromCookies(db: Db, store: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  const viewer = await adultViewerFromCookies(db, store);
  return viewer && (await stepInOpen(db, viewer)) ? viewer : null;
}

/* ------------------------------------------------ what a scene is ------------------------------------------------ */

/** A new session: back after this long, the AI notice goes in again (as the PG companion's: lib/companion.ts). */
export const NOTICE_IDLE_MINUTES = 30;
/** And every this many hours of the scene (New York GBL Art. 47 asks for at least every three). */
export const NOTICE_EVERY_HOURS = 3;
/** The rolling recap is written again when this many turns have fallen out of the prompt since the last one. */
export const RECAP_EVERY = 10;
/** Earlier scenes with the character a new one remembers, a line each. */
export const EARLIER_SCENES = 5;
/** Where the self-harm check's count files a Step in line (lib/crisis.ts crisis_referrals: the day and this, nothing else). */
export const STEP_IN_SURFACE: CrisisSurface = "after_dark_step_in";

/** The AI notice: a system line at the start of every scene and whenever it's due again. */
export const stepInNotice = (name: string): string => `${first(name)} is an AI character, not a real person. This is fiction between adults.`;

/**
 * What stands in when a reply couldn't be used twice: a neutral narrator's line that changes the subject, with nothing
 * of either draft in it and nothing about the viewer. Held to every check a reply is (tests/after-dark-step-in.test.ts).
 */
export const ASIDES: readonly string[] = [
  "The moment drifted, the way moments do. The evening was still there, unhurried, with plenty of it left.",
  "Somewhere nearby a sound broke the thread of it, and the thought was gone. There were other places for this to go.",
  "A pause settled in, easy and unhurried. Whatever came next could begin somewhere new.",
];

/**
 * What stands in on a call when a spoken reply couldn't be used twice: the character's own voice, changing the subject,
 * with nothing of either draft in it and nothing about the viewer. Held to every check a spoken reply is.
 */
export const CALL_ASIDES: readonly string[] = [
  "Sorry, I lost my thread for a second. Tell me something else.",
  "Hold on, let me think about that one. What else is on your mind?",
  "Hm. Let's come back to that. Tell me about your night.",
];

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
/** What a scene's character is called once they've been deleted. */
const GONE_NAME = "Someone who has left";
const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
/** Messages written in one request are a millisecond apart, so they always sort in the order they were said. */
const tick = (d: Date, n: number) => new Date(d.getTime() + n);
const clean = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export type StepInFail = { ok: false; status: number; error: string; message: string; crisis_resources?: CrisisResources; consent_required?: true };
const fail = (status: number, error: string, message: string): StepInFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "Not found.");
const ENDED = fail(409, "ended", "This scene has ended. Start a new one to carry on.");
const PAUSED = fail(409, "paused", "This scene is paused. Carry on when you're ready.");

type SceneRow = {
  id: string;
  owner_id: string;
  character_id: string;
  place: string;
  roleplay: { id: string; you: 0 | 1 } | null;
  opening: string | null;
  intensity: string | null;
  hard_nos: unknown;
  recap: string | null;
  recap_upto: string | Date | null;
  line: string | null;
  notice_at: string | Date | null;
  paused_at: string | Date | null;
  ended_at: string | Date | null;
  created_at: string | Date;
  last_at: string | Date;
};

type MessageRow = { id: string; role: "viewer" | "character" | "system"; kind: string | null; text: string; replaced_by: string | null; created_at: string | Date };

const SCENE_COLUMNS = "id, owner_id, character_id, place, roleplay, opening, intensity, hard_nos, recap, recap_upto, line, notice_at, paused_at, ended_at, created_at, last_at";

async function ownScene(db: Db, viewer: string, sceneId: string): Promise<SceneRow | null> {
  return (await db.query<SceneRow>(`select ${SCENE_COLUMNS} from adult_step_in_scenes where id = $1 and owner_id = $2`, [sceneId, viewer])).rows[0] ?? null;
}

/** Every message of a scene, oldest first: the current ones and the draws set aside. */
async function allMessages(db: Db, sceneId: string): Promise<MessageRow[]> {
  return (await db.query<MessageRow>(`select id, role, kind, text, replaced_by, created_at from adult_step_in_messages where scene_id = $1 order by created_at asc, id asc`, [sceneId])).rows;
}

async function addMessage(
  db: Db,
  s: Pick<SceneRow, "id" | "owner_id">,
  role: MessageRow["role"],
  text: string,
  at: Date,
  extra: { kind?: string | null; model?: string | null; cost?: number | null } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into adult_step_in_messages (id, scene_id, owner_id, role, kind, text, model, cost, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    id,
    s.id,
    s.owner_id,
    role,
    extra.kind ?? null,
    text,
    extra.model ?? null,
    extra.cost ?? null,
    at.toISOString(),
  ]);
  await db.query(`update adult_step_in_scenes set last_at = $2 where id = $1`, [s.id, at.toISOString()]);
  return id;
}

/** The scene's limits (a pair's shape, lib/adult/limits.ts): After Dark's defaults until the viewer sets their own. */
const limitsOf = (s: Pick<SceneRow, "intensity" | "hard_nos">): PairLimits => ({ intensity: intensityOf(s.intensity), hard_nos: storedHardNos(s.hard_nos) });

/* ------------------------------------------------ who, where, what ------------------------------------------------ */

/**
 * Who the viewer may step in with: exactly who may be in a pair of theirs (lib/adult/characters.ts eligibleIds: the
 * season's cast, the agent cast that passed After Dark's check, and the characters they've switched in).
 */
export async function stepInCast(db: Db, viewer: string): Promise<StepInCharacter[]> {
  const ids = [...(await eligibleIds(db, viewer))];
  if (!ids.length) return [];
  return (
    await db.query<StepInCharacter>(`select c.id, c.name, ${portraitPathSql("c")} as portrait, c.avatar_hue as hue, coalesce(c.is_house, false) as house from characters c where c.id = any($1) order by c.name`, [ids])
  ).rows;
}

async function characterRef(db: Db, id: string): Promise<StepInCharacter | null> {
  return (await db.query<StepInCharacter>(`select c.id, c.name, ${portraitPathSql("c")} as portrait, c.avatar_hue as hue from characters c where c.id = $1`, [id])).rows[0] ?? null;
}

/** The sets already drawn (place_sets), so a place's card and backdrop only name a picture that exists. */
export async function drawnSets(db: Db): Promise<string[]> {
  return (await db.query<{ label: string }>(`select label from place_sets where status = 'ready' order by updated_at desc limit 300`).catch(() => ({ rows: [] as { label: string }[] }))).rows.map((r) => r.label);
}

/**
 * Where a scene can be: After Dark's scene catalog, less the sets someone typed in (the catalog's own places only) and
 * the double date (a scene is the two of them). `drawn`: the sets that exist, for the pictures.
 */
export function stepInPlaces(drawn: readonly string[] = []): StepInPlace[] {
  return sceneCatalog(drawn)
    .filter((s) => !s.id.startsWith("set:") && s.id !== "venue:double_date")
    .map((s) => ({
      id: s.id,
      title: s.id === "venue:home" ? "Their place" : s.title,
      place: s.place,
      image: s.image,
      // A venue's backdrop is one file; a drawn set's card is its small copy, and the page takes the whole picture.
      backdrop: s.image && s.image.includes("?w=") ? setPath(s.place) : s.image,
      public: isPublicPlace(s.place),
    }));
}

/** The scene's place as the page shows it: the catalog's card for it, or the label alone. */
function placeOf(label: string, drawn: readonly string[]): StepInPlace {
  const key = normalizeScene(label);
  return stepInPlaces(drawn).find((p) => normalizeScene(p.place) === key) ?? { id: "", title: label, place: label, image: null, backdrop: null, public: isPublicPlace(label) };
}

/** The home venue's label (lib/venues.ts "Their place"): in a scene with one character, that character's own home. */
const HOME_KEY = normalizeScene(venueName("home"));

/**
 * A place as the character's prompt says it: its name inside a sentence, with what it puts them in when it's one of
 * the library's venues (lib/adult/scene-catalog.ts venueSituation). "Their place" is the character's own: "your place".
 */
function promptPlace(label: string): { label: string; situation: string | null } {
  if (normalizeScene(label) === HOME_KEY) return { label: "your place", situation: "your own home: the living room and the kitchen, a lamp on, something on the stove" };
  // A class's own "teacher" is its instructor here: Step in's net keeps the word out of every line (lib/adult/step-in-lines.ts).
  return { label: placeInSentence(label), situation: venueSituation(label)?.replaceAll("teacher", "instructor") ?? null };
}

/** The viewer's side of a roleplay: {a} when they play its first role. */
const sideOf = (you: 0 | 1): "a" | "b" => (you === 1 ? "b" : "a");

/**
 * The viewer's persona for an After Dark scene (lib/persona.ts: the name, look and line about themselves they wrote
 * for scenes). Read raw, then held to the rules that hold everywhere, to After Dark's lines and to Step in's own net
 * (lib/adult/step-in-lines.ts) again as it's read: one that fails any of them is left out (`leftOut`), and the scene
 * plays without it.
 */
export async function stepInPersona(db: Db, viewer: string): Promise<{ persona: ScenePersona | null; leftOut: boolean }> {
  const p = await getPersona(db, viewer).catch(() => null);
  if (!p) return { persona: null, leftOut: false };
  const lines = Object.fromEntries(Object.entries({ name: p.name, look: p.look, about: p.about }).filter(([, v]) => Boolean(v)));
  const fits = !personaIssue(p) && checkAdultText(lines).ok && !stepInNeverIn(Object.values(lines));
  return fits ? { persona: p, leftOut: false } : { persona: null, leftOut: true };
}

/** The persona a scene's prompt may carry, or null: none written, or one the checks leave out. */
export const adultPersona = async (db: Db, viewer: string): Promise<ScenePersona | null> => (await stepInPersona(db, viewer)).persona;

/* ------------------------------------------------ the checks ------------------------------------------------ */

/** What a text refused by the lines that never move is told: After Dark's steers' own sentence (lib/adult/scenes.ts). */
function linesMessage(what: string, r: SafetyResult): string {
  if (!r.ok && r.reason === "language") return CHARACTER_REJECTION_MESSAGES.language;
  return `That ${what} crosses one of the lines that never move (${linesCrossed(r)}).`;
}

/** One of our own lists' single words: safe to say back to whoever wrote the line, so they can say it another way. */
const saidBack = (hit: StepInNever): string => (/^[a-z]+$/.test(hit.word) ? `: it was the word "${hit.word}"` : "");

/**
 * What a text caught by Step in's own net (lib/adult/step-in-lines.ts) is told: the same sentence, the line it is, and
 * the word when it's one of ours. `logged` is the same without the word: the step log never holds any of the text.
 */
function neverMessage(what: string, hit: StepInNever): { message: string; logged: string } {
  const logged = `That ${what} crosses one of the lines that never move (${STEP_IN_NEVER_SAID[hit.why]}).`;
  return { message: `${logged.slice(0, -2)}${saidBack(hit)}).`, logged };
}

/** Why a text can't be in a Step in scene at all, for the next draft's note: After Dark's lines, then Step in's net. */
function linesNote(text: string): { why: string; avoid: string } | null {
  const safe = checkAdultText({ reply: text });
  if (!safe.ok) {
    if (safe.reason === "language") return { why: "lines:language", avoid: "it wasn't in English" };
    return { why: `lines:${safe.theme ?? safe.reason}`, avoid: `it crossed one of the lines that never move (${linesCrossed(safe)})` };
  }
  const never = stepInNever(text);
  if (never) return { why: `never:${never.why}`, avoid: `it crossed one of the lines that never move here (${STEP_IN_NEVER_SAID[never.why]}${saidBack(never)})` };
  if (crisisIntent(text)) return { why: "crisis", avoid: "someone in it talked about hurting themselves" };
  return null;
}

/**
 * The word of a paragraph's narration that the narrator's guard refuses, when a single word is what trips it (a family
 * word, a word for someone young), for the next draft's note: the guard's lists are wide ("stepped" reads as a family
 * word to it), and a draft told which word it was rarely makes the same mistake twice.
 */
function guardedWord(paragraph: string): string | null {
  const prose = paragraph.replace(/“[^”]*”|"[^"]*"/g, " ");
  for (const w of prose.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []) if (narrationGuard(w, "adult")) return w.toLowerCase();
  return null;
}

/**
 * Why the viewer's line can't go in under their own limits for the scene, or null: the limits' own sentences
 * (lib/adult/scenes.ts limitRefusal), said for a line. `stage`: how far the scene has gone (STAGES index).
 */
export function lineLimitRefusal(text: string, limits: PairLimits, stage: number): string | null {
  const hard = hardNoHit(text, limits.hard_nos);
  if (hard) return `That line asks for one of your hard limits for this scene (${hard}). Change it, or the limits, first.`;
  const level = INTENSITY[limits.intensity];
  const asked = stageAsked(text, stage);
  if (asked !== null && asked > level.maxStage) return `That line goes past ${STAGES[level.maxStage]}, as far as ${level.label.toLowerCase()} goes. Change it, or turn the intensity up, first.`;
  const over = overIntensity(text, limits.intensity);
  if (over) return `That line is more than ${level.label.toLowerCase()} allows (${over}). Change it, or turn the intensity up, first.`;
  return null;
}

const KISSING = STAGES.indexOf("kissing");

/** Why a text is past the viewer's limits or the place's cap, as a note for the next draft, or null. */
function limitsNote(text: string, limits: PairLimits, publicPlace: boolean): { why: string; avoid: string } | null {
  const hard = hardNoHit(text, limits.hard_nos);
  if (hard) return { why: "hard_no", avoid: `it crossed one of their hard limits (${hard})` };
  const over = overIntensity(text, limits.intensity);
  if (over) return { why: "intensity", avoid: over.startsWith("went") ? `it ${over}` : `it was ${over}` };
  if (publicPlace && (stageShown(text) ?? 0) > KISSING) return { why: "public_place", avoid: "it went past kissing in a public place" };
  return null;
}

export type ReplyVerdict = { ok: true; paragraphs: string[] } | { ok: false; why: string; avoid: string };

/** The most of a spoken reply that's kept: a few sentences. */
export const CALL_REPLY_MAX = 600;

/**
 * What a spoken reply's draft says out loud: its `say` (lib/adult/step-in-prompt.ts STEP_IN_CALL_ANSWER), or, from a
 * writer that answered as a story anyway, the lines that story says out loud. Stage directions come out (they can't be
 * voiced), double quotes become single ones (the line is kept inside a pair of its own), and it stops at a sentence
 * within CALL_REPLY_MAX. Empty when nothing was said.
 */
export function parseCallReply(raw: string): string {
  const json = jsonOf(raw) as { say?: unknown; story?: unknown } | null;
  const said =
    typeof json?.say === "string"
      ? json.say
      : Array.isArray(json?.story)
        ? storySpeech(json.story.filter((x): x is string => typeof x === "string").join("\n\n")).join(" ")
        : json
          ? ""
          : raw;
  let text = withoutStageDirections(said.replace(/\r/g, " "))
    .replace(/[“”"]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim();
  if (text.length > CALL_REPLY_MAX) {
    const cut = text.slice(0, CALL_REPLY_MAX);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = (end > CALL_REPLY_MAX / 3 ? cut.slice(0, end + 1) : cut).trim();
  }
  return text;
}

/**
 * A spoken reply through the checks a written one gets, as far as they apply to speech: the lines that never move
 * (After Dark's, then Step in's own net), nothing that reads as wanting to hurt oneself, the viewer's hard nos and
 * intensity, a public place's cap, and the narrator's age rule on what's said. There's no narration to guard and no
 * "you" to drift. Kept as one line inside double quotes, which is how the scene keeps anything said out loud.
 */
export function checkCallReply(said: string, limits: PairLimits, o: { publicPlace: boolean }): ReplyVerdict {
  const text = said.trim();
  if (!text) return { ok: false, why: "empty", avoid: "nothing was said in it" };
  const crossed = linesNote(text);
  if (crossed) return { ok: false, ...crossed };
  const limited = limitsNote(text, limits, o.publicPlace);
  if (limited) return { ok: false, ...limited };
  const line = `"${text}"`;
  if (guardStory(line, "adult").cut > 0) return { ok: false, why: "guard", avoid: "it gave someone an age under 18" };
  return { ok: true, paragraphs: [line] };
}

/**
 * A drawn reply through every check, in order (the PG companion's order, with After Dark's checks: the line checks on
 * the whole reply first, then the narrator's guard):
 *  1. the lines that never move, on the whole reply: After Dark's (checkAdultText), then Step in's own net (what it
 *     says out loud included), and nothing that reads as wanting to hurt oneself;
 *  2. the viewer's hard nos and intensity, and a public place's cap (nothing past kissing there);
 *  3. the narrator's guard on the prose outside the quotes (nothing young, no family word, no age under 18), and its
 *     age rule on what's said inside them: any hit refuses the reply, nothing is quietly cut;
 *  4. it never writes the viewer: a line put in their mouth refuses it, and so does narration that has slipped into
 *     telling them as "he" or "she" (`pronouns`: the character's own, which is how the two are told apart), where the
 *     checks that read "you" can't see it write them.
 * Then the craft: a sentence of narration that feels or thinks for the viewer, or uses a worn phrase, is cut; a reply
 * that loses more than a third that way isn't used. `why` is a word for the step log, `avoid` the next draft's note:
 * neither holds more of the reply than one word of our own lists.
 */
export function checkReply(paragraphs: readonly string[], limits: PairLimits, o: { publicPlace: boolean; pronouns?: string | null }): ReplyVerdict {
  if (!paragraphs.length) return { ok: false, why: "empty", avoid: "there was no story in it" };
  const whole = paragraphs.join("\n\n");
  const crossed = linesNote(whole);
  if (crossed) return { ok: false, ...crossed };
  const limited = limitsNote(whole, limits, o.publicPlace);
  if (limited) return { ok: false, ...limited };
  for (const p of paragraphs) {
    if (guardStory(p, "adult").cut === 0) continue;
    const w = guardedWord(p);
    return { ok: false, why: "guard", avoid: `its narration brought in someone young, a family word or an age under 18${w ? ` (the word "${w}")` : ""}` };
  }
  if (speaksForThePerson(whole)) return { ok: false, why: "speaks_for_them", avoid: "it wrote a line for the person you're with: never write what they say or do" };
  const third = tellsThemInThirdPerson(whole, o.pronouns);
  if (third) return { ok: false, why: "third_person", avoid: `its narration called the person you're with "${third}": in the narration they are always "you"` };
  const kept = paragraphs.map((p) => guardStory(p, "adult", (sentence) => hasWornPhrase(sentence) || thinksForThePerson(sentence)).text).filter(Boolean);
  const left = kept.join("\n\n");
  if (!kept.length || left.length < (whole.length * 2) / 3) return { ok: false, why: "cut", avoid: "too much of it said what the person you're with felt or thought" };
  // What the cuts left is read once more as a whole: a cut can bring two sentences together.
  const recrossed = linesNote(left) ?? limitsNote(left, limits, o.publicPlace);
  if (recrossed) return { ok: false, ...recrossed };
  return { ok: true, paragraphs: kept };
}

/** The AI notice is due at a scene's start, back after NOTICE_IDLE_MINUTES, and every NOTICE_EVERY_HOURS. */
export function noticeDue(s: { notice_at: string | Date | null; last_at: string | Date }, now: Date): boolean {
  if (!s.notice_at) return true;
  if (now.getTime() - new Date(s.last_at).getTime() >= NOTICE_IDLE_MINUTES * 60_000) return true;
  return now.getTime() - new Date(s.notice_at).getTime() >= NOTICE_EVERY_HOURS * 3_600_000;
}

async function putNotice(db: Db, s: SceneRow, name: string, now: Date): Promise<void> {
  await addMessage(db, s, "system", stepInNotice(name), now, { kind: "notice" });
  await db.query(`update adult_step_in_scenes set notice_at = $2 where id = $1`, [s.id, now.toISOString()]);
  s.notice_at = now.toISOString();
}

/* ------------------------------------------------ the step log ------------------------------------------------ */

/**
 * One row in After Dark's step log (lib/adult/steps.ts) for a reply or a refusal: what kind of move it was, how it
 * ended and why. Never a word of the viewer's or the character's: no direction, nothing dropped. Best effort.
 */
async function logMove(
  db: Db,
  who: { owner: string; character: string; scene: string | null },
  step: { ok: boolean; http?: number; message?: string | null; added?: number; flags: Record<string, unknown>; text?: { model: string | null; provider: string | null } },
): Promise<void> {
  await logStep(db, who.owner, { a: who.character, b: STEP_IN_PARTNER }, who.scene, {
    kind: "step_in",
    direction: null,
    steer_mode: null,
    status: step.ok ? "ok" : "error",
    http: step.http ?? null,
    message: step.message ?? null,
    chapter: 1,
    line_from: null,
    line_to: null,
    added: step.added ?? 0,
    dropped: [],
    flags: step.flags,
    text_model: step.text?.model ?? null,
    text_provider: step.text?.provider ?? null,
  });
}

/**
 * A refusal: counted in the step log by its kind (never the refused words), and answered. `logged`: what the log keeps
 * when the answer names a word of the line.
 */
async function refuse(db: Db, s: Pick<SceneRow, "id" | "owner_id" | "character_id">, status: number, error: string, message: string, refused: string, action: string, logged: string = message): Promise<StepInFail> {
  await logMove(db, { owner: s.owner_id, character: s.character_id, scene: s.id }, { ok: false, http: status, message: logged, flags: { action, refused } });
  return fail(status, error, message);
}

/** The self-harm protocol's pause: counted by day and surface only (never who, never the words), the scene paused. */
async function pauseForCrisis(db: Db, s: SceneRow, now: Date): Promise<StepInFail> {
  await countReferral(db, STEP_IN_SURFACE, now);
  // (A scene already ended has nothing to pause: the resources are the answer either way.)
  await db.query(`update adult_step_in_scenes set paused_at = $2 where id = $1 and ended_at is null`, [s.id, now.toISOString()]);
  return { ...fail(200, "paused", CRISIS_RESOURCES.message), crisis_resources: CRISIS_RESOURCES };
}

/* ------------------------------------------------ the view ------------------------------------------------ */

const messageKind = (m: Pick<MessageRow, "kind">): StepInMessageView["kind"] =>
  m.kind === "aside" || m.kind === "notice" || m.kind === "place" || m.kind === "call" || m.kind === "call_aside" ? m.kind : null;
/** A stand-in, written or spoken: never something to steer away from, and never a line the character "said before". */
const isAside = (m: Pick<MessageRow, "kind">): boolean => m.kind === "aside" || m.kind === "call_aside";
/** A line said out loud (a call's), the character's or its spoken stand-in. */
const isCall = (m: Pick<MessageRow, "kind">): boolean => m.kind === "call" || m.kind === "call_aside";

/** The scene's turns as they stand (no draws set aside, no AI notice), oldest first. */
const turnsOf = (rows: readonly MessageRow[]): MessageRow[] => rows.filter((m) => !m.replaced_by && !(m.role === "system" && m.kind !== "place"));
/** The same without the lines that only say the scene moved: what the viewer and the character wrote. */
const spokenOf = (rows: readonly MessageRow[]): MessageRow[] => turnsOf(rows).filter((m) => m.role !== "system");

/** The newest reply's draws in the order they were drawn, the current one among them. */
function drawsOf(rows: readonly MessageRow[], current: MessageRow): MessageRow[] {
  const at = (m: MessageRow) => new Date(m.created_at).getTime();
  return [current, ...rows.filter((m) => m.replaced_by === current.id)].sort((x, y) => at(x) - at(y) || x.id.localeCompare(y.id));
}

function roleplayView(pick: SceneRow["roleplay"], characterName: string): StepInSceneView["roleplay"] {
  const rp = pick ? roleplayById(pick.id) : null;
  if (!rp || !pick) return null;
  const you = sideOf(pick.you);
  return {
    id: rp.id,
    title: rp.title,
    icon: rp.icon,
    you_play: rp.roles ? rp.roles[pick.you] : null,
    they_play: rp.roles ? rp.roles[pick.you === 0 ? 1 : 0] : null,
    setup: rp.card ? cardForYou(rp.card, you, characterName).setup : "",
  };
}

async function viewOf(db: Db, s: SceneRow): Promise<StepInSceneView> {
  const [found, rows, drawn, who, left, eligible] = await Promise.all([
    characterRef(db, s.character_id),
    allMessages(db, s.id),
    drawnSets(db),
    stepInPersona(db, s.owner_id),
    usageLeft(db, s.owner_id, "writes"),
    eligibleIds(db, s.owner_id),
  ]);
  // A character who has since been deleted: the scene stays readable (and deletable), under a name that says so.
  const character = found ?? { id: s.character_id, name: GONE_NAME, portrait: null, hue: null };
  const shown = rows.filter((m) => !m.replaced_by);
  const spoken = spokenOf(rows);
  const last = spoken.at(-1) ?? null;
  const draws = last?.role === "character" ? drawsOf(rows, last) : [];
  // Nothing more is written once they're out of the viewer's After Dark (switched out, left the cast, deleted).
  const out = !found || !eligible.has(s.character_id);
  const live = !s.ended_at && !s.paused_at && !out;
  return {
    id: s.id,
    character,
    character_out: out,
    place: placeOf(s.place, drawn),
    roleplay: roleplayView(s.roleplay, character.name),
    persona: who.persona ? { name: who.persona.name } : null,
    persona_left_out: who.leftOut,
    limits: limitsOf(s),
    // Their own opening line is the first thing said: the character's first reply answers it.
    opening: s.opening && !openingHasSides(s.opening) ? s.opening : null,
    // `spoken`: how many pieces of a reply can be heard (what it says out loud); the narrator's stand-in says nothing.
    messages: shown.map((m) => ({ id: m.id, role: m.role, kind: messageKind(m), text: m.text, at: iso(m.created_at)!, ...(m.role === "character" && m.kind !== "aside" ? { spoken: spokenPieces(m.text).length } : {}) })),
    draws: draws.length > 1 ? { count: draws.length, showing: draws.indexOf(last!) + 1 } : null,
    paused: Boolean(s.paused_at),
    ended: s.ended_at ? { at: iso(s.ended_at)!, recap: s.recap } : null,
    can: {
      regenerate: live && last?.role === "character",
      carry_on: live,
      // The viewer's last line and what answered it; with none yet, any reply after the opening.
      take_back: live && (spoken.some((m) => m.role === "viewer") || spoken.filter((m) => m.role === "character").length > 1),
    },
    steps_left: left,
    started_at: iso(s.created_at)!,
  };
}

/**
 * `replied: false`: done, but the reply it should have come with didn't (no model answered), so nothing was counted;
 * `message` says so, and Continue draws the reply that's due.
 */
export type StepInSend = { ok: true; view: StepInSceneView; replied?: false; message?: string } | StepInFail;

async function sent(db: Db, s: SceneRow, extra: { replied?: false; message?: string } = {}): Promise<StepInSend> {
  const fresh = await ownScene(db, s.owner_id, s.id);
  return fresh ? { ok: true, view: await viewOf(db, fresh), ...extra } : NOT_FOUND;
}

/**
 * Whether the scene can still be written: its character is still one the viewer may have in After Dark (the same
 * eligibility as when it started, asked again before every reply, as a pair's is). When they've been switched out,
 * left the cast or been deleted, the scene stays to read, end or delete, and nothing more is written.
 */
async function writable(db: Db, s: SceneRow): Promise<StepInFail | null> {
  if (s.ended_at) return ENDED;
  if (s.paused_at) return PAUSED;
  if ((await eligibleIds(db, s.owner_id)).has(s.character_id)) return null;
  return fail(409, "character_out", "They aren't in your After Dark any more, so this scene can't go on. It's still here to read, and you can end it.");
}

/** The scene as its page shows it. */
export async function getStepInScene(db: Db, viewer: string, sceneId: string): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  return s ? sent(db, s) : NOT_FOUND;
}

/** The viewer's scenes for the set-up page: the ones still running (the latest first), then the ones they ended. */
export async function listStepInScenes(db: Db, viewer: string): Promise<{ running: StepInSceneRef[]; ended: StepInSceneRef[] }> {
  const { rows } = await db.query<SceneRow & { name: string | null; portrait: string | null; hue: number | null }>(
    `select s.id, s.owner_id, s.character_id, s.place, s.roleplay, s.line, s.ended_at, s.last_at, c.name, ${portraitPathSql("c")} as portrait, c.avatar_hue as hue
       from adult_step_in_scenes s left join characters c on c.id = s.character_id
      where s.owner_id = $1 order by s.last_at desc limit 60`,
    [viewer],
  );
  const drawn = await drawnSets(db);
  const refs = rows.map((r) => ({
    id: r.id,
    character: { id: r.character_id, name: r.name ?? GONE_NAME, portrait: r.portrait, hue: r.hue },
    place: placeOf(r.place, drawn).title,
    roleplay: (r.roleplay && roleplayById(r.roleplay.id)?.title) || null,
    last_at: iso(r.last_at)!,
    ended_at: iso(r.ended_at),
    line: r.line,
  }));
  return { running: refs.filter((r) => !r.ended_at), ended: refs.filter((r) => r.ended_at) };
}

/* ------------------------------------------------ a reply ------------------------------------------------ */

let random: () => number = Math.random;
/** Tests pick which of the three neutral lines stands in. */
export function setStepInRandomForTests(fn: (() => number) | null): void {
  random = fn ?? Math.random;
}

/** A reply's second draw goes to the fast writer once the first has taken this long, so the request ends in time. */
export const REDRAW_ON_FAST_AFTER_MS = 45_000;

type Drawn =
  | { ok: true; text: string; kind: "reply" | "aside"; call: boolean; paragraphs: number; model: string | null; provider: string | null; cost: number | null; flags: Record<string, unknown> }
  | { ok: false; fail: StepInFail; flags: Record<string, unknown> };

type DrawContext = {
  character: Character;
  place: StepInPlace;
  roleplay: { rp: Roleplay; you: 0 | 1 } | null;
  persona: ScenePersona | null;
  limits: PairLimits;
  turns: StepInTurn[];
  /** The character's replies so far, newest first: what a new one mustn't say again. */
  said: string[];
  earlier: string[];
};

const turnOf = (m: MessageRow): StepInTurn =>
  m.role === "system" ? { role: "place", text: promptPlace(m.text).label } : { role: m.role === "viewer" ? "viewer" : isAside(m) ? "aside" : "character", text: m.text };

/** One line about each earlier scene with this character that the viewer ended, newest first. */
async function earlierScenes(db: Db, s: Pick<SceneRow, "id" | "owner_id" | "character_id">): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(
    `select line from adult_step_in_scenes where owner_id = $1 and character_id = $2 and id <> $3 and ended_at is not null and line is not null order by ended_at desc limit $4`,
    [s.owner_id, s.character_id, s.id, EARLIER_SCENES],
  );
  // Read again as it's used: a line kept before a check got stricter never reaches a prompt.
  return rows.map((r) => r.line).filter((l) => memoryLineOk(l));
}

async function drawContext(db: Db, s: SceneRow, rows: readonly MessageRow[], replacing: readonly string[] = []): Promise<DrawContext | null> {
  const [character, drawn, persona, earlier] = await Promise.all([sceneCharacter(db, s.character_id), drawnSets(db), adultPersona(db, s.owner_id), earlierScenes(db, s)]);
  if (!character) return null;
  const rp = s.roleplay ? roleplayById(s.roleplay.id) : null;
  const current = turnsOf(rows).filter((m) => !replacing.includes(m.id));
  return {
    character,
    place: placeOf(s.place, drawn),
    roleplay: rp && s.roleplay ? { rp, you: s.roleplay.you } : null,
    persona,
    limits: limitsOf(s),
    turns: current.slice(-STEP_IN_TURNS).map(turnOf),
    said: current.filter((m) => m.role === "character" && !isAside(m)).map((m) => m.text).reverse().slice(0, 150),
    earlier,
  };
}

const emptyText = (err: unknown) => err instanceof Error && /returned no text/.test(err.message);

/**
 * The character's reply to the scene as it stands. Written by the viewer's own writer (lib/adult/writer.ts), the fast
 * one standing in exactly as for a scene step (lib/adult/scenes.ts writeSceneStep): at once when theirs is limited or
 * doesn't answer, and after it has twice sent nothing back. Every draft goes through checkReply and the repeat check;
 * one that fails is drawn once more with a note of what to avoid, and when that fails too a neutral narrator's line
 * stands in. Fails (502) only when no model answered the first draw: then nothing is written and nothing counted.
 *
 * `form: "call"`: the reply is said out loud (lib/adult/step-in-prompt.ts STEP_IN_CALL), so it's a few spoken
 * sentences, read by parseCallReply and held to checkCallReply, and the stand-in is one of the spoken ones
 * (CALL_ASIDES). The fast writer writes it whoever the viewer's writer is: someone is waiting to hear the answer.
 */
async function draw(
  db: Db,
  s: SceneRow,
  ctx: DrawContext,
  o: { cue: "open" | "continue" | null; insteadOf?: string | null; form?: "call" | null },
): Promise<Drawn> {
  const settings = await getAdultSettings(db);
  const opening = o.cue === "open";
  const call = o.form === "call";
  const chosen = await writerChoice(db, s.owner_id, { opening });
  const { id: writer, think_tokens } = call ? { id: FALLBACK_WRITER, think_tokens: 0 } : chosen;
  const own = await adultModel(db, process.env, { model: writer });
  const fast = writer === FALLBACK_WRITER ? null : await adultModel(db, process.env, { model: FALLBACK_WRITER });
  const usage: Usage[] = [];
  const served = { model: null as string | null, provider: null as string | null };
  const sampling = samplingOf(settings);
  const options = (thinking: number): ModelOptions => ({
    temperature: sampling.temperature,
    maxTokens: (call ? STEP_IN_CALL_TOKENS : STEP_IN_REPLY_TOKENS) + thinking,
    ...(sampling.frequency_penalty !== null ? { frequencyPenalty: sampling.frequency_penalty } : {}),
    ...(sampling.presence_penalty !== null ? { presencePenalty: sampling.presence_penalty } : {}),
    ...(sampling.repetition_penalty !== null ? { repetitionPenalty: sampling.repetition_penalty } : {}),
    onUsage: (u) => void usage.push(u),
    onServed: (x) => {
      served.model = x.model ?? served.model;
      served.provider = x.provider ?? served.provider;
    },
  });
  const flags: Record<string, unknown> = { calls: 0 };
  let model: Model = own;
  let thinking = think_tokens;
  const toFast = () => {
    flags.fell_back_to = FALLBACK_WRITER;
    model = fast!;
    thinking = 0;
  };
  /** One draft's text, the fast writer standing in as it does for a scene step. */
  const complete = async (avoid: string | null): Promise<string> => {
    const messages = stepInMessages({
      character: ctx.character,
      place: { ...promptPlace(ctx.place.place), public: ctx.place.public },
      roleplay: ctx.roleplay,
      persona: ctx.persona,
      limits: ctx.limits,
      turns: ctx.turns,
      recap: s.recap,
      earlier: ctx.earlier,
      // The opening is for the scene's first reply only.
      opening: opening ? s.opening : null,
      cue: o.cue,
      insteadOf: o.insteadOf ?? null,
      avoid,
      form: call ? "call" : null,
    });
    const ask = () => {
      flags.calls = Number(flags.calls) + 1;
      return model.complete(messages, options(thinking));
    };
    try {
      return await ask();
    } catch (err) {
      const canFallBack = Boolean(fast) && model !== fast;
      if (limitOf(err) && canFallBack) {
        toFast();
        return ask();
      }
      if (!emptyText(err)) throw err;
      try {
        return await ask();
      } catch (again) {
        if ((limitOf(again) || emptyText(again)) && canFallBack) {
          toFast();
          return ask();
        }
        throw again;
      }
    }
  };

  const started = Date.now();
  const reasons: string[] = [];
  let avoid: string | null = null;
  let kept: string[] | null = null;
  // A draft that passed every check and only says something again: used when the second isn't better (never the aside).
  let repeat: string[] | null = null;
  for (let attempt = 0; attempt < 2 && !kept; attempt++) {
    // The second draw goes to the fast writer when the first had no story in it (as a scene step's does), and never
    // waits on a slow writer twice.
    if (attempt > 0 && fast && model !== fast && (reasons.at(-1) === "empty" || Date.now() - started > REDRAW_ON_FAST_AFTER_MS)) toFast();
    let raw: string;
    try {
      raw = await complete(avoid);
    } catch {
      if (attempt === 0) return { ok: false, fail: fail(502, "model_down", `${first(ctx.character.name)} can't answer right now. Try again in a moment.`), flags: { ...flags, model_down: true } };
      break;
    }
    const verdict = call
      ? checkCallReply(parseCallReply(raw), ctx.limits, { publicPlace: ctx.place.public })
      : checkReply(parseStoryReply(raw), ctx.limits, { publicPlace: ctx.place.public, pronouns: ctx.character.pronouns });
    if (!verdict.ok) {
      reasons.push(verdict.why);
      avoid = verdict.avoid;
      continue;
    }
    if (repeatsEarlier(verdict.paragraphs.join(" "), ctx.said)) {
      repeat ??= verdict.paragraphs;
      reasons.push("repeat");
      avoid = "you've said this before: write something new";
      continue;
    }
    kept = verdict.paragraphs;
  }
  kept ??= repeat;
  const cost = usage.some((u) => typeof u.cost === "number") ? usage.reduce((n, u) => n + (u.cost ?? 0), 0) : null;
  const modelId = served.model ?? (await adultModelId(db, process.env, { model: flags.fell_back_to ? FALLBACK_WRITER : writer }));
  const out = { model: modelId, provider: served.provider, cost, flags: { ...flags, ...(reasons.length ? { redrawn: reasons } : {}) } };
  if (kept) return { ok: true, text: kept.join("\n\n"), kind: "reply", call, paragraphs: kept.length, ...out };
  // Twice unusable: the narrator changes the subject (on a call, the character does, out loud), and nothing of either draft is kept.
  const pool = call ? CALL_ASIDES : ASIDES;
  const aside = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return { ok: true, text: call ? `"${aside}"` : aside, kind: "aside", call, paragraphs: 1, ...out, flags: { ...out.flags, aside: true } };
}

/**
 * Draws a reply and keeps it: the message, the month's count (one scene step, whatever it took to draw), and the step
 * log. `replaces`: the reply it stands in for (regenerate), which stays as a draw to flip back to. Null: the model was
 * down, nothing was written, and the failure is in the log.
 */
async function reply(
  db: Db,
  s: SceneRow,
  rows: readonly MessageRow[],
  now: Date,
  o: { action: string; cue: "open" | "continue" | null; insteadOf?: string | null; replaces?: MessageRow | null; form?: "call" | null },
): Promise<StepInFail | { ok: true; id: string; aside: boolean }> {
  const ctx = await drawContext(db, s, rows, o.replaces ? [o.replaces.id] : []);
  if (!ctx) return NOT_FOUND;
  const who = { owner: s.owner_id, character: s.character_id, scene: s.id };
  const drawn = await draw(db, s, ctx, { cue: o.cue, insteadOf: o.insteadOf, form: o.form });
  if (!drawn.ok) {
    await logMove(db, who, { ok: false, http: drawn.fail.status, message: drawn.fail.message, flags: { action: o.action, ...drawn.flags } });
    return drawn.fail;
  }
  const kind = drawn.call ? (drawn.kind === "aside" ? "call_aside" : "call") : drawn.kind === "aside" ? "aside" : null;
  const id = await addMessage(db, s, "character", drawn.text, now, { kind, model: drawn.model, cost: drawn.cost });
  if (o.replaces) {
    // The reply it replaces, and the draws that one already had, all point at the new current draw: exactly one is current.
    await db.query(`update adult_step_in_messages set replaced_by = $3 where scene_id = $1 and (id = $2 or replaced_by = $2)`, [s.id, o.replaces.id, id]);
  }
  await countUse(db, s.owner_id, "writes", now);
  await logMove(db, who, { ok: true, added: drawn.paragraphs, flags: { action: o.action, ...(drawn.call ? { call: true } : {}), ...drawn.flags }, text: { model: drawn.model, provider: drawn.provider } });
  return { ok: true, id, aside: drawn.kind === "aside" };
}

/** What a reply answers when the viewer hasn't just written: nothing yet (it opens the scene), or the character's own last word. */
const cueAfter = (last: MessageRow | null): "open" | "continue" | null => (!last ? "open" : last.role === "character" ? "continue" : null);

/* ------------------------------------------------ starting one ------------------------------------------------ */

export type StepInOpeningPick = 0 | 1 | 2 | "surprise" | { written: string };
export type StepInStart = {
  character_id: string;
  /** A place's id from stepInPlaces. */
  place: string;
  /** One of After Dark's roleplays and which of its two sides the viewer plays (0: its first role); null: none. */
  roleplay?: { id: string; you?: 0 | 1 } | null;
  /** How it opens: one of the three, any of them ("surprise", or nothing sent), or one sentence of the viewer's own. */
  opening?: StepInOpeningPick;
};

/** The three openings a scene has to pick from: its roleplay's card's, or the generic three (the viewer is {a}) without one. */
export const openingsFor = (rp: Roleplay | null): readonly [string, string, string] => rp?.card?.openings ?? GENERIC_OPENINGS;

/**
 * Starts a scene: who (someone the viewer may have in After Dark), where (a place from the catalog), the roleplay and
 * the viewer's side of it, and how it opens. A written opening is the viewer's own words, so it goes through the
 * self-harm check, the lines that never move and the roleplay theme check (lib/scene-cards.ts adultCardTextIssue: one
 * sentence of story, nothing explicit) before anything exists: refused, no scene is made and nothing is kept. Then the
 * AI notice goes in and the character opens, one scene step. If no model answers, the scene is there without its
 * opening (`replied: false`) and Continue draws it. `defer`: the scene is made without its opening and no model is
 * asked (quickStepIn: the click lands on the scene at once, and the page has the character open it).
 */
export async function startStepIn(db: Db, viewer: string, input: StepInStart, now: Date = new Date(), opts: { defer?: boolean } = {}): Promise<(StepInSend & { ok: true; id: string }) | StepInFail> {
  if (!(await eligibleIds(db, viewer)).has(input.character_id)) return fail(404, "not_found", "Pick someone who's in your After Dark: the house cast, or a character you've switched in.");
  const character = await characterRef(db, input.character_id);
  if (!character) return NOT_FOUND;
  const place = stepInPlaces(await drawnSets(db)).find((p) => p.id === input.place);
  if (!place) return fail(422, "invalid_place", "Pick a place from the list.");
  const rp = input.roleplay ? roleplayById(input.roleplay.id) : null;
  if (input.roleplay && !rp) return fail(422, "invalid_roleplay", "Pick a roleplay from the list, or none.");
  const you: 0 | 1 = input.roleplay?.you === 1 ? 1 : 0;
  const id = randomUUID();
  const who = { owner: viewer, character: input.character_id, scene: null };
  let opening: string | null;
  const pick = input.opening ?? "surprise";
  if (typeof pick === "object") {
    const text = pick.written.replace(/\s+/g, " ").trim();
    if (!text) opening = openingOf({ openings: openingsFor(rp) }, null, id);
    else {
      if (text.length > CARD_OPENING_MAX) return fail(422, "invalid_opening", `Keep the opening to one sentence, up to ${CARD_OPENING_MAX} characters.`);
      if (/[{}]/.test(text)) return fail(422, "invalid_opening", "Write the opening in plain words, without braces.");
      // The viewer's own words: the self-harm check first. Nothing is kept, and no scene is made.
      const { crisis } = await lineInCrisis(text, STEP_IN_SURFACE, await adultModel(db));
      if (crisis) {
        await countReferral(db, STEP_IN_SURFACE, now);
        return { ...fail(200, "crisis", CRISIS_RESOURCES.message), crisis_resources: CRISIS_RESOURCES };
      }
      // Then the lines that never move (After Dark's, and Step in's own net), then that it's a sentence of story.
      const safe = checkAdultText({ opening: text });
      const never = safe.ok ? stepInNever(text) : null;
      // What they're told, and what the log keeps of it (never a word of what was written).
      const crossed = !safe.ok ? { message: linesMessage("opening", safe), logged: linesMessage("opening", safe) } : never ? neverMessage("opening", never) : null;
      const issue = crossed ? null : openingIssue(text);
      if (crossed || issue) {
        await logMove(db, who, { ok: false, http: 422, message: crossed ? crossed.logged : issue, flags: { action: "start", refused: crossed ? "lines" : "opening" } });
        return fail(422, "opening_not_allowed", crossed ? crossed.message : issue!);
      }
      opening = text;
    }
  } else opening = openingOf({ openings: openingsFor(rp) }, pick === "surprise" ? null : pick, id);
  const capped = await overCap(db, viewer, "writes", now);
  if (capped) {
    await logMove(db, who, { ok: false, http: 429, message: capped, flags: { action: "start", refused: "cap" } });
    return fail(429, "capped", capped);
  }
  await db.query(`insert into adult_step_in_scenes (id, owner_id, character_id, place, roleplay, opening, created_at, last_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)`, [
    id,
    viewer,
    input.character_id,
    place.place,
    rp ? JSON.stringify({ id: rp.id, you }) : null,
    opening,
    now.toISOString(),
  ]);
  const s = (await ownScene(db, viewer, id))!;
  await putNotice(db, s, character.name, now);
  if (opts.defer) {
    const made = await sent(db, s);
    return made.ok ? { ...made, id } : made;
  }
  const r = await reply(db, s, [], tick(now, 1), { action: "start", cue: "open" });
  const done = await sent(db, s, r.ok ? {} : { replied: false, message: r.message });
  return done.ok ? { ...done, id } : done;
}

/* ------------------------------------------------ one click ------------------------------------------------ */

/** Where a scene started in one click begins: the character's own place (private, so nothing is held to a kiss). */
export const QUICK_PLACE = "venue:home";

/**
 * The viewer's scenes still running, the latest for each character: what "Step in" on a character picks up
 * (app/after-dark/characters), so the button can say so and go straight there.
 */
export async function runningStepIns(db: Db, viewer: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; character_id: string }>(
    `select distinct on (character_id) id, character_id from adult_step_in_scenes where owner_id = $1 and ended_at is null order by character_id, last_at desc`,
    [viewer],
  );
  return new Map(rows.map((r) => [r.character_id, r.id]));
}

export type StepInQuick = { ok: true; id: string; resumed: boolean } | StepInFail;

/**
 * Step in with someone in one click (David, 2026-11-22: "one click step in, but still allow for role play", as the
 * show's Characters page texts someone in one): the scene the viewer has running with that character, or a new one
 * with nothing to choose first: at the character's own place, no roleplay, any of the three openings. The new scene is
 * made without its opening, so nothing waits on a model and the click lands on the scene at once; its page has the
 * character open it (continueStepIn: one scene step, as an opening always is). The set-up page is still there for a
 * place, a roleplay or a written opening, and a scene can move somewhere else once it's running.
 */
export async function quickStepIn(db: Db, viewer: string, characterId: string, now: Date = new Date()): Promise<StepInQuick> {
  if (!(await eligibleIds(db, viewer)).has(characterId)) return fail(404, "not_found", "Pick someone who's in your After Dark: the house cast, or a character you've switched in.");
  const running = (await db.query<{ id: string }>(`select id from adult_step_in_scenes where owner_id = $1 and character_id = $2 and ended_at is null order by last_at desc limit 1`, [viewer, characterId])).rows[0];
  if (running) return { ok: true, id: running.id, resumed: true };
  const places = stepInPlaces(await drawnSets(db));
  const place = places.find((p) => p.id === QUICK_PLACE) ?? places.find((p) => !p.public) ?? places[0];
  if (!place) return fail(409, "no_place", "There's nowhere to be yet. Set the scene instead.");
  const made = await startStepIn(db, viewer, { character_id: characterId, place: place.id, opening: "surprise" }, now, { defer: true });
  return made.ok ? { ok: true, id: made.id, resumed: false } : made;
}

/** Why a written opening isn't one, in words for the person who wrote it, or null (after the lines that never move). */
function openingIssue(text: string): string | null {
  const issue = adultCardTextIssue(text);
  if (!issue) return null;
  if (issue.startsWith("never"))
    return "That opening can't be used: everyone in a scene is an adult who wants to be there, so nothing about family, school or a babysitter, and nobody drunk, trapped, paid or kept from saying no.";
  if (issue.startsWith("explicit") || issue.startsWith("suggestive"))
    return "That opening can't be used: an opening is one sentence of story (who is where, doing what), with nothing explicit in it. How far the scene goes is decided in the scene.";
  return "That opening crosses one of the lines that never move.";
}

/* ------------------------------------------------ playing it ------------------------------------------------ */

/** How far the scene has gone (STAGES index): the furthest stage anything in it plainly shows. */
const stageOf = (rows: readonly MessageRow[]): number => spokenOf(rows).reduce((max, m) => Math.max(max, stageShown(m.text) ?? 0), 0);

/**
 * One line from the viewer (what they say and do), and the character's reply. The checks, in order: the self-harm
 * protocol, the lines that never move, the viewer's own limits; then the month's steps. A line that's refused is never
 * stored. The AI notice goes in first when it's due.
 *
 * `call`: the line was said out loud on a call (what the browser heard, as words), and the reply is said out loud too
 * (draw's `form: "call"`). Every check is the same, it counts one scene step like any reply, and both lines are kept in
 * the scene marked as a call's.
 */
export async function sendStepInLine(db: Db, viewer: string, sceneId: string, input: string, now: Date = new Date(), opts: { call?: boolean } = {}): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const text = clean(input);
  const action = opts.call ? "say" : "send";
  if (!text) return fail(400, "empty", opts.call ? "Nothing was heard." : "Write what you say or do first.");
  if (text.length > STEP_IN_LINE_MAX) return fail(400, "too_long", `Keep it under ${STEP_IN_LINE_MAX} characters.`);
  // Their own words are read for this before anything else, whatever state the scene is in.
  const { crisis } = await lineInCrisis(text, STEP_IN_SURFACE, await adultModel(db));
  if (crisis) return pauseForCrisis(db, s, now);
  const closed = await writable(db, s);
  if (closed) return closed;
  const safe = checkAdultText({ line: text });
  if (!safe.ok) return refuse(db, s, 422, "refused", linesMessage("line", safe), "lines", action);
  // Step in's own net (lib/adult/step-in-lines.ts): here a line can cross the same lines just by saying who someone is.
  const never = stepInNever(text);
  if (never) {
    const told = neverMessage("line", never);
    return refuse(db, s, 422, "refused", told.message, "lines", action, told.logged);
  }
  const rows = await allMessages(db, s.id);
  const limited = lineLimitRefusal(text, limitsOf(s), stageOf(rows));
  if (limited) return refuse(db, s, 422, "limits", limited, "limits", action);
  const capped = await overCap(db, viewer, "writes", now);
  if (capped) return refuse(db, s, 429, "capped", capped, "cap", action);
  const character = await characterRef(db, s.character_id);
  if (!character) return NOT_FOUND;
  if (noticeDue(s, now)) await putNotice(db, s, character.name, now);
  await addMessage(db, s, "viewer", text, tick(now, 1), { kind: opts.call ? "call" : null });
  const r = await reply(db, s, await allMessages(db, s.id), tick(now, 2), { action, cue: null, form: opts.call ? "call" : null });
  // No model answered: their line is kept, and Continue draws the reply that's due.
  return sent(db, s, r.ok ? {} : { replied: false, message: r.message });
}

/**
 * The character carries on without the viewer writing anything: one more reply, counted like any. With nothing of the
 * character's to carry on from (the viewer wrote last, or the opening never came), it's simply the reply that's due.
 */
export async function continueStepIn(db: Db, viewer: string, sceneId: string, now: Date = new Date()): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const closed = await writable(db, s);
  if (closed) return closed;
  const capped = await overCap(db, viewer, "writes", now);
  if (capped) return refuse(db, s, 429, "capped", capped, "cap", "continue");
  const character = await characterRef(db, s.character_id);
  if (!character) return NOT_FOUND;
  // The viewer is here and asking for more: the notice is due on their time, as on a line of theirs.
  if (noticeDue(s, now)) await putNotice(db, s, character.name, now);
  const rows = await allMessages(db, s.id);
  const r = await reply(db, s, rows, tick(now, 1), { action: "continue", cue: cueAfter(spokenOf(rows).at(-1) ?? null) });
  if (!r.ok) return r;
  return sent(db, s);
}

/**
 * Draws the newest reply again: one scene step, like any reply. The one it replaces is kept as a draw the viewer can
 * flip back to (swipeStepIn). With no reply to draw again (the viewer wrote last), it's simply the reply that's due.
 */
export async function regenerateStepIn(db: Db, viewer: string, sceneId: string, now: Date = new Date()): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const closed = await writable(db, s);
  if (closed) return closed;
  const capped = await overCap(db, viewer, "writes", now);
  if (capped) return refuse(db, s, 429, "capped", capped, "cap", "regenerate");
  const rows = await allMessages(db, s.id);
  const spoken = spokenOf(rows);
  const last = spoken.at(-1) ?? null;
  const replaces = last?.role === "character" ? last : null;
  // What the reply being drawn again answered: the line before it, the character's own (it carried on), or nothing.
  const before = replaces ? (spoken.at(-2) ?? null) : last;
  const r = await reply(db, s, rows, now, {
    action: "regenerate",
    cue: cueAfter(before),
    // The narrator's stand-in isn't something to steer away from: the draw is simply made again.
    insteadOf: replaces && !isAside(replaces) ? replaces.text.slice(0, 600) : null,
    replaces,
    // A line said on a call is drawn again as one.
    form: replaces && isCall(replaces) ? "call" : null,
  });
  if (!r.ok) return r;
  return sent(db, s);
}

/**
 * Flips the newest reply to another of its draws (free: nothing is drawn): the one before or after the one showing, in
 * the order they were drawn. Only the newest reply, while nothing has been written after it. A draw kept from before
 * the viewer tightened their limits isn't shown again: it's held to the limits as they are now.
 */
export async function swipeStepIn(db: Db, viewer: string, sceneId: string, to: "prev" | "next"): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const closed = await writable(db, s);
  if (closed) return closed;
  const rows = await allMessages(db, s.id);
  const last = spokenOf(rows).at(-1) ?? null;
  const order = last?.role === "character" ? drawsOf(rows, last) : [];
  if (order.length < 2) return fail(409, "one_draw", "There's only this one so far. Ask for another first.");
  const target = order[order.indexOf(last!) + (to === "next" ? 1 : -1)];
  if (!target) return fail(409, "no_more", to === "next" ? "That's the newest one." : "That's the first one.");
  const drawn = await drawnSets(db);
  // Held again to the limits as they are now, and to the lines as they're checked now.
  if (linesNote(target.text) ?? limitsNote(target.text, limitsOf(s), placeOf(s.place, drawn).public)) return fail(409, "past_limits", "That draw is past the limits you've set since. Draw another instead.");
  await db.query(`update adult_step_in_messages set replaced_by = case when id = $3::text then null else $3::text end where scene_id = $1 and id = any($2::text[])`, [s.id, order.map((m) => m.id), target.id]);
  return sent(db, s);
}

/**
 * Takes back the last exchange: the viewer's last line and everything written after it (its reply, anything the
 * character carried on with, and their kept draws), gone for good. With no line of theirs yet, the newest reply after
 * the opening. The steps they used aren't given back.
 */
export async function takeBackStepIn(db: Db, viewer: string, sceneId: string): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const closed = await writable(db, s);
  if (closed) return closed;
  const rows = await allMessages(db, s.id);
  const spoken = spokenOf(rows);
  const line = [...spoken].reverse().find((m) => m.role === "viewer") ?? null;
  const gone = line ? spoken.slice(spoken.indexOf(line)) : spoken.filter((m) => m.role === "character").length > 1 ? spoken.slice(-1) : [];
  if (!gone.length) return fail(409, "nothing_to_take_back", "There's nothing to take back yet.");
  const ids = gone.map((m) => m.id);
  await db.query(`delete from adult_step_in_messages where scene_id = $1 and (id = any($2::text[]) or replaced_by = any($2::text[]))`, [s.id, ids]);
  return sent(db, s);
}

/** Carry on after the crisis resources: the scene opens again. */
export async function carryOnStepIn(db: Db, viewer: string, sceneId: string): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  await db.query(`update adult_step_in_scenes set paused_at = null where id = $1`, [s.id]);
  return sent(db, s);
}

/**
 * Moves the scene to another place from the catalog (free: nothing is drawn): a line in the scene says so, and the next
 * reply is written there. It's how a scene that began in public goes somewhere private, since a public place keeps
 * everything to a kiss at most.
 */
export async function moveStepIn(db: Db, viewer: string, sceneId: string, placeId: string, now: Date = new Date()): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const closed = await writable(db, s);
  if (closed) return closed;
  const place = stepInPlaces(await drawnSets(db)).find((p) => p.id === placeId);
  if (!place) return fail(422, "invalid_place", "Pick a place from the list.");
  if (normalizeScene(place.place) === normalizeScene(s.place)) return fail(409, "already_there", "You're already there.");
  await db.query(`update adult_step_in_scenes set place = $2 where id = $1`, [s.id, place.place]);
  await addMessage(db, s, "system", place.place, now, { kind: "place" });
  return sent(db, s);
}

/**
 * Sets the viewer's limits for the scene (lib/adult/limits.ts: the intensity and the hard nos), exactly as a pair's are
 * set (lib/adult/scenes.ts saveLimits): their own hard nos held to the lines like anything typed, and, because hard nos
 * are "sex life" data (GDPR Art. 9), nothing stored without the profile consent (given now, or before).
 */
export async function saveStepInLimits(db: Db, viewer: string, sceneId: string, input: LimitsInput, opts: { consent?: boolean } = {}): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  const before = limitsOf(s);
  const intensity = input.intensity === undefined ? before.intensity : intensityOf(input.intensity);
  let hard_nos: HardNos = before.hard_nos;
  if (input.hard_nos) {
    const seen = new Set<string>();
    const own = (input.hard_nos.own ?? []).map((o) => o.replace(/\s+/g, " ").trim()).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
    if (own.length > OWN_MAX) return fail(400, "invalid_limits", `Up to ${OWN_MAX} of your own hard nos.`);
    const long = own.find((o) => o.length > OWN_LEN);
    if (long) return fail(400, "invalid_limits", `Keep each hard no to ${OWN_LEN} characters ("${long.slice(0, 20)}…").`);
    if (own.some((o) => !checkAdultText({ limit: o }).ok)) {
      return fail(422, "invalid_limits", "One of those crosses the lines that never move (nobody under 18, no real people): they already never happen, so there's no need to list them.");
    }
    hard_nos = storedHardNos({ chips: input.hard_nos.chips ?? [], own });
    if (hasHardNos(hard_nos) && opts.consent !== true && !(await hasProfileConsent(db, viewer))) return { ...consentRefusal(), error: "consent_required" };
  }
  // When hard nos were sent: consented now if there are any, nothing to consent to if they were cleared.
  const consented = input.hard_nos ? hasHardNos(hard_nos) : null;
  await db.query(
    `update adult_step_in_scenes set intensity = $2, hard_nos = $3::jsonb,
       hard_nos_consented_at = case when $4::boolean is null then hard_nos_consented_at when $4::boolean then now() else null end
     where id = $1`,
    [s.id, intensity, JSON.stringify(hard_nos), consented],
  );
  return sent(db, s);
}

/* ------------------------------------------------ memory ------------------------------------------------ */

/** A recap or a remembered line may go into a prompt: After Dark's lines, the narrator's guard, and nothing about self-harm. */
const memoryLineOk = (text: string): boolean => checkAdultText({ memory: text }).ok && !stepInNever(text) && !narrationGuard(text, "adult") && !crisisIntent(text);

/** An ended scene's line when the model's can't be used: what the record itself says, and nothing else. */
const recordLine = (placeTitle: string, rp: Roleplay | null): string => `A scene at ${placeTitle}${rp ? `, playing "${rp.title}"` : ""}.`;

/**
 * The scene's notes, written the way a chapter's recap is (lib/adult/scenes.ts writeRecap: the fast text model, the
 * same call and the same reading of its reply, recapFrom), for one character and the viewer: the recap so far and the
 * next stretch in, the new recap and one line to remember the scene by out. Both are held to After Dark's lines and
 * the narrator's guard before they're kept; null for one that can't be used.
 */
async function writeNotes(db: Db, name: string, before: string | null, stretch: readonly MessageRow[]): Promise<{ recap: string | null; line: string | null }> {
  try {
    const raw = await (await adultModel(db)).complete(
      [
        {
          role: "system",
          content: `You keep the running notes of a private scene of adult fiction between a person and ${name}, an AI character, so that ${name} remembers it later. Plain facts, third person, past tense, no quotes. The person is "they": note what they said and did, never what they felt or thought.`,
        },
        {
          role: "user",
          content:
            (before ? `The notes so far:\n${before}\n\n` : "") +
            `The next stretch:\n${stretch.map((m) => `${m.role === "viewer" ? "Them" : m.kind === "aside" ? "(Narrator)" : name}: ${m.text}`).join("\n")}\n\n` +
            `Write "recap": the whole scene so far in under 120 words (where it was, what happened and in what order, how ${name} felt about it, anything promised or left open), ` +
            `and "line": one sentence under 30 words that ${name} would remember the scene by. Reply with a JSON object: {"recap": "...", "line": "..."}`,
        },
      ],
      { temperature: 0.3, maxTokens: 400 },
    );
    const got = recapFrom(raw);
    const recap = "recap" in got && memoryLineOk(got.recap) ? got.recap : null;
    const said = (jsonOf(raw) as { line?: unknown } | null)?.line;
    const line = typeof said === "string" ? said.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    return { recap, line: line && memoryLineOk(line) ? line : null };
  } catch {
    return { recap: null, line: null };
  }
}

/**
 * After a reply (the route runs it past the response): the rolling recap, written again when RECAP_EVERY turns have
 * fallen out of the prompt since the last one. One call; a failure keeps the old recap. Never throws.
 */
export async function stepInFollowUp(db: Db, sceneId: string): Promise<boolean> {
  try {
    const s = (await db.query<SceneRow>(`select ${SCENE_COLUMNS} from adult_step_in_scenes where id = $1`, [sceneId])).rows[0];
    if (!s || s.ended_at) return false;
    const since = s.recap_upto ? new Date(s.recap_upto).getTime() : 0;
    const fresh = spokenOf(await allMessages(db, s.id)).filter((m) => new Date(m.created_at).getTime() > since);
    const older = fresh.slice(0, Math.max(0, fresh.length - STEP_IN_TURNS));
    if (older.length < RECAP_EVERY) return false;
    const name = first((await characterRef(db, s.character_id))?.name ?? "the character");
    const { recap } = await writeNotes(db, name, s.recap, older);
    if (!recap) return false;
    await db.query(`update adult_step_in_scenes set recap = $2, recap_upto = $3 where id = $1`, [s.id, recap, new Date(older[older.length - 1].created_at).toISOString()]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends the scene and files it: kept, readable, with a short recap, and one line the next scene with this character
 * remembers it by. Free (it's a recap, not a reply). When the model's notes can't be used, the recap stays as it was
 * and the line is what the record says (where, and which roleplay).
 */
export async function endStepIn(db: Db, viewer: string, sceneId: string, now: Date = new Date()): Promise<StepInSend> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  if (s.ended_at) return sent(db, s);
  const rows = await allMessages(db, s.id);
  const since = s.recap_upto ? new Date(s.recap_upto).getTime() : 0;
  const stretch = spokenOf(rows).filter((m) => new Date(m.created_at).getTime() > since);
  const character = await characterRef(db, s.character_id);
  const rp = s.roleplay ? roleplayById(s.roleplay.id) : null;
  const fallback = recordLine(placeOf(s.place, await drawnSets(db)).title, rp);
  const notes = stretch.length ? await writeNotes(db, first(character?.name ?? "the character"), s.recap, stretch) : { recap: null, line: null };
  await db.query(`update adult_step_in_scenes set ended_at = $2, paused_at = null, recap = $3, line = $4 where id = $1`, [s.id, now.toISOString(), notes.recap ?? s.recap ?? fallback, notes.line ?? fallback]);
  return sent(db, s);
}

/** Deletes a scene with every message of it. */
export async function deleteStepIn(db: Db, viewer: string, sceneId: string): Promise<{ ok: true } | StepInFail> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  await db.query(`delete from adult_step_in_messages where scene_id = $1`, [s.id]);
  await db.query(`delete from adult_step_in_scenes where id = $1`, [s.id]);
  return { ok: true };
}
