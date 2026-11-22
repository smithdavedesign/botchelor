import type { Db } from "@/lib/db";
import { afterDarkCounts, listShowcase, parseFilters, seenFilters, sideOf, type ShowcaseViewer } from "@/lib/showcase";
import { showcasePaths, type ShowcasePlace } from "@/lib/showcase-paths";
import ReelFeed from "./ReelFeed";
import { REEL_PAGE, reelsQuery } from "./reel-shared";

type Search = Record<string, string | string[] | undefined>;

/**
 * The showcase as reels (ReelFeed.tsx): the same posts and filters as its grid, most liked this week first, what they've
 * seen last. One body for both of its pages, the show's (/showcase/reels) and After Dark's (/after-dark/showcase/reels,
 * 2026-11-18: David, "keep the reel page as is, I like it"), so the two never drift. `place`: whose Gallery the way
 * back leads to (lib/showcase-paths.ts), and on After Dark's, where the feed's links lead. `nights` (After Dark's page):
 * who a night can start with for this viewer, whose button opens their After Dark page.
 */
export async function reelFeed(db: Db, viewer: ShowcaseViewer, sp: Search, place: ShowcasePlace = "show", opts: { nights?: string[] } = {}) {
  const f = seenFilters(viewer, parseFilters(sp));
  // What this browser has seen goes last: a reload or a return starts on what's new to them, its pages as of now.
  const asOf = new Date();
  const start = typeof sp.start === "string" ? sp.start.slice(0, 64) : null;
  const [first, lead] = await Promise.all([
    listShowcase(db, viewer, { ...f, sort: f.sort ?? "trending", page: 1 }, { pageSize: REEL_PAGE, mix: true, seenBefore: asOf }),
    // Opened at a post (the showcase's "Watch full screen from here"): it comes first, wherever this feed's order puts
    // it (David, 2026-11-01: it opened somewhere else; a post they've seen goes last, so it was rarely on the first page).
    start ? listShowcase(db, viewer, { ...f, page: 1 }, { pageSize: 1, only: start }).then((r) => r.posts[0] ?? null) : null,
  ]);
  const initial = lead ? [lead, ...first.posts.filter((p) => p.id !== lead.id)] : first.posts;
  const locked = await afterDarkCounts(db, viewer, initial.flatMap((p) => [p.character.id, ...(p.partner ? [p.partner.id] : [])]));
  // The filters as asked (never the page or where to start), for the next pages and the way back; After Dark's side
  // only when it's theirs to see.
  const query = reelsQuery(f.side ? sp : { ...sp, side: undefined }).slice(1);
  // The way back: on After Dark its own showcase, whose address says the side itself.
  const base = showcasePaths(place).base;
  const backQuery = place === "after_dark" ? reelsQuery({ ...sp, side: undefined }).slice(1) : query;
  return (
    // Each set of filters is a new feed: Next keeps a page's client component when only its query changes, and the
    // feed's posts and veil are its own state, so the side tabs and "Safe for work instead" would change nothing.
    <ReelFeed
      key={query}
      initial={initial}
      more={first.more}
      locked={locked}
      query={query}
      side={sideOf(f)}
      explicit={viewer.ratings.includes("nsfw")}
      start={start}
      asOf={asOf.toISOString()}
      back={backQuery ? `${base}?${backQuery}` : base}
      place={place}
      nights={opts.nights}
    />
  );
}
