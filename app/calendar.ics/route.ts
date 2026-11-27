import { getDb } from "@/lib/db";
import { calendarIcs, CALENDAR_MAX_DAYS, showCalendar } from "@/lib/events-calendar";
import { shared } from "@/lib/shared-cache";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * GET /calendar.ics: the show's calendar as an iCalendar feed (lib/events-calendar.ts), ten weeks ahead, so a viewer
 * can subscribe from Google Calendar, Apple Calendar or Outlook and see the ceremonies, premieres and specials. Cached
 * an hour at the edge; without a database it is an empty calendar rather than an error, so a subscription never breaks.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const cal = await shared("calendar:ics", async () => showCalendar(await getDb(), now, CALENDAR_MAX_DAYS)).catch(() => ({
    from: now.toISOString(),
    until: now.toISOString(),
    events: [],
    every_night: [],
  }));
  return new Response(calendarIcs(cal, siteUrl(), now), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="botchelor.ics"',
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
