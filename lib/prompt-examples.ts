import { getDb, type Db } from "./db";
import { tagPrompt } from "./prompt-library-rules";
import { tagById } from "./prompts-library";
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

type Row = {
  id: string;
  source: "pg" | "after_dark";
  rating: "pg" | "suggestive" | "nsfw";
  name: string;
  prompt: string;
  /** A PG Studio picture's own tags (lib/studio/pg-catalog.ts pgTagsOf: {kind: group, value: option}). */
  tags: { kind?: string; value?: string }[] | null;
  /** Its shoot's picked options, either Studio's: {group: option | option[]}. */
  choices: Record<string, unknown> | null;
};

/**
 * The tags a Studio picture carries: the options its creator picked (either Studio keeps them as the library's own
 * "<group>.<option>" ids: a PG picture's tags, a shoot's choices), and whatever its prompt's words say.
 */
export function pictureTags(prompt: string, tags: Row["tags"], choices: Row["choices"] = null): string[] {
  const fromTags = (tags ?? []).map((t) => (t.kind && t.value && t.kind !== "made" ? `${t.kind}.${t.value}` : ""));
  const fromChoices = Object.entries(choices ?? {}).flatMap(([group, v]) => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "string" && x ? `${group}.${x}` : "")));
  const picked = [...fromTags, ...fromChoices].filter((id) => id && tagById(id));
  return [...new Set([...picked, ...tagPrompt(prompt)])];
}

let cache: { at: number; byTag: Map<string, PromptExample[]> } | null = null;

/** Every tag's examples from one scan of the showcase, kept for ten minutes (one read serves every tag page). */
export async function promptExamples(db: Db): Promise<Map<string, PromptExample[]>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byTag;
  // The showcase's safe-side pictures: the PG Studio's, and After Dark Studio pictures whose PG twin the showcase already
  // shows visitors (rating pg, the twin's own rating pg). The picked options come from whichever shoot made it (a twin's
  // from the original's shoot).
  const { rows } = await db.query<Row>(
    `select p.id, p.source, p.rating, c.name, coalesce(g.prompt, i.prompt) as prompt, g.tags, coalesce(s.choices, s2.choices) as choices
       from showcase_posts p
       join creator_profiles cp on cp.user_id = p.owner_id
       join characters c on c.id = p.character_id
       left join studio_pg_pictures g on p.source = 'pg' and g.id = p.media_id
       left join studio_pg_shoots s2 on s2.id = g.shoot_id
       left join adult_images i on p.source = 'after_dark' and i.id = p.media_id and i.status = 'ready'
       left join adult_images orig on orig.id = i.twin_of
       left join adult_studio_shoots s on s.id = coalesce(i.shoot_id, orig.shoot_id)
      where p.status = 'live' and not p.held and p.rating = 'pg' and p.medium = 'picture' and not cp.hidden and c.visibility = 'public'
        and ((p.source = 'pg' and g.content_rating = 'pg') or (p.source = 'after_dark' and i.content_rating = 'pg'))
        and coalesce(g.prompt, i.prompt) is not null
      order by p.published_at desc nulls last, p.id
      limit $1`,
    [EXAMPLES_SCAN],
  );
  const candidates = new Map<string, PromptExample[]>();
  for (const r of rows) {
    for (const tag of pictureTags(r.prompt, r.tags, r.choices)) {
      const list = candidates.get(tag) ?? [];
      list.push({
        post_id: r.id,
        href: `/showcase/reels?start=${encodeURIComponent(r.id)}`,
        src: mediaHref({ id: r.id, source: r.source, rating: r.rating }, "tile"),
        character: r.name,
        alt: `${r.name}, a picture made in the Studio`,
      });
      candidates.set(tag, list);
    }
  }
  const byTag = new Map([...candidates].map(([tag, list]) => [tag, pickVaried(list, EXAMPLES_PER_TAG)]));
  cache = { at: Date.now(), byTag };
  return byTag;
}

/**
 * Up to `n` of a tag's candidates (newest first): one of each character before a second of any, so four pictures of
 * one shoot don't fill the strip when others exist; the order within is kept. Pure, so it's tested on its own.
 */
export function pickVaried(candidates: readonly PromptExample[], n: number): PromptExample[] {
  const seen = new Set<string>();
  const first = candidates.filter((c) => (seen.has(c.character) ? false : (seen.add(c.character), true)));
  const picked = first.slice(0, n);
  if (picked.length < n) {
    const chosen = new Set(picked.map((c) => c.post_id));
    for (const c of candidates) {
      if (picked.length >= n) break;
      if (!chosen.has(c.post_id)) picked.push(c);
    }
    picked.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  }
  return picked;
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
