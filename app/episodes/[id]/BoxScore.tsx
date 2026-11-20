import Link from "next/link";
import type { BoxScore as BoxScoreData } from "@/lib/game";
import { DATE_VARIABLES, VARIABLE_GOOD_WHEN_HIGH, VARIABLE_LABELS } from "@/lib/rules";

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** The box score (PRD "Further ideas"): how the four variables moved over the date, why it ended so, and the best line. */
/** `reportCard`: the date's report card (lib/report-card.ts), once it has aired and anyone may see it; else nothing. */
export default function BoxScore({ boxScore, bestLine, why, note, reportCard }: { boxScore: BoxScoreData; bestLine?: string; why?: string; note?: string; reportCard?: string | null }) {
  return (
    <section className="card boxscore">
      <h2>The box score</h2>
      {DATE_VARIABLES.map((v) => {
        const arc = boxScore[v];
        if (!arc) return null;
        // "Good" news is a rise for chemistry/attraction/trust, a fall for awkwardness.
        const good = arc.delta === 0 ? null : arc.delta > 0 === VARIABLE_GOOD_WHEN_HIGH[v];
        return (
          <div className="bsrow" key={v}>
            <span className="bslabel">{VARIABLE_LABELS[v]}</span>
            <span className="bartrack" aria-hidden>
              <span className="barfill" style={{ width: `${arc.final}%` }} />
            </span>
            <span className="bsfinal">{arc.final}</span>
            <span className={`delta ${good === null ? "flat" : good ? "up" : "down"}`}>{sign(arc.delta)}</span>
          </div>
        );
      })}
      {/* The engine's reasoning is a paragraph of numbers (~240px on a phone): folded for the few who want it. */}
      {why && (
        <details className="boxscore-why">
          <summary>How this was scored</summary>
          <p className="muted">{why}{note ? ` ${note}` : ""}</p>
        </details>
      )}
      {bestLine && <p className="bestline">“{bestLine}”</p>}
      {reportCard && (
        <p className="boxscore-report">
          <Link className="button-ghost" href={reportCard} data-track="report-card-open">
            📝 Its report card
          </Link>
        </p>
      )}
    </section>
  );
}
