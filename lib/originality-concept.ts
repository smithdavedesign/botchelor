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
/**
 * EMBED_API_KEY, else the Google key the show's own model uses (lib/model.ts): GOOGLE_API_KEY, or LLM_API_KEY while it
 * points at Google's endpoint (another provider's key would be refused by Gemini).
 */
const EMBED_KEY = (env: Env): string =>
  env.EMBED_API_KEY || env.GOOGLE_API_KEY || (!env.LLM_BASE_URL || env.LLM_BASE_URL.startsWith(GEMINI_BASE) ? env.LLM_API_KEY : "") || "";
export const embedModel = (env: Env = process.env): string => env.EMBED_MODEL || DEFAULT_EMBED_MODEL;
/** How alike two characters must read to be called twins. Tunable from the `[embed] twins` log line's top scores. */
export const twinThreshold = (env: Env = process.env): number => Number(env.CONCEPT_TWIN_MIN) || 0.88;

export const conceptEnabled = (env: Env = process.env): boolean => env.ORIGINALITY_CONCEPT === "1" && Boolean(EMBED_KEY(env));

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
}

/**
 * Fetch an embedding; null on failure or with no key, so the caller just falls back. Logs one line per call,
 * `[embed] <status> <model>`, never the key or the text. Gemini's own endpoint by default (it takes the truncated
 * size); EMBED_URL points it at any OpenAI-compatible /embeddings instead.
 */
export async function embed(text: string, env: Env = process.env): Promise<Vec | null> {
  const key = EMBED_KEY(env);
  if (!key) return null;
  const model = embedModel(env);
  const hash = textHash(model, text);
  const hit = recent.get(hash);
  if (hit) return hit;
  try {
    const res = env.EMBED_URL
      ? await fetch(env.EMBED_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, input: text, dimensions: EMBED_DIMS }),
          signal: AbortSignal.timeout(8000),
        })
      : await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:embedContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ content: { parts: [{ text }] }, taskType: "SEMANTIC_SIMILARITY", outputDimensionality: EMBED_DIMS }),
          signal: AbortSignal.timeout(8000),
        });
    console.log(`[embed] ${res.status} ${model}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: Vec }; data?: { embedding?: Vec }[] };
    const v = data.embedding?.values ?? data.data?.[0]?.embedding;
    if (!Array.isArray(v) || !v.length) return null;
    // Six decimals are far below what cosine can tell apart, and keep the cached jsonb compact.
    const vec = v.map((x) => Math.round(x * 1e6) / 1e6);
    recent.set(hash, vec);
    if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
    return vec;
  } catch (err) {
    console.log(`[embed] error ${model} ${err instanceof Error ? err.name : "unknown"}`);
    return null;
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

/**
 * Bring one character's cached embedding up to date: "fresh" when the text and model haven't changed, "made" when it
 * embedded, "failed" when the call didn't come back, "skipped" when off or not a character we compare (house, deleted).
 */
export async function refreshConceptEmbedding(db: Db, characterId: string, env: Env = process.env): Promise<"made" | "fresh" | "failed" | "skipped"> {
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
  const vec = await embed(text, env);
  if (!vec) return "failed";
  await cacheEmbedding(db, characterId, vec, model, hash);
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

/**
 * The daily job's catch-up: characters with no embedding from the current model yet, newest first, at most `limit`
 * (one call each, one at a time). Never the house cast or a deleted account's.
 */
export async function backfillEmbeddings(db: Db, limit = 40, env: Env = process.env): Promise<{ made: number; failed: number }> {
  if (!conceptEnabled(env)) return { made: 0, failed: 0 };
  const { rows } = await db.query<{ id: string }>(
    `select c.id from characters c left join character_embeddings e on e.character_id = c.id
      where not c.is_house and c.owner_id is distinct from $1 and (e.character_id is null or e.model is distinct from $2)
      order by c.created_at desc
      limit $3`,
    [DELETED_OWNER, embedModel(env), limit],
  );
  let made = 0;
  let failed = 0;
  for (const r of rows) {
    const got = await refreshConceptEmbedding(db, r.id, env);
    if (got === "made") made++;
    if (got === "failed") failed++;
  }
  return { made, failed };
}

/** Concept twins of a draft (lib/originality.ts merges them with the word-based ones). Empty while off or on any failure. */
export async function conceptLookalikes(
  db: Db,
  sheet: { bio?: string; traits?: readonly string[]; want?: string; extras?: CharacterExtras | null },
  excludeId: string | null,
): Promise<ConceptTwin[]> {
  if (!conceptEnabled() || !sheet.bio?.trim()) return [];
  const vec = await embed(conceptText({ bio: sheet.bio, traits: sheet.traits ?? [], want: sheet.want ?? "", extras: sheet.extras }));
  return vec ? conceptTwinsOf(db, vec, excludeId) : [];
}

/**
 * The originality check (lib/originality.ts) with twins by meaning weighed in when concept checks are on: what every
 * server caller runs (the route, MCP create_character and check_originality). Server-only, like this whole module.
 */
export function originalityWithConcepts(db: Db, sheet: SheetDraft, excludeId: string | null = null): Promise<OriginalityReport> {
  const twins = conceptLookalikes(db, sheet, excludeId).then((list) => list.map((c): Lookalike => ({ id: c.id, name: c.name, kind: "concept", why: c.why })));
  return originality(db, sheet, excludeId, twins);
}
