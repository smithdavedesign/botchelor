import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { addDays, dayDiff, isDay, isoDay } from "@/lib/chart";
import { getDb } from "@/lib/db";
import { loadEngagement, type EngagementQuery } from "@/lib/engagement";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_DAYS = 365;

/**
 * Owner-only: the site's engagement for the analytics page's Engagement tab (lib/engagement.ts). ?from= and ?to= are
 * UTC days (the last 30 by default, at most a year); ?include_ours=1 counts our own browsers too; ?host= is show,
 * after_dark or all. The admin password (x-frontier-key) or a signed-in admin account.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const p = new URL(req.url).searchParams;
  const today = isoDay(new Date());
  let to = isDay(p.get("to")) && p.get("to")! <= today ? p.get("to")! : today;
  let from = isDay(p.get("from")) ? p.get("from")! : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (dayDiff(from, to) + 1 > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  const host = p.get("host");
  const q: EngagementQuery = {
    from,
    to,
    includeOurs: p.get("include_ours") === "1",
    host: host === "show" || host === "after_dark" ? host : "all",
  };
  return json(await loadEngagement(await getDb(), q));
});
