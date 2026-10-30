import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { afterDarkCounts, listShowcase, parseFilters, seenFilters, showcaseViewer } from "@/lib/showcase";
import { REEL_PAGE } from "@/app/showcase/reels/reel-shared";

export const dynamic = "force-dynamic";

/** The next page of the reels (app/showcase/reels): the showcase's posts, most liked this week first, and the After Dark counts. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const v = await showcaseViewer(db, req);
  const f = seenFilters(v, parseFilters(new URL(req.url).searchParams));
  // Most liked this week first unless asked otherwise (parseFilters leaves `sort` undefined, so it can't be spread over).
  const r = await listShowcase(db, v, { ...f, sort: f.sort ?? "trending" }, { pageSize: REEL_PAGE, mix: true });
  const locked = await afterDarkCounts(db, v, r.posts.flatMap((p) => [p.character.id, ...(p.partner ? [p.partner.id] : [])]));
  return json({ ...r, locked });
});
