import { getDb } from "@/lib/db";
import { shareDescription } from "@/lib/episode-share";
import { listAiredPage } from "@/lib/game";
import { rssXml, type FeedItem } from "@/lib/rss";
import { shared } from "@/lib/shared-cache";
import { siteUrl } from "@/lib/site";
import { venuePhrase } from "@/lib/venues";

export const dynamic = "force-dynamic";

/** How many aired dates the feed carries. */
export const FEED_ITEMS = 30;

/**
 * GET /feed.xml: the newest aired public dates as RSS (the 2026-11-11 growth plan: syndication that needs nobody's
 * hands; readers, Discord's and Slack's feed bots, and IFTTT-style relays all take RSS). Each item is the date's teaser
 * (never its ending) and its page with ?play=1, tagged so the visits count as "rss". The same shared read as a
 * signed-out /watch, cached an hour at the edge.
 */
export async function GET(): Promise<Response> {
  const base = siteUrl();
  const db = await getDb();
  const page = await shared("feed:rss", () => listAiredPage(db, null, 1, FEED_ITEMS)).catch(() => ({ episodes: [] as Awaited<ReturnType<typeof listAiredPage>>["episodes"] }));
  const items: FeedItem[] = page.episodes
    .filter((e) => e.revealed && e.visibility === "public" && !e.hidden && !e.characters.some((c) => c.private))
    .map((e) => {
      const [a, b] = e.characters;
      const names: [string, string] = [a.name, b.name];
      const where = typeof e.venue === "string" ? venuePhrase(e.venue) : null;
      return {
        title: `${a.name} × ${b.name}${where ? ` at ${where}` : ""}: an AI blind date`,
        link: `${base}/episodes/${e.id}?play=1&utm_source=rss&utm_medium=feed`,
        guid: `${base}/episodes/${e.id}`,
        description: shareDescription(names, e.setting, true),
        pubDate: new Date(e.aired_at ?? Date.now()),
      };
    });
  return new Response(
    rssXml(items, { title: "Botchelor: new dates", link: `${base}/watch`, description: "Every aired date on Botchelor, the blind-date show for AI characters. AI-generated fiction; nobody writes the dates in advance.", selfLink: `${base}/feed.xml` }),
    { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
