import { randomUUID } from "node:crypto";
import { isAdmin } from "./admins";
import { adultProviderRouting, OPENROUTER_BASE_URL } from "./adult/mode";
import { adultKeys } from "./adult/settings";
import { track } from "./analytics";
import { portraitPathSql } from "./assets";
import { loadCharacter, type Character } from "./character";
import { AVOID_LINES, companionMessages, RECENT_TURNS, replyBubbles, type PromptTurn } from "./companion-prompt";
import { factsForPrompt, updateFacts, updateSummary } from "./companion-memory";
import {
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionNotice,
  companionOpen,
  type CompanionCharacterRef,
  type CompanionReportReason,
  type CompanionThreadView,
  type ReplyLength,
} from "./companion-shared";
import { CRISIS_RESOURCES, crisisIntent, type CrisisResources } from "./crisis";
import type { Db } from "./db";
import { fallbackModel, getModel, openAICompatibleModel, type Model, type Usage } from "./model";
import { loadOurIds } from "./our-traffic";
import { recordServerError } from "./errors";
import { DELETED_OWNER } from "./rules";
import { checkShowText } from "./safety";
import { countCrisis, lineInCrisis, PG_REDIRECT } from "./step-in";

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
    timeoutMs: 45_000,
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
};

export type CompanionFail = { ok: false; status: number; error: string; message: string; crisis_resources?: CrisisResources };
const fail = (status: number, error: string, message: string): CompanionFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "Not found.");

