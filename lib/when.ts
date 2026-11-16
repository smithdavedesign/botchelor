export type WhenStyle = "ago" | "date" | "day-time" | "weekly";

/**
 * A time as a list shows it. "ago", as a messaging app says it: "now", "12m", "3h", then "Tue" within the week, then
 * "Oct 12". "date": "Oct 12". "day-time", one moment with its zone: "Sun, Dec 27, 8:20 PM UTC". "weekly", a time that
 * comes round every week, from one of its moments: "Sundays, 8:20 PM UTC" (the season page's schedule). `timeZone`
 * unset is the runtime's own zone (the viewer's, in a browser), so "day-time" and "weekly" name the day it falls on
 * there: midnight UTC on a Thursday is a Wednesday evening in California.
 */
export function formatWhen(iso: string, style: WhenStyle, now: number, timeZone?: string): string {
  const d = new Date(iso);
  const zone = timeZone ? { timeZone } : {};
  if (style === "ago") {
    const mins = Math.max(0, Math.round((now - d.getTime()) / 60_000));
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
    if (mins < 6 * 24 * 60) return d.toLocaleDateString("en-US", { weekday: "short", ...zone });
  }
  if (style === "day-time" || style === "weekly") {
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", ...zone });
    if (style === "weekly") return `${d.toLocaleDateString("en-US", { weekday: "long", ...zone })}s, ${time}`;
    return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...zone })}, ${time}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...zone });
}
