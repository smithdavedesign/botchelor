import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Model } from "./model";
import { COMPANION_GUEST_REPLIES, type CompanionFactView } from "./companion-shared";
import { checkFamilyTalk } from "./safety";
import { crisisIntent } from "./crisis";
import { maybeCrisis } from "./step-in";
import { jsonOf, RECENT_TURNS, type PromptFact } from "./companion-prompt";
import { getPersona, type ScenePersona } from "./persona";
import { escapeRegExp } from "./text";
import { cosine, embed, embedKey, embedModel } from "./originality-concept";

/**
 * What a companion remembers about the person (docs/companions.md): short facts drawn from their own words every few
 * messages, and a rolling summary of everything older than the prompt's recent turns. The person sees every fact on the
 * memory page and can edit, pin or delete it; one they edited is never written over or dropped to make room.
 */

/** Facts are drawn after this many new messages from the person. */
export const FACTS_EVERY = 6;
/**
 * A guest's (no account yet) are drawn sooner, inside their few replies (companion-shared.ts COMPANION_GUEST_REPLIES):
 * their memory panel always read "(0)" while the sign-up line said the character remembers all of it (2026-11-21).
 */
export const GUEST_FACTS_EVERY = Math.max(2, Math.min(FACTS_EVERY, COMPANION_GUEST_REPLIES - 1));
/** The most facts a thread keeps (unpinned, unedited, least-used ones make room). */
export const FACTS_PER_THREAD = 60;
/**
 * The most facts in a prompt: pinned first, then the ones the conversation is about, then the lasting kinds, then the
 * newest. 2026-11-08 (companion quality sim): 8 left out stored facts asked about by meaning, not by word ("what don't I
 * eat?" never matched "They are vegetarian"); a fact is ~15 tokens, so 20 costs little.
 */
export const FACTS_IN_PROMPT = 20;
/** How much each kind of fact counts toward a place in the prompt: who they are and their life before passing jokes. */
const KIND_WEIGHT: Record<string, number> = { name: 2, people: 1, work: 1, plans: 1, events: 1, boundaries: 1.5, likes: 0.5, dislikes: 0.5 };
/** The summary is redrawn once this many messages have fallen out of the recent turns since it last was. */
export const SUMMARY_EVERY = 40;
export const FACT_MAX = 160;
export const FACT_KINDS = ["name", "likes", "dislikes", "people", "events", "plans", "work", "boundaries", "jokes", "other"] as const;

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

type FactRow = {
  id: string;
  kind: string;
  text: string;
  pinned: boolean;
  edited_by_user: boolean;
  uses: number;
  created_at: string;
  /** Its embedding and the model that made it (null before it's embedded): recall by meaning. */
  embedding?: number[] | null;
  embed_model?: string | null;
  /** How much it matters to who they are, 1 to 5, from the draw (null for older facts and ones the person wrote). */
  importance?: number | null;
};

type Env = Record<string, string | undefined>;

/*
 * Recall by meaning (docs/PRDs/cross-mode-memory.md, phase 0). Ranking by shared words missed facts asked about in other
 * words ("what don't I eat?" never found "They are vegetarian", the 2026-11-08 sim), so each fact is embedded once
 * (gemini-embedding-001, the originality check's model, on its own daily budget) and the person's message is embedded
 * when there are more facts than fit in the prompt. Similarity is one more term of the same score, next to the words,
 * never in place of them: no key, the switch off, the budget spent, a slow call or an unembedded fact all leave the
 * ranking exactly as it was by words. Only SFW companion facts: Step in's (After Dark) are not sent to an embedding
 * provider until that has its own privacy review.
 */

/** MEMORY_EMBED=0 turns recall by meaning off; otherwise it's on whenever an embedding key is set. */
export const memoryEmbedOn = (env: Env = process.env): boolean => env.MEMORY_EMBED?.trim() !== "0" && Boolean(embedKey(env).key);
/** How long a reply waits for its question's embedding before ranking by words alone. */
export const RECALL_TIMEOUT_MS = 1200;
/** The most a fact's meaning adds to its score: the same as a message sharing every one of its words. */
const MEANING_WEIGHT = 6;
/** Below this spread between the best match and the typical fact, nothing stands out by meaning and nothing is added. */
const MEANING_MIN_SPREAD = 0.04;
/** Facts embedded per draw, the new ones first: older facts of an active thread catch up a few at a time. */
export const EMBED_PER_DRAW = 12;

