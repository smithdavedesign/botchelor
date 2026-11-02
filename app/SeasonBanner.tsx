import Link from "next/link";
import { seasonBanner } from "@/lib/season-ref";

/**
 * "Season 1 is over: watch the recap" (David 2026-11-01), on home and /watch for the first week of a month
 * (lib/season-ref.ts BANNER_DAYS), linking the season that just closed to its finale page (/seasons/<month-year>).
 * Pure dates, no database: the finale itself freezes on its first read.
 */
export default function SeasonBanner({ now = new Date() }: { now?: Date }) {
  const season = seasonBanner(now);
  if (!season) return null;
  return (
    <Link href={season.path} className="season-banner">
      <span aria-hidden="true">🎬</span>
      <span className="season-banner-text">
        <strong>Season {season.number} is over</strong> <span className="season-banner-sub">{season.label}: how it all went</span>
      </span>
      <span className="season-banner-cta">Watch the recap →</span>
    </Link>
  );
}
