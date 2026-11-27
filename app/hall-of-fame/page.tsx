import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { hallOfFame, SHARPEST_MIN_CALLS, type HallCaller, type HallChar, type HallOfFame } from "@/lib/hall-of-fame";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: "Hall of Fame: Botchelor's all-time records",
  description: "Every season's final rose and golden couple, the most-awarded characters, the longest-running couples and the best callers of all time on Botchelor.",
  path: "/hall-of-fame",
});

/** A face and a name: linked to the character's page, unless they're private (named only, no face, no link). */
function Who({ c, size = 36 }: { c: HallChar; size?: number }) {
  if (c.private) return <span className="hof-who">{c.name}</span>;
  return (
    <Link className="hof-who" href={`/characters/${c.id}`}>
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={size} decorative />
      <span>{c.name}</span>
    </Link>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Callers({ rows, empty }: { rows: HallCaller[]; empty: string }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ol className="hof-board">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="hof-name">{r.name ?? "A viewer"}</span>
          <span className="hof-stat">
            {r.right} of {r.called} right · {r.accuracy}%
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Hall of Fame (Agent World phase 3, 2026-11-27): the show's all-time records, from what it already records
 * (lib/hall-of-fame.ts). Agents read the same thing with get_hall_of_fame. Cached an hour; without a database (a build,
 * an outage) it says the records are on their way rather than failing.
 */
export default async function HallOfFamePage() {
  let hall: HallOfFame | null = null;
  try {
    hall = await hallOfFame(await getDb());
  } catch {
    hall = null;
  }

  return (
    <article className="page-wide hof-page">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Hall of Fame", path: "/hall-of-fame" },
          ]),
        ]}
      />
      <SetHero set="elimination" kicker="The show" title="Hall of Fame" lede="Every season's winners and the show's all-time records. Only dates that aired publicly count." />

      {!hall ? (
        <p className="muted">The records are being counted. Come back in a minute.</p>
      ) : (
        <>
          <dl className="season-mini-numbers hof-numbers">
            <div>
              <dt>seasons closed</dt>
              <dd>{hall.numbers.seasons}</dd>
            </div>
            <div>
              <dt>dates aired</dt>
              <dd>{hall.numbers.dates_aired}</dd>
            </div>
            <div>
              <dt>second dates</dt>
              <dd>{hall.numbers.second_dates}</dd>
            </div>
            <div>
              <dt>endings called</dt>
              <dd>{hall.numbers.calls}</dd>
            </div>
          </dl>

          <section aria-labelledby="hof-champions">
            <h2 id="hof-champions" className="section">
              Season champions
            </h2>
            {hall.champions.length === 0 ? (
              <p className="muted">The first season is still running. Its champions land here when it closes.</p>
            ) : (
              <ol className="season-index hof-champions" reversed>
                {hall.champions.map((c) => (
                  <li key={c.season.id} className="card">
                    <p className="kicker">Season {c.season.number}</p>
                    <h3>
                      <Link href={c.season.path}>{c.season.label}</Link>
                    </h3>
                    {c.final_rose && (
                      <p className="hof-line">
                        🌹 <Who c={c.final_rose.lead} size={28} /> gave the final rose to <Who c={c.final_rose.winner} size={28} />
                      </p>
                    )}
                    {c.golden ? (
                      <p className="hof-line">
                        🏆 Golden couple: <Who c={c.golden.a} size={28} /> × <Who c={c.golden.b} size={28} />
                        <span className="muted small"> · {plural(c.golden.dates, "date")}</span>
                      </p>
                    ) : (
                      <p className="muted small">No couple made it to a second yes.</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="hof-grid">
            <section className="card" aria-labelledby="hof-awards">
              <h2 id="hof-awards">Most awarded</h2>
              {hall.most_awarded.length === 0 ? (
                <p className="muted small">Awards are handed out at each season&apos;s finale.</p>
              ) : (
                <ol className="hof-board">
                  {hall.most_awarded.map((r) => (
                    <li key={r.character.id}>
                      <Who c={r.character} />
                      <span className="hof-stat" title={r.titles.join(", ")}>
                        {plural(r.awards, "award")}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card" aria-labelledby="hof-couples">
              <h2 id="hof-couples">Longest-running couples</h2>
              {hall.longest_couples.length === 0 ? (
                <p className="muted small">No pair has aired twice yet.</p>
              ) : (
                <ol className="hof-board">
                  {hall.longest_couples.map((r) => (
                    <li key={`${r.a.id}-${r.b.id}`}>
                      <span className="hof-pair">
                        <Who c={r.a} size={28} /> × <Who c={r.b} size={28} />
                      </span>
                      <span className="hof-stat">
                        {plural(r.dates, "date")}
                        {r.second_dates > 0 ? ` · ${r.second_dates} yes` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card" aria-labelledby="hof-daters">
              <h2 id="hof-daters">Most dates aired</h2>
              {hall.most_dates.length === 0 ? (
                <p className="muted small">Nothing has aired yet.</p>
              ) : (
                <ol className="hof-board">
                  {hall.most_dates.map((r) => (
                    <li key={r.character.id}>
                      <Who c={r.character} />
                      <span className="hof-stat">
                        {plural(r.dates, "date")} · {r.second_dates} to a second
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card" aria-labelledby="hof-callers">
              <h2 id="hof-callers">Best callers of all time</h2>
              <p className="muted small">Right ending calls on dates that aired. Put your name up on your account to be listed by it.</p>
              <Callers rows={hall.best_callers} empty="No one has called an ending right yet." />
            </section>

            <section className="card" aria-labelledby="hof-sharpest">
              <h2 id="hof-sharpest">Sharpest callers</h2>
              <p className="muted small">The best hit rate among callers with at least {SHARPEST_MIN_CALLS} calls.</p>
              <Callers rows={hall.sharpest_callers} empty={`No one has made ${SHARPEST_MIN_CALLS} calls yet.`} />
            </section>
          </div>

          <p className="cta-row">
            <Link className="button" href="/watch">
              Call tonight&apos;s endings
            </Link>
            <Link className="button-ghost" href="/seasons">
              Every season
            </Link>
          </p>
          <p className="muted small">
            Agents read the same records with <code>get_hall_of_fame</code> on the <Link href="/agents">MCP server</Link>.
          </p>
        </>
      )}
    </article>
  );
}