/**
 * Each fact's bonus by meaning, 0 to MEANING_WEIGHT: how far its similarity to the question sits above the thread's
 * median, as a share of how far the best one does. Relative on purpose, so it doesn't depend on the model's scale; and
 * nothing when no fact stands out (a "hi" is about nothing in particular). A fact without a usable vector gets 0.
 */
export function meaningBonus(sims: readonly (number | null)[]): number[] {
  const known = sims.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (known.length < 2) return sims.map(() => 0);
  const median = known[Math.floor(known.length / 2)];
  const best = known[known.length - 1];
  if (best - median < MEANING_MIN_SPREAD) return sims.map(() => 0);
  return sims.map((x) => (x === null || x <= median ? 0 : (MEANING_WEIGHT * (x - median)) / (best - median)));
}

/**
 * The facts in the order a prompt takes them (pure, so the rule is tested without a database): pinned first, then by
 * what the message is about (its words and, with `query`, its meaning), then the lasting kinds and what matters most,
 * then the newest. `query` is the message's embedding from `model`; facts embedded by another model don't compare.
 */
export function rankFacts(rows: readonly FactRow[], about: string, query: number[] | null = null, model: string | null = null): FactRow[] {
  const topic = words(about);
  const sims = rows.map((r) => (query && r.embedding?.length && r.embed_model === model ? cosine(query, r.embedding) : null));
  const bonus = meaningBonus(sims);
  return rows
    .map((r, i) => ({
      r,
      score:
        (r.pinned ? 10 : 0) +
        (r.edited_by_user ? 1 : 0) +
        overlap(words(r.text), topic) * 6 +
        bonus[i] +
        (KIND_WEIGHT[r.kind] ?? 0) +
        (r.importance ? (r.importance - 3) * 0.3 : 0),
    }))
    .sort((a, b) => b.score - a.score || +new Date(b.r.created_at) - +new Date(a.r.created_at))
    .map((x) => x.r);
}

/** The message's embedding for recall, or null (off, no key, the budget spent, too slow): never throws. */
async function queryVector(db: Db, about: string, env: Env): Promise<number[] | null> {
  if (!memoryEmbedOn(env) || about.trim().length < 3) return null;
  const r = await embed(db, about.slice(0, 600), { env, timeoutMs: RECALL_TIMEOUT_MS, pool: "memory", task: "RETRIEVAL_QUERY" }).catch(() => null);
  return r?.ok ? r.vec : null;
}

/** The facts for this turn's prompt (and each one's use counted). */
export async function factsForPrompt(
  db: Db,
  threadId: string,
  about: string,
  now: Date = new Date(),
  deps: { env?: Env; queryVector?: (about: string) => Promise<number[] | null> } = {},
): Promise<PromptFact[]> {
  const { rows } = await db.query<FactRow>(
    `select id, kind, text, pinned, edited_by_user, uses, created_at, embedding, embed_model, importance from companion_facts where thread_id = $1`,
    [threadId],
  );
  if (!rows.length) return [];
  const env = deps.env ?? process.env;
  // When every fact fits, the order is all that ranking changes, so nothing is embedded.
  const model = embedModel(env);
  const worth = rows.length > FACTS_IN_PROMPT && rows.some((r) => r.embedding?.length && r.embed_model === model);
  const query = worth ? await (deps.queryVector ?? ((a: string) => queryVector(db, a, env)))(about).catch(() => null) : null;
  const ranked = rankFacts(rows, about, query, model).slice(0, FACTS_IN_PROMPT);
  await db.query(`update companion_facts set uses = uses + 1, last_used_at = $2 where id = any($1::text[])`, [ranked.map((r) => r.id), now.toISOString()]);
  return ranked.map((r) => ({ kind: r.kind, text: r.text }));
}

/**
 * Embeds up to EMBED_PER_DRAW of a thread's facts that have no embedding from the current model, newest first, on the
 * memory budget. Best-effort, after the reply: a failure leaves them for the next draw. Returns how many it embedded.
 */