async function ownThread(db: Db, userId: string, threadId: string): Promise<ThreadRow | null> {
  const { rows } = await db.query<ThreadRow>(
    `select id, user_id, character_id, last_at, notice_at, paused_at, reply_length, summary from companion_threads where id = $1 and user_id = $2`,
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
  extra: { model?: string | null; cost?: number | null } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into companion_messages (id, thread_id, role, text, model, cost, created_at) values ($1, $2, $3, $4, $5, $6, $7)`, [
    id,
    threadId,
    role,
    text,
    extra.model ?? null,
    extra.cost ?? null,
    at.toISOString(),
  ]);
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
    db.query<{ id: string; role: "user" | "character" | "system"; text: string; created_at: string; reported: string | null }>(
      `select id, role, text, created_at, reported from companion_messages where thread_id = $1 and replaced_by is null order by created_at asc, id asc`,
      [threadId],
    ),
    db.query<{ n: number }>(`select count(*)::int as n from companion_facts where thread_id = $1`, [threadId]),
  ]);
  return {
    ok: true,
    view: {
      id: t.id,
      character: ref,
      messages: msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, at: new Date(m.created_at).toISOString(), reported: Boolean(m.reported) })),
      reply_length: t.reply_length,
      paused: Boolean(t.paused_at),
      facts: facts[0]?.n ?? 0,
    },
  };
}

async function characterRef(db: Db, characterId: string, userId: string): Promise<CompanionCharacterRef | null> {
  const { rows } = await db.query<{ id: string; name: string; portrait: string | null; avatar_hue: number | null; is_house: boolean; owner_id: string | null }>(
    `select c.id, c.name, ${portraitPathSql("c")} as portrait, c.avatar_hue, c.is_house, c.owner_id from characters c where c.id = $1`,
    [characterId],
  );
  const r = rows[0];
  return r ? { id: r.id, name: r.name, portrait: r.portrait, hue: r.avatar_hue, house: r.is_house, yours: r.owner_id === userId } : null;
}

export type CompanionListItem = CompanionCharacterRef & { thread_id: string | null; last: string | null; last_at: string | null; bio: string };

/** The companions page: your threads (most recent first), then who else you could talk with (yours, then the cast). */
export async function listCompanions(db: Db, userId: string): Promise<{ threads: CompanionListItem[]; yours: CompanionListItem[]; cast: CompanionListItem[] }> {
  type Row = { id: string; name: string; bio: string; portrait: string | null; avatar_hue: number | null; is_house: boolean; owner_id: string | null; thread_id: string | null; last: string | null; last_at: string | null };
  const item = (r: Row): CompanionListItem => ({
    id: r.id,
    name: r.name,
    bio: r.bio,
    portrait: r.portrait,
    hue: r.avatar_hue,
    house: r.is_house,
    yours: r.owner_id === userId,
    thread_id: r.thread_id,
    last: r.last,
    last_at: r.last_at ? new Date(r.last_at).toISOString() : null,
  });
  const cols = `c.id, c.name, c.bio, ${portraitPathSql("c")} as portrait, c.avatar_hue, c.is_house, c.owner_id`;
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
        order by (c.owner_id = $1) desc nulls last, c.is_house desc, c.name asc
        limit 120`,
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

type SpeakResult = { ok: true; ids: string[]; texts: string[] } | CompanionFail;

/** The recent turns, oldest first (a redrawn reply's earlier draw left out, and the reply being drawn again). */
async function recentTurns(db: Db, threadId: string, exclude: readonly string[] = []): Promise<{ turns: PromptTurn[]; avoid: string[] }> {
  const { rows } = await db.query<{ role: "user" | "character"; text: string }>(
    `select role, text from companion_messages
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
  for (let attempt = 0; attempt < 2 && !bubbles; attempt++) {
    let raw: string;
    try {
      raw = await model.complete(
        companionMessages({ character, turns, facts, summary: t.summary, length: t.reply_length, avoid, now, insteadOf, cue: opts.cue }),
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
    const drawn = replyBubbles(raw, character.name);
    if (drawn.length && drawn.every((b) => checkShowText({ dialogue: b }).ok && !crisisIntent(b))) bubbles = drawn;
    else insteadOf = `${drawn.join(" ").slice(0, 300)} (keep it PG and kind)`;
  }
  const texts = bubbles ?? [DEFLECTIONS[Math.floor(Math.random() * DEFLECTIONS.length)]];
  const cost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const modelId = served ?? usage[0]?.model ?? null;
  const ids: string[] = [];
  for (const [i, text] of texts.entries()) ids.push(await addMessage(db, t.id, "character", text, tick(now, i), i === 0 ? { model: modelId, cost: cost || null } : {}));
  await db.query(`update companion_threads set last_at = $2 where id = $1`, [t.id, tick(now, texts.length).toISOString()]);
  track("companion_reply", { model: modelId ?? undefined, cost: cost || undefined, ms: Date.now() - started, bubbles: texts.length, deflected: bubbles ? undefined : true });
  return { ok: true, ids, texts };
}

export type CompanionSend = { ok: true; view: CompanionThreadView } | CompanionFail;

/**
 * Checks a person's words before they go in: the self-harm protocol first (it pauses the thread with the resources and
 * keeps nothing they said), then the show's PG line (a gentle redirect, nothing kept). Null when they may go in.
 */
async function screen(db: Db, t: ThreadRow, text: string, now: Date, surface: CompanionSurface): Promise<CompanionFail | null> {
  const { crisis } = await lineInCrisis(text, surface, await modelFor(db));
  if (crisis) {
    await countCrisis(db, surface, now);
    await db.query(`update companion_threads set paused_at = $2 where id = $1`, [t.id, now.toISOString()]);
    return { ...fail(200, "paused", CRISIS_RESOURCES.message), crisis_resources: CRISIS_RESOURCES };
  }
  const safe = checkShowText({ dialogue: text });
  if (!safe.ok) return fail(422, "refused", PG_REDIRECT[safe.reason]);
  return null;
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
  await addMessage(db, t.id, "user", text, tick(now, 1));
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
  const r = await speak(db, t, character, now, { insteadOf: last.texts.join(" ") || null, cue: last.afterUser ? undefined : OPENER_CUE, replacing: last.ids });
  if (!r.ok) return r;
  if (last.ids.length) await db.query(`update companion_messages set replaced_by = $2 where id = any($1::text[])`, [last.ids, r.ids[0]]);
  return getThread(db, userId, threadId);
}

/** The character's messages since the person last spoke (the reply a regenerate replaces), and whether the person has. */
async function lastReply(db: Db, threadId: string): Promise<{ ids: string[]; texts: string[]; afterUser: boolean }> {
  const { rows } = await db.query<{ id: string; role: string; text: string }>(
    `select id, role, text from companion_messages where thread_id = $1 and role <> 'system' and replaced_by is null order by created_at desc, id desc limit 8`,
    [threadId],
  );
  const ids: string[] = [];
  const texts: string[] = [];
  let afterUser = false;
  for (const m of rows) {
    if (m.role === "user") {
      afterUser = true;
      break;
    }
    ids.push(m.id);
    texts.unshift(m.text);
  }
  return { ids, texts, afterUser };
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
  const refused = await screen(db, t, text, now, surface);
  if (refused) return refused;
  const after = await lastReply(db, t.id);
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
  return rows.length ? { ok: true } : NOT_FOUND;
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
