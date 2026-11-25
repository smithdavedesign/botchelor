import { getDb } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { recapWeek, weekBest, weekLabel, weekRecapOn, WEEK_DATES } from "@/lib/week-recap";

export const dynamic = "force-dynamic";

/**
 * A week's best aired dates (lib/week-recap.ts weekBest), for the script that cuts the week in review
 * (scripts/clips/weekly-recap.mjs): the last complete week (Monday to Monday, UTC), `?week=current` for the one under
 * way, or `?week=YYYY-MM-DD` for the week starting that Monday. Public: only dates that aired publicly between public
 * characters, and of each only what its own page shows (the two names, its title, how it ended, its grade).
 */
export const GET = handle(async (req) => {
  if (!weekRecapOn()) return json({ error: "off", message: "WEEK_RECAP is off." }, 404);
  const now = new Date();
  const week = recapWeek(now, new URL(req.url).searchParams.get("week"));
  if (!week) return json({ error: "invalid_week", message: "week: nothing (the last complete week), current, or the week's Monday as YYYY-MM-DD." }, 400);
  const dates = await weekBest(await getDb(), week, WEEK_DATES, now);
  return json({ week: { id: week.id, from: week.from.toISOString(), to: week.to.toISOString(), label: weekLabel(week), complete: week.to.getTime() <= now.getTime() }, dates });
});
