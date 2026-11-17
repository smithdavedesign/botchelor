import { randomUUID } from "node:crypto";
import { shortName } from "./names";
import { narrate, type Beat } from "./narration";
import { styleFor } from "./writing-style";
import { isAdmin } from "./admins";
import { adultProviderRouting, OPENROUTER_BASE_URL } from "./adult/mode";
import { adultKeys } from "./adult/settings";
import { track } from "./analytics";
import { portraitPathSql } from "./assets";
import { loadCharacter, type Character } from "./character";
import { lessonsForPrompt } from "./character-lessons";
import { ClauseSplitter, spokenClause } from "./companion-live-shared";
import { AVOID_LINES, BUBBLE_MAX, companionMessages, MAX_BUBBLES, RECENT_TURNS, repeatsEarlier, replyBubbles, sceneReply, type PromptRoleplay, type PromptScene, type PromptTurn } from "./companion-prompt";
import { factsForPrompt, updateFacts, updateSummary } from "./companion-memory";
import { forgetUnusedVoices, voiceUrl } from "./companion-voice";
import {
  COMPANION_GUEST_THREADS,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionDateOpener,
  companionEligibleSql,
  companionNotice,
  companionOpen,
  aboutDateLabel,
  chatDateLinks,
  datePhotoEpisode,
  isScenePlace,
  isTextTag,
  tagEpisode,
  textLink,
  type CompanionCharacterRef,
  type CompanionMessageView,
  type CompanionReportReason,
  type CompanionRoleplayView,
  type CompanionThreadView,
  type ReplyLength,
} from "./companion-shared";
import { CRISIS_RESOURCES, crisisIntent, type CrisisResources } from "./crisis";
import { resolveTerms, type TermsInput } from "./date-roleplays";
import type { Db } from "./db";
import { activeNudge } from "./between-dates";
import { nextTimeFor, openOffers, type StoredOffers } from "./companion-offers";
import { castOpenerLines, castOpenerTag } from "./cast-opener";
import { threadDates } from "./chat-date-links";
import { openQuestion, type StoredQuestion } from "./character-question-fields";
import { textPhoto, type TextPhoto } from "./date-photo";
import { lastAiredDateOf, lastDateOf } from "./last-date";
import { lockedPictureEpisode, lockedPictureTextsOn } from "./locked-picture";
import { lockedPictureForPrompt } from "./locked-picture-texts";
import { fallbackModel, getModel, openAICompatibleModel, type Model, type Usage } from "./model";
import { houseForPrompt } from "./house-texts";
import { notify } from "./notifications";
import { loadOurIds } from "./our-traffic";
import { recordServerError } from "./errors";
import { premiseForYou, rolesOf, type RoleplayTerms } from "./roleplays";
import { DELETED_OWNER } from "./rules";
import { checkFamilyTalk } from "./safety";
import { showCastIds } from "./season-cast";
import { companionStory } from "./story-state";
import { countCrisis, lineInCrisis, PG_REDIRECT } from "./step-in";
import { venue, venueName, type VenueId } from "./venues";

export * from "./companion-shared";

/**
 * Companions (docs/companions.md): a person talks one to one with a character, in a thread of their own that remembers
 * them. The house cast, the show's own agent-made cast (characters.companion_open) and the person's own characters, never
 * someone else's. PG like the show, the AI notice at the start and every three hours, the self-harm protocol on every
 * message, and nothing said here ever reaches a date, a text or anyone's memory of the show.
 */

/* ------------------------------------------------ the switch ------------------------------------------------ */

export async function companionAllowed(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!auth?.authenticated) return false;
  if (companionOpen(env)) return true;
  return isAdmin(db, auth.userId);
}

/** A person's messages an hour and a day, across every companion (P2's plan sets the paid limits; this is abuse only). */
export const COMPANION_LIMITS = { perHour: 150, perDay: 800 };
/** Conversations opened an hour and a day: each new one draws a free opener (lib/companion-plan.ts doesn't count it). */
export const COMPANION_OPEN_LIMITS = { perHour: 30, perDay: 100 };
/**
 * Guests (no account, lib/companion-shared.ts) from one address, an HMAC of the IP (lib/limits.ts visitorKey): their
 * replies, and the conversations they open. A new cookie costs nothing, so the address is what holds a script back.
 */
export const COMPANION_GUEST_IP_LIMITS = { perHour: 25, perDay: 60 };
export const COMPANION_GUEST_OPEN_IP_LIMITS = { perHour: 8, perDay: 20 };

/**
 * A guest opening a conversation with this character: whether it's a new one (`fresh`), and why they can't (`block`, the
 * message to show) or null when they can. Going back to one they already have is always fine; a new one needs replies
 * left and room under COMPANION_GUEST_THREADS.
 */
export async function guestOpening(db: Db, userId: string, characterId: string, left: number): Promise<{ fresh: boolean; block: string | null }> {
  const { rows } = await db.query<{ mine: boolean; n: number }>(
    `select coalesce(bool_or(character_id = $2), false) as mine, count(*)::int as n from companion_threads where user_id = $1`,
    [userId, characterId],
  );
  const r = rows[0] ?? { mine: false, n: 0 };
  if (r.mine) return { fresh: false, block: null };
  if (left <= 0) return { fresh: true, block: "That's the free replies without an account. A free account keeps the conversation going, with anyone." };
  if (r.n >= COMPANION_GUEST_THREADS) {
    return { fresh: true, block: `Without an account you can talk with ${COMPANION_GUEST_THREADS} characters. A free account opens everyone.` };
  }
  return { fresh: true, block: null };
}
/** A new session: back after this long, the AI notice goes in again. */
export const NOTICE_IDLE_MINUTES = 30;
/** And every this many hours of talking (New York GBL Art. 47 asks for at least every three). */
export const NOTICE_EVERY_HOURS = 3;

/* ------------------------------------------------ the model ------------------------------------------------ */

/** The companions' writer: DeepSeek on OpenRouter (about $0.001 a message), never the show's free quota. */
export const COMPANION_DEFAULT_MODEL = "deepseek/deepseek-chat-v3.1:nitro";

/**
 * OpenRouter with the saved key (After Dark's, on the reviewed hosts that don't keep prompts), falling back to the show's
 * model when it's down; the show's model alone where there's no key (a dev machine, the tests).
 */
export async function companionModel(db: Db, env: Record<string, string | undefined> = process.env): Promise<Model> {
  const { openrouter } = await adultKeys(db).catch(() => ({ openrouter: null }));
  if (!openrouter) return getModel();
  const primary = openAICompatibleModel({
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: openrouter,
    model: env.COMPANION_MODEL?.trim() || COMPANION_DEFAULT_MODEL,
    // With the show's model behind it (25 s, then its own fallback's 25 s), a reply answers inside Cloudflare's 100 s.
    timeoutMs: 30_000,
    retryDelaysMs: [1_500],
    extraBody: { usage: { include: true }, provider: adultProviderRouting(env) },
  });
  return fallbackModel(primary, getModel());
}

let modelForTests: Model | null = null;
/** Tests script the companion's model (lib/model.ts setModelForTests covers the fallback). */
export function setCompanionModelForTests(model: Model | null): void {
  modelForTests = model;
}
const modelFor = async (db: Db): Promise<Model> => modelForTests ?? companionModel(db);

/* ---------------------------------------------- who can be one ---------------------------------------------- */

