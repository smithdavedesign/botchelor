import Link from "next/link";
import Icon from "@/app/Icon";
import { seasonArc, type SeasonFormatDef } from "@/lib/season-format";
import { isMonthlySeason, seasonBanner, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf, seasonLabel } from "@/lib/season-window";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The season in the chrome, on home and /watch. For the first week of a month: "Season 1 is over: watch the recap"
 * (David 2026-11-01; lib/season-ref.ts BANNER_DAYS), linking the season that just closed to its finale page. The rest
 * of the month: the arc (the design system, 2026-11-11): which season, which night, how far through the month, this
 * season's format when the page knows it, linking to the Reunion. Pure dates, no database.
 *
 * On a lead format (`def`, The Botchelor) the finale it counts to is the final rose (lib/season-format.ts seasonArc),
 * and the layout passes the season's own page as `href` (docs/season-page.md): /reunion stays in the show's tabs.
 */
export default function SeasonBanner({
  now = new Date(),
  format = null,
  def = null,
  href = "/reunion",
}: {
  now?: Date;
  format?: string | null;
  def?: SeasonFormatDef | null;
  href?: string;
}) {
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
  const { night, nights, left, pct, to } = seasonArc(now, def);
  // After a lead format's final rose the season still has nights left: the arc counts those, not a finale to come.
  const after = to === "end";
  const label = `Season ${number}, ${seasonLabel(id)}, night ${night} of ${nights}, ${after ? `${days(left)} left in the season` : left === 0 ? "the finale is tonight" : `${days(left)} to the finale`}`;
  return (
    <Link href={href} className="season-arc" aria-label={label} data-track="season-arc">
      <span className="season-arc-name">
        <span className="season-arc-long">Season {number}</span>
        <span className="season-arc-short">S{number}</span>
      </span>
      <span className="season-arc-sep" aria-hidden="true">
        ·
      </span>
      <span className="season-arc-month">{seasonLabel(id)}</span>
      <span className="season-arc-sep" aria-hidden="true">
        ·
      </span>
      <span className="season-arc-night">Night {night}</span>
      <span className="season-arc-track" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="season-arc-left">
        {after ? (
          left === 0 ? (
            "Last night"
          ) : (
            `${days(left)} left`
          )
        ) : left === 0 ? (
          "Finale tonight"
        ) : (
          <>
            <span className="season-arc-long">{`${days(left)} to the finale`}</span>
            <span className="season-arc-short">{`${days(left)} left`}</span>
          </>
        )}
      </span>
      {format && <span className="chip season-arc-format">{format}</span>}
    </Link>
  );
}
