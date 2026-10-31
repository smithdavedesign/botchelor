/**
 * Originality by concept: find look-alike characters by what they MEAN, not just the words they use.
 *
 * The existing `lib/originality.ts` compares words. Visitors noticed in the 2026-10-21 run that it misses
 * concept twins: "the last four pipe organs in the county" and "a church organ tuner" are the same character
 * in different words. This file adds a cheap embedding-based pass that catches concept twins when embeddings
 * are available, and falls back to the word-based pass otherwise.
 *
 * Cost: one embedding per character (bio + traits + want + kind, under 200 tokens), cached in
 * `character_embeddings` with the model and a hash of the text, so an unchanged character never re-embeds. A check
 * embeds the draft once (a small in-process cache absorbs repeats) and cosine-matches it against the cached rows.
 *
 * On when `ORIGINALITY_CONCEPT=1` and a key is set (data plan Tier 2, David 2026-10-22: wired and enabled). Fail-closed:
 * no embedding, no concept check, the same output as the word-based pass alone. Only public characters of live
 * accounts are ever compared, so a twin note can't name a private character or a deleted account's.
 *
 * Limits (the 2026-10-22 review of the data plan, on #678):
 *  - every call claims one of today's `EMBED_DAILY_CAP` (2000 a UTC day by default), whoever asks: the web review panel,
 *    MCP create_character and check_originality, a save, the daily backfill. Past it the concept pass is skipped and the
 *    word-based check still runs;
 *  - an interactive check waits `EMBED_CHECK_TIMEOUT_MS` (2.5 s) at most, then falls back to the word-based twins; a
 *    save's after-response embed and the backfill wait 8 s, and the backfill stops at the daily job's deadline;
 *  - the draft route is limited per connection and per session too (lib/limits.ts ORIGINALITY_CHECK_LIMITS).
 */

import { createHash } from "node:crypto";
import type { Db } from "./db";
import type { CharacterExtras } from "./extras";
import { kindLabel } from "./kinds";
import { originality, type Lookalike, type OriginalityReport, type SheetDraft } from "./originality";
import { DELETED_OWNER } from "./rules";

type Vec = number[];
type Env = Record<string, string | undefined>;

/** Google's current embedding model (it replaces text-embedding-004, which Google is retiring). EMBED_MODEL overrides it. */
export const DEFAULT_EMBED_MODEL = "gemini-embedding-001";
/** Truncated output: a quarter of the model's 3072 dimensions keeps each cached row small (~8 KB) and costs little recall. */
export const EMBED_DIMS = 768;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** The environment variable the key came from: its name only, for the logs (never the value). */
export type EmbedKeySource = "EMBED_API_KEY" | "GOOGLE_API_KEY" | "LLM_API_KEY";

/**
 * The embedding key, first one set wins (BUILD.md):
 *  1. `EMBED_API_KEY`: a key of its own, with a spend cap at the provider. Set this one: without it, embeddings share
 *     the live show's quota (one shared quota is what took the show down during an eval run);
 *  2. `GOOGLE_API_KEY`: the Google key the show's own model uses (lib/model.ts);
 *  3. `LLM_API_KEY`, only while `LLM_BASE_URL` points at Google's endpoint (another provider's key would be refused).
 */
export function embedKey(env: Env = process.env): { key: string; from: EmbedKeySource | null } {
  if (env.EMBED_API_KEY) return { key: env.EMBED_API_KEY, from: "EMBED_API_KEY" };
  if (env.GOOGLE_API_KEY) return { key: env.GOOGLE_API_KEY, from: "GOOGLE_API_KEY" };
  if (env.LLM_API_KEY && (!env.LLM_BASE_URL || env.LLM_BASE_URL.startsWith(GEMINI_BASE))) return { key: env.LLM_API_KEY, from: "LLM_API_KEY" };
  return { key: "", from: null };
}
/** Which variable this process's calls use, logged once (and again only if it changes), so the prod logs show it. */
let keyLogged: EmbedKeySource | null = null;
function logKeySource(from: EmbedKeySource): void {
  if (keyLogged === from) return;
  keyLogged = from;
  console.log(`[embed] key from ${from}${from === "EMBED_API_KEY" ? "" : " (the show's own key: set EMBED_API_KEY, capped at the provider)"}`);
}
export const embedModel = (env: Env = process.env): string => env.EMBED_MODEL || DEFAULT_EMBED_MODEL;
/** How alike two characters must read to be called twins. Tunable from the `[embed] twins` log line's top scores. */
export const twinThreshold = (env: Env = process.env): number => Number(env.CONCEPT_TWIN_MIN) || 0.88;