/** Whether this person may talk with this character: a public house character, one of the show's open cast, or their own. */
export async function companionEligible(db: Db, userId: string, characterId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from characters c where c.id = $1 and ${companionEligibleSql("c", "$2", "$3")}`,
    [characterId, userId, DELETED_OWNER],
  );
  return rows.length > 0;
}

/**
 * Opens the show's own agent-made cast (lib/recast.ts: made over MCP by our own agents, lib/our-traffic.ts loadOurIds) as
 * companions. Never an outside agent's character: its maker never agreed to it. `dryRun` counts without opening.
 * Returns how many it opened (or would).
 */
export async function openOurAgentCast(db: Db, opts: { dryRun?: boolean } = {}): Promise<number> {
  const ours = await loadOurIds(db);
  const where = `created_via = 'mcp' and not is_house and owner_id = any($1::text[]) and owner_id <> $2 and visibility <> 'private' and not companion_open`;
  if (opts.dryRun) return (await db.query<{ n: number }>(`select count(*)::int as n from characters where ${where}`, [ours, DELETED_OWNER])).rows[0]?.n ?? 0;
  return (await db.query(`update characters set companion_open = true where ${where} returning id`, [ours, DELETED_OWNER])).rows.length;
}

/* ------------------------------------------------ the threads ------------------------------------------------ */

type ThreadRow = {
  id: string;
  user_id: string;
  character_id: string;
  last_at: string;
  notice_at: string | null;
  paused_at: string | null;
  reply_length: ReplyLength;
  /** True until the person turns this character's texts on ("Hear from" on a verdict card, or the thread's Settings). */
  muted_proactive: boolean;
  summary: string | null;
  scene: VenueId | null;
  /** The scene's roleplay (`first` is YOU or the character's id); null without one, and always null while texting. */
  roleplay: RoleplayTerms | null;
};

export type CompanionFail = { ok: false; status: number; error: string; message: string; crisis_resources?: CrisisResources };
const fail = (status: number, error: string, message: string): CompanionFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "Not found.");

async function ownThread(db: Db, userId: string, threadId: string): Promise<ThreadRow | null> {
  const { rows } = await db.query<ThreadRow>(
    `select id, user_id, character_id, last_at, notice_at, paused_at, reply_length, muted_proactive, summary, scene, roleplay from companion_threads where id = $1 and user_id = $2`,
    [threadId, userId],
  );
  return rows[0] ?? null;
}

async function addMessage(
  db: Db,
  threadId: string,
  role: "user" | "character" | "system",
  text: string,
  at: Date,
  extra: {
    model?: string | null;
    cost?: number | null;
    scene?: VenueId | null;
    action?: string | null;
    marker?: "scene" | "texting";
    roleplay?: string | null;
    onCall?: boolean;
    offers?: StoredOffers | StoredQuestion | null;
    /** A photo message (lib/date-photo.ts): where it's drawn; `text` is then its alt text. */
    photoUrl?: string | null;
    /** The date a written text is about (companion_messages.episode_id): only ever from its tag (writeText), never a reply's. */
    episodeId?: string | null;
    /** A narrated scene reply's prose (lib/narration.ts), kept beside the words so the voice never reads it. */
    beat?: Beat | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into companion_messages (id, thread_id, role, text, model, cost, created_at, scene, action, marker, roleplay, on_call, offers, via, media_url, episode_id, beat) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17::jsonb)`,
    [id, threadId, role, text, extra.model ?? null, extra.cost ?? null, at.toISOString(), extra.scene ?? null, extra.action ?? null, extra.marker ?? null, extra.roleplay ?? null, extra.onCall === true, extra.offers ? JSON.stringify(extra.offers) : null, extra.photoUrl ? "photo" : "text", extra.photoUrl ?? null, extra.episodeId ?? null, extra.beat ? JSON.stringify(extra.beat) : null],
  );
  return id;
}

/** Written lines, cleaned and kept only when every one passes the PG line and the crisis list (null otherwise). */
function writtenLines(raw: readonly string[]): string[] | null {
  const lines = raw
    .map((l) => clean(l).slice(0, BUBBLE_MAX))
    .filter(Boolean)
    .slice(0, MAX_BUBBLES);
  return lines.length && lines.every((l) => checkFamilyTalk(l).ok && !crisisIntent(l)) ? lines : null;
}

/**
 * Puts a written text (no model) in a thread as the character's: its bubbles, all with `tag`, the offers on the first,
 * and its photo (lib/date-photo.ts) as a message of its own right after the first bubble, the way a person sends one:
 * "back from the date with Nell", the picture, then the rest. A text about a date (its tag names one) is written with
 * that date's id on every row. Returns the bubbles' ids (the photo's isn't one).
 */
async function writeText(db: Db, threadId: string, now: Date, o: { lines: readonly string[]; tag: string; offers?: StoredOffers | StoredQuestion | null; photo?: TextPhoto | null }): Promise<string[]> {
  const ids: string[] = [];
  let n = 0;
  // The date the text is about, when its tag names one (lib/companion-shared.ts tagEpisode): the key every bubble carries.
  const episodeId = tagEpisode(o.tag);
  for (const [i, text] of o.lines.entries()) {
    ids.push(await addMessage(db, threadId, "character", text, tick(now, ++n), { action: o.tag, offers: i === 0 ? (o.offers ?? null) : null, episodeId }));
    if (i === 0 && o.photo) await addMessage(db, threadId, "character", clean(o.photo.alt).slice(0, BUBBLE_MAX), tick(now, ++n), { action: o.tag, photoUrl: o.photo.url, episodeId });
  }
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [threadId, tick(now, n + 1).toISOString()]);
  return ids;
}

/** Messages that follow one another in a reply are a millisecond apart, so they always sort in the order said. */
const tick = (d: Date, n: number) => new Date(d.getTime() + n);

/** The notice is due at a conversation's start, back after NOTICE_IDLE_MINUTES, and every NOTICE_EVERY_HOURS. */
export function noticeDue(t: Pick<ThreadRow, "notice_at" | "last_at">, now: Date): boolean {
  if (!t.notice_at) return true;
  if (now.getTime() - new Date(t.last_at).getTime() >= NOTICE_IDLE_MINUTES * 60_000) return true;
  return now.getTime() - new Date(t.notice_at).getTime() >= NOTICE_EVERY_HOURS * 3_600_000;
}

async function putNotice(db: Db, t: ThreadRow, name: string, now: Date): Promise<void> {
  await addMessage(db, t.id, "system", companionNotice(name), now);
  await db.query(`update companion_threads set notice_at = $2 where id = $1`, [t.id, now.toISOString()]);
  t.notice_at = now.toISOString();
}

const OPENER_CUE =
  "(They've just started talking with you for the first time. Open the conversation your way: say hi like yourself, and something only you would say. Don't ask more than one question.)";

/** The person's side of a scene's roleplay (RoleplayTerms.first when they play the first role). */
export const ROLEPLAY_YOU = "you";

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A scene's roleplay from the person's side, for the page: the premise with "you" in it, and who plays whom. */
export function roleplayView(rp: RoleplayTerms, characterName: string): CompanionRoleplayView {
  const { mine, theirs } = rolesOf(rp, ROLEPLAY_YOU);
  return { id: rp.id, title: rp.title, icon: rp.icon, premise: premiseForYou(rp.premise, rp.first === ROLEPLAY_YOU ? "a" : "b", characterName), you_play: mine, they_play: theirs };
}

/** The same from the character's side, for its prompt: its name in the premise, the person as "your scene partner". */
export function promptRoleplay(rp: RoleplayTerms, characterName: string): PromptRoleplay {
  const [person, own] = rp.first === ROLEPLAY_YOU ? ["{a}", "{b}"] : ["{b}", "{a}"];
  const premise = rp.premise
    .replaceAll(own, firstNameOf(characterName))
    .replaceAll(`${person}'s`, "your scene partner's")
    .replaceAll(person, "your scene partner")
    .replace(/(^|[.!?]\s+)your scene partner/g, (_m, lead: string) => `${lead}Your scene partner`);
  const { mine, theirs } = rolesOf(rp, ROLEPLAY_YOU);
  return { title: rp.title, premise, you_play: theirs, they_play: mine };
}

/** A scene's place for the prompt: its name and its stage direction (lib/venues.ts), and its roleplay if any. */
const promptScene = (t: Pick<ThreadRow, "scene" | "roleplay">, characterName: string): PromptScene | null =>
  t.scene ? { name: venueName(t.scene), prompt: venue(t.scene).prompt, roleplay: t.roleplay ? promptRoleplay(t.roleplay, characterName) : null } : null;

/** The user turn that has the character open a scene (in its roleplay, when there's one). */
const sceneCue = (place: VenueId, roleplay: RoleplayTerms | null = null) =>
  roleplay
    ? `(You've both just got to ${venue(place).prompt}, and the roleplay "${roleplay.title}" starts now. Open it in character: what you do and say as you get there, setting up the story and playing off the place. Don't ask more than one question.)`
    : `(You've both just got to ${venue(place).prompt}. Open the scene: what you do and say as you get there, playing off the place. Don't ask more than one question.)`;

/** The user turn that has the character text first once a scene is over (asked for over MCP; the chat waits for the person). */
const TEXTING_CUE = "(The scene's over and you're both back to texting. Pick the conversation up your way, in a line or two.)";

