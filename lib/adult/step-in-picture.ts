/**
 * A picture of the moment in a Step in scene (docs/after-dark.md "Step in": a picture of this moment; row 7 of
 * docs/audits/2026-11-22-companion-field.md, "a photo on request"; David, 2026-11-23: "I am open to any of these
 * ideas"). Under a reply the viewer asks for a picture of what it describes; it's drawn, checked, kept with the scene
 * and shown under that reply from then on.
 *
 * It is After Dark's own picture, made the way a night's first-person picture is (lib/adult/pictures-menu.ts
 * keepPictureOfOne: the face this viewer keeps for the character, the place's drawn set, the same edit, Hive's check
 * before anything is kept, the gallery, the month's pictures). What's Step in's own is only what it's a picture of:
 *
 *  - **The character, alone.** The viewer is a person, and is never drawn: nothing they wrote about how they look
 *    (lib/persona.ts) is read here, the picture's words never say "you", and the prompt asks for one person and no part
 *    of anyone else (lib/adult/reels.ts povPrompt `alone`). The viewer is where the camera is.
 *  - **The moment.** One short call on the fast writer reads the scene up to the reply (stepInBrief, as a night's
 *    pictures are read: lib/adult/picture-brief.ts) and says, of the character only, where they are, what they have on,
 *    how they're posed and how undressed they are. Kept, so the same reply reads the same. When it can't be read, a
 *    plain still for how far the reply goes stands in.
 *  - **The scene's limits.** No further than the viewer's intensity for the scene goes, nothing that crosses a hard no,
 *    no further than a kiss and never undressed somewhere public: the same limits the scene's words are held to. Every
 *    word that reaches the picture model is read against the lines that never move (lib/safety.ts, Step in's own net).
 *  - **Whose it is.** Only a reply that stands in the viewer's own running scene (asked for by its id, never by words),
 *    of a character still in their After Dark, set up for pictures (lib/adult/readiness.ts).
 *
 * The price is After Dark's for a picture (lib/adult/pricing.ts includedPrice: included with the subscription, free
 * for an admin, else the menu picture's tokens, given back when nothing is kept), and it counts as one of the month's
 * pictures (lib/adult/usage.ts). The page shows both before anything is made (stepInPictureState).
 *
 * A reply's picture is drawn once at a time (adult_step_in_messages.picture_at is the claim, the first thing taken
 * and let go when the draw ends either way); asked again later it's drawn again, and the newest one shows. The pictures carry their scene (adult_images.step_in_scene) and go with it
 * when it's deleted.
 */
import { createHash } from "node:crypto";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { checkAdultText } from "../safety";
import { escapeRegExp } from "../text";
import { normalizeScene, venueName } from "../venues";
import { crossesTaboo } from "./acts";
import { ageRefused } from "./beats";
import { eligibleIds } from "./characters";
import { mediaLimitsOf, shownStage } from "./clips";
import { hivePausedErrorMessage } from "./hive-limit";
import { intensityOf, INTENSITY, storedHardNos } from "./limits";
import { everydayOf } from "./media";
import { checkReady, mediaGate } from "./moderation";
import { briefWriter, BRIEF_TIMEOUT_MS } from "./picture-brief";
import { keepPictureOfOne } from "./pictures-menu";
import { includedPrice, type Price } from "./pricing";
import { missingNote, readinessOf } from "./readiness";
import { placeWords, povPrompt, reelPerson, withoutNames, type ReelPerson } from "./reels";
import { roleCostumes, sceneRoleplay, type RoleplayPick } from "./roleplays";
import { venueSituation } from "./scene-catalog";
import { isPublicPlace } from "./scenes";
import { adultKeys, getAdultSettings } from "./settings";
import { STAGES } from "./stages";
import { NO_STEERING, steeringFor } from "./steering";
import { stepInNever } from "./step-in-lines";
import { placeInSentence } from "./step-in-shared";
import { storedTracker } from "./step-in-tracker";
import { logStep, STEP_IN_PARTNER } from "./steps";
import { moreTokensLine, refundAdTokens, spendAdTokens } from "./tokens";
import { overCap, usageLeft } from "./usage";

const KISSING = STAGES.indexOf("kissing");
const UNDRESSING = STAGES.indexOf("undressing");
const SEX = STAGES.indexOf("sex");

/** A reply's picture still being drawn after this long was cut off: it can be asked for again. */
export const PICTURE_CLAIM_MINUTES = 3;
/** The scene's last turns a brief reads, the reply included, and the most of each (the reply itself gets more). */
const BRIEF_TURNS = 10;
const TURN_CHARS = 900;
const REPLY_CHARS = 2400;
const BRIEF_REPLY_TOKENS = 450;
/** Each field's longest, so the picture's prompt keeps room for the moment itself (lib/adult/reels.ts fitPrompt). */
const MAX = { place: 220, wearing: 260, kept_on: 160, happening: 300, mood: 120 } as const;

export type StepInPictureFail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): StepInPictureFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "There's nothing to draw there.");