export const conceptEnabled = (env: Env = process.env): boolean => env.ORIGINALITY_CONCEPT === "1" && Boolean(embedKey(env).key);

/** A whole number of at least 0 from `raw`, else `fallback`. */
const wholeNumber = (raw: string | undefined, fallback: number): number => {
  const n = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Concept-embedding calls a UTC day, all callers together, unless `EMBED_DAILY_CAP` says otherwise (0 turns them off). */
export const DEFAULT_EMBED_DAILY_CAP = 2000;
export const embedDailyCap = (env: Env = process.env): number => wholeNumber(env.EMBED_DAILY_CAP, DEFAULT_EMBED_DAILY_CAP);

/**
 * How long one call may take. An interactive check (the review panel, MCP create_character and check_originality) waits
 * briefly, then falls back to the word-based twins; a save's after-response embed and the daily backfill can wait.
 */
export const EMBED_CHECK_TIMEOUT_MS = 2500;
export const EMBED_SLOW_TIMEOUT_MS = 8000;
export const checkTimeoutMs = (env: Env = process.env): number => wholeNumber(env.EMBED_CHECK_TIMEOUT_MS, 0) || EMBED_CHECK_TIMEOUT_MS;

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
/** The UTC day this process last found the cap spent: later calls that day don't ask the database again. */
let cappedOn: string | null = null;

/**
 * Takes one of today's embedding calls (UTC day). False once the cap is spent, or when the count can't be kept (an
 * uncounted call could run past the cap, so it isn't made). The first refusal of the day is logged once per process.
 */
async function claimEmbedCall(db: Db, env: Env, now = new Date()): Promise<boolean> {
  const day = utcDay(now);
  if (cappedOn === day) return false;
  const cap = embedDailyCap(env);
  let used = Number.POSITIVE_INFINITY;
  if (cap > 0) {
    try {
      const { rows } = await db.query<{ calls: number }>(
        `insert into embed_usage (day, calls) values ($1, 1)
           on conflict (day) do update set calls = embed_usage.calls + 1
         returning calls`,
        [day],
      );
      used = rows[0]?.calls ?? used;
    } catch {
      return false;
    }
  }
  if (used <= cap) return true;
  cappedOn = day;
  console.log(`[embed] daily cap reached (${cap}): concept checks skipped until 00:00 UTC; the word-based check still runs`);
  return false;
}

/** Concept-embedding calls made (or refused at the cap) today, UTC. */
export async function embedCallsToday(db: Db, now = new Date()): Promise<number> {
  const { rows } = await db.query<{ calls: number }>(`select calls from embed_usage where day = $1`, [utcDay(now)]);
  return rows[0]?.calls ?? 0;
}

/** The text we embed. Short so it's cheap and the embedding stays stable across sheet tweaks. */
export function conceptText(sheet: { bio: string; traits: readonly string[]; want: string; extras?: CharacterExtras | null }): string {
  const traits = sheet.traits.slice(0, 3).join(", ");
  // What they are (lib/kinds.ts) is part of the concept: a vampire sommelier isn't a human one.
  const kind = sheet.extras?.kind && sheet.extras.kind !== "human" ? ` Is: ${kindLabel(sheet.extras)?.replace(/^\S+\s/, "")}.` : "";
  return `${sheet.bio.trim()} Wants: ${sheet.want.trim()}. Traits: ${traits}.${kind}`.slice(0, 1200);
}

/** What a cached embedding was made from: the model and the exact text. A match means there's nothing to redo. */
export const textHash = (model: string, text: string): string => createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 32);