/**
 * Starts (or finds) this person's thread with a character. A new one opens with the AI notice and the character's
 * first message (left out if the model is down: the person can say hi first). `opener: false` (postFromCharacter):
 * the notice only, since the character's first words are about to be written without the model.
 */
export async function openThread(
  db: Db,
  userId: string,
  characterId: string,
  now: Date = new Date(),
  opts: { opener?: boolean } = {},
): Promise<{ ok: true; thread_id: string; resumed: boolean } | CompanionFail> {
  if (!(await companionEligible(db, userId, characterId))) return NOT_FOUND;
  const existing = (await db.query<{ id: string }>(`select id from companion_threads where user_id = $1 and character_id = $2`, [userId, characterId])).rows[0];
  if (existing) return { ok: true, thread_id: existing.id, resumed: true };
  const character = await loadCharacter(db, characterId);
  if (!character) return NOT_FOUND;
  const id = randomUUID();
  const created = await db.query<{ id: string }>(
    `insert into companion_threads (id, user_id, character_id, created_at, last_at) values ($1, $2, $3, $4, $4)
     on conflict (user_id, character_id) do nothing returning id`,
    [id, userId, characterId, now.toISOString()],
  );
  if (!created.rows.length) {
    const raced = (await db.query<{ id: string }>(`select id from companion_threads where user_id = $1 and character_id = $2`, [userId, characterId])).rows[0];
    return { ok: true, thread_id: raced!.id, resumed: true };
  }
  const t = (await ownThread(db, userId, id))!;
  await putNotice(db, t, character.name, now);
  if (opts.opener !== false) {
    // Someone else's cast character with an aired date opens with it, written (lib/cast-opener.ts); anyone else the old way.
    const told = character.ownerId !== userId && (await castOpener(db, t, character, now).catch(() => false));
    if (!told) await speak(db, t, character, tick(now, 1), { cue: OPENER_CUE }).catch(() => null);
  }
  return { ok: true, thread_id: id, resumed: false };
}

/**
 * The cast's opener (lib/cast-opener.ts): the character's last aired date in its own words, with the date's snapshot
 * (lib/date-photo.ts) and, under the last bubble, the link to watch it. False when there is nothing to tell (no aired
 * date, the switch is off, or a line failed the PG check), and then the model writes the hello as before.
 */
async function castOpener(db: Db, t: ThreadRow, character: Character, now: Date): Promise<boolean> {
  if (!companionDateOpener()) return false;
  const last = await lastAiredDateOf(db, character.id);
  if (!last) return false;
  const lines = writtenLines(castOpenerLines(character.name, last));
  if (!lines) return false;
  await writeText(db, t.id, now, { lines, tag: castOpenerTag(last.episodeId), photo: textPhoto({ id: last.episodeId, names: last.names, venue: last.venueId, at: last.at }) });
  track("companion_text", { kind: "opener", bubbles: lines.length });
  return true;
}

/** This person's thread with a character, if they have one. */
export async function threadIdFor(db: Db, userId: string, characterId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`select id from companion_threads where user_id = $1 and character_id = $2`, [userId, characterId]);
  return rows[0]?.id ?? null;
}

export type PostFromCharacterArgs = {
  userId: string;
  characterId: string;
  /** What the character says, in its own voice, already written (no model call): one to MAX_BUBBLES bubbles. */
  lines: readonly string[];
  now?: Date;
  /** What kind of text this is (`after_date`, …): analytics and the tag's prefix. */
  kind: string;
  /** The tag kept on the message (lib/companion-shared.ts TEXT_TAG, e.g. `after_date:<episode id>`): a thread gets it once. */
  dedupeKey: string;
  /**
   * The chips under the text (lib/companion-offers.ts), or a question's answer box (lib/character-question-fields.ts):
   * kept on its first bubble, shown while open.
   */
  offers?: StoredOffers | StoredQuestion | null;
  /** A photo from the date the text is about (lib/date-photo.ts textPhoto): one message of its own, after the first bubble. */
  photo?: TextPhoto | null;
};

/**
 * The one way a character texts its person first, safe to call from a job or a route (docs/companions.md, "Texts from
 * your own character"): the person must be able to talk with the character (companionEligible); the thread is found or
 * started without the model's opener; a paused thread (the crisis resources are up) is never written into; the AI
 * notice goes in first when due (New York GBL Art. 47 / SB 243 are evaluated here, not only on the person's input); the
 * lines are kept as the character's, each under the PG line and the crisis list, tagged with `dedupeKey`, and the
 * person is told (kind character_texted_you: inbox, push, an email at once). Free: nothing counts against the free
 * replies or a guest's, like the opener. Returns what was written, or null when nothing was: not eligible, paused, a
 * line failed, or the thread already has this tag.
 */
export async function postFromCharacter(db: Db, args: PostFromCharacterArgs): Promise<{ threadId: string; messageId: string } | null> {
  const now = args.now ?? new Date();
  if (!isTextTag(args.dedupeKey)) throw new Error(`postFromCharacter: dedupeKey must read <kind>:<ref>, got ${JSON.stringify(args.dedupeKey)}`);
  const lines = writtenLines(args.lines);
  if (!lines) return null;
  if (!(await companionEligible(db, args.userId, args.characterId))) return null;
  const character = await loadCharacter(db, args.characterId);
  if (!character) return null;
  const opened = await openThread(db, args.userId, args.characterId, now, { opener: false });
  if (!opened.ok) return null;
  const t = await ownThread(db, args.userId, opened.thread_id);
  if (!t || t.paused_at) return null;
  const dup = await db.query(`select 1 from companion_messages where thread_id = $1 and action = $2 limit 1`, [t.id, args.dedupeKey]);
  if (dup.rows.length) return null;
  if (noticeDue(t, now)) await putNotice(db, t, character.name, now);
  // Texting lines, whatever the thread is doing: a text arrives between scenes, never inside one. The offers ride the first.
  const ids = await writeText(db, t.id, now, { lines, tag: args.dedupeKey, offers: args.offers, photo: args.photo });
  await notify(db, args.userId, {
    kind: "character_texted_you",
    title: `💬 ${firstNameOf(character.name)} texted you`,
    body: lines[0],
    link: `/companion/${t.id}`,
  });
  track("companion_text", { kind: args.kind, bubbles: lines.length, photo: args.photo ? true : undefined });
  return { threadId: t.id, messageId: ids[0] };
}

