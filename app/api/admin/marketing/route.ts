import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { cleanFeed, loadFeed, saveFeed } from "@/lib/public-marketing";

export const dynamic = "force-dynamic";

/** The marketing log as last sent (admin only; the public page is /marketing). */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json({ feed: await loadFeed(await getDb()) });
});

/**
 * The marketing loop sends its whole log after each run (idea-factory lib/market-sync.js): channels, posts, spend. It
 * replaces the last one. Everything here is shown on the public /marketing page, so cleanFeed keeps only the known
 * fields and takes out any email address. The admin password (x-frontier-key) or a signed-in admin account.
 */
export const POST = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const feed = cleanFeed(await req.json().catch(() => null));
  if (!feed) return json({ error: "bad_feed", message: "Send {channels: [...], posts: [...], spend?: [...]}." }, 400);
  await saveFeed(await getDb(), feed);
  return json({ ok: true, channels: feed.channels.length, posts: feed.posts.length, spend: feed.spend.length });
});