/** Cosine similarity, 0–1. Inputs are expected to be unit-length (Gemini embeddings aren't; we normalise). */
export function cosine(a: Vec, b: Vec): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** The last few embeddings this instance made, by text hash: a draft checked twice costs one call. */
const RECENT_MAX = 64;
const recent = new Map<string, Vec>();
export function clearEmbedCacheForTests(): void {
  recent.clear();
  keyLogged = null;
  cappedOn = null;
}

/** Why an embedding didn't come back. `rate_limited`, `timeout` and `capped` end a backfill batch (pushing on won't help). */
export type EmbedFailure = "no_key" | "capped" | "timeout" | "rate_limited" | "http" | "bad_response" | "error";
export type EmbedResult = { ok: true; vec: Vec } | { ok: false; why: EmbedFailure };

/**
 * Fetch an embedding, or say why there's none, so the caller just falls back. Each call claims one of today's
 * `EMBED_DAILY_CAP` first; a repeat of a recent text is free (the in-process cache answers it). Logs one line per call,
 * `[embed] <status> <model>`, and the name of the variable the key came from once per process; never the key or the
 * text. Gemini's own endpoint by default (it takes the truncated size); EMBED_URL points it at any OpenAI-compatible
 * /embeddings instead. `timeoutMs`: how long to wait (the slow budget unless an interactive caller passes the short one).
 */
export async function embed(db: Db, text: string, opts: { env?: Env; timeoutMs?: number } = {}): Promise<EmbedResult> {
  const env = opts.env ?? process.env;
  const { key, from } = embedKey(env);
  if (!key || !from) return { ok: false, why: "no_key" };
  const model = embedModel(env);
  const hash = textHash(model, text);
  const hit = recent.get(hash);
  if (hit) return { ok: true, vec: hit };
  if (!(await claimEmbedCall(db, env))) return { ok: false, why: "capped" };
  logKeySource(from);
  const signal = AbortSignal.timeout(Math.max(1, Math.floor(opts.timeoutMs ?? EMBED_SLOW_TIMEOUT_MS)));
  try {
    const res = env.EMBED_URL
      ? await fetch(env.EMBED_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, input: text, dimensions: EMBED_DIMS }),
          signal,
        })
      : await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:embedContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ content: { parts: [{ text }] }, taskType: "SEMANTIC_SIMILARITY", outputDimensionality: EMBED_DIMS }),
          signal,
        });
    console.log(`[embed] ${res.status} ${model}`);
    if (res.status === 429) return { ok: false, why: "rate_limited" };
    if (!res.ok) return { ok: false, why: "http" };
    const data = (await res.json()) as { embedding?: { values?: Vec }; data?: { embedding?: Vec }[] };
    const v = data.embedding?.values ?? data.data?.[0]?.embedding;
    if (!Array.isArray(v) || !v.length) return { ok: false, why: "bad_response" };
    // Six decimals are far below what cosine can tell apart, and keep the cached jsonb compact.
    const vec = v.map((x) => Math.round(x * 1e6) / 1e6);
    recent.set(hash, vec);
    if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
    return { ok: true, vec };
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.log(`[embed] error ${model} ${name}`);
    return { ok: false, why: name === "TimeoutError" || (name === "AbortError" && signal.aborted) ? "timeout" : "error" };
  }
}

export type ConceptTwin = { id: string; name: string; similarity: number; why: string };

/**
 * The most similar characters by concept, at or above `threshold`, at most 5. Only public characters of live
 * accounts, never the house cast, and only embeddings from the same model (two models' vectors don't compare).
 */
