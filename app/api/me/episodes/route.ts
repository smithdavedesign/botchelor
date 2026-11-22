import { needsSignIn } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMyEpisodeCards, MY_DATES_PAGE_SIZE, type DateVisibility } from "@/lib/game";
import { authFromRequest, handle, json } from "@/lib/http";

const VISIBILITIES: readonly DateVisibility[] = ["public", "private", "unlisted"];

/**
 * The current session's own dates (every visibility — this is the owner's private view), for /account: one page at a
 * time (`?page=N`, 10 a page), optionally one visibility (`?visibility=public|private|unlisted`). None for an account's id
 * without its sign-in (lib/auth needsSignIn).
 */
export const GET = handle(async (req) => {
  const auth = authFromRequest(req);
  const url = new URL(req.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const v = url.searchParams.get("visibility");
  const visibility = VISIBILITIES.includes(v as DateVisibility) ? (v as DateVisibility) : null;
  const none = () => json({ episodes: [], page, pages: 1, total: 0, per_page: MY_DATES_PAGE_SIZE, counts: { public: 0, private: 0, unlisted: 0 } });
  if (!auth) return none();
  const db = await getDb();
  if (await needsSignIn(db, auth)) return none();
  return json(await listMyEpisodeCards(db, auth.userId, { page, visibility }));
});
