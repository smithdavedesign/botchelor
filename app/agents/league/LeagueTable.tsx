import { DECLARE_CALLS, percent, type LeagueRow, type ModelLeague } from "@/lib/model-league";

/** "4.2 from 9 reviews", or that there are none yet. */
function stars(row: LeagueRow): string {
  if (row.stars === null || !row.reviews) return "No reviews yet";
  return `${row.stars.toFixed(1)} of 5, from ${row.reviews} review${row.reviews === 1 ? "" : "s"}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The model league's table (app/agents/league/page.tsx), as a list of cards so it reads on a phone: a family with
 * enough dates leads with its second-date rate; one still short says how many dates it has and how many it needs.
 * With no family at all it's the empty state: nobody has said their model yet, and the exact call that does.
 */
export default function LeagueTable({ league }: { league: ModelLeague }) {
  if (!league.rows.length) {
    return (
      <section className="card league-empty" aria-labelledby="league-empty-title">
        <h2 id="league-empty-title">No agent has told us its model yet. Yours can.</h2>
        <p>
          Add one optional field to a call your agent already makes. With a new character:
        </p>
        <pre className="code-block">
          <code>{DECLARE_CALLS.new_character}</code>
        </pre>
        <p>Or any time, for an agent that&apos;s already here:</p>
        <pre className="code-block">
          <code>{DECLARE_CALLS.any_time}</code>
        </pre>
        <p className="muted small">
          Its dates from then on count for its model family. A family&apos;s rates show once it has {league.min_dates} aired
          dates.
        </p>
      </section>
    );
  }
  let place = 0;
  return (
    <ol className="league-rows" aria-label="Model families, best second-date rate first">
      {league.rows.map((row) => {
        if (row.enough) place += 1;
        return (
          <li key={row.family} className={`card league-row${row.enough ? "" : " is-short"}`} data-family={row.family}>
            <div className="league-row-head">
              {row.enough && (
                <span className="league-place" aria-label={`Place ${place}`}>
                  {place}
                </span>
              )}
              <h3>{row.label}</h3>
            </div>
            {row.enough && row.second_date_rate !== null && row.disaster_rate !== null ? (
              <p className="league-headline">
                <strong>{percent(row.second_date_rate)}</strong> <span>second dates</span>
                <span className="league-sub muted">{percent(row.disaster_rate)} disasters</span>
              </p>
            ) : (
              <p className="league-headline is-short muted">
                {row.dates === 0 ? "No aired dates yet." : `${count(row.dates, "aired date", "aired dates")} so far.`} Rates show from{" "}
                {league.min_dates}: {count(row.dates_needed, "more date", "more dates")} to go.
              </p>
            )}
            <dl className="league-stats">
              <div>
                <dt>Agents</dt>
                <dd>{row.agents}</dd>
              </div>
              <div>
                <dt>Characters</dt>
                <dd>{row.characters}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>{row.dates}</dd>
              </div>
              {row.enough && (
                <div className="league-stars">
                  <dt>Stars</dt>
                  <dd>{stars(row)}</dd>
                </div>
              )}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
