import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Model } from "./model";
import type { CompanionFactView } from "./companion-shared";
import { checkShowText } from "./safety";
import { crisisIntent } from "./crisis";
import { maybeCrisis } from "./step-in";
import { jsonOf, RECENT_TURNS, type PromptFact } from "./companion-prompt";

/**
 * What a companion remembers about the person (docs/companions.md): short facts drawn from their own words every few
 * messages, and a rolling summary of everything older than the prompt's recent turns. The person sees every fact on the
 * memory page and can edit, pin or delete it; one they edited is never written over or dropped to make room.
 */

/** Facts are drawn after this many new messages from the person. */
export const FACTS_EVERY = 6;
/** The most facts a thread keeps (unpinned, unedited, least-used ones make room). */
export const FACTS_PER_THREAD = 60;
/** The most facts in a prompt: pinned first, then the ones the conversation is about, then the newest. */
export const FACTS_IN_PROMPT = 8;
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

type FactRow = { id: string; kind: string; text: string; pinned: boolean; edited_by_user: boolean; uses: number; created_at: string };

/** The facts for this turn's prompt (and each one's use counted). */
export async function factsForPrompt(db: Db, threadId: string, about: string, now: Date = new Date()): Promise<PromptFact[]> {
  const { rows } = await db.query<FactRow>(`select id, kind, text, pinned, edited_by_user, uses, created_at from companion_facts where thread_id = $1`, [threadId]);
  if (!rows.length) return [];
  const topic = words(about);
  const ranked = rows
    .map((r, i) => ({ r, score: (r.pinned ? 10 : 0) + (r.edited_by_user ? 1 : 0) + overlap(words(r.text), topic) * 3 + (r.kind === "name" ? 2 : 0), i }))
    .sort((a, b) => b.score - a.score || +new Date(b.r.created_at) - +new Date(a.r.created_at))
    .slice(0, FACTS_IN_PROMPT)
    .map((x) => x.r);
  await db.query(`update companion_facts set uses = uses + 1, last_used_at = $2 where id = any($1::text[])`, [ranked.map((r) => r.id), now.toISOString()]);
  return ranked.map((r) => ({ kind: r.kind, text: r.text }));
}

const FACTS_PROMPT = (name: string) =>
  `You read part of a conversation between a person and ${name}, an AI character they talk with. List what ${name} should remember about THE PERSON (never about ${name}): their name, what they like and dislike, the people in their life, what happened to them, plans coming up, their work, topics they don't want to talk about (boundaries), and inside jokes between them. Only what they actually said or clearly meant; skip small talk and anything already known. Lines marked [roleplay: …] are make-believe from a roleplay the two played: never take a fact from them. Each fact is short, in the third person ("Their sister is called Maya."), under 140 characters. Answer only JSON: {"facts":[{"kind":"name|likes|dislikes|people|events|plans|work|boundaries|jokes|other","text":"..."}]}, at most 8, or {"facts":[]}.`;

/**
 * Draws new facts from the person's recent messages when FACTS_EVERY have come in since the last draw. One model call;
 * a failed or unreadable one changes nothing. Returns how many facts were added.
 */
export async function updateFacts(db: Db, threadId: string, name: string, model: Model, now: Date = new Date()): Promise<number> {
  const t = (await db.query<{ facts_upto: string | null }>(`select facts_upto from companion_threads where id = $1`, [threadId])).rows[0];
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
  if (fromThem.length < FACTS_EVERY) return 0;
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
  let added = 0;
  for (const f of parsed.slice(0, 8)) {
    const text = typeof f?.text === "string" ? f.text.replace(/\s+/g, " ").trim().slice(0, FACT_MAX) : "";
    if (text.length < 4) continue;
    // Never the words of a crisis (not even a maybe: a companion keeps no notes on someone's mental health), never
    // anything the show wouldn't say.
    if (crisisIntent(text) || maybeCrisis(text) || !checkShowText({ fact: text }).ok) continue;
    const w = words(text);
    if (knownWords.some((k) => overlap(k, w) >= 0.8)) continue;
    const kind = (FACT_KINDS as readonly string[]).includes(f?.kind) ? (f.kind as string) : "other";
    await db.query(`insert into companion_facts (id, thread_id, kind, text, created_at) values ($1, $2, $3, $4, $5)`, [randomUUID(), threadId, kind, text, now.toISOString()]);
    knownWords.push(w);
    added++;
  }
  await capFacts(db, threadId);
  return added;
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
    if (!checkShowText({ fact: text }).ok) return "That can't go in a companion's memory: the show is PG.";
    // Like the facts it draws, never a note on someone's mental health (the crisis check ran first: screenFact).
    if (crisisIntent(text) || maybeCrisis(text)) return "That's one a companion doesn't keep notes on. You can still talk with them about it.";
    if (e.op === "add") {
      // Theirs are never dropped to make room, so they stop at the thread's cap.
      const n = (await db.query<{ n: number }>(`select count(*)::int as n from companion_facts where thread_id = $1`, [threadId])).rows[0]?.n ?? 0;
      if (n >= FACTS_PER_THREAD) return `That's ${FACTS_PER_THREAD} things already: forget one first.`;
      await db.query(`insert into companion_facts (id, thread_id, kind, text, edited_by_user, pinned, created_at) values ($1, $2, 'other', $3, true, true, $4)`, [randomUUID(), threadId, text, now.toISOString()]);
      return null;
    }
    const r = await db.query(`update companion_facts set text = $3, edited_by_user = true where id = $2 and thread_id = $1 returning id`, [threadId, e.id, text]);
    return r.rows.length ? null : "That's not one of theirs.";
  }
  if (e.op === "pin") {
    const r = await db.query(`update companion_facts set pinned = $3 where id = $2 and thread_id = $1 returning id`, [threadId, e.id, e.pinned]);
    return r.rows.length ? null : "That's not one of theirs.";
  }
  const r = await db.query(`delete from companion_facts where id = $2 and thread_id = $1 returning id`, [threadId, e.id]);
  return r.rows.length ? null : "That's not one of theirs.";
}