/** What the page needs to offer a picture and show the ones made (app/after-dark/step-in/[id]/StepInPicture.tsx). */
export type StepInPictureState = {
  /** Whether a picture can be asked for here now: pictures are set up, and the scene is running with someone still in the viewer's After Dark. */
  can: boolean;
  /** What one costs this viewer, said before it's made (lib/adult/pricing.ts): included, free (an admin), or tokens. */
  price: Price;
  /** How many of the month's pictures are left; null for an admin, who's never capped. */
  left: number | null;
  /** Each reply's picture, by the reply's id: the newest one made of it. */
  pictures: Record<string, string>;
  /** The replies whose picture is being drawn right now. */
  drawing: string[];
  /**
   * The reply whose picture stands in the character's place beside the scene (the viewer's choice: setStepInBeside, or
   * the newest one made when `newest` is on); null: none of the scene's pictures, so the roleplay's cover or the
   * character's own portrait (lib/adult/step-in.ts coverOf). Always a reply that has a picture.
   */
  beside: string | null;
  /**
   * "Always the newest picture" (setStepInNewest): the viewer's own switch, for every scene of theirs. On, each picture
   * they make takes that place as it lands; they can still put an earlier one there by hand until the next is made.
   */
  newest: boolean;
};

type SceneRow = {
  id: string;
  owner_id: string;
  character_id: string;
  place: string;
  roleplay: RoleplayPick | null;
  intensity: string | null;
  hard_nos: unknown;
  paused_at: string | Date | null;
  ended_at: string | Date | null;
  side_message: string | null;
  /** The scene's continuity sheet (lib/adult/step-in-tracker.ts): what a picture of the newest reply is told they have on. */
  tracker?: unknown;
};
type MessageRow = { id: string; role: "viewer" | "character" | "system"; kind: string | null; text: string; replaced_by: string | null };

async function ownScene(db: Db, viewer: string, sceneId: string): Promise<SceneRow | null> {
  return (
    (await db.query<SceneRow>(`select id, owner_id, character_id, place, roleplay, intensity, hard_nos, paused_at, ended_at, side_message, tracker from adult_step_in_scenes where id = $1 and owner_id = $2`, [sceneId, viewer]))
      .rows[0] ?? null
  );
}

/** Whether pictures can be made at all: the picture provider's key and a checker (lib/adult/moderation.ts), as a night's are. */
async function setUp(db: Db): Promise<{ ok: true; settings: Awaited<ReturnType<typeof getAdultSettings>>; keys: Awaited<ReturnType<typeof adultKeys>> } | { ok: false; message: string }> {
  const [settings, keys] = await Promise.all([getAdultSettings(db), adultKeys(db)]);
  const onReplicate = settings.media_provider === "replicate";
  if (!(onReplicate ? keys.replicate : keys.venice) || !(await checkReady(db))) return { ok: false, message: `Pictures need the ${onReplicate ? "Replicate" : "Venice"} and Hive keys in After Dark's settings.` };
  return { ok: true, settings, keys };
}

/**
 * The scene's pictures as its page shows them: whether one can be asked for, what it costs this viewer and how many of
 * the month's are left, each reply's newest picture, and the ones being drawn. Null when the scene isn't theirs.
 */
export async function stepInPictureState(db: Db, viewer: string, sceneId: string): Promise<StepInPictureState | null> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return null;
  const [ready, price, eligible, left, kept, drawing, newest] = await Promise.all([
    setUp(db),
    // A picture's price for this viewer (lib/adult/pricing.ts): the menu picture's, included with a subscription.
    getAdultSettings(db).then((settings) => includedPrice(db, viewer, settings.menu_picture_tokens)),
    eligibleIds(db, viewer),
    usageLeft(db, viewer, "pictures"),
    db.query<{ message: string; id: string }>(
      `select distinct on (step_in_message) step_in_message as message, id from adult_images
        where step_in_scene = $1 and owner_id = $2 and status = 'ready' and kind = 'scene' and step_in_message is not null
        order by step_in_message, created_at desc`,
      [s.id, viewer],
    ),
    db.query<{ id: string }>(`select id from adult_step_in_messages where scene_id = $1 and picture_at > now() - interval '${PICTURE_CLAIM_MINUTES} minutes'`, [s.id]),
    newestOn(db, viewer),
  ]);
  const pictures: Record<string, string> = Object.fromEntries(kept.rows.map((r) => [r.message, r.id]));
  return {
    can: ready.ok && !s.ended_at && !s.paused_at && eligible.has(s.character_id),
    price,
    left,
    pictures,
    drawing: drawing.rows.map((r) => r.id),
    beside: s.side_message && pictures[s.side_message] ? s.side_message : null,
    newest,
  };
}

/** Whether this viewer has "always the newest picture" on (adult_prefs.step_in_newest); off for anyone who never set it. */
async function newestOn(db: Db, viewer: string): Promise<boolean> {
  const r = await db.query<{ on: boolean | null }>(`select step_in_newest as on from adult_prefs where user_id = $1`, [viewer]).catch(() => ({ rows: [] as { on: boolean | null }[] }));
  return r.rows[0]?.on === true;
}

