/**
 * Originality by concept: find look-alike characters by what they MEAN, not just the words they use.
 *
 * The existing `lib/originality.ts` compares words. Visitors noticed in the 2026-10-21 run that it misses
 * concept twins: "the last four pipe organs in the county" and "a church organ tuner" are the same character
 * in different words. This file adds a cheap embedding-based pass that catches concept twins when embeddings
 * are available, and falls back to the word-based pass otherwise.
 *
 * Cost: Gemini's text-embedding free tier is 1500 req/day, 1M tokens/day free. Each check embeds the new
 * character's bio+traits+want (<200 tokens) once, then cosine-matches against the latest N characters' cached
 * embeddings. Cached embeddings never regenerate.
 *
 * This is behind the `ORIGINALITY_CONCEPT=1` env flag until it's measured. Fail-closed: no embedding, no
 * concept check, same output as today.
 */

import type { Db } from "./db";

type Vec = number[];

const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-embedding-004";
const EMBED_URL = process.env.EMBED_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/embeddings";
const EMBED_KEY = (env: Record<string, string | undefined> = process.env) => env.EMBED_API_KEY ?? env.GOOGLE_API_KEY ?? "";

export const conceptEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.ORIGINALITY_CONCEPT === "1" && Boolean(EMBED_KEY(env));

/** The text we embed. Short so it's cheap and the embedding stays stable across sheet tweaks. */
export function conceptText(sheet: { bio: string; traits: readonly string[]; want: string }): string {
  const traits = sheet.traits.slice(0, 3).join(", ");
  return `${sheet.bio.trim()} Wants: ${sheet.want.trim()}. Traits: ${traits}.`.slice(0, 1200);
}

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

/** Fetch an embedding; returns null on failure or when disabled, so the caller just falls back. */
export async function embed(text: string): Promise<Vec | null> {
  const key = EMBED_KEY(process.env);
  if (!key) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: Vec }[] };
    const v = data.data?.[0]?.embedding;
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

export type ConceptTwin = { id: string; name: string; similarity: number; why: string };

/** The N most-similar characters by concept, above a threshold. Returns at most 5. */
export async function conceptTwinsOf(
  db: Db,
  needle: Vec,
  excludeId: string | null,
  threshold = 0.82,
): Promise<ConceptTwin[]> {
  // We keep the search cheap: match against embeddings cached in `character_embeddings`.
  // Fresh characters without a cached embedding aren't considered here — the word-based pass still catches them.
  try {
    const { rows } = await db.query<{ id: string; name: string; embedding: number[] }>(
      `select c.id, c.name, e.embedding
         from character_embeddings e
         join characters c on c.id = e.character_id
        where ($1::text is null or c.id <> $1)
          and not c.is_house
        limit 500`,
      [excludeId],
    );
    const scored = rows
      .map((r) => ({ id: r.id, name: r.name, similarity: cosine(needle, r.embedding) }))
      .filter((x) => x.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .map((x) => ({ ...x, why: `reads a lot like this one by concept (${Math.round(x.similarity * 100)}% match)` }));
    return scored;
  } catch {
    return [];
  }
}

/** Cache an embedding so future checks are a database read, not an API call. */
export async function cacheEmbedding(db: Db, characterId: string, vec: Vec): Promise<void> {
  try {
    await db.query(
      `insert into character_embeddings (character_id, embedding, created_at)
       values ($1, $2::jsonb, now())
       on conflict (character_id) do update set embedding = excluded.embedding, created_at = now()`,
      [characterId, JSON.stringify(vec)],
    );
  } catch {
    // Table may not exist in a bare test DB; ignore.
  }
}