export async function conceptTwinsOf(
  db: Db,
  needle: Vec,
  excludeId: string | null,
  threshold = twinThreshold(),
  model = embedModel(),
): Promise<ConceptTwin[]> {
  // Fresh characters without a cached embedding aren't considered here — the word-based pass still catches them.
  try {
    const { rows } = await db.query<{ id: string; name: string; embedding: number[] }>(
      `select c.id, c.name, e.embedding
         from character_embeddings e
         join characters c on c.id = e.character_id
        where ($1::text is null or c.id <> $1)
          and not c.is_house and c.visibility = 'public' and c.owner_id is distinct from $2
          and e.model = $3
        order by e.created_at desc
        limit 500`,
      [excludeId, DELETED_OWNER, model],
    );
    const scored = rows.map((r) => ({ id: r.id, name: r.name, similarity: cosine(needle, r.embedding) })).sort((a, b) => b.similarity - a.similarity);
    // The top score of every check, twin or not: what CONCEPT_TWIN_MIN gets tuned from.
    if (scored.length) console.log(`[embed] twins top=${scored[0].similarity.toFixed(3)} of=${scored.length}`);
    return scored
      .filter((x) => x.similarity >= threshold)
      .slice(0, 5)
      .map((x) => ({ ...x, why: `${x.name} is the same idea in other words (${Math.round(x.similarity * 100)}% alike by meaning).` }));
  } catch {
    return [];
  }
}

/** Cache an embedding so future checks are a database read, not an API call. */
export async function cacheEmbedding(db: Db, characterId: string, vec: Vec, model = embedModel(), hash: string | null = null): Promise<void> {
  try {
    await db.query(
      `insert into character_embeddings (character_id, embedding, model, text_hash, created_at)
       values ($1, $2::jsonb, $3, $4, now())
       on conflict (character_id) do update set embedding = excluded.embedding, model = excluded.model, text_hash = excluded.text_hash, created_at = now()`,
      [characterId, JSON.stringify(vec), model, hash],
    );
  } catch {
    // Table may not exist in a bare test DB; ignore.
  }
}

type Sheet = { bio: string; traits: readonly string[]; want: string; extras: CharacterExtras | null };

/** What refreshing one character's embedding did. The last three are failures that end a backfill batch. */
export type RefreshResult = "made" | "fresh" | "failed" | "skipped" | "rate_limited" | "timeout" | "capped";

/**
 * Bring one character's cached embedding up to date: "fresh" when the text and model haven't changed, "made" when it
 * embedded, "skipped" when off or not a character we compare (house, deleted). A call that didn't come back is
 * "rate_limited" (a 429), "timeout", "capped" (today's EMBED_DAILY_CAP is spent; no call was made) or "failed".
 */
export async function refreshConceptEmbedding(db: Db, characterId: string, env: Env = process.env, opts: { timeoutMs?: number } = {}): Promise<RefreshResult> {
  if (!conceptEnabled(env)) return "skipped";
  const row = (
    await db.query<Sheet & { text_hash: string | null }>(
      `select c.bio, c.traits, c.want, c.extras, e.text_hash
         from characters c left join character_embeddings e on e.character_id = c.id
        where c.id = $1 and not c.is_house and c.owner_id is distinct from $2`,
      [characterId, DELETED_OWNER],
    )
  ).rows[0];
  if (!row) return "skipped";
  const model = embedModel(env);
  const text = conceptText(row);
  const hash = textHash(model, text);
  if (row.text_hash === hash) return "fresh";
  const got = await embed(db, text, { env, timeoutMs: opts.timeoutMs });
  if (!got.ok) return got.why === "rate_limited" || got.why === "timeout" || got.why === "capped" ? got.why : "failed";
  await cacheEmbedding(db, characterId, got.vec, model, hash);
  return "made";
}

/**
 * Re-embed a character after the response (the after() pattern of lib/swipes.ts scheduleMatchChat), so a save never
 * waits on the embedding API. Inline in tests and outside a request. A no-op while concept checks are off.
 */
export async function scheduleConceptEmbedding(db: Db, characterId: string): Promise<void> {
  if (!conceptEnabled()) return;
  const run = () =>
    refreshConceptEmbedding(db, characterId)
      .then(() => undefined)
      .catch((err) => console.error("[embed] refresh failed", err instanceof Error ? err.message : err));
  const { inlineGenerationEnabled } = await import("./jobs");
  if (inlineGenerationEnabled()) return run();
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}

/** Below this much time before its deadline, the backfill makes no more calls (one could only time out). */
export const BACKFILL_MIN_CALL_MS = 1000;