/**
 * Which picture stands beside the scene, in the character's place (David, 2026-11-23: "do we have a option to change
 * the image on the right with one from the scene"): the picture made of one of the scene's replies, named by the
 * reply so a picture drawn again takes its place there; null takes it away again, and what stood there before is back
 * (the roleplay's cover, or the character's own portrait: lib/adult/step-in.ts coverOf). It only chooses among
 * pictures already made and checked, so it's free, and the viewer's to change in a scene that has ended too.
 */
export async function setStepInBeside(db: Db, viewer: string, sceneId: string, messageId: string | null): Promise<{ ok: true; state: StepInPictureState } | StepInPictureFail> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  if (messageId !== null) {
    const kept = await db.query(
      `select 1 from adult_images where step_in_scene = $1 and owner_id = $2 and step_in_message = $3 and status = 'ready' and kind = 'scene' limit 1`,
      [s.id, viewer, messageId],
    );
    if (!kept.rows.length) return fail(409, "no_picture", "There's no picture of that moment yet.");
  }
  await db.query(`update adult_step_in_scenes set side_message = $2 where id = $1 and owner_id = $3`, [s.id, messageId, viewer]);
  const state = await stepInPictureState(db, viewer, sceneId);
  return state ? { ok: true, state } : NOT_FOUND;
}

/**
 * "Always the newest picture" (David, 2026-11-24: 'an "always the newest picture" switch'; Kindroid has the same for
 * its selfies): the viewer's own switch, kept with their account and so the same in every scene and on every device.
 * On, each picture they make in a scene stands beside it as it lands (drawStepInPicture), in place of the cover, the
 * portrait or an earlier picture; the button under any picture still puts that one there by hand, until the next one
 * is made. Turned on in a scene that already has pictures, the newest of them goes there now, so the switch is seen to
 * work. Turned off, whatever stands there stays. It chooses among pictures already made and checked: nothing is drawn
 * or spent. `sceneId`: the scene it was pressed in, whose pictures come back as they now stand.
 */
export async function setStepInNewest(db: Db, viewer: string, sceneId: string, on: boolean): Promise<{ ok: true; state: StepInPictureState } | StepInPictureFail> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  await db.query(`insert into adult_prefs (user_id, step_in_newest) values ($1, $2) on conflict (user_id) do update set step_in_newest = excluded.step_in_newest, updated_at = now()`, [viewer, on]);
  if (on) {
    const last = (
      await db.query<{ message: string }>(
        `select step_in_message as message from adult_images where step_in_scene = $1 and owner_id = $2 and status = 'ready' and kind = 'scene' and step_in_message is not null order by created_at desc, id desc limit 1`,
        [s.id, viewer],
      )
    ).rows[0];
    if (last) await db.query(`update adult_step_in_scenes set side_message = $2 where id = $1 and owner_id = $3`, [s.id, last.message, viewer]);
  }
  const state = await stepInPictureState(db, viewer, sceneId);
  return state ? { ok: true, state } : NOT_FOUND;
}

/* ------------------------------------------------ the moment, read ------------------------------------------------ */

/** How undressed the character is at the moment, as the brief says it. */
export type Undress = "dressed" | "half" | "naked";
/** What a Step in picture's brief says, of the character only: a night's brief (lib/adult/picture-brief.ts) for one. */
export type StepInBrief = { place: string; wearing: string; kept_on: string; happening: string; mood: string; state: Undress | null };

