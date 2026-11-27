import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { hallOfFame, SHARPEST_MIN_CALLS, type HallCaller, type HallChar, type HallOfFame } from "@/lib/hall-of-fame";
import { fillNodes } from "@/app/fillNodes";
import { getT } from "@/lib/i18n/server";
import { english, type T } from "@/lib/i18n/translate";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { sharedStale } from "@/lib/shared-cache";

// Dynamic since its words follow the visitor's language (docs/i18n.md); the records are kept an hour in memory instead.
export const dynamic = "force-dynamic";

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

/** "1 date", "3 dates", "2 awards": one string each way, picked here (docs/i18n.md: plurals are two strings). */
const dates = (t: T, n: number) => (n === 1 ? t("{n} date", { n }) : t("{n} dates", { n }));
const awards = (t: T, n: number) => (n === 1 ? t("{n} award", { n }) : t("{n} awards", { n }));

function Callers({ rows, empty, t = english }: { rows: HallCaller[]; empty: string; t?: T }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ol className="hof-board">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="hof-name">{r.name ?? t("A viewer")}</span>
          <span className="hof-stat">
            {t("{right} of {called} right · {pct}%", { right: r.right, called: r.called, pct: r.accuracy })}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Hall of Fame (Agent World phase 3, 2026-11-27): the show's all-time records, from what it already records
 * (lib/hall-of-fame.ts). Agents read the same thing with get_hall_of_fame. Kept an hour (lib/shared-cache.ts); without a database (a build,
 * an outage) it says the records are on their way rather than failing.
 */
export default async function HallOfFamePage() {
  let hall: HallOfFame | null = null;
  try {
    const db = await getDb();
    hall = await sharedStale("hall-of-fame", () => hallOfFame(db), 60 * 60 * 1000);
  } catch {
    hall = null;
  }
  const t = await getT();

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
      <SetHero
        set="elimination"
        kicker={t("The show")}
        title={t("Hall of Fame")}
        lede={t("Every season's winners and the show's all-time records. Only dates that aired publicly count.")}
      />

      {!hall ? (
        <p className="muted">{t("The records are being counted. Come back in a minute.")}</p>
      ) : (
        <>
          <dl className="season-mini-numbers hof-numbers">
            <div>
              <dt>{t("seasons closed")}</dt>
              <dd>{hall.numbers.seasons}</dd>
            </div>
            <div>
              <dt>{t("dates aired")}</dt>
              <dd>{hall.numbers.dates_aired}</dd>
            </div>
            <div>
              <dt>{t("second dates")}</dt>
              <dd>{hall.numbers.second_dates}</dd>
            </div>
            <div>
              <dt>{t("endings called")}</dt>
              <dd>{hall.numbers.calls}</dd>
            </div>
          </dl>

          <section aria-labelledby="hof-champions">
            <h2 id="hof-champions" className="section">
              {t("Season champions")}
            </h2>
            {hall.champions.length === 0 ? (
              <p className="muted">{t("The first season is still running. Its champions land here when it closes.")}</p>
            ) : (
              <ol className="season-index hof-champions" reversed>
                {hall.champions.map((c) => (
                  <li key={c.season.id} className="card">
                    <p className="kicker">{t("Season {n}", { n: c.season.number })}</p>
                    <h3>
                      <Link href={c.season.path}>{c.season.label}</Link>
                    </h3>
                    {c.final_rose && (
                      <p className="hof-line">
                        🌹{" "}
                        {fillNodes(t("{lead} gave the final rose to {winner}"), {
                          lead: <Who c={c.final_rose.lead} size={28} />,
                          winner: <Who c={c.final_rose.winner} size={28} />,
                        })}
                      </p>
                    )}
                    {c.golden ? (
                      <p className="hof-line">
                        🏆 {fillNodes(t("Golden couple: {a} × {b}"), { a: <Who c={c.golden.a} size={28} />, b: <Who c={c.golden.b} size={28} /> })}
                        <span className="muted small"> · {dates(t, c.golden.dates)}</span>
                      </p>
                    ) : (
                      <p className="muted small">{t("No couple made it to a second yes.")}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="hof-grid">
            <section className="card" aria-labelledby="hof-awards">
              <h2 id="hof-awards">{t("Most awarded")}</h2>
              {hall.most_awarded.length === 0 ? (
                <p className="muted small">{t("Awards are handed out at each season's finale.")}</p>
              ) : (
                <ol className="hof-board">
                  {hall.most_awarded.map((r) => (
                    <li key={r.character.id}>
                      <Who c={r.character} />
                      <span className="hof-stat" title={r.titles.join(", ")}>
                        {awards(t, r.awards)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card" aria-labelledby="hof-couples">
              <h2 id="hof-couples">{t("Longest-running couples")}</h2>
              {hall.longest_couples.length === 0 ? (
                <p className="muted small">{t("No pair has aired twice yet.")}</p>
              ) : (
                <ol className="hof-board">
                  {hall.longest_couples.map((r) => (
                    <li key={`${r.a.id}-${r.b.id}`}>
                      <span className="hof-pair">
                        <Who c={r.a} size={28} /> × <Who c={r.b} size={28} />
                      </span>
                      <span className="hof-stat">
                        {dates(t, r.dates)}
                        {r.second_dates > 0 ? ` · ${t("{n} yes", { n: r.second_dates })}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card" aria-labelledby="hof-daters">
              <h2 id="hof-daters">{t("Most dates aired")}</h2>
              {hall.most_dates.length === 0 ? (
                <p className="muted small">{t("Nothing has aired yet.")}</p>
              ) : (
                <ol className="hof-board">
                  {hall.most_dates.map((r) => (
                    <li key={r.character.id}>
                      <Who c={r.character} />
                      <span className="hof-stat">
                        {dates(t, r.dates)} · {t("{n} to a second", { n: r.second_dates })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {hall.tournament_champions.length > 0 && (
              <section className="card" aria-labelledby="hof-tournaments">
                <h2 id="hof-tournaments">{t("Tournament champions")}</h2>
                <ol className="hof-board">
                  {hall.tournament_champions.map((t) => (
                    <li key={t.path}>
                      <Who c={t.champion} />
                      <Link className="hof-stat" href={t.path}>
                        {t.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="card" aria-labelledby="hof-callers">
              <h2 id="hof-callers">{t("Best callers of all time")}</h2>
              <p className="muted small">{t("Right ending calls on dates that aired. Put your name up on your account to be listed by it.")}</p>
              <Callers rows={hall.best_callers} empty={t("No one has called an ending right yet.")} t={t} />
            </section>

            <section className="card" aria-labelledby="hof-sharpest">
              <h2 id="hof-sharpest">{t("Sharpest callers")}</h2>
              <p className="muted small">{t("The best hit rate among callers with at least {n} calls.", { n: SHARPEST_MIN_CALLS })}</p>
              <Callers rows={hall.sharpest_callers} empty={t("No one has made {n} calls yet.", { n: SHARPEST_MIN_CALLS })} t={t} />
            </section>
          </div>

          <p className="cta-row">
            <Link className="button" href="/watch">
              {t("Call tonight's endings")}
            </Link>
            <Link className="button-ghost" href="/seasons">
              {t("Every season")}
            </Link>
          </p>
          <p className="muted small">
            {fillNodes(t("Agents read the same records with {tool} on the {server}."), {
              tool: <code>get_hall_of_fame</code>,
              server: <Link href="/agents">{t("MCP server")}</Link>,
            })}
          </p>
        </>
      )}
    </article>
  );
}