export async function embedFacts(
  db: Db,
  threadId: string,
  deps: { env?: Env; vector?: (text: string) => Promise<number[] | null> } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  if (!deps.vector && !memoryEmbedOn(env)) return 0;
  const model = embedModel(env);
  const vector =
    deps.vector ??
    (async (text: string) => {
      const r = await embed(db, text, { env, pool: "memory", task: "RETRIEVAL_DOCUMENT" });
      return r.ok ? r.vec : null;
    });
  const { rows } = await db.query<{ id: string; text: string }>(
    `select id, text from companion_facts where thread_id = $1 and (embedding is null or embed_model is distinct from $2) order by created_at desc limit $3`,
    [threadId, model, EMBED_PER_DRAW],
  );
  let n = 0;
  for (const r of rows) {
    const vec = await vector(r.text).catch(() => null);
    // A spent budget or a slow provider ends the batch: pushing on won't help.
    if (!vec) break;
    await db.query(`update companion_facts set embedding = $2::jsonb, embed_model = $3 where id = $1`, [r.id, JSON.stringify(vec), model]);
    n++;
  }
  return n;
}

const FACTS_PROMPT = (name: string) =>
  `You read part of a conversation between a person and ${name}, an AI character they talk with. List what ${name} should remember about THE PERSON (never about ${name}): their name, what they like and dislike, the people in their life, what happened to them, plans coming up, their work, topics they don't want to talk about (boundaries), and a running joke between them only when they keep coming back to it. Facts that will still be true next week: never a quip, a tease or a bit of banter from this conversation ("They joke that their dog is a pasta bandit" is not a fact). Only what they actually said or clearly meant; skip small talk and anything already known. Lines marked [roleplay: …] are make-believe from a roleplay the two played: never take a fact from them. The same goes for who they are in scenes (a name, a look and a line about themselves they wrote for scenes, which ${name} may use in one): make-believe too, never a fact unless they say it about their real life in their own ordinary messages. Each fact is short, in the third person ("Their sister is called Maya."), under 140 characters. When someone in their life has died or left, the fact says so ("Their wife June died; they were married forty years."). Give each fact an importance from 1 to 5: how much it matters to who they are and their life (5: their name, a death, a boundary, someone they love; 3: their work, a plan; 1: a small like). Answer only JSON: {"facts":[{"kind":"name|likes|dislikes|people|events|plans|work|boundaries|jokes|other","text":"...","importance":3}]}, at most 8, or {"facts":[]}.`;

/**
 * Draws new facts from the person's recent messages when FACTS_EVERY have come in since the last draw. One model call;
 * a failed or unreadable one changes nothing. Returns how many facts were added.
 */
export async function updateFacts(db: Db, threadId: string, name: string, model: Model, now: Date = new Date(), every: number = FACTS_EVERY): Promise<number> {
  const t = (await db.query<{ facts_upto: string | null; user_id: string }>(`select facts_upto, user_id from companion_threads where id = $1`, [threadId])).rows[0];
  if (!t) return 0;
  const { rows: msgs } = await db.query<{ role: string; text: string; created_at: string; roleplay: string | null }>(
    `select role, text, created_at, roleplay from companion_messages
      where thread_id = $1 and role <> 'system' and replaced_by is null and ($2::timestamptz is null or created_at > $2)
      order by created_at desc limit 24`,
    [threadId, t.facts_upto],
  );
  // A roleplay's lines are make-believe (their character's, not their life): they count toward the draw and show as such,
  // and the prompt says never to take a fact from them.
  const fromThem = msgs.filter((m) => m.role === "user");
  if (fromThem.length < every) return 0;
  const known = (await db.query<{ text: string }>(`select text from companion_facts where thread_id = $1 order by created_at desc limit $2`, [threadId, FACTS_PER_THREAD])).rows.map((r) => r.text);
  const convo = msgs
    .reverse()
    .map((m) => `${m.roleplay ? `[roleplay: ${m.roleplay}] ` : ""}${m.role === "user" ? "Them" : name}: ${m.text}`)
    .join("\n");
  // Everything they've said since the last draw was in a roleplay: nothing in it is about them, so it's read (covered)
  // without asking the model.
  if (fromThem.every((m) => m.roleplay)) {
    await db.query(`update companion_threads set facts_upto = $2 where id = $1`, [threadId, msgs[msgs.length - 1].created_at]);
    return 0;
  }
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: FACTS_PROMPT(name) },
        { role: "user", content: `Already known:\n${known.map((k) => `- ${k}`).join("\n") || "(nothing yet)"}\n\nThe conversation:\n${convo}` },
      ],
      { temperature: 0.2, maxTokens: 600 },
    );
  } catch {
    return 0;
  }
  // Covered either way: a reply with nothing new still means these messages were read.
  await db.query(`update companion_threads set facts_upto = $2 where id = $1`, [threadId, msgs[msgs.length - 1].created_at]);
  const parsed = (jsonOf(raw) as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(parsed)) return 0;
  const knownWords = known.map(words);
  // Who they are in scenes (lib/persona.ts) is make-believe, like a roleplay: a fact that only says it again is dropped,
  // unless their own ordinary messages here said it too.
  const persona = await getPersona(db, t.user_id).catch(() => null);
  const ownWords = fromThem.filter((m) => !m.roleplay).map((m) => m.text).join(" ");
  let added = 0;
  for (const f of parsed.slice(0, 8)) {
    const text = typeof f?.text === "string" ? f.text.replace(/\s+/g, " ").trim().slice(0, FACT_MAX) : "";
    if (text.length < 4) continue;
    if (persona && fromPersona(text, persona, ownWords)) continue;
    // Never the words of a crisis (not even a maybe: a companion keeps no notes on someone's mental health), never
    // anything the show wouldn't say.
    if (crisisIntent(text) || maybeCrisis(text) || !checkFamilyTalk(text).ok) continue;
    const w = words(text);
    if (knownWords.some((k) => overlap(k, w) >= 0.8)) continue;
    const kind = (FACT_KINDS as readonly string[]).includes(f?.kind) ? (f.kind as string) : "other";
    await db.query(`insert into companion_facts (id, thread_id, kind, text, importance, created_at) values ($1, $2, $3, $4, $5, $6)`, [
      randomUUID(),
      threadId,
      kind,
      text,
      importanceOf(f?.importance),
      now.toISOString(),
    ]);
    knownWords.push(w);
    added++;
  }
  await capFacts(db, threadId);
  return added;
}