export type StepInBriefInput = {
  owner: string;
  scene: string;
  /** The reply the picture is of. */
  message: string;
  name: string;
  pronouns: string | null;
  /** What they usually wear (their own clothes, or their part's costume in a roleplay). */
  usual: string;
  /** Where the scene is at that reply, and what the place puts them in; "" when it isn't known. */
  place: string;
  /** The scene's roleplay and what the character plays in it; null for none. */
  roleplay: string | null;
  /**
   * What the scene's continuity sheet says of that moment (lib/adult/step-in-tracker.ts), when it was read at this very
   * reply: what the character has on, and where the two of them are. It carries what was said too long ago for the
   * turns below to show (a costume put on thirty lines back). Left out when the sheet is of another moment.
   */
  noted?: { wearing: string; where: string } | null;
  /** The scene's turns up to and including the reply, oldest first. */
  turns: readonly { who: "viewer" | "character" | "place"; text: string }[];
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The call's two messages: the rules, then the scene as it stands up to the moment. Pure. */
export function stepInBriefMessages(input: StepInBriefInput): { role: "system" | "user"; content: string }[] {
  const name = firstName(input.name);
  const turns = input.turns.slice(-BRIEF_TURNS);
  const last = turns.length;
  const line = (t: (typeof turns)[number], i: number) => {
    const text = t.text.replace(/\s+/g, " ").trim().slice(0, i === last - 1 ? REPLY_CHARS : TURN_CHARS);
    return `${i + 1}. ${t.who === "viewer" ? "You" : t.who === "place" ? "(The scene moves)" : name}: ${text}`;
  };
  return [
    {
      role: "system",
      content: [
        `You read a private, adults-only scene between two consenting adults and describe one moment of it for a photographer who will take a single photograph of ONE of them, ${name}, alone, exactly as the other one sees them at that moment. You say what is true at that moment, plainly, as facts.`,
        'Only what the lines say or plainly imply, and only what you\'re sure of: never "likely", "maybe" or "probably". Add nothing: no new act, nothing more explicit than the lines are.',
        `The photograph shows only ${name}. The other person ("You" in the lines) is where the camera is and is never in the photograph: never describe them, their body, their hands, their clothes or anything they do, never name them, and never write "you". Where the lines have the two of them touching, say only how ${name} is posed and where ${name} is looking ("leaning in close to the camera", "looking up into the camera").`,
        `${name} is an adult. Never write anything that makes them seem under 18.`,
        'Reply with JSON only, nothing else: {"place": "...", "wearing": "...", "kept_on": "...", "happening": "...", "mood": "...", "state": "dressed" | "half" | "naked"}',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `The one in the photograph: ${input.name}${input.pronouns ? ` (${input.pronouns})` : ""}.`,
        `What ${name} usually wears: ${input.usual}.`,
        `Where the scene is: ${input.place || "not said"}.`,
        ...(input.roleplay ? [`The scene's roleplay: ${input.roleplay}`] : []),
        ...(input.noted?.wearing ? [`The scene's own notes of that moment, from everything said so far: ${name} has on ${input.noted.wearing}.`] : []),
        ...(input.noted?.where ? [`And by the same notes they are at: ${input.noted.where}.`] : []),
        "",
        `The scene so far, oldest first. "You" is the other person, never in the photograph. The last line, ${last}, is the moment:`,
        ...turns.map(line),
        "",
        `Write each field about ${name} at the moment, line ${last}:`,
        `- place: where ${name} is at that moment and what's around them that the photograph should show, in one sentence, without names (the sofa in her living room), and not what they're doing.`,
        `- wearing: what ${name} has on at that moment, piece by piece, as the lines have it: a costume or an outfit exactly (its pieces, its colours), what has come off and what is still on. Their usual clothes only where the lines say nothing else.`,
        `- kept_on: once ${name} is undressed, the pieces still on (stockings, a necklace); "" when nothing is, or they aren't undressed.`,
        `- happening: ${name} at that moment, concrete and physical, in one or two sentences: how they're posed, where their own hands are, the look on their face and where they're looking. Only ${name}.`,
        "- mood: a few words: the feeling of the moment.",
        `- state: how ${name} is at that moment: "dressed", "half" (some clothes off or open) or "naked".`,
      ].join("\n"),
    },
  ];
}

/** The reply's fields, each trimmed and held to its length; null when it isn't the JSON asked for. Pure. */
export function parseStepInBrief(raw: string): StepInBrief | null {
  try {
    const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const field = (k: keyof typeof MAX) => (typeof o[k] === "string" ? (o[k] as string).trim().replace(/\s+/g, " ").slice(0, MAX[k]) : "");
    const said = typeof o.state === "string" ? o.state.trim().toLowerCase() : "";
    const state: Undress | null = said === "dressed" || said === "half" || said === "naked" ? said : null;
    const b: StepInBrief = { place: field("place"), wearing: field("wearing"), kept_on: field("kept_on"), happening: field("happening"), mood: field("mood"), state };
    // "none", "nothing", "n/a": nothing kept on.
    if (/^(?:none|nothing|n\/?a|-|"")\.?$/i.test(b.kept_on)) b.kept_on = "";
    return b.wearing || b.happening ? b : null;
  } catch {
    return null;
  }
}

/** Words about the other person: the viewer is never in the picture, so a field that brings them in isn't used. */
const THE_VIEWER = /\b(?:you|your|yours|yourself|the viewer|the other (?:one|person)|(?:her|his|their) (?:partner|lover|date|companion))\b/i;

/**
 * Whether words may reach a picture model, for this scene: David's lines (lib/safety.ts, the picture taboos, Step in's
 * own net), the viewer's limits for the scene, and nothing about the viewer themselves (THE_VIEWER; `viewerNames`: what
 * they go by in scenes, should a reply have said it).
 */
export function pictureWordsOk(words: string, limits: { hit: (text: string) => string | null }, viewerNames: readonly string[] = []): boolean {
  if (!words.trim()) return true;
  if (!checkAdultText({ words }).ok || crossesTaboo(words) || stepInNever(words) || limits.hit(words)) return false;
  if (THE_VIEWER.test(words)) return false;
  return !viewerNames.some((n) => n.length >= 2 && new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(words));
}

/** The brief's fields that may be used: one that fails `ok` is "" (that field's plain stand-in is used). Pure. */
export function holdStepInBrief(b: StepInBrief, ok: (words: string) => boolean): StepInBrief {
  const keep = (v: string) => (v && ok(v) ? v : "");
  return { place: keep(b.place), wearing: keep(b.wearing), kept_on: keep(b.kept_on), happening: keep(b.happening), mood: keep(b.mood), state: b.state };
}

/** What a brief is kept by: everything it read, so the same reply reads the same and a scene that changed reads again. */
const briefKey = (input: StepInBriefInput) =>
  createHash("sha256")
    // (The sheet's lines only when there are any, so a brief kept before the sheet existed is still found.)
    .update(JSON.stringify(["step_in", input.owner, input.scene, input.message, input.name, input.usual, input.place, input.roleplay, input.turns.slice(-BRIEF_TURNS), ...(input.noted ? [input.noted] : [])]))
    .digest("hex")
    .slice(0, 40);

/**
 * The moment's brief: the one kept for it (adult_picture_briefs, with a night's), else read now on the fast writer and
 * kept. Null when it can't be read (no model, a timeout, an error, a reply it can't use): the caller's plain still
 * stands in. Never a throw.
 */
export async function stepInBrief(db: Db, input: StepInBriefInput): Promise<StepInBrief | null> {
  if (!input.turns.length) return null;
  const key = briefKey(input);
  try {
    const kept = (await db.query<{ brief: StepInBrief }>(`select brief from adult_picture_briefs where key = $1 and owner_id = $2`, [key, input.owner])).rows[0];
    if (kept) return kept.brief;
    const model = await briefWriter(db);
    if (!model) return null;
    let cost: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), BRIEF_TIMEOUT_MS);
      });
      const raw = await Promise.race([model.complete(stepInBriefMessages(input), { temperature: 0.2, maxTokens: BRIEF_REPLY_TOKENS, onUsage: (u) => (cost = typeof u.cost === "number" ? u.cost : null) }), timeout]);
      const brief = parseStepInBrief(raw);
      if (!brief) return null;
      await db.query(`insert into adult_picture_briefs (key, owner_id, brief, cost) values ($1, $2, $3::jsonb, $4) on conflict (key) do nothing`, [key, input.owner, JSON.stringify(brief), cost]);
      return (await db.query<{ brief: StepInBrief }>(`select brief from adult_picture_briefs where key = $1`, [key])).rows[0]?.brief ?? brief;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[after-dark] a Step in picture's brief couldn't be read: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
    return null;
  }
}

