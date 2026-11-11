import Link from "next/link";
import Icon from "@/app/Icon";
import { seasonDayOf } from "@/lib/season-format";
import { isMonthlySeason, seasonBanner, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf, seasonLabel, seasonWindow } from "@/lib/season-window";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The season in the chrome, on home and /watch. For the first week of a month: "Season 1 is over: watch the recap"
 * (David 2026-11-01; lib/season-ref.ts BANNER_DAYS), linking the season that just closed to its finale page. The rest
 * of the month: the arc (the design system, 2026-11-11): which season, which night, how far through the month, this
 * season's format when the page knows it, linking to the Reunion. Pure dates, no database.
 */
export default function SeasonBanner({ now = new Date(), format = null }: { now?: Date; format?: string | null }) {
  const closed = seasonBanner(now);
  if (closed) {
    return (
      <Link href={closed.path} className="season-banner">
        <Icon name="clapper" />
        <span className="season-banner-text">
          <strong>Season {closed.number} is over</strong> <span className="season-banner-sub">{closed.label}: how it all went</span>
        </span>
        <span className="season-banner-cta">Watch the recap →</span>
      </Link>
    );
  }
  const id = seasonIdOf(now);
  const number = seasonNumber(id);
  if (!isMonthlySeason(id) || number === null) return null;
  const { start, end } = seasonWindow(now);
  const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  const night = Math.min(nights, seasonDayOf(now));
  const left = nights - night;
  const pct = Math.max(0, Math.min(100, Math.round((night / nights) * 100)));
  const label = `Season ${number}, ${seasonLabel(id)}, night ${night} of ${nights}, ${left === 0 ? "the finale is tonight" : `${left} ${left === 1 ? "day" : "days"} to the finale`}`;
  return (
    <Link href="/reunion" className="season-arc" aria-label={label} data-track="season-arc">
      <span className="season-arc-name">Season {number}</span>
      <span className="season-arc-sep" aria-hidden="true">
        ·
      </span>
      <span>{seasonLabel(id)}</span>
      <span className="season-arc-sep" aria-hidden="true">
        ·
      </span>
      <span className="season-arc-night">Night {night}</span>
      <span className="season-arc-track" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="season-arc-left">{left === 0 ? "Finale tonight" : `${left} ${left === 1 ? "day" : "days"} to the finale`}</span>
      {format && <span className="chip season-arc-format">{format}</span>}
    </Link>
  );
}