/** The thread as its page shows it: the messages (a redrawn reply's earlier draw left out) and its settings. */
export async function getThread(db: Db, userId: string, threadId: string): Promise<{ ok: true; view: CompanionThreadView } | CompanionFail> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  const ref = await characterRef(db, t.character_id, userId);
  if (!ref) return NOT_FOUND;
  const [{ rows: msgs }, { rows: facts }, nextTime, realPhotos, dates] = await Promise.all([
    db.query<{ id: string; role: "user" | "character" | "system"; text: string; created_at: string; reported: string | null; scene: string | null; action: string | null; marker: CompanionMessageView["marker"]; roleplay: string | null; voice_key: string | null; on_call: boolean; offers: StoredOffers | null; via: string; media_url: string | null; episode_id: string | null; beat: Beat | null }>(
      `select id, role, text, created_at, reported, scene, action, marker, roleplay, voice_key, on_call, offers, via, media_url, episode_id, beat from companion_messages where thread_id = $1 and replaced_by is null order by created_at asc, id asc`,
      [threadId],
    ),
    db.query<{ n: number }>(`select count(*)::int as n from companion_facts where thread_id = $1`, [threadId]),
    // Their own character: who the "For next time" note is for, and the standing note (lib/companion-offers.ts).
    ref.yours ? nextTimeFor(db, ref.id).catch(() => null) : Promise.resolve(null),
    // Their own character's dates may have a real photo, made in the PG Studio (lib/studio/date-photos.ts): it stands
    // in for the composed snapshot. Owner-only, like the photos themselves.
    ref.yours ? realDatePhotos(db, threadId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    // The dates this thread's texts are about that this person may open, with the partner's name (lib/chat-date-links.ts):
    // beside the reads above, so the thread waits on nothing more. CHAT_DATE_LINKS=0: none.
    chatDateLinks() ? threadDates(db, { threadId, characterId: t.character_id, viewer: userId }).catch(() => new Map<string, { partner: string }>()) : Promise.resolve(new Map<string, { partner: string }>()),
  ]);
  // The link goes under the last bubble of a text whose tag says so: "Watch the date" (the cast's opener, the tease), or
  // the house scene a text is about (lib/companion-shared.ts textLink).
  const lastOfTag = new Map<string, string>();
  for (const m of msgs) if (m.role === "character" && m.via !== "photo" && textLink(m.action)) lastOfTag.set(m.action!, m.id);
  // "About your date with Nell" goes under the last bubble of a text about a date they may open (its episode_id), once
  // a text, and never beside a "Watch the date" link to the same date.
  const lastAbout = new Map<string, string>();
  for (const m of msgs) if (m.role === "character" && m.via !== "photo" && m.action && m.episode_id && dates.has(m.episode_id) && !textLink(m.action)) lastAbout.set(m.action, m.id);
  // The locked tile goes under the last bubble of a locked-picture text (lib/locked-picture.ts), while the switch is on.
  const lastLocked = new Map<string, string>();
  if (lockedPictureTextsOn()) for (const m of msgs) if (m.role === "character" && lockedPictureEpisode(m.action)) lastLocked.set(m.action!, m.id);
  // The chips: on the newest text whose menu is still open, and only while no newer date of theirs exists.
  const open = ref.yours ? await openOffers(db, ref.id, msgs).catch(() => null) : null;
  // The answer box: under the newest question the character asked about its own sheet, until it's answered.
  const asked = ref.yours ? openQuestion(msgs) : null;
  return {
    ok: true,
    view: {
      id: t.id,
      character: ref,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        at: new Date(m.created_at).toISOString(),
        reported: Boolean(m.reported),
        scene: isScenePlace(m.scene) ? m.scene : null,
        // A text's tag (postFromCharacter) is bookkeeping, not what they did.
        action: isTextTag(m.action) ? null : m.action,
        ...(m.beat && (m.beat.before || m.beat.after) ? { beat: m.beat } : {}),
        marker: m.marker,
        roleplay: m.roleplay,
        voice: m.voice_key ? voiceUrl(t.id, m.id) : null,
        ...(m.on_call ? { call: true } : {}),
        ...(open && open.messageId === m.id ? { offers: open.view } : {}),
        ...(asked && asked.messageId === m.id ? { question: asked.view } : {}),
        ...photoOf(m, realPhotos),
        ...(m.action && lastOfTag.get(m.action) === m.id ? { link: textLink(m.action)! } : {}),
        ...(m.action && m.episode_id && lastAbout.get(m.action) === m.id
          ? { about: { href: `/episodes/${m.episode_id}`, label: aboutDateLabel({ yours: ref.yours, character: ref.name, partner: dates.get(m.episode_id)!.partner }), episode: m.episode_id } }
          : {}),
        ...(m.action && lastLocked.get(m.action) === m.id ? { locked: { episode: lockedPictureEpisode(m.action)! } } : {}),
      })),
      reply_length: t.reply_length,
      texts: !t.muted_proactive,
      scene: isScenePlace(t.scene) ? t.scene : null,
      roleplay: t.scene && t.roleplay ? roleplayView(t.roleplay, ref.name) : null,
      paused: Boolean(t.paused_at),
      facts: facts[0]?.n ?? 0,
      ...(ref.yours ? { next_time: nextTime } : {}),
    },
  };
}

/**
 * A photo message as the page shows it: the composed snapshot (only ever the snapshot route's own path: anything else
 * stored there is not rendered), or the real date photo when its owner made one; a tap opens the date.
 */
function photoOf(m: { via: string; media_url: string | null }, real: ReadonlyMap<string, string>): Pick<CompanionMessageView, "photo"> {
  const episode = m.via === "photo" ? datePhotoEpisode(m.media_url) : null;
  if (!episode) return {};
  const asset = real.get(episode);
  return { photo: { src: asset ? `/api/assets/${asset}` : m.media_url!, href: `/episodes/${episode}` } };
}

/** The newest approved real photo of each date this thread has a photo message about: episode id -> asset id. */
async function realDatePhotos(db: Db, threadId: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ episode_id: string; asset_id: string }>(
    `select distinct on (d.episode_id) d.episode_id, d.asset_id
       from date_photos d
       join character_assets a on a.id = d.asset_id and a.review_status = 'approved' and a.content_rating = 'pg'
      where d.episode_id in (select substring(m.media_url from '[^/]+$') from companion_messages m where m.thread_id = $1 and m.via = 'photo')
      order by d.episode_id, d.created_at desc`,
    [threadId],
  );
  return new Map(rows.map((r) => [r.episode_id, r.asset_id]));
}

async function characterRef(db: Db, characterId: string, userId: string): Promise<CompanionCharacterRef | null> {
  const { rows } = await db.query<{ id: string; name: string; portrait: string | null; avatar_hue: number | null; is_house: boolean; owner_id: string | null; pronouns: CompanionCharacterRef["pronouns"] }>(
    `select c.id, c.name, ${portraitPathSql("c")} as portrait, c.avatar_hue, c.is_house, c.owner_id, c.pronouns from characters c where c.id = $1`,
    [characterId],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, portrait: r.portrait, hue: r.avatar_hue, house: r.is_house, yours: r.owner_id === userId, pronouns: r.pronouns ?? null } : null;
}

/** Where a companion comes from, for the companions page's filter: yours, the house cast, the show's agent-made cast, or another creator's opened one. */
export type CompanionSource = "yours" | "house" | "agent" | "community";

export type CompanionListItem = CompanionCharacterRef & {
  thread_id: string | null;
  last: string | null;
  last_at: string | null;
  bio: string;
  age: number | null;
  /** Their first few traits (the filter's search reads them, the card shows them). */
  traits: string[];
  source: CompanionSource;
  /** On this month's show cast (lib/season-cast.ts showCastIds). */
  on_show: boolean;
  created_at: string | null;
  /** How they're drawn, for the Style filter: anime when their looks say so (lib/looks.ts isAnime), else realistic. */
  style: CompanionStyle;
};

export type CompanionStyle = "realistic" | "anime";

/**
 * How many people the companions page may list besides your own threads: every one of them, with room (the page shows
 * COMPANIONS_PAGE at a time). It was 200 with 173 listed; the anime cast (2026-11-08) took it to ~197, and past the limit
 * the alphabetical order quietly dropped whoever came last.
 */
export const COMPANIONS_LISTED = 500;

/**
 * The companions page: your threads (most recent first), then who else you could talk with: yours, then the house
 * cast, then the rest. (Until 2026-11-07 the order was `(owner_id = $1) desc nulls last`, which sorts a house
 * character's NULL owner LAST, so behind 177 agent-made characters the 120 limit cut the house cast out entirely.)
 */