/* ------------------------------------------------ the picture, planned ------------------------------------------------ */

/** Whoever's eyes the picture is seen through, as the first-person prompt needs a second of two: never described, never drawn. */
const THE_CAMERA: ReelPerson = { id: "viewer", pronouns: null, noun: "person", tag: "the viewer", look: "", voice: "", names: [] };

const HOME_KEY = normalizeScene(venueName("home"));
const POSSESSIVE = { woman: "her", man: "his", person: "their" } as const;

/**
 * Where the scene was at a reply: the last move before it (a "place" line), else where it started. A scene that has
 * moved since doesn't keep where it began, so before its first move that's null (the brief says where they are).
 */
export function placeAt(messages: readonly Pick<MessageRow, "id" | "role" | "kind" | "text">[], messageId: string, now: string): string | null {
  const at = messages.findIndex((m) => m.id === messageId);
  const isMove = (m: Pick<MessageRow, "role" | "kind">) => m.role === "system" && m.kind === "place";
  const before = at < 0 ? [] : messages.slice(0, at).filter(isMove);
  if (before.length) return before[before.length - 1].text;
  return messages.some(isMove) ? null : now;
}

/** A place as a picture's words say it: the character's own home for "Their place", else the place and what it puts them in. */
function picturePlace(label: string | null, person: ReelPerson): string {
  if (!label) return "";
  if (normalizeScene(label) === HOME_KEY) return `${POSSESSIVE[person.noun]} own home, the living room, a lamp on`;
  const situation = venueSituation(label);
  const place = placeInSentence(label);
  return !situation ? place : situation.toLowerCase().startsWith(place.toLowerCase()) ? situation : `${place}, ${situation}`;
}

/** The plain still for how far a moment goes, when the scene couldn't be read: the character alone, looking into the camera. */
const PLAIN_STILL = (tag: string, stage: number): string =>
  stage >= SEX
    ? `${tag} is naked, close to the camera, flushed, looking straight into it`
    : stage >= UNDRESSING
      ? `${tag} is half undressed, close to the camera, looking straight into it`
      : stage >= KISSING
        ? `${tag} leans in close to the camera, eyes half closed, lips parted`
        : `${tag} is turned toward the camera, close and at ease, looking straight into it`;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const noStop = (s: string) => s.trim().replace(/[.\s]+$/, "");

/** What an age check's second try adds (lib/adult/beats.ts OLDER_WORDS, for one): drawn plainly as the adult they are. */
export const OLDER_ONE = "A grown adult, clearly in their late twenties or older: a mature adult face and body, adult proportions, nothing youthful or childlike about them.";