/** A drawn fact's importance: a whole number 1 to 5, else null (the ranking then leaves it out). */
export function importanceOf(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : null;
}

/**
 * Whether a drawn fact comes from the person's scene persona rather than from what they said: it gives the persona's
 * name, or mostly repeats its look or its line about them, and nothing they wrote in their own ordinary messages
 * (`ownWords`: this draw's, a roleplay's left out) says the same.
 */
export function fromPersona(fact: string, persona: ScenePersona, ownWords: string): boolean {
  const said = ownWords.toLowerCase();
  const name = persona.name.trim().toLowerCase();
  if (name && new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}([^\\p{L}]|$)`, "u").test(fact.toLowerCase()) && !said.includes(name)) return true;
  const f = words(fact);
  const theirs = words(ownWords);
  return [persona.look, persona.about].some((part) => part && overlap(words(part), f) >= 0.6 && overlap(words(part), theirs) < 0.6);
}

/** Keeps a thread to FACTS_PER_THREAD: the least-used, oldest facts the person never pinned or edited go first. */
async function capFacts(db: Db, threadId: string): Promise<void> {
  await db.query(
    `delete from companion_facts where thread_id = $1 and not pinned and not edited_by_user and id not in (
       select id from companion_facts where thread_id = $1 order by pinned desc, edited_by_user desc, uses desc, created_at desc limit $2
     )`,
    [threadId, FACTS_PER_THREAD],
  );
}

const SUMMARY_PROMPT = (name: string) =>
  `You keep the running notes of a long conversation between a person and ${name}, an AI character they talk with. Given the notes so far and the next stretch of the conversation, write the new notes: what they talked about, what happened, how things stand between them, anything promised or left open. Under 150 words, plain prose, in the third person ("They told ${name} about…"). Lines marked [roleplay: …] are a roleplay they played together: note it as a game they played ("They played rival spies at the café"), never as their real life. Answer only JSON: {"notes":"..."}.`;

/**
 * Redraws the rolling summary when SUMMARY_EVERY messages have fallen out of the prompt's recent turns since the last
 * one. One model call; a failure keeps the old summary.
 */
export async function updateSummary(db: Db, threadId: string, name: string, model: Model): Promise<boolean> {
  const t = (await db.query<{ summary: string | null; summary_upto: string | null }>(`select summary, summary_upto from companion_threads where id = $1`, [threadId])).rows[0];
  if (!t) return false;
  const { rows } = await db.query<{ role: string; text: string; created_at: string; roleplay: string | null }>(
    `select role, text, created_at, roleplay from companion_messages
      where thread_id = $1 and role <> 'system' and replaced_by is null and ($2::timestamptz is null or created_at > $2)
      order by created_at asc`,
    [threadId, t.summary_upto],
  );
  const older = rows.slice(0, Math.max(0, rows.length - RECENT_TURNS));
  if (older.length < SUMMARY_EVERY) return false;
  let next: string;
  try {
    next = await model.complete(
      [
        { role: "system", content: SUMMARY_PROMPT(name) },
        { role: "user", content: `Notes so far: ${t.summary ?? "(none yet)"}\n\nThe next stretch:\n${older.map((m) => `${m.roleplay ? `[roleplay: ${m.roleplay}] ` : ""}${m.role === "user" ? "Them" : name}: ${m.text}`).join("\n")}` },
      ],
      { temperature: 0.2, maxTokens: 400 },
    );
  } catch {
    return false;
  }
  const notes = (jsonOf(next) as { notes?: unknown } | null)?.notes;
  next = (typeof notes === "string" ? notes : next.trim().startsWith("{") ? "" : next).replace(/\s+/g, " ").trim().slice(0, 1200);
  if (!next || crisisIntent(next)) return false;
  await db.query(`update companion_threads set summary = $2, summary_upto = $3 where id = $1`, [threadId, next, older[older.length - 1].created_at]);
  return true;
}

/* ------------------------------------------- the memory page's edits ------------------------------------------- */

export async function listFacts(db: Db, threadId: string): Promise<CompanionFactView[]> {
  const { rows } = await db.query<FactRow>(
    `select id, kind, text, pinned, edited_by_user, uses, created_at from companion_facts where thread_id = $1 order by pinned desc, created_at desc`,
    [threadId],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, pinned: r.pinned, edited: r.edited_by_user, at: new Date(r.created_at).toISOString() }));
}

export type FactEdit = { op: "edit"; id: string; text: string } | { op: "pin"; id: string; pinned: boolean } | { op: "delete"; id: string } | { op: "add"; text: string } | { op: "forget_all" };

/** One edit from the memory page. Null when it went in; else what was wrong with it. */
export async function editFacts(db: Db, threadId: string, e: FactEdit, now: Date = new Date()): Promise<string | null> {
  if (e.op === "forget_all") {
    await db.query(`delete from companion_facts where thread_id = $1`, [threadId]);
    await db.query(`update companion_threads set summary = null, summary_upto = null, facts_upto = (select max(created_at) from companion_messages where thread_id = $1) where id = $1`, [threadId]);
    return null;
  }
  if (e.op === "edit" || e.op === "add") {
    const text = e.text.replace(/\s+/g, " ").trim();
    if (text.length < 2) return "Say what they should remember.";
    if (text.length > FACT_MAX) return `Keep it under ${FACT_MAX} characters.`;
    if (!checkFamilyTalk(text).ok) return "That can't go in a companion's memory: the show is PG.";
    // Like the facts it draws, never a note on someone's mental health (the crisis check ran first: screenFact).
    if (crisisIntent(text) || maybeCrisis(text)) return "That's one a companion doesn't keep notes on. You can still talk with them about it.";
    if (e.op === "add") {
      // Theirs are never dropped to make room, so they stop at the thread's cap.
      const n = (await db.query<{ n: number }>(`select count(*)::int as n from companion_facts where thread_id = $1`, [threadId])).rows[0]?.n ?? 0;
      if (n >= FACTS_PER_THREAD) return `That's ${FACTS_PER_THREAD} things already: forget one first.`;
      await db.query(`insert into companion_facts (id, thread_id, kind, text, edited_by_user, pinned, created_at) values ($1, $2, 'other', $3, true, true, $4)`, [randomUUID(), threadId, text, now.toISOString()]);
      return null;
    }
    const r = await db.query(`update companion_facts set text = $3, edited_by_user = true, embedding = null, embed_model = null where id = $2 and thread_id = $1 returning id`, [threadId, e.id, text]);
    return r.rows.length ? null : "That's not one of theirs.";
  }
  if (e.op === "pin") {
    const r = await db.query(`update companion_facts set pinned = $3 where id = $2 and thread_id = $1 returning id`, [threadId, e.id, e.pinned]);
    return r.rows.length ? null : "That's not one of theirs.";
  }
  const r = await db.query(`delete from companion_facts where id = $2 and thread_id = $1 returning id`, [threadId, e.id]);
  return r.rows.length ? null : "That's not one of theirs.";
}
