/**
 * One mind, walled rooms (docs/PRDs/cross-mode-memory.md, phase 1; David, 2026-11-26: "we need a smarter way for the
 * character to remember and grow"). Each mode kept its own memory: the show's learned layer (lib/memory.ts), lessons
 * (lib/character-lessons.ts), the companion's facts and summary (lib/companion-memory.ts), After Dark's notes and facts
 * (lib/adult/memory.ts, lib/adult/facts.ts), Step in's facts. Nothing joined them into one life, so a character told its
 * maker nothing of the night it spent with someone, and its talks with its maker never taught it anything.
 *
 * This is the shared, episodic memory every mode writes to: one row per remembered thing (`character_episodes`), in
 * the character's own words or the show's, with
 *  - **a room**, `sfw` or `adult`. The wall is SQL: every reader here selects `room = 'sfw'` itself, and no function
 *    takes the room as an argument, so no caller can widen it. An SFW row's text passed the show's own check
 *    (lib/safety.ts checkShowText) before it was kept. Nothing writes the adult room yet: it exists so After Dark's own
 *    memories can join later without ever being readable from the show.
 *  - **who may see it**: `public` (the aired record), `owner` (the character and its maker) or `self` (only the
 *    character's own prompts and its maker's views). Readers say which they may read.
 *  - **where it came from** (source + source_ref), one row each, so a writer can sync its own rows (a forgotten
 *    reflection goes from here too) and a rewrite replaces instead of piling up.
 *  - **importance** 1 to 5 and an **embedding** (recall by meaning, the companion's phase-0 machinery, on its budget).
 *
 * Writers, each for what it already decided to keep (none of them calls a model for this):
 *  - an aired date's reflection (lib/memory.ts updateCharacterMemory: `reflection`, synced with its forgets);
 *  - After Dark's PG note after a night (lib/adult/memory.ts rememberAfterDark: `after_dark_note`, the only After Dark
 *    thing that ever reaches here, and only once it passed the show's check: David's "they spent the night together");
 *  - its weekly lessons (lib/character-lessons.ts: `lesson`);
 *  - the rolling summary of its maker's own companion thread, never anyone else's (lib/companion.ts follow-up:
 *    `companion_talk`, David's call 2026-11-26: "companion chats shape growth, owner's thread only").
 *
 * Readers: the maker's companion thread recalls what it remembers lately (rankEpisodes: meaning, recency, importance,
 * the person it's about), and the lessons writer reads its talks with its maker. The engine reads none of it.
 *
 * Consolidation (consolidateMemories, the daily job): a character's oldest rows past EPISODES_LIVE are folded into one
 * `chapter` row by the show's free model (a template when it can't), kept with the ids it was folded from; the folded
 * rows stay but leave recall. Forgetting a row also removes any chapter folded from it, so a forget is total.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { Model } from "./model";
import { cosine, embed, embedModel } from "./originality-concept";
import { checkShowText } from "./safety";
import { meaningBonus, memoryEmbedOn } from "./companion-memory";

type Env = Record<string, string | undefined>;

export const EPISODE_SOURCES = ["reflection", "after_dark_note", "lesson", "companion_talk", "chapter"] as const;
export type EpisodeSource = (typeof EPISODE_SOURCES)[number];
export type EpisodeVisibility = "public" | "owner" | "self";

/** A kept memory's length. */
export const EPISODE_MAX = 400;
/** How many unfolded rows a character keeps live in recall before the oldest are folded into a chapter. */
export const EPISODES_LIVE = 60;
/** At most this many rows go into one chapter, and only rows at least this old. */
export const FOLD_BATCH = 20;
export const FOLD_MIN_AGE_DAYS = 21;
/** Characters consolidated a day, at most (one cheap call each). */
export const FOLDS_PER_DAY = 40;
/** Memories in a companion prompt. */
export const RECALL_IN_PROMPT = 6;
/** A memory's recency halves every this many days in recall. */
const RECENCY_HALF_LIFE_DAYS = 30;
const DAY_MS = 86_400_000;

/** MEMORY_EPISODES=0 turns the shared memory off: nothing is written or read, and every mode works as it did alone. */
export const episodesOn = (env: Env = process.env): boolean => env.MEMORY_EPISODES?.trim() !== "0";

export type NewEpisode = {
  characterId: string;
  source: EpisodeSource;
  sourceRef: string;
  text: string;
  visibility: EpisodeVisibility;
  /** The other character it's about, when it's about one. */
  aboutId?: string | null;
  importance?: number;
  at?: Date;
};