export async function listCompanions(
  db: Db,
  userId: string,
  now: Date = new Date(),
  /** `others: false`: only the threads (the Chat inbox, lib/chat-inbox.ts, lists no one new), so the directory isn't read. */
  opts: { others?: boolean } = {},
): Promise<{ threads: CompanionListItem[]; yours: CompanionListItem[]; cast: CompanionListItem[] }> {
  type Row = {
    id: string;
    name: string;
    bio: string;
    portrait: string | null;
    avatar_hue: number | null;
    is_house: boolean;
    owner_id: string | null;
    thread_id: string | null;
    last: string | null;
    last_at: string | null;
    age: number | null;
    pronouns: string | null;
    traits: unknown;
    created_via: string | null;
    created_at: Date | string | null;
    style: string | null;
  };
  const onShow = new Set(showCastIds(now));
  const pronounsOf = (p: string | null): CompanionCharacterRef["pronouns"] => (p === "she/her" || p === "he/him" || p === "they/them" ? p : null);
  const item = (r: Row): CompanionListItem => ({
    id: r.id,
    name: r.name,
    bio: r.bio,
    portrait: r.portrait,
    hue: r.avatar_hue,
    house: r.is_house,
    yours: r.owner_id === userId,
    pronouns: pronounsOf(r.pronouns),
    thread_id: r.thread_id,
    last: r.last,
    last_at: r.last_at ? new Date(r.last_at).toISOString() : null,
    age: r.age,
    traits: Array.isArray(r.traits) ? r.traits.filter((t): t is string => typeof t === "string").slice(0, 3) : [],
    source: r.owner_id === userId && userId ? "yours" : r.is_house ? "house" : r.created_via === "mcp" ? "agent" : "community",
    on_show: onShow.has(r.id),
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    style: r.style === "anime" ? "anime" : "realistic",
  });
  const cols = `c.id, c.name, c.bio, ${portraitPathSql("c")} as portrait, c.avatar_hue, c.is_house, c.owner_id, c.age, c.pronouns, c.traits, c.created_via, c.created_at, c.extras->'looks'->>'style' as style`;
  const [threads, others] = await Promise.all([
    db.query<Row>(
      `select ${cols}, t.id as thread_id, t.last_at,
              (select m.text from companion_messages m where m.thread_id = t.id and m.role <> 'system' and m.replaced_by is null order by m.created_at desc limit 1) as last
         from companion_threads t join characters c on c.id = t.character_id
        where t.user_id = $1 order by t.last_at desc limit 50`,
      [userId],
    ),
    opts.others === false
      ? { rows: [] as Row[] }
      : db.query<Row>(
      `select ${cols}, null as thread_id, null as last, null as last_at
         from characters c
        where c.owner_id is distinct from $2
          and ((c.is_house and c.premium_sku is null and c.visibility <> 'private') or (c.companion_open and c.visibility <> 'private') or c.owner_id = $1)
          and not exists (select 1 from companion_threads t where t.user_id = $1 and t.character_id = c.id)
        order by (c.owner_id is not distinct from $1) desc, c.is_house desc, c.name asc
        limit ${COMPANIONS_LISTED}`,
      [userId, DELETED_OWNER],
    ),
  ]);
  const rest = others.rows.map(item);
  return { threads: threads.rows.map(item), yours: rest.filter((r) => r.yours), cast: rest.filter((r) => !r.yours) };
}

/* ------------------------------------------------ the replies ------------------------------------------------ */

/** What the character says when it can't say what it drew (twice over the PG line): in-world, never a scolding. */
const DEFLECTIONS = [
  "Okay, I'm going to steer us somewhere else before I say something I can't take back. Tell me one good thing about today.",
  "Ha, no, we're keeping this one PG. What's actually on your mind?",
  "I just typed and deleted three things. Let's change the subject: what are you up to later?",
];
/** The same, out loud in a scene. */
const SCENE_DEFLECTIONS = [
  "Okay, I'm steering us somewhere else before I say something I can't take back. Tell me one good thing about today.",
  "Ha, no. We're keeping this one PG. So what's actually on your mind?",
  "I just started three sentences in my head and dropped all of them. New subject: what are you up to later?",
];

type SpeakResult = { ok: true; ids: string[]; texts: string[] } | CompanionFail;

/** A reply is drawn again (after a PG or crisis miss) only this soon: past it, the deflection, so the request ends in time. */
export const REDRAW_WITHIN_MS = 40_000;

/** The recent turns, oldest first (a redrawn reply's earlier draw left out, and the reply being drawn again). */
async function recentTurns(db: Db, threadId: string, exclude: readonly string[] = []): Promise<{ turns: PromptTurn[]; avoid: string[]; photos: string[] }> {
  const { rows: all } = await db.query<{ role: "user" | "character"; text: string; action: string | null; roleplay: string | null; via: string }>(
    `select role, text, action, roleplay, via from companion_messages
      where thread_id = $1 and role <> 'system' and replaced_by is null and not (id = any($3::text[]))
      order by created_at desc, id desc limit $2`,
    [threadId, RECENT_TURNS + AVOID_LINES, exclude],
  );
  // A photo is not something the character said: it stays out of the turns (so a reply never imitates its alt text),
  // and the prompt is told a photo was sent, so "nice picture" doesn't come as a surprise.
  const rows = all.filter((r) => r.via !== "photo");
  const photos = all.filter((r) => r.via === "photo").map((r) => r.text).slice(0, 2);
  const recent = rows
    .slice(0, RECENT_TURNS)
    .reverse()
    .map((r) => (isTextTag(r.action) ? { ...r, action: null } : r));
  const avoid = rows
    .slice(RECENT_TURNS)
    .filter((r) => r.role === "character")
    .map((r) => r.text);
  return { turns: recent, avoid, photos };
}

/** The character's own lines in this thread, newest first: what a new reply mustn't say again (repeatsEarlier). */
async function earlierLines(db: Db, threadId: string): Promise<string[]> {
  const { rows } = await db.query<{ text: string }>(
    `select text from companion_messages where thread_id = $1 and role = 'character' and via <> 'photo' order by created_at desc, id desc limit 150`,
    [threadId],
  );
  return rows.map((r) => r.text);
}

/**
 * The last date the character's prompt knows about (lib/companion-prompt.ts): for its owner, its last finished date,
 * private or not yet aired included (it's theirs); for anyone else, its last aired public date, the one its opener told
 * them about (lib/cast-opener.ts), and none with COMPANION_DATE_OPENER=0.
 */
const lastDateFor = (db: Db, characterId: string, yours: boolean) =>
  (yours ? lastDateOf(db, characterId) : companionDateOpener() ? lastAiredDateOf(db, characterId) : Promise.resolve(null)).catch(() => null);

/**
 * The character's reply to the thread as it stands: one model call, split into 1-3 messages, each checked against the
 * show's PG line and the crisis list. A reply that fails is drawn once more; a second failure is a deflection. Fails
 * (503) only when the model can't be reached, with nothing written.
 */
