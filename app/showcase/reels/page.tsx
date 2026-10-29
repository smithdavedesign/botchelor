import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { afterDarkCounts, listShowcase, parseFilters, sideOf } from "@/lib/showcase";
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

/** The showcase as reels (ReelFeed.tsx): the same posts and filters as /showcase, most liked this week first. */
export default async function ReelsPage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  const sp = await searchParams;
  const f = parseFilters(sp);
  const first = await listShowcase(db, viewer, { sort: "trending", ...f, page: 1 }, { pageSize: REEL_PAGE });
  const locked = await afterDarkCounts(db, viewer, first.posts.flatMap((p) => [p.character.id, ...(p.partner ? [p.partner.id] : [])]));
  // The filters as asked (never the page or where to start), for the next pages and the way back.
  const query = reelsQuery(sp).slice(1);
  const start = typeof sp.start === "string" ? sp.start.slice(0, 64) : null;
  return (
    <ReelFeed
      initial={first.posts}
      more={first.more}
      locked={locked}
      query={query}
      side={sideOf(f)}
      explicit={viewer.ratings.includes("nsfw")}
      start={start}
      back={query ? `/showcase?${query}` : "/showcase"}
    />
  );
}