const tidy = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, EPISODE_MAX);

/**
 * Keeps one SFW memory, or replaces the one from the same source and ref (a rewritten note, an updated summary).
 * Held to the show's text check first: a row that fails isn't kept. Never throws; true when it was kept.
 */
export async function rememberSfw(db: Db, e: NewEpisode, env: Env = process.env): Promise<boolean> {
  if (!episodesOn(env)) return false;
  const text = tidy(e.text);
  if (text.length < 8 || !checkShowText({ text }).ok) return false;
  try {
    await db.query(
      `insert into character_episodes (id, character_id, room, source, source_ref, about_id, visibility, text, importance, created_at)
       values ($1, $2, 'sfw', $3, $4, $5, $6, $7, $8, $9)
       on conflict (character_id, source, source_ref) do update set
         text = excluded.text, about_id = excluded.about_id, visibility = excluded.visibility, importance = excluded.importance,
         embedding = case when character_episodes.text = excluded.text then character_episodes.embedding else null end,
         embed_model = case when character_episodes.text = excluded.text then character_episodes.embed_model else null end,
         folded_into = case when character_episodes.text = excluded.text then character_episodes.folded_into else null end`,
      [randomUUID(), e.characterId, e.source, e.sourceRef, e.aboutId ?? null, e.visibility, text, Math.min(5, Math.max(1, Math.round(e.importance ?? 3))), (e.at ?? new Date()).toISOString()],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes rows of one source, and every chapter folded from any of them (a forget is total). `keepRefs`: the refs
 * that still stand (a sync); null removes them all. Never throws.
 */
export async function forgetEpisodes(db: Db, characterId: string, source: EpisodeSource, keepRefs: readonly string[] | null, refs: readonly string[] | null = null): Promise<number> {
  try {
    const { rows } = await db.query<{ id: string }>(
      `delete from character_episodes where character_id = $1 and source = $2
          and ($3::text[] is null or not (source_ref = any($3::text[])))
          and ($4::text[] is null or source_ref = any($4::text[]))
        returning id`,
      [characterId, source, keepRefs ? [...keepRefs] : null, refs ? [...refs] : null],
    );
    if (rows.length) {
      await db.query(`delete from character_episodes where character_id = $1 and source = 'chapter' and folded_from ?| $2::text[]`, [characterId, rows.map((r) => r.id)]);
      // What a removed chapter had folded comes back into recall (it was only out because the chapter stood for it).
      await db.query(`update character_episodes set folded_into = null where character_id = $1 and folded_into is not null and not exists (select 1 from character_episodes c where c.id = character_episodes.folded_into)`, [characterId]);
    }
    return rows.length;
  } catch {
    return 0;
  }
}

/** Every row of a companion thread's talk (forget everything, the thread deleted). */
export async function forgetThreadTalk(db: Db, threadId: string): Promise<void> {
  const { rows } = await db.query<{ character_id: string }>(`select distinct character_id from character_episodes where source = 'companion_talk' and source_ref = $1`, [threadId]).catch(() => ({ rows: [] as { character_id: string }[] }));
  for (const r of rows) await forgetEpisodes(db, r.character_id, "companion_talk", null, [threadId]);
}

export type EpisodeRow = {
  id: string;
  source: EpisodeSource;
  source_ref: string;
  about_id: string | null;
  visibility: EpisodeVisibility;
  text: string;
  importance: number;
  created_at: string | Date;
  embedding: number[] | null;
  embed_model: string | null;
};

/**
 * The order recall takes memories in (pure): recency (halving every RECENCY_HALF_LIFE_DAYS), importance, meaning
 * against `query` (relative to the rest, as companion facts rank: lib/companion-memory.ts meaningBonus), and a lift for
 * one about `aboutId` (the person the conversation is about).
 */
export function rankEpisodes(rows: readonly EpisodeRow[], opts: { now?: Date; query?: number[] | null; model?: string | null; aboutId?: string | null } = {}): EpisodeRow[] {
  const now = (opts.now ?? new Date()).getTime();
  const sims = rows.map((r) => (opts.query && r.embedding?.length && r.embed_model === opts.model ? cosine(opts.query, r.embedding) : null));
  const bonus = meaningBonus(sims);
  return rows
    .map((r, i) => {
      const age = Math.max(0, (now - new Date(r.created_at).getTime()) / DAY_MS);
      const recency = 3 * Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS);
      return { r, score: recency + (r.importance - 3) * 0.5 + bonus[i] + (opts.aboutId && r.about_id === opts.aboutId ? 2 : 0) };
    })
    .sort((a, b) => b.score - a.score || +new Date(b.r.created_at) - +new Date(a.r.created_at))
    .map((x) => x.r);
}

/**
 * What a character remembers, for one of its SFW prompts: never the adult room (in the SQL itself), only what `may`
 * allows (its maker's thread: everything; anyone else's: the public record), without `skip`'s sources (ones the prompt
 * already carries its own way), folded rows left out (their chapter stands for them). Best first, at most `limit`.
 */
export async function recallSfw(
  db: Db,
  characterId: string,
  opts: { may: "maker" | "public"; about?: string; aboutId?: string | null; skip?: readonly EpisodeSource[]; limit?: number; now?: Date; env?: Env; queryVector?: (text: string) => Promise<number[] | null> },
): Promise<string[]> {
  const env = opts.env ?? process.env;
  if (!episodesOn(env)) return [];
  const visible = opts.may === "maker" ? ["public", "owner", "self"] : ["public"];
  const { rows } = await db
    .query<EpisodeRow>(
      `select id, source, source_ref, about_id, visibility, text, importance, created_at, embedding, embed_model from character_episodes
        where character_id = $1 and room = 'sfw' and visibility = any($2::text[]) and folded_into is null and not (source = any($3::text[]))
        order by created_at desc limit 200`,
      [characterId, visible, [...(opts.skip ?? [])]],
    )
    .catch(() => ({ rows: [] as EpisodeRow[] }));
  if (!rows.length) return [];
  const limit = opts.limit ?? RECALL_IN_PROMPT;
  const model = embedModel(env);
  const about = opts.about?.trim() ?? "";
  const worth = rows.length > limit && about.length >= 3 && rows.some((r) => r.embedding?.length && r.embed_model === model);
  const query = worth
    ? await (opts.queryVector ?? (async (t: string) => (memoryEmbedOn(env) ? ((r) => (r.ok ? r.vec : null))(await embed(db, t.slice(0, 600), { env, timeoutMs: 1200, pool: "memory", task: "RETRIEVAL_QUERY" })) : null)))(about).catch(() => null)
    : null;
  return rankEpisodes(rows, { now: opts.now, query, model, aboutId: opts.aboutId }).slice(0, limit).map((r) => r.text);
}

/** The rows of one source, newest first (the lessons writer's talks with its maker). */
export async function episodesOf(db: Db, characterId: string, source: EpisodeSource, limit = 3): Promise<string[]> {
  const { rows } = await db
    .query<{ text: string }>(`select text from character_episodes where character_id = $1 and room = 'sfw' and source = $2 order by created_at desc limit $3`, [characterId, source, limit])
    .catch(() => ({ rows: [] as { text: string }[] }));
  return rows.map((r) => r.text);
}

/** Embeds up to `limit` of a character's rows that have no embedding from the current model. Best-effort. */
export async function embedEpisodes(db: Db, characterId: string, limit = 8, deps: { env?: Env; vector?: (text: string) => Promise<number[] | null> } = {}): Promise<number> {
  const env = deps.env ?? process.env;
  if (!episodesOn(env) || (!deps.vector && !memoryEmbedOn(env))) return 0;
  const model = embedModel(env);
  const vector =
    deps.vector ??
    (async (text: string) => {
      const r = await embed(db, text, { env, pool: "memory", task: "RETRIEVAL_DOCUMENT" });
      return r.ok ? r.vec : null;
    });
  const { rows } = await db
    .query<{ id: string; text: string }>(
      `select id, text from character_episodes where character_id = $1 and room = 'sfw' and folded_into is null and (embedding is null or embed_model is distinct from $2) order by created_at desc limit $3`,
      [characterId, model, limit],
    )
    .catch(() => ({ rows: [] as { id: string; text: string }[] }));
  let n = 0;
  for (const r of rows) {
    const vec = await vector(r.text).catch(() => null);
    if (!vec) break;
    await db.query(`update character_episodes set embedding = $2::jsonb, embed_model = $3 where id = $1`, [r.id, JSON.stringify(vec), model]);
    n++;
  }
  return n;
}

/* ---------------------------------------------- consolidation ---------------------------------------------- */

const FOLD_PROMPT = (name: string) =>
  `You keep the long-term memory of ${name}, a character on a dating show. Below are some of ${name}'s older memories, oldest first. ` +
  `Write them as one short chapter of ${name}'s own story, in the second person ("You met…", "You learned…"), under 90 words: who mattered, what happened, what changed in you. ` +
  `Keep names and the details that would matter later; drop the rest. Nothing explicit, nothing sexual. Answer only JSON: {"chapter":"..."}.`;

/** The chapter when the model can't write one: the memories themselves, joined and cut to fit. */
export function templateChapter(texts: readonly string[]): string {
  return tidy(texts.join(" "));
}

/**
 * Folds one character's oldest live rows into a chapter when it has more than EPISODES_LIVE: at most FOLD_BATCH rows at
 * least FOLD_MIN_AGE_DAYS old. Returns how many rows it folded (0 when nothing was due).
 */
export async function foldCharacter(db: Db, characterId: string, model: Model | null, now: Date = new Date()): Promise<number> {
  const { rows: live } = await db.query<{ n: number }>(`select count(*)::int as n from character_episodes where character_id = $1 and room = 'sfw' and folded_into is null and source <> 'chapter'`, [characterId]);
  const over = (live[0]?.n ?? 0) - EPISODES_LIVE;
  if (over <= 0) return 0;
  const { rows } = await db.query<{ id: string; text: string; visibility: EpisodeVisibility }>(
    `select id, text, visibility from character_episodes
      where character_id = $1 and room = 'sfw' and folded_into is null and source <> 'chapter' and created_at < $2
      order by created_at asc limit $3`,
    [characterId, new Date(now.getTime() - FOLD_MIN_AGE_DAYS * DAY_MS).toISOString(), Math.min(FOLD_BATCH, Math.max(over, 2))],
  );
  if (rows.length < 2) return 0;
  const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [characterId])).rows[0]?.name ?? "the character";
  let chapter: string | null = null;
  if (model) {
    try {
      const raw = await model.complete(
        [
          { role: "system", content: FOLD_PROMPT(name) },
          { role: "user", content: rows.map((r) => `- ${r.text}`).join("\n") },
        ],
        { temperature: 0.4, maxTokens: 400 },
      );
      const m = raw.match(/\{[\s\S]*\}/);
      const text = m ? (JSON.parse(m[0]) as { chapter?: unknown }).chapter : null;
      if (typeof text === "string" && tidy(text).length >= 20 && checkShowText({ text: tidy(text) }).ok) chapter = tidy(text);
    } catch {
      chapter = null;
    }
  }
  chapter ??= templateChapter(rows.map((r) => r.text));
  if (!checkShowText({ text: chapter }).ok) return 0;
  // The chapter is as private as the most private thing in it.
  const visibility: EpisodeVisibility = rows.some((r) => r.visibility === "self") ? "self" : rows.some((r) => r.visibility === "owner") ? "owner" : "public";
  const id = randomUUID();
  await db.query(
    `insert into character_episodes (id, character_id, room, source, source_ref, visibility, text, importance, folded_from, created_at)
     values ($1, $2, 'sfw', 'chapter', $1, $3, $4, 4, $5::jsonb, $6)`,
    [id, characterId, visibility, chapter, JSON.stringify(rows.map((r) => r.id)), now.toISOString()],
  );
  await db.query(`update character_episodes set folded_into = $2 where id = any($1::text[])`, [rows.map((r) => r.id), id]);
  return rows.length;
}

/** The daily job's part: the characters with the most live rows past EPISODES_LIVE, FOLDS_PER_DAY at most, until `deadline`. */
export async function consolidateMemories(db: Db, model: Model | null, now: Date = new Date(), opts: { deadline?: number } = {}): Promise<{ characters: number; folded: number }> {
  if (!episodesOn()) return { characters: 0, folded: 0 };
  const { rows } = await db.query<{ character_id: string }>(
    `select character_id from character_episodes where room = 'sfw' and folded_into is null and source <> 'chapter'
      group by character_id having count(*) > $1 order by count(*) desc limit $2`,
    [EPISODES_LIVE, FOLDS_PER_DAY],
  );
  let characters = 0;
  let folded = 0;
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const n = await foldCharacter(db, r.character_id, model, now).catch(() => 0);
    if (n) {
      characters++;
      folded += n;
    }
  }
  return { characters, folded };
}