async function speak(
  db: Db,
  t: ThreadRow,
  character: Character,
  now: Date,
  opts: {
    cue?: string;
    insteadOf?: string | null;
    /** The reply being drawn again: not in the prompt's turns. */
    replacing?: readonly string[];
    /** On a voice call (never in a scene): a short spoken reply, kept as one message marked as said on the call. */
    call?: boolean;
  } = {},
): Promise<SpeakResult> {
  const { turns, avoid, photos } = await recentTurns(db, t.id, opts.replacing);
  const lastUser = [...turns].reverse().find((x) => x.role === "user")?.text ?? "";
  const facts = await factsForPrompt(db, t.id, lastUser, now);
  const model = await modelFor(db);
  const usage: Usage[] = [];
  let served = null as string | null;
  const started = Date.now();
  let insteadOf = opts.insteadOf ?? null;
  let bubbles: string[] | null = null;
  let action: string | null = null;
  const scene = promptScene(t, character.name);
  const call = opts.call === true && !scene;
  const said = await earlierLines(db, t.id);
  // Their own character (lib/companion-prompt.ts, the "yours" branch): talking with the person who made them, who may
  // hear how their last date really went (a private date included: it's this owner's).
  const yours = character.ownerId !== null && character.ownerId === t.user_id;
  const lastDate = await lastDateFor(db, character.id, yours);
  // The owner's standing note for the next date with that partner (a nudge): the character may acknowledge it here.
  const nudge = yours && lastDate ? await activeNudge(db, character.id, lastDate.partnerId).catch(() => null) : null;
  // What it has learned about itself lately (lib/character-lessons.ts): its maker's thread only.
  const lessons = yours ? await lessonsForPrompt(db, character.id) : null;
  // What it thinks of people, has heard and wants this week (lib/story-state.ts): its own, so a text can mention it.
  const story = await companionStory(db, character, yours, now).catch(() => []);
  // What the house said about it lately (lib/house-texts.ts): public, so it can talk about it when they ask.
  const house = await houseForPrompt(db, character, yours, now);
  // A locked-picture text it sent lately (lib/locked-picture-texts.ts): one line, so "what picture?" has a PG answer.
  const lockedPicture = await lockedPictureForPrompt(db, t.id, character.id, now);
  // A safe draw that only says something again: used when the redraw doesn't come back better (never a deflection).
  let safeRepeat: { bubbles: string[]; action: string | null } | null = null;
  const again = (x: string) => `${x.slice(0, 300)} (you've said this before: say something new)`;
  for (let attempt = 0; attempt < 2 && !bubbles; attempt++) {
    if (attempt > 0 && Date.now() - started > REDRAW_WITHIN_MS) break;
    let raw: string;
    try {
      raw = await model.complete(
        companionMessages({ character, turns, facts, summary: t.summary, length: t.reply_length, avoid, now, insteadOf, cue: opts.cue, scene, call, yours, lastDate, activeNudge: nudge, photos, lessons, story, house, lockedPicture }),
        {
          temperature: 0.9,
          frequencyPenalty: 0.3,
          maxTokens: call ? 250 : t.reply_length === "long" ? 700 : 400,
          onUsage: (u) => usage.push(u),
          onModel: (id) => (served = id),
        },
      );
    } catch {
      if (attempt === 0) return fail(503, "model_down", `${character.name.split(/\s+/)[0]} can't answer right now. Try again in a moment.`);
      break;
    }
    if (scene) {
      // A scene: one line, with what they do as they say it; both under the PG line and the crisis list.
      const line = sceneReply(raw, character.name);
      if (line && checkFamilyTalk(line.say).ok && checkFamilyTalk(line.action ?? "").ok && !crisisIntent(line.say) && !crisisIntent(line.action ?? "")) {
        if (repeatsEarlier(line.say, said)) {
          safeRepeat ??= { bubbles: [line.say], action: line.action };
          insteadOf = again(line.say);
          continue;
        }
        bubbles = [line.say];
        action = line.action;
      } else insteadOf = `${line ? `${line.action ? `(${line.action}) ` : ""}${line.say}` : raw}`.slice(0, 300) + " (keep it PG and kind)";
      continue;
    }
    // On a call it's said in one go: whatever came back as separate messages is one spoken reply.
    const split = replyBubbles(raw, character.name);
    const drawn = call && split.length > 1 ? [split.join(" ")] : split;
    if (drawn.length && drawn.every((b) => checkFamilyTalk(b).ok && !crisisIntent(b))) {
      // Not an earlier line, and not a bubble before it in this same reply (the sim saw one paragraph sent twice).
      const fresh = drawn.filter((b, i) => !repeatsEarlier(b, [...said, ...drawn.slice(0, i)]));
      if (fresh.length === drawn.length) bubbles = drawn;
      else {
        safeRepeat ??= { bubbles: fresh.length ? fresh : drawn, action: null };
        insteadOf = again(drawn.join(" "));
      }
    } else insteadOf = `${drawn.join(" ").slice(0, 300)} (keep it PG and kind)`;
  }
  if (!bubbles && safeRepeat) ({ bubbles, action } = safeRepeat);
  // The narrated style (lib/narration.ts): a scene reply wrapped in prose, the action folded into it, once it has passed
  // every check above. Their own style (lib/writing-style.ts, admins only while it's tested); never on a call or a text.
  let beat: Beat | null = null;
  if (scene && bubbles?.length && (await styleFor(db, t.user_id, "show")) === "narrated") {
    const first = shortName(character.name);
    const done = await narrate(
      model,
      {
        rating: "pg",
        people: [
          { name: first, about: character.persona.traits.slice(0, 3).join(", ") },
          { name: "You", about: 'the person they\'re with; the prose calls them "you"' },
        ],
        place: scene.name,
        lines: [{ who: first, dialogue: bubbles[0], action: action ?? "" }],
        before: turns.slice(-4).map((x) => ({ who: x.role === "user" ? "You" : first, dialogue: x.text, action: x.action ?? "" })),
      },
      { onUsage: (u) => usage.push(u) },
    ).catch(() => null);
    beat = done?.beats[0] ?? null;
  }
  const texts = bubbles ?? [scene ? SCENE_DEFLECTIONS[Math.floor(Math.random() * SCENE_DEFLECTIONS.length)] : DEFLECTIONS[Math.floor(Math.random() * DEFLECTIONS.length)]];
  const cost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const modelId = served ?? usage[0]?.model ?? null;
  const ids: string[] = [];
  for (const [i, text] of texts.entries()) {
    ids.push(
      await addMessage(db, t.id, "character", text, tick(now, i), {
        ...(i === 0 ? { model: modelId, cost: cost || null } : {}),
        scene: t.scene,
        action: bubbles ? action : null,
        ...(i === 0 && beat ? { beat } : {}),
        roleplay: t.roleplay?.title ?? null,
        onCall: call,
      }),
    );
  }
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, texts.length).toISOString()]);
  track("companion_reply", { model: modelId ?? undefined, cost: cost || undefined, ms: Date.now() - started, bubbles: texts.length, deflected: bubbles ? undefined : true, call: call || undefined });
  return { ok: true, ids, texts };
}

/** `replied: false`: done, but the reply it should have come with didn't (the model was down), so nothing is owed for it. */
export type CompanionSend = { ok: true; view: CompanionThreadView; replied?: false } | CompanionFail;

/**
 * Checks a person's words before they go in: the self-harm protocol first (it pauses the thread with the resources and
 * keeps nothing they said), then the show's PG line (a gentle redirect, nothing kept). Null when they may go in.
 */
async function screen(db: Db, t: ThreadRow, text: string, now: Date, surface: CompanionSurface): Promise<CompanionFail | null> {
  const { crisis } = await lineInCrisis(text, surface, await modelFor(db));
  if (crisis) return pauseForCrisis(db, t.id, surface, now);
  const safe = checkFamilyTalk(text);
  if (!safe.ok) return fail(422, "refused", PG_REDIRECT[safe.reason]);
  return null;
}

/** The self-harm protocol's pause: counted (day and surface only), the thread paused until the person carries on. */
async function pauseForCrisis(db: Db, threadId: string, surface: CompanionSurface, now: Date): Promise<CompanionFail> {
  await countCrisis(db, surface, now);
  await db.query(`update companion_threads set paused_at = $2 where id = $1`, [threadId, now.toISOString()]);
  return { ...fail(200, "paused", CRISIS_RESOURCES.message), crisis_resources: CRISIS_RESOURCES };
}

/**
 * The same check on a fact the person writes on the memory page (it goes in every prompt, so it gets what a message
 * gets): a crisis pauses the thread with the resources, and nothing is kept. Null when it may go on to editFacts.
 */
export async function screenFact(db: Db, userId: string, threadId: string, text: string, surface: CompanionSurface = "companion", now: Date = new Date()): Promise<CompanionFail | null> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  const { crisis } = await lineInCrisis(text, surface, await modelFor(db));
  return crisis ? pauseForCrisis(db, t.id, surface, now) : null;
}

async function loaded(db: Db, userId: string, threadId: string): Promise<{ t: ThreadRow; character: Character } | CompanionFail> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  if (!(await companionEligible(db, userId, t.character_id))) return NOT_FOUND;
  const character = await loadCharacter(db, t.character_id);
  if (!character) return NOT_FOUND;
  return { t, character };
}

const clean = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Where the person's words came from: the site, or an agent over MCP (each counted apart in crisis_referrals). */
export type CompanionSurface = "companion" | "mcp_companion";

/**
 * One message from the person, and the character's reply. `call`: said on a voice call in the app (the browser heard
 * it; the reply is short and spoken aloud). Both lines are marked as said on the call; in a scene it's an ordinary line.
 */
export async function sendMessage(
  db: Db,
  userId: string,
  threadId: string,
  input: string,
  now: Date = new Date(),
  surface: CompanionSurface = "companion",
  opts: { call?: boolean } = {},
): Promise<CompanionSend> {
  const took = await takeIn(db, userId, threadId, input, now, surface, { call: opts.call === true });
  if ("status" in took) return took;
  const r = await speak(db, took.t, took.character, tick(now, 2), { call: took.call });
  if (!r.ok) return r;
  return getThread(db, userId, threadId);
}

/**
 * A person's line, in: the thread loaded, not paused, the words cleaned and checked (screen: the self-harm protocol,
 * then the PG line), the AI notice when due, and the line kept (marked as said on a call, never in a scene). The front
 * half of every message, typed (sendMessage) or said on a live call (liveTurnIn).
 */
async function takeIn(
  db: Db,
  userId: string,
  threadId: string,
  input: string,
  now: Date,
  surface: CompanionSurface,
  opts: { call: boolean; noScene?: boolean },
): Promise<{ t: ThreadRow; character: Character; call: boolean } | CompanionFail> {
  const l = await loaded(db, userId, threadId);
  if ("status" in l) return l;
  const { t, character } = l;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  if (opts.noScene && t.scene) return fail(409, "scene", "Calls aren't for a scene. Go back to texting first.");
  const text = clean(input);
  if (!text) return fail(400, "empty", "Say something first.");
  if (text.length > COMPANION_MESSAGE_MAX) return fail(400, "too_long", `Keep it under ${COMPANION_MESSAGE_MAX} characters.`);
  const refused = await screen(db, t, text, now, surface);
  if (refused) return refused;
  if (noticeDue(t, now)) await putNotice(db, t, character.name, now);
  const call = opts.call && !t.scene;
  await addMessage(db, t.id, "user", text, tick(now, 1), { scene: t.scene, roleplay: t.roleplay?.title ?? null, onCall: call });
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, 1).toISOString()]);
  return { t, character, call };
}

