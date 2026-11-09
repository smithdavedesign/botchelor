import { randomUUID } from "node:crypto";
import { isAdmin } from "./admins";
import { adultProviderRouting, OPENROUTER_BASE_URL } from "./adult/mode";
import { adultKeys } from "./adult/settings";
import { track } from "./analytics";
import { portraitPathSql } from "./assets";
import { loadCharacter, type Character } from "./character";
import { AVOID_LINES, companionMessages, RECENT_TURNS, repeatsEarlier, replyBubbles, sceneReply, type PromptRoleplay, type PromptScene, type PromptTurn } from "./companion-prompt";
import { factsForPrompt, updateFacts, updateSummary } from "./companion-memory";
import { forgetUnusedVoices, voiceUrl } from "./companion-voice";
import {
  COMPANION_GUEST_THREADS,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionNotice,
  companionOpen,
  isScenePlace,
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
import { fallbackModel, getModel, openAICompatibleModel, type Model, type Usage } from "./model";
import { loadOurIds } from "./our-traffic";
import { recordServerError } from "./errors";
import { premiseForYou, rolesOf, type RoleplayTerms } from "./roleplays";
import { DELETED_OWNER } from "./rules";
import { checkFamilyTalk } from "./safety";
import { showCastIds } from "./season-cast";
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
    `select 1 from characters
      where id = $1 and owner_id is distinct from $3
        and ((is_house and premium_sku is null and visibility <> 'private') or (companion_open and visibility <> 'private') or owner_id = $2)`,
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
    `select id, user_id, character_id, last_at, notice_at, paused_at, reply_length, summary, scene, roleplay from companion_threads where id = $1 and user_id = $2`,
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
  extra: { model?: string | null; cost?: number | null; scene?: VenueId | null; action?: string | null; marker?: "scene" | "texting"; roleplay?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into companion_messages (id, thread_id, role, text, model, cost, created_at, scene, action, marker, roleplay) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, threadId, role, text, extra.model ?? null, extra.cost ?? null, at.toISOString(), extra.scene ?? null, extra.action ?? null, extra.marker ?? null, extra.roleplay ?? null],
  );
  return id;
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
 * first message (left out if the model is down: the person can say hi first).
 */
export async function openThread(db: Db, userId: string, characterId: string, now: Date = new Date()): Promise<{ ok: true; thread_id: string; resumed: boolean } | CompanionFail> {
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
  await speak(db, t, character, tick(now, 1), { cue: OPENER_CUE }).catch(() => null);
  return { ok: true, thread_id: id, resumed: false };
}

/** The thread as its page shows it: the messages (a redrawn reply's earlier draw left out) and its settings. */
export async function getThread(db: Db, userId: string, threadId: string): Promise<{ ok: true; view: CompanionThreadView } | CompanionFail> {
  const t = await ownThread(db, userId, threadId);
  if (!t) return NOT_FOUND;
  const ref = await characterRef(db, t.character_id, userId);
  if (!ref) return NOT_FOUND;
  const [{ rows: msgs }, { rows: facts }] = await Promise.all([
    db.query<{ id: string; role: "user" | "character" | "system"; text: string; created_at: string; reported: string | null; scene: string | null; action: string | null; marker: CompanionMessageView["marker"]; roleplay: string | null; voice_key: string | null }>(
      `select id, role, text, created_at, reported, scene, action, marker, roleplay, voice_key from companion_messages where thread_id = $1 and replaced_by is null order by created_at asc, id asc`,
      [threadId],
    ),
    db.query<{ n: number }>(`select count(*)::int as n from companion_facts where thread_id = $1`, [threadId]),
  ]);
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
        action: m.action,
        marker: m.marker,
        roleplay: m.roleplay,
        voice: m.voice_key ? voiceUrl(t.id, m.id) : null,
      })),
      reply_length: t.reply_length,
      scene: isScenePlace(t.scene) ? t.scene : null,
      roleplay: t.scene && t.roleplay ? roleplayView(t.roleplay, ref.name) : null,
      paused: Boolean(t.paused_at),
      facts: facts[0]?.n ?? 0,
    },
  };
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
};

/**
 * The companions page: your threads (most recent first), then who else you could talk with: yours, then the house
 * cast, then the rest. (Until 2026-11-07 the order was `(owner_id = $1) desc nulls last`, which sorts a house
 * character's NULL owner LAST, so behind 177 agent-made characters the 120 limit cut the house cast out entirely.)
 */
