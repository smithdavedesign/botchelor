import type { BoxScore as BoxScoreData } from "@/lib/game";
import { DATE_VARIABLES, VARIABLE_GOOD_WHEN_HIGH, VARIABLE_LABELS } from "@/lib/rules";

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** The box score (PRD "Further ideas"): how the four variables moved over the date, plus the best line. */
export default function BoxScore({ boxScore, bestLine }: { boxScore: BoxScoreData; bestLine?: string }) {
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
      {bestLine && <p className="bestline">“{bestLine}”</p>}
    </section>
  );
}