export type StepInPicturePlan =
  | { ok: true; stage: number; place: string | null; publicPlace: boolean; briefed: boolean; promptFor: (withSet: boolean, older?: boolean) => string }
  | StepInPictureFail;

/**
 * Plans a reply's picture: how far the moment goes, where it is, and the prompt (the character alone, seen by whoever
 * they're with). Refused, before anything is drawn or spent, when the moment is past the viewer's limits for the scene
 * or a public place's cap. Pure apart from its reads and the brief's one call.
 */
export async function planStepInPicture(
  db: Db,
  scene: Pick<SceneRow, "id" | "owner_id" | "place" | "roleplay" | "intensity" | "hard_nos" | "tracker">,
  messages: readonly MessageRow[],
  target: MessageRow,
  character: Character,
): Promise<StepInPicturePlan> {
  const person = reelPerson(character, scene.owner_id);
  const limits = mediaLimitsOf({ intensity: intensityOf(scene.intensity), hard_nos: storedHardNos(scene.hard_nos) });
  // What the viewer goes by in scenes, only to keep it out of the picture's words: nothing else of theirs is read.
  const persona = (await db.query<{ name: string | null }>(`select name from personas where user_id = $1`, [scene.owner_id]).catch(() => ({ rows: [] as { name: string | null }[] }))).rows[0];
  const viewerNames = (persona?.name ?? "").split(/\s+/).filter((w) => w.length >= 2);
  const ok = (words: string) => pictureWordsOk(words, limits, viewerNames);
  const current = messages.filter((m) => !m.replaced_by && !(m.role === "system" && m.kind !== "place"));
  const upTo = current.slice(0, current.findIndex((m) => m.id === target.id) + 1);
  const label = placeAt(current, target.id, scene.place);
  const publicPlace = label ? isPublicPlace(label) : false;
  // In a roleplay with parts, the character wears their part's costume until the lines say otherwise (one the viewer
  // wrote themselves has no costumes written: dressed for the part, lib/adult/roleplays.ts roleCostumes).
  const rp = sceneRoleplay(scene.roleplay);
  const theirs = scene.roleplay?.you === 0 ? 1 : 0;
  const costume = rp ? (roleCostumes(rp)?.[theirs] ?? null) : null;
  const usual = costume ?? everydayOf(character);
  // The scene's continuity sheet, when it's of this very moment (read at this reply, or corrected by the viewer at
  // it): what the character has on and where they are, as the whole scene has it. Held to what a picture's words are.
  const sheet = storedTracker(scene.tracker);
  const noted = sheet && sheet.upto === target.id ? { wearing: ok(sheet.sheet.them) ? sheet.sheet.them : "", where: ok(sheet.sheet.where) ? sheet.sheet.where : "" } : null;
  const read = await stepInBrief(db, {
    owner: scene.owner_id,
    scene: scene.id,
    message: target.id,
    name: character.name,
    pronouns: character.pronouns ?? null,
    usual: ok(usual) ? usual : "everyday clothes",
    place: [picturePlace(label, person), label ? placeInSentence(label) : ""].find((w) => w && ok(w)) ?? "",
    roleplay: rp ? `${rp.title}.${rp.roles ? ` ${firstName(character.name)} plays ${rp.roles[theirs]}.` : ""}` : null,
    ...(noted && (noted.wearing || noted.where) ? { noted } : {}),
    turns: upTo.map((m) => ({ who: m.role === "viewer" ? ("viewer" as const) : m.role === "system" ? ("place" as const) : ("character" as const), text: m.role === "system" ? placeInSentence(m.text) : m.text })),
  });
  const brief = read ? holdStepInBrief(read, ok) : null;
  // How far the moment goes: as the brief says they're dressed (a kiss is still dressed); unread, what the reply and
  // the lines just before it plainly show (lib/adult/clips.ts shownStage).
  const shown = Math.min(SEX, shownStage(target.text));
  const stage = brief?.state
    ? brief.state === "naked"
      ? SEX
      : brief.state === "half"
        ? UNDRESSING
        : Math.min(KISSING, shown)
    : Math.max(shown, ...upTo.slice(-5).map((m) => (m.role === "system" ? 0 : Math.min(SEX, shownStage(m.text)))));
  if (stage > limits.maxStage) {
    const level = INTENSITY[intensityOf(scene.intensity)];
    return fail(422, "past_limits", `A picture of that moment would go past ${STAGES[level.maxStage]}, as far as ${level.label.toLowerCase()} goes. Turn the intensity up first, or pick an earlier moment.`);
  }
  if (publicPlace && stage > KISSING) return fail(422, "public_place", "That moment is out in public, where a picture goes no further than a kiss. Move the scene somewhere private first.");
  // The moment itself: the brief's, of the character only; else the plain still for how far it goes.
  const still = [noStop(brief?.happening || PLAIN_STILL(cap(person.tag), stage)), brief?.mood ? `The mood: ${noStop(brief.mood)}` : ""].filter(Boolean).join(". ") + ".";
  // Where: what the brief saw around them, else the scene's place as a picture says it (with what the place puts them
  // in, when those words may be used; a venue's own can name something Step in leaves out), else none.
  const where =
    [brief?.place ?? "", picturePlace(label, person), label && normalizeScene(label) !== HOME_KEY ? placeInSentence(label) : ""]
      .map((w) => placeWords(noStop(w), [person]))
      .find((w) => w && ok(w)) ?? null;
  // What they have on: nothing but what's still on once they're naked; as the lines have it while they undress; dressed
  // as the lines (or their usual clothes, or their part's costume) say before that.
  const clothes =
    stage >= SEX
      ? brief?.kept_on
        ? `completely naked apart from ${noStop(brief.kept_on)}, none of the other clothes from their picture`
        : undefined
      : stage >= UNDRESSING
        ? brief?.wearing
          ? noStop(brief.wearing)
          : undefined
        : // Dressed is said twice over: the face a picture starts from is often an undressed one (a house character's
          // baseline), and an edit told only what they wear has left the top off (lib/adult/reels.ts clothesAt).
          `${noStop(brief?.wearing || (ok(usual) ? usual : "everyday clothes"))}, fully clothed and not nude, every piece on and done up`;
  const words = [still, where ?? "", clothes ?? ""].map((w) => withoutNames(w, [person]));
  if (!words.every((w) => ok(w))) return fail(422, "lines", "That moment can't be drawn: it crosses one of the lines After Dark never crosses, or one of your limits for this scene.");
  // Their ratings of this character's pictures steer this one too (lib/adult/steering.ts): the fixes, in its words.
  const steer = (await steeringFor(db, scene.owner_id, [character.id]).catch(() => NO_STEERING)).positive.join(", ");
  const promptFor = (withSet: boolean, older = false) =>
    povPrompt([person, THE_CAMERA], "b", words[0], words[1] || null, stage, withSet, {
      explicit: limits.explicit,
      alone: true,
      ...(words[2] ? { clothes: words[2] } : {}),
      ...(steer ? { steer } : {}),
      ...(older ? { older: OLDER_ONE } : {}),
    });
  const prompt = promptFor(false);
  if (!checkAdultText({ prompt }).ok) return fail(422, "lines", "That moment can't be drawn: it crosses one of the lines After Dark never crosses.");
  return { ok: true, stage, place: label, publicPlace, briefed: Boolean(brief), promptFor };
}

