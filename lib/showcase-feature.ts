/**
 * The gallery's "Now showing" (app/showcase/ShowcaseFeature.tsx; the visual pop audit's pass 3): one clip, large, above
 * /showcase's grid. Picked from the trending order (the most liked this week, then the newest), as everyone signed out
 * sees it, so it's the same for everyone and only ever PG: a date reel when the top few have one, else the top clip.
 */
import type { Db } from "./db";
import { listShowcase, type Filters, type Post, type ShowcaseViewer } from "./showcase";
import { SHOW_HANDLE } from "./showcase-labels";
import { showcasePaths } from "./showcase-paths";

export type FeatureReel = {
  id: string;
  /** Where its file is (Post.media, else the show's media route). */
  src: string;
  /** Its still, when it has one (the tile-sized copy): the first paint. */
  poster: string | null;
  /** "9:16", "3:4" … as the post was made. */
  aspect: string;
  names: string;
  /** Its character's page (lib/showcase-paths.ts), and the name to meet. */
  character: { name: string; href: string };
  /** Its creator's handle and page, when it isn't the show's own. */
  by: { handle: string; href: string } | null;
  likes: number;
  /** The reels, opened at this one, with the same order it was picked in. */
  reelsHref: string;
  /** "Also showing": the next few PG clips in the same order that have a still, each opening the reels at itself. */
  also: { id: string; poster: string; names: string; href: string }[];
};

/** Everyone signed out: PG only (lib/showcase.ts showcaseViewer gives the same to a stranger). */
const STRANGER: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };
/** How far down the trending order a date reel may come from before the top clip wins. */
const LOOK = 8;
/** How many clips "Also showing" lists. */
const ALSO = 4;

/**
 * Whether the gallery opened as it is, with nothing filtered, on its first page: where "Now showing" goes. parseFilters
 * always sets `page` (1 when none is asked for), so the page is checked by its number and every other filter by being
 * unset.
 */
export function isUnfiltered(f: Filters): boolean {
  return (f.page ?? 1) === 1 && Object.entries(f).every(([k, v]) => k === "page" || v === undefined || v === false);
}

/** The clip to feature from a trending page (pure): PG videos only, a reel first, else the first. */
export function pickFeature(posts: readonly Post[]): Post | null {
  const clips = posts.slice(0, LOOK).filter((p) => p.rating === "pg" && p.mime.startsWith("video/"));
  return clips.find((p) => p.medium === "reel") ?? clips[0] ?? null;
}

const srcOf = (p: Post) => p.media ?? `/api/showcase/${p.id}/media`;
const tileOf = (src: string) => `${src}${src.includes("?") ? "&" : "?"}size=tile`;
const namesOf = (p: Post) => (p.partner ? `${p.character.name} × ${p.partner.name}` : p.character.name);
const reelsAt = (id: string) => `${showcasePaths("show").reels}?start=${encodeURIComponent(id)}&sort=trending&medium=video`;

/** A picked post as the feature shows it, and the rest of its page for "Also showing" (pure). */
export function featureReel(p: Post, rest: readonly Post[] = []): FeatureReel {
  const paths = showcasePaths("show");
  const src = srcOf(p);
  return {
    id: p.id,
    src,
    poster: p.poster ? tileOf(src) : null,
    aspect: p.aspect && /^\d+:\d+$/.test(p.aspect) ? p.aspect : "3:4",
    names: namesOf(p),
    character: { name: p.character.name, href: paths.character(p.character.id) },
    by: p.creator.handle !== SHOW_HANDLE ? { handle: p.creator.handle, href: paths.creator(p.creator.handle) } : null,
    likes: p.likes,
    reelsHref: reelsAt(p.id),
    also: rest
      .filter((x) => x.id !== p.id && x.rating === "pg" && x.mime.startsWith("video/") && x.poster)
      .slice(0, ALSO)
      .map((x) => ({ id: x.id, poster: tileOf(srcOf(x)), names: namesOf(x), href: reelsAt(x.id) })),
  };
}

/** The feature for /showcase, or null when there's no PG clip to show. Never throws. */
export async function showcaseFeature(db: Db): Promise<FeatureReel | null> {
  try {
    const { posts } = await listShowcase(db, STRANGER, { sort: "trending", medium: "video", side: "pg" }, { pageSize: LOOK });
    const p = pickFeature(posts);
    return p ? featureReel(p, posts) : null;
  } catch {
    return null;
  }
}