/* ----------------------------------------------- live calls (P6) ----------------------------------------------- */

/** A live call's turn that's in: the person's line checked and kept, the reply still to come (liveReply). */
export type LiveTurn = { t: ThreadRow; character: Character; now: Date };

/**
 * A line said on a live call (docs/companions.md, P6), in: exactly a call's message (sendMessage with `call`): the same
 * checks, the notice, the line kept marked 📞. Refused in a scene. The reply is liveReply's.
 */
export async function liveTurnIn(db: Db, userId: string, threadId: string, input: string, now: Date = new Date()): Promise<{ ok: true; turn: LiveTurn } | CompanionFail> {
  const took = await takeIn(db, userId, threadId, input, now, "companion", { call: true, noScene: true });
  if ("status" in took) return took;
  return { ok: true, turn: { t: took.t, character: took.character, now } };
}

/** Where a live reply goes as it's written: each checked piece, in order; `signal` is a barge-in (stop now). */
export type LiveSink = { say: (text: string) => void; signal?: AbortSignal };

export type LiveReply = { ok: true; id: string | null; text: string; streamed: boolean; cut: boolean } | CompanionFail;

/**
 * The character's reply on a live call, said as it's written: the model streams (plain text, call length), the stream
 * is cut into pieces (ClauseSplitter), and each piece is checked against the PG line and the crisis list on its own and
 * with everything before it, and against their earlier lines, before it goes to `sink.say`. A piece that fails stops
 * the reply there (what was already said stands, every piece of it checked). When nothing sayable came first (the
 * model can't stream, is down, or its first piece failed), it's v1's reply instead: drawn whole, checked, drawn again
 * or deflected (speak), and said in one piece. Kept as one message marked 📞: what was said, up to a barge-in.
 */
export async function liveReply(db: Db, turn: LiveTurn, sink: LiveSink): Promise<LiveReply> {
  const { t, character } = turn;
  const now = tick(turn.now, 2);
  const model = await modelFor(db);
  const started = Date.now();
  const v1 = async (insteadOf: string | null): Promise<LiveReply> => {
    const r = await speak(db, t, character, now, { call: true, insteadOf });
    if (!r.ok) return r;
    const text = r.texts.join(" ");
    if (!sink.signal?.aborted) sink.say(text);
    return { ok: true, id: r.ids[0] ?? null, text, streamed: false, cut: false };
  };
  if (!model.stream) return v1(null);
  const { turns, avoid, photos } = await recentTurns(db, t.id);
  const lastUser = [...turns].reverse().find((x) => x.role === "user")?.text ?? "";
  const [facts, earlier] = await Promise.all([factsForPrompt(db, t.id, lastUser, now), earlierLines(db, t.id)]);
  const yours = character.ownerId !== null && character.ownerId === t.user_id;
  const lastDate = await lastDateFor(db, character.id, yours);
  const nudge = yours && lastDate ? await activeNudge(db, character.id, lastDate.partnerId).catch(() => null) : null;
  // What it has learned about itself lately (lib/character-lessons.ts): its maker's thread only.
  const lessons = yours ? await lessonsForPrompt(db, character.id) : null;
  // What it thinks of people, has heard and wants this week (lib/story-state.ts): its own, so a text can mention it.
  const story = await companionStory(db, character, yours, now).catch(() => []);
  // What the house said about it lately (lib/house-texts.ts): public, so it can talk about it when they ask.
  const house = await houseForPrompt(db, character, yours, now);
  const lockedPicture = await lockedPictureForPrompt(db, t.id, character.id, now);
  const usage: Usage[] = [];
  let served = null as string | null;
  const parts: string[] = [];
  let stopped: string | null = null;
  let firstMs: number | null = null;
  const stop = new AbortController();
  const signal = sink.signal ? AbortSignal.any([sink.signal, stop.signal]) : stop.signal;
  const splitter = new ClauseSplitter();
  /** One piece: said when it passes, else the reply stops here (false). */
  const take = (clause: string): boolean => {
    const c = spokenClause(clause, character.name, parts.length === 0);
    if (!c) return true;
    const whole = [...parts, c].join(" ");
    if (!checkFamilyTalk(c).ok || !checkFamilyTalk(whole).ok || crisisIntent(c) || crisisIntent(whole)) {
      stopped = `${whole.slice(0, 300)} (keep it PG and kind)`;
      return false;
    }
    if (repeatsEarlier(c, [...earlier, ...parts])) {
      stopped = `${whole.slice(0, 300)} (you've said this before: say something new)`;
      return false;
    }
    parts.push(c);
    firstMs ??= Date.now() - started;
    sink.say(c);
    return true;
  };
  try {
    const stream = model.stream(
      companionMessages({ character, turns, facts, summary: t.summary, length: t.reply_length, avoid, now, call: true, live: true, yours, lastDate, activeNudge: nudge, photos, lessons, story, house, lockedPicture }),
      { temperature: 0.9, frequencyPenalty: 0.3, maxTokens: 250, onUsage: (u) => usage.push(u), onModel: (id) => (served = id), signal },
    );
    reading: for await (const piece of stream) {
      if (signal.aborted) break;
      for (const clause of splitter.push(piece)) {
        if (!take(clause)) {
          stop.abort();
          break reading;
        }
      }
    }
    if (!stopped && !signal.aborted) for (const clause of splitter.flush()) if (!take(clause)) break;
  } catch {
    // The model failed before (or while) it said anything: v1's reply below when nothing was said.
  }
  const cut = sink.signal?.aborted === true;
  if (!parts.length) {
    // Talked over before a word of it: nothing to keep, and no reply owed.
    if (cut) return { ok: true, id: null, text: "", streamed: true, cut: true };
    return v1(stopped);
  }
  const text = parts.join(" ");
  const cost = usage.reduce((sum, u) => sum + (u.cost ?? 0), 0);
  const modelId = served ?? usage[0]?.model ?? null;
  const id = await addMessage(db, t.id, "character", text, now, { model: modelId, cost: cost || null, onCall: true });
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, 1).toISOString()]);
  track("companion_reply", {
    model: modelId ?? undefined,
    cost: cost || undefined,
    ms: Date.now() - started,
    first_ms: firstMs ?? undefined,
    bubbles: 1,
    call: true,
    live: true,
    cut: cut || undefined,
    stopped: stopped ? true : undefined,
  });
  return { ok: true, id, text, streamed: true, cut };
}

/**
 * Draws the character's last reply again (free): the reply after the person's last message is set aside and a new one
 * written, told not to say the same. With no reply yet (the model was down), it's simply the reply.
 */
export async function regenerate(db: Db, userId: string, threadId: string, now: Date = new Date()): Promise<CompanionSend> {
  const l = await loaded(db, userId, threadId);
  if ("status" in l) return l;
  const { t, character } = l;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  const last = await lastReply(db, t.id);
  const cue = last.afterUser ? undefined : last.marker ? (t.scene ? sceneCue(t.scene, t.roleplay) : TEXTING_CUE) : OPENER_CUE;
  const r = await speak(db, t, character, now, { insteadOf: last.texts.join(" ") || null, cue, replacing: last.ids });
  if (!r.ok) return r;
  if (last.ids.length) await db.query(`update companion_messages set replaced_by = $2 where id = any($1::text[])`, [last.ids, r.ids[0]]);
  return getThread(db, userId, threadId);
}

/**
 * The character's messages since the person last spoke (the reply a regenerate replaces), and whether the person has. A
 * scene starting or ending stops it too (marker): what came before belongs to the conversation before.
 */
async function lastReply(db: Db, threadId: string): Promise<{ ids: string[]; texts: string[]; afterUser: boolean; marker: boolean }> {
  const { rows } = await db.query<{ id: string; role: string; text: string }>(
    `select id, role, text from companion_messages where thread_id = $1 and (role <> 'system' or marker is not null) and replaced_by is null order by created_at desc, id desc limit 8`,
    [threadId],
  );
  const ids: string[] = [];
  const texts: string[] = [];
  let afterUser = false;
  let marker = false;
  for (const m of rows) {
    if (m.role === "user") {
      afterUser = true;
      break;
    }
    if (m.role === "system") {
      marker = true;
      break;
    }
    ids.push(m.id);
    texts.unshift(m.text);
  }
  return { ids, texts, afterUser, marker };
}