export async function listCompanions(db: Db, userId: string, now: Date = new Date()): Promise<{ threads: CompanionListItem[]; yours: CompanionListItem[]; cast: CompanionListItem[] }> {
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
  });
  const cols = `c.id, c.name, c.bio, ${portraitPathSql("c")} as portrait, c.avatar_hue, c.is_house, c.owner_id, c.age, c.pronouns, c.traits, c.created_via, c.created_at`;
  const [threads, others] = await Promise.all([
    db.query<Row>(
      `select ${cols}, t.id as thread_id, t.last_at,
              (select m.text from companion_messages m where m.thread_id = t.id and m.role <> 'system' and m.replaced_by is null order by m.created_at desc limit 1) as last
         from companion_threads t join characters c on c.id = t.character_id
        where t.user_id = $1 order by t.last_at desc limit 50`,
      [userId],
    ),
    db.query<Row>(
      `select ${cols}, null as thread_id, null as last, null as last_at
         from characters c
        where c.owner_id is distinct from $2
          and ((c.is_house and c.premium_sku is null and c.visibility <> 'private') or (c.companion_open and c.visibility <> 'private') or c.owner_id = $1)
          and not exists (select 1 from companion_threads t where t.user_id = $1 and t.character_id = c.id)
        order by (c.owner_id is not distinct from $1) desc, c.is_house desc, c.name asc
        limit 200`,
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
async function recentTurns(db: Db, threadId: string, exclude: readonly string[] = []): Promise<{ turns: PromptTurn[]; avoid: string[] }> {
  const { rows } = await db.query<{ role: "user" | "character"; text: string; action: string | null; roleplay: string | null }>(
    `select role, text, action, roleplay from companion_messages
      where thread_id = $1 and role <> 'system' and replaced_by is null and not (id = any($3::text[]))
      order by created_at desc, id desc limit $2`,
    [threadId, RECENT_TURNS + AVOID_LINES, exclude],
  );
  const recent = rows.slice(0, RECENT_TURNS).reverse();
  const avoid = rows
    .slice(RECENT_TURNS)
    .filter((r) => r.role === "character")
    .map((r) => r.text);
  return { turns: recent, avoid };
}

/** The character's own lines in this thread, newest first: what a new reply mustn't say again (repeatsEarlier). */
async function earlierLines(db: Db, threadId: string): Promise<string[]> {
  const { rows } = await db.query<{ text: string }>(
    `select text from companion_messages where thread_id = $1 and role = 'character' order by created_at desc, id desc limit 150`,
    [threadId],
  );
  return rows.map((r) => r.text);
}

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
  opts: { cue?: string; insteadOf?: string | null; /** The reply being drawn again: not in the prompt's turns. */ replacing?: readonly string[] } = {},
): Promise<SpeakResult> {
  const { turns, avoid } = await recentTurns(db, t.id, opts.replacing);
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
  const said = await earlierLines(db, t.id);
  // A safe draw that only says something again: used when the redraw doesn't come back better (never a deflection).
  let safeRepeat: { bubbles: string[]; action: string | null } | null = null;
  const again = (x: string) => `${x.slice(0, 300)} (you've said this before: say something new)`;
  for (let attempt = 0; attempt < 2 && !bubbles; attempt++) {
    if (attempt > 0 && Date.now() - started > REDRAW_WITHIN_MS) break;
    let raw: string;
    try {
      raw = await model.complete(
        companionMessages({ character, turns, facts, summary: t.summary, length: t.reply_length, avoid, now, insteadOf, cue: opts.cue, scene }),
        {
          temperature: 0.9,
          frequencyPenalty: 0.3,
          maxTokens: t.reply_length === "long" ? 700 : 400,
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
    const drawn = replyBubbles(raw, character.name);
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
  const texts = bubbles ?? [scene ? SCENE_DEFLECTIONS[Math.floor(Math.random() * SCENE_DEFLECTIONS.length)] : DEFLECTIONS[Math.floor(Math.random() * DEFLECTIONS.length)]];
  const cost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const modelId = served ?? usage[0]?.model ?? null;
  const ids: string[] = [];
  for (const [i, text] of texts.entries()) {
    ids.push(await addMessage(db, t.id, "character", text, tick(now, i), { ...(i === 0 ? { model: modelId, cost: cost || null } : {}), scene: t.scene, action: bubbles ? action : null, roleplay: t.roleplay?.title ?? null }));
  }
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, texts.length).toISOString()]);
  track("companion_reply", { model: modelId ?? undefined, cost: cost || undefined, ms: Date.now() - started, bubbles: texts.length, deflected: bubbles ? undefined : true });
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

/** One message from the person, and the character's reply. */
export async function sendMessage(db: Db, userId: string, threadId: string, input: string, now: Date = new Date(), surface: CompanionSurface = "companion"): Promise<CompanionSend> {
  const l = await loaded(db, userId, threadId);
  if ("status" in l) return l;
  const { t, character } = l;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  const text = clean(input);
  if (!text) return fail(400, "empty", "Say something first.");
  if (text.length > COMPANION_MESSAGE_MAX) return fail(400, "too_long", `Keep it under ${COMPANION_MESSAGE_MAX} characters.`);
  const refused = await screen(db, t, text, now, surface);
  if (refused) return refused;
  if (noticeDue(t, now)) await putNotice(db, t, character.name, now);
  await addMessage(db, t.id, "user", text, tick(now, 1), { scene: t.scene, roleplay: t.roleplay?.title ?? null });
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, 1).toISOString()]);
  const r = await speak(db, t, character, tick(now, 2));
  if (!r.ok) return r;
  return getThread(db, userId, threadId);
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