/**
 * What one backfill run did. `skipped`: characters it didn't get to; `stopped` says why it ended early: "deadline" (out
 * of time), "rate_limited" or "timeout" (the first one ends the batch: the next run picks up there), or "capped" (today's
 * EMBED_DAILY_CAP is spent). `key_from`: which variable the key comes from (its name only).
 */
export type EmbeddingBackfill = {
  made: number;
  failed: number;
  skipped: number;
  stopped: "deadline" | "rate_limited" | "timeout" | "capped" | null;
  key_from: EmbedKeySource | null;
};

/**
 * The daily job's catch-up: characters with no embedding from the current model yet, newest first, at most `limit`
 * (one call each, one at a time). Never the house cast or a deleted account's. Each call waits at most the slow budget
 * and never past `deadline` (epoch ms, the daily job's own: it must leave time for the job's report); the first 429 or
 * timeout ends the batch.
 */
export async function backfillEmbeddings(
  db: Db,
  opts: { limit?: number; deadline?: number; env?: Env; now?: () => number } = {},
): Promise<EmbeddingBackfill> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const out: EmbeddingBackfill = { made: 0, failed: 0, skipped: 0, stopped: null, key_from: embedKey(env).from };
  if (!conceptEnabled(env)) return out;
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c left join character_embeddings e on e.character_id = c.id
      where not c.is_house and c.owner_id is distinct from $1 and (e.character_id is null or e.model is distinct from $2)
      order by c.created_at desc
      limit $3`,
    [DELETED_OWNER, embedModel(env), Math.max(0, Math.floor(opts.limit ?? 40))],
  );
  for (let i = 0; i < rows.length; i++) {
    const left = deadline - now();
    if (left < BACKFILL_MIN_CALL_MS) {
      out.stopped = "deadline";
      out.skipped = rows.length - i;
      break;
    }
    const got = await refreshConceptEmbedding(db, rows[i].id, env, { timeoutMs: Math.min(EMBED_SLOW_TIMEOUT_MS, left) });
    if (got === "made") out.made++;
    else if (got === "failed") out.failed++;
    else if (got === "rate_limited" || got === "timeout" || got === "capped") {
      // A capped call was never made: it's skipped, not failed.
      if (got !== "capped") out.failed++;
      out.stopped = got;
      out.skipped = rows.length - i - (got === "capped" ? 0 : 1);
      break;
    }
  }
  if (out.stopped) console.log(`[embed] backfill stopped (${out.stopped}): made=${out.made} failed=${out.failed} skipped=${out.skipped}`);
  return out;
}

/**
 * Concept twins of a draft (lib/originality.ts merges them with the word-based ones). Empty while off or on any failure.
 * Interactive, so the call waits `EMBED_CHECK_TIMEOUT_MS` at most: a slow one falls back to the word-based twins and
 * says so in the logs.
 */
export async function conceptLookalikes(
  db: Db,
  sheet: { bio?: string; traits?: readonly string[]; want?: string; extras?: CharacterExtras | null },
  excludeId: string | null,
): Promise<ConceptTwin[]> {
  if (!conceptEnabled() || !sheet.bio?.trim()) return [];
  const timeoutMs = checkTimeoutMs();
  const got = await embed(db, conceptText({ bio: sheet.bio, traits: sheet.traits ?? [], want: sheet.want ?? "", extras: sheet.extras }), { timeoutMs });
  if (got.ok) return conceptTwinsOf(db, got.vec, excludeId);
  if (got.why === "timeout") console.log(`[embed] check slower than ${timeoutMs}ms: word-based twins only`);
  return [];
}

/**
 * The originality check (lib/originality.ts) with twins by meaning weighed in when concept checks are on: what every
 * server caller runs (the route, MCP create_character and check_originality). Server-only, like this whole module.
 */
export function originalityWithConcepts(db: Db, sheet: SheetDraft, excludeId: string | null = null, by: string | null = null): Promise<OriginalityReport> {
  const twins = conceptLookalikes(db, sheet, excludeId).then((list) => list.map((c): Lookalike => ({ id: c.id, name: c.name, kind: "concept", why: c.why })));
  return originality(db, sheet, excludeId, twins, by);
}
