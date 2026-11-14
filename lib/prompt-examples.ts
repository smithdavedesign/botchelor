import { getDb, type Db } from "./db";
import { tagPrompt } from "./prompt-library-rules";
import { mediaHref } from "./showcase";

/**
 * Example pictures for the prompts library's tags, from pictures the show has already made and published: the PG
 * Studio's pictures that creators put on the showcase (live, PG, a public character, a creator who isn't hidden). Each
 * picture's own prompt is tagged by the library's word rules (lib/prompt-library-rules.ts tagPrompt), so a tag's examples
 * are pictures whose prompt carries that tag. Nothing is generated and nothing is spent (2026-11-13 design review: "no
 * example picture anywhere"; the prompt records carry none).
 */
export type PromptExample = { post_id: string; href: string; src: string; character: string; alt: string };

/** How many of the newest showcase pictures one scan reads, how many a tag shows, and how long a scan is kept. */
export const EXAMPLES_SCAN = 400;
export const EXAMPLES_PER_TAG = 4;
const TTL_MS = 10 * 60 * 1000;

type Row = { id: string; source: "pg" | "after_dark"; rating: "pg" | "suggestive" | "nsfw"; name: string; prompt: string };

let cache: { at: number; byTag: Map<string, PromptExample[]> } | null = null;

/** Every tag's examples from one scan of the showcase, kept for ten minutes (one read serves every tag page). */
export async function promptExamples(db: Db): Promise<Map<string, PromptExample[]>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byTag;
  const { rows } = await db.query<Row>(
    `select p.id, p.source, p.rating, c.name, g.prompt
       from showcase_posts p
       join creator_profiles cp on cp.user_id = p.owner_id
       join characters c on c.id = p.character_id
       join studio_pg_pictures g on g.id = p.media_id
      where p.source = 'pg' and p.status = 'live' and not p.held and p.rating = 'pg' and p.medium = 'picture'
        and g.content_rating = 'pg' and g.prompt is not null and not cp.hidden and c.visibility = 'public'
      order by p.published_at desc nulls last, p.id
      limit $1`,
    [EXAMPLES_SCAN],
  );
  const byTag = new Map<string, PromptExample[]>();
  for (const r of rows) {
    for (const tag of tagPrompt(r.prompt)) {
      const list = byTag.get(tag) ?? [];
      if (list.length >= EXAMPLES_PER_TAG) continue;
      list.push({
        post_id: r.id,
        href: `/showcase/reels?start=${encodeURIComponent(r.id)}`,
        src: mediaHref({ id: r.id, source: r.source, rating: r.rating }, "tile"),
        character: r.name,
        alt: `${r.name}, a picture made in the Studio`,
      });
      byTag.set(tag, list);
    }
  }
  cache = { at: Date.now(), byTag };
  return byTag;
}

/** One tag's examples, newest first; empty when there are none or the database can't be read (a build, an outage). */
export async function examplesForTag(db: Db, tagId: string): Promise<PromptExample[]> {
  try {
    return (await promptExamples(db)).get(tagId) ?? [];
  } catch {
    return [];
  }
}

/** For a page: one tag's examples from the app's database, or nothing when it can't be reached (a build, an outage). */
export async function examplesFor(tagId: string): Promise<PromptExample[]> {
  try {
    return await examplesForTag(await getDb(), tagId);
  } catch {
    return [];
  }
}

export function resetPromptExamplesForTests(): void {
  cache = null;
}
