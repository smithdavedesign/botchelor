import Link from "next/link";
import type { RecouplingBoard } from "@/lib/recoupling";
import type { SeasonFormatDef, ThisWeekCard } from "@/lib/season-format";
import { seasonBanner, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";

/** "tonight", "in 3 days", "in 5h": the countdown to the Recoupling, from the server's clock (the page is dynamic). */
export function recouplingIn(iso: string, now: number): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000);
  if (mins <= 0) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours < 6 ? `tonight (in ${hours}h)` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Where the season stands, as one line (2026-11-07 audit, item 3: "Season 1 is over", "Premiere week" and "The
 * Recoupling in 23 days" were three cards stacked above the first date on /watch). The line names this season, its
 * week and the next Recoupling; opening it gives this week's announcement and twist, last season's recap in its first
 * week, and the ballot for next season. $0: templates and dates, no model.
 */
export default function SeasonLine({
  def,
  card,
  picked,
  recoupling,
  now,
}: {
  def: SeasonFormatDef | null;
  card: ThisWeekCard | null;
  picked: { title: string; votes: number; total: number } | null;
  recoupling: RecouplingBoard | null;
  now: number;
}) {
  const at = new Date(now);
  const number = seasonNumber(seasonIdOf(at));
  const closed = seasonBanner(at);
  const nightAhead = recoupling && Date.parse(recoupling.runs_at) > now ? recoupling : null;
  const parts = [
    `📺 ${number ? `Season ${number}` : "This season"}${def ? `: ${def.title}` : ""}`,
    card?.label ?? null,
    nightAhead ? `💘 The Recoupling ${recouplingIn(nightAhead.runs_at, now)}` : null,
  ].filter(Boolean);
  return (
    <details className="season-line ux-fold" id="this-week" data-track-area="this-week">
      <summary>
        <span className="season-line-text">{parts.join(" · ")}</span> <span className="muted small">What&apos;s on</span>
      </summary>
      <div className="season-line-body">
        {card?.announce && <p>{card.announce}</p>}
        {card?.announce && picked && (
          <p className="small watch-picked">
            🗳️ Picked by the viewers: <strong>{picked.title}</strong>, {picked.votes} of {picked.total} votes.
          </p>
        )}
        {card?.tease && <p className="muted small">{card.tease}</p>}
        {recoupling?.last && (
          <p className="small">
            <Link href={recoupling.last.room_path}>Watch the last Recoupling →</Link>
          </p>
        )}
        {closed && (
          <p className="small">
            <Link href={closed.path}>🎬 Season {closed.number} is over: watch the recap →</Link>
          </p>
        )}
        <p className="small">
          <Link href="/reunion#next-season">Vote on next season&apos;s show →</Link>
        </p>
      </div>
    </details>
  );
}
