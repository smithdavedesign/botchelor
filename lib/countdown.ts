/**
 * A countdown in words ("in 5h 12m", "in 40m", "in 2 days"), from a clock the page passes in (the pages are dynamic,
 * so it's the server's). Pure and client-safe: Sunday's reveal (app/WeeklyReveal.tsx) and the season pool use it.
 */
export function countdown(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `in ${hours}h ${mins % 60}m` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}