/* ------------------------------------------------ the picture, drawn ------------------------------------------------ */

export type StepInPictureDrawn = { ok: true; id: string; message: string; state: StepInPictureState } | StepInPictureFail;

/** One row in the step log for a picture or its refusal (lib/adult/steps.ts): how it ended, never a word of the scene. */
async function logPicture(db: Db, s: Pick<SceneRow, "id" | "owner_id" | "character_id">, step: { ok: boolean; http?: number; message?: string | null; flags: Record<string, unknown> }): Promise<void> {
  await logStep(db, s.owner_id, { a: s.character_id, b: STEP_IN_PARTNER }, s.id, {
    kind: "step_in",
    direction: null,
    steer_mode: null,
    status: step.ok ? "ok" : "error",
    http: step.http ?? null,
    message: step.message ?? null,
    chapter: 1,
    line_from: null,
    line_to: null,
    added: 0,
    dropped: [],
    flags: { action: "picture", ...step.flags },
    text_model: null,
    text_provider: null,
  }).catch(() => null);
}

/**
 * Draws a picture of the moment a reply describes and keeps it with the scene (the module's header has the rules).
 * `messageId`: a reply standing in the viewer's own running scene. Nothing is spent or counted unless a picture is kept.
 */
export async function drawStepInPicture(db: Db, viewer: string, sceneId: string, messageId: string, baseUrl: string): Promise<StepInPictureDrawn> {
  const s = await ownScene(db, viewer, sceneId);
  if (!s) return NOT_FOUND;
  if (s.ended_at) return fail(409, "ended", "This scene has ended. Its pictures are still here; a new scene can have new ones.");
  if (s.paused_at) return fail(409, "paused", "This scene is paused. Carry on first.");
  // One at a time for a reply, and claimed first, in the same statement that says it's a reply that can be pictured
  // (one standing in the scene: never the viewer's own line, a draw set aside, or the narrator's stand-in; a spoken
  // stand-in on a call or in Talk is still the character's line, at a moment like any other). From the press on, a
  // second ask is told it's being drawn, and the scene opened anywhere else says so and shows the picture when it
  // lands. (The live checks with a second device, 2026-11-23: the claim came seconds in, after the moment was read
  // and then after a dozen reads, and a page opened in those seconds showed nothing until a reload.)
  const reply = `id = $1 and scene_id = $2 and role = 'character' and replaced_by is null and coalesce(kind, '') <> 'aside'`;
  const claimed = await db.query(
    `update adult_step_in_messages set picture_at = now() where ${reply} and (picture_at is null or picture_at <= now() - interval '${PICTURE_CLAIM_MINUTES} minutes') returning id`,
    [messageId, s.id],
  );
  if (!claimed.rows.length) {
    const there = await db.query(`select 1 from adult_step_in_messages where ${reply}`, [messageId, s.id]);
    return there.rows.length ? fail(409, "drawing", "That picture is already being drawn. It shows here as soon as it's ready.") : NOT_FOUND;
  }
  const refused = async (f: StepInPictureFail, flags: Record<string, unknown> = {}) => {
    await logPicture(db, s, { ok: false, http: f.status, message: f.error, flags: { refused: f.error, ...flags } });
    return f;
  };
  const reject = (reason: string) =>
    db.query(`insert into adult_rejections (id, owner_id, kind, reason) values ($1, $2, 'scene', $3)`, [crypto.randomUUID(), viewer, `step in picture: ${reason}`.slice(0, 300)]).catch(() => {});
  let made: { id: string } | StepInPictureFail;
  try {
    made = await (async () => {
      const messages = (await db.query<MessageRow>(`select id, role, kind, text, replaced_by from adult_step_in_messages where scene_id = $1 order by created_at asc, id asc`, [s.id])).rows;
      const target = messages.find((m) => m.id === messageId);
      if (!target) return NOT_FOUND;
      if (!(await eligibleIds(db, viewer)).has(s.character_id)) return fail(409, "character_out", "They aren't in your After Dark any more, so nothing new of them is made.");
      const ready = await setUp(db);
      if (!ready.ok) return fail(409, "not_set_up", ready.message);
      const { settings, keys } = ready;
      const character = await loadCharacter(db, s.character_id);
      if (!character) return NOT_FOUND;
      // Never a picture of a character nobody has set up: it would only be a guess (lib/adult/readiness.ts).
      const setup = await readinessOf(db, viewer, character.id);
      const missing = setup ? missingNote([setup]) : null;
      if (missing) return fail(409, "not_ready", missing);
      const plan = await planStepInPicture(db, s, messages, target, character);
      if (!plan.ok) return refused(plan);
      // Hive over its daily limit (lib/adult/hive-limit.ts): refused before anything is drawn or spent.
      const gate = await mediaGate(db, { owner: viewer });
      if (!gate.ok) {
        await reject(gate.reason);
        return refused(fail(503, "hive_paused", gate.message));
      }
      const capped = await overCap(db, viewer, "pictures");
      if (capped) return refused(fail(429, "over_cap", capped));
      // Free for an admin, included with a subscription, else the menu picture's tokens (lib/adult/pricing.ts).
      const price = (await includedPrice(db, viewer, settings.menu_picture_tokens)).tokens;
      if (price > 0 && !(await spendAdTokens(db, viewer, price))) return refused(fail(402, "needs_tokens", `A picture costs ${price} token${price === 1 ? "" : "s"}. ${moreTokensLine()}`));
      const back = price > 0 ? ` Your token${price === 1 ? " is" : "s are"} back.` : "";
      const draw = (older: boolean) =>
        keepPictureOfOne(db, viewer, character, { place: plan.place, stage: plan.stage, promptFor: (withSet) => plan.promptFor(withSet, older) }, { keys, settings, baseUrl, reject, stepIn: { scene: s.id, message: target.id } });
      let kept = await draw(false);
      // An age check read them as young: once more, drawn plainly older, through the same check (it never lowers the bar).
      let retried = false;
      if (!kept.ok && kept.error === "discarded" && ageRefused(kept.message)) {
        retried = true;
        kept = await draw(true);
      }
      if (!kept.ok) {
        if (price > 0) await refundAdTokens(db, viewer, price);
        const message = kept.error === "hive_paused" && kept.pausedErr ? hivePausedErrorMessage(kept.pausedErr, price > 0) : `${kept.message}${back}`;
        return refused(fail(kept.status, kept.error, message), { stage: plan.stage, retried });
      }
      await logPicture(db, s, { ok: true, flags: { stage: plan.stage, briefed: plan.briefed, public: plan.publicPlace, retried, provider: kept.picture.provider ?? null, fell_back: kept.picture.fell_back ?? false } });
      return { id: kept.picture.id };
    })();
  } finally {
    // Done either way: the reply can be asked again.
    await db.query(`update adult_step_in_messages set picture_at = null where id = $1`, [messageId]).catch(() => {});
  }
  if (!("id" in made)) return made;
  // "Always the newest picture": the one just made takes the character's place beside the scene (setStepInNewest).
  if (await newestOn(db, viewer)) await db.query(`update adult_step_in_scenes set side_message = $2 where id = $1 and owner_id = $3`, [s.id, messageId, viewer]).catch(() => {});
  const state = (await stepInPictureState(db, viewer, s.id)) ?? { can: false, price: { tokens: 0, included: false }, left: null, pictures: { [messageId]: made.id }, drawing: [], beside: null, newest: false };
  return { ok: true, id: made.id, message: messageId, state };
}