/** Rewrites the person's last message (only the last one) and has the character answer it again. */
export async function editLast(db: Db, userId: string, threadId: string, input: string, now: Date = new Date(), surface: CompanionSurface = "companion"): Promise<CompanionSend> {
  const l = await loaded(db, userId, threadId);
  if ("status" in l) return l;
  const { t, character } = l;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  const text = clean(input);
  if (!text) return fail(400, "empty", "Say something first.");
  if (text.length > COMPANION_MESSAGE_MAX) return fail(400, "too_long", `Keep it under ${COMPANION_MESSAGE_MAX} characters.`);
  const mine = (await db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and role = 'user' and replaced_by is null order by created_at desc, id desc limit 1`, [t.id])).rows[0];
  if (!mine) return fail(409, "nothing_to_edit", "You haven't said anything yet.");
  const after = await lastReply(db, t.id);
  if (after.marker) return fail(409, "nothing_to_edit", t.scene ? "Your last message was before this scene: say something new instead." : "Your last message was in the scene: say something new instead.");
  const refused = await screen(db, t, text, now, surface);
  if (refused) return refused;
  await db.query(`update companion_messages set text = $2 where id = $1`, [mine.id, text]);
  const r = await speak(db, t, character, now, { replacing: after.ids });
  if (!r.ok) return r;
  if (after.ids.length) await db.query(`update companion_messages set replaced_by = $2 where id = any($1::text[])`, [after.ids, r.ids[0]]);
  return getThread(db, userId, threadId);
}

/** Carry on after the crisis resources: the thread opens again. */
export async function carryOn(db: Db, userId: string, threadId: string): Promise<CompanionSend> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  await db.query(`update companion_threads set paused_at = null where id = $1`, [t.id]);
  return getThread(db, userId, threadId);
}

export async function setReplyLength(db: Db, userId: string, threadId: string, length: ReplyLength): Promise<CompanionSend> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  await db.query(`update companion_threads set reply_length = $2 where id = $1`, [t.id, length]);
  return getThread(db, userId, threadId);
}

/**
 * Whether this character may text first (docs/companions.md, "When the house talks about them"): the thread's own
 * switch, the same column "Hear from" sets on a verdict card. On: the event-driven texts (a date aired, the house
 * talked about them) may arrive in this thread; never on silence. Off: the character only ever answers.
 */
export async function setTexts(db: Db, userId: string, threadId: string, on: boolean): Promise<CompanionSend> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  await db.query(`update companion_threads set muted_proactive = $2 where id = $1`, [t.id, !on]);
  return getThread(db, userId, threadId);
}

/**
 * Starts a scene at one of the show's places (the character opens it: a reply, so it's counted like one), moves it
 * somewhere else, or goes back to texting (null). Each is a line in the thread. With the model down the scene still
 * starts, without its opener (replied: false); "Ask them to start" draws it.
 *
 * A scene can play a roleplay (`roleplay`: the show's by id, or written for it, and which role is the person's,
 * lib/date-roleplays.ts resolveTerms): a person with an AI character, so it's agreed as it's picked. The scene is the
 * place and the roleplay together: asking for the same place with another roleplay (or none) starts it again.
 */
export async function setScene(db: Db, userId: string, threadId: string, place: VenueId | null, now: Date = new Date(), roleplay: TermsInput | null = null): Promise<CompanionSend> {
  const l = await loaded(db, userId, threadId);
  if ("status" in l) return l;
  const { t, character } = l;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  if (place !== null && !isScenePlace(place)) return fail(400, "invalid_place", "Pick one of the show's places.");
  let terms: RoleplayTerms | null = null;
  if (roleplay) {
    if (place === null) return fail(400, "roleplay_needs_scene", "A roleplay is played in a scene: pick a place too.");
    const r = resolveTerms(roleplay, ROLEPLAY_YOU, character.id);
    if (!r.ok) return fail(r.status, r.error, r.message);
    terms = r.terms;
  }
  if (t.scene === place && sameTerms(place ? t.roleplay : null, terms)) {
    const same = await getThread(db, userId, threadId);
    return same.ok ? { ...same, replied: false } : same;
  }
  if (noticeDue(t, now)) await putNotice(db, t, character.name, now);
  await db.query(`update companion_threads set scene = $2, roleplay = $3, last_at = $4 where id = $1`, [t.id, place, terms ? JSON.stringify(terms) : null, tick(now, 1).toISOString()]);
  t.scene = place;
  t.roleplay = terms;
  const shown = terms ? roleplayView(terms, character.name) : null;
  const line = !place
    ? "Back to texting."
    : shown
      ? `${venueName(place)}: a scene you're both imagining. ${shown.icon} ${shown.title}: ${shown.premise}${shown.you_play ? ` You play ${shown.you_play}, ${firstNameOf(character.name)} ${shown.they_play}.` : ""}`
      : `${venueName(place)}: a scene you're both imagining.`;
  await addMessage(db, t.id, "system", line, tick(now, 1), { marker: place ? "scene" : "texting", scene: place, roleplay: terms?.title ?? null });
  track("companion_scene", { place: place ?? "texting", ...(terms ? { roleplay: terms.id } : {}) });
  if (!place) {
    const view = await getThread(db, userId, threadId);
    return view.ok ? { ...view, replied: false } : view;
  }
  const r = await speak(db, t, character, tick(now, 2), { cue: sceneCue(place, terms) });
  const view = await getThread(db, userId, threadId);
  return view.ok && !r.ok ? { ...view, replied: false } : view;
}

/** Two scenes' roleplays are the same one, with the same roles. */
function sameTerms(a: RoleplayTerms | null, b: RoleplayTerms | null): boolean {
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.title === b.title && a.premise === b.premise && a.first === b.first && JSON.stringify(a.roles) === JSON.stringify(b.roles);
}

/** A person's report on one of the character's replies (reviewed on the admin reports page). */
export async function reportMessage(db: Db, userId: string, threadId: string, messageId: string, reason: CompanionReportReason, now: Date = new Date()): Promise<CompanionSend> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  if (!(COMPANION_REPORT_REASONS as readonly string[]).includes(reason)) return fail(400, "invalid_request", "Pick a reason.");
  const { rows } = await db.query(
    `update companion_messages set reported = $3, reported_at = $4 where id = $2 and thread_id = $1 and role = 'character' returning id`,
    [t.id, messageId, reason, now.toISOString()],
  );
  if (!rows.length) return NOT_FOUND;
  track("companion_report", { reason });
  return getThread(db, userId, threadId);
}

/** Deletes a thread: every message, fact and the summary go with it. */
export async function deleteThread(db: Db, userId: string, threadId: string): Promise<{ ok: true } | CompanionFail> {
  const { rows } = await db.query(`delete from companion_threads where id = $1 and user_id = $2 returning id`, [threadId, userId]);
  if (!rows.length) return NOT_FOUND;
  // Its voice notes go too (unless the same words are another reply's).
  await forgetUnusedVoices(db);
  return { ok: true };
}

/**
 * After a reply (the route runs it in after(), past the response): new facts when FACTS_EVERY messages have come in,
 * and the rolling summary when it's due. Never throws.
 */
export async function companionFollowUp(db: Db, threadId: string): Promise<void> {
  try {
    const t = (await db.query<{ character_id: string }>(`select character_id from companion_threads where id = $1`, [threadId])).rows[0];
    if (!t) return;
    const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [t.character_id])).rows[0]?.name ?? "the character";
    const model = await modelFor(db);
    const facts = await updateFacts(db, threadId, name, model);
    const summary = await updateSummary(db, threadId, name, model);
    if (process.env.COMPANION_DEBUG === "1") console.error(`[companion] follow-up ${threadId}: ${facts} facts, summary ${summary}`);
  } catch (err) {
    // Memory is best-effort (the next message tries again), but a failure is recorded, never swallowed.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[companion] follow-up failed: ${message}`);
    await recordServerError("companion", "/api/companion/[id]", `follow-up: ${message}`, db);
  }
}
