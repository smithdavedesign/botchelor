import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { afterDarkCounts, listShowcase, parseFilters, seenFilters, sideOf } from "@/lib/showcase";
import { pageViewer } from "../viewer";
import ReelFeed from "./ReelFeed";
import { REEL_PAGE, reelsQuery } from "./reel-shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reels · Botchelor showcase",
  description: "The showcase one picture or clip at a time: swipe through original characters, then take one on a date.",
  // The showcase itself is the page to find; these are the same posts, one a screen.
  alternates: { canonical: "/showcase" },
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The showcase as reels (ReelFeed.tsx): the same posts and filters as /showcase, most liked this week first, what they've seen last. */
export default async function ReelsPage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  const sp = await searchParams;
  const f = seenFilters(viewer, parseFilters(sp));
  // What this browser has seen goes last: a reload or a return starts on what's new to them, its pages as of now.
  const asOf = new Date();
  const first = await listShowcase(db, viewer, { ...f, sort: f.sort ?? "trending", page: 1 }, { pageSize: REEL_PAGE, mix: true, seenBefore: asOf });
  const locked = await afterDarkCounts(db, viewer, first.posts.flatMap((p) => [p.character.id, ...(p.partner ? [p.partner.id] : [])]));
  // The filters as asked (never the page or where to start), for the next pages and the way back; After Dark's side
  // only when it's theirs to see.
  const query = reelsQuery(f.side ? sp : { ...sp, side: undefined }).slice(1);
  const start = typeof sp.start === "string" ? sp.start.slice(0, 64) : null;
  return (
    // Each set of filters is a new feed: Next keeps a page's client component when only its query changes, and the
    // feed's posts and veil are its own state, so the side tabs and "Safe for work instead" would change nothing.
    <ReelFeed
      key={query}
      initial={first.posts}
      more={first.more}
      locked={locked}
      query={query}
      side={sideOf(f)}
      explicit={viewer.ratings.includes("nsfw")}
      start={start}
      asOf={asOf.toISOString()}
      back={query ? `/showcase?${query}` : "/showcase"}
    />
  );
}
