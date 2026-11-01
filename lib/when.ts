export type WhenStyle = "ago" | "date";

/**
 * A time as a list shows it. "ago", as a messaging app says it: "now", "12m", "3h", then "Tue" within the week, then
 * "Oct 12". "date": "Oct 12". `timeZone` unset is the runtime's own zone (the viewer's, in a browser).
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...zone });
}
