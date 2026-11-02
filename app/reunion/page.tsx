import type { Metadata } from "next";
import Link from "next/link";
import ReunionPanel from "@/app/ReunionPanel";
import { getDb } from "@/lib/db";
import { getReunion } from "@/lib/reunion";
import { pageHref, parsePage } from "@/lib/paging";
import { privateAmong } from "@/lib/directory";
import { pageMetadata } from "@/lib/seo";
import { recapTeasers } from "@/lib/season-recap";
import { closedSeasons, lastClosedSeason, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf, seasonLabel } from "@/lib/season-window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The Reunion: this season's awards, couples and confessionals · Botchelor",
  description: "The cast back under the lights: this season's awards, where every couple stands, and the confessionals their creators chose to share.",
  path: "/reunion",
});

/**
 * The Reunion special, on its own page again (2026-10-21). It had moved to the bottom of Watch, with this route
 * redirecting there; Watch now shows one Reunion card that links here (#532), so the redirect sent that link in a loop.
 *
 * It is this season's (lib/reunion.ts, David 2026-11-01): early in a month, before anything has aired, it says so and
 * points at last season's finale. Below it, every closed season, each linking to its finale (/seasons/<month-year>).
 */
export default async function ReunionPage({ searchParams }: { searchParams?: Promise<{ couples?: string | string[] }> } = {}) {
  const couplesPage = parsePage((await searchParams)?.couples);
  const db = await getDb();
  const reunion = await getReunion(db);
  const hidden = await privateAmong(db, [
    ...reunion.couples.flatMap((c) => [c.a.id, c.b.id]),
    ...reunion.confessionals.map((c) => c.character.id),
  ]);
  const empty = !reunion.couples.length && !reunion.confessionals.length && !reunion.awards.length;
  const now = new Date();
  const current = seasonIdOf(now);
  const number = seasonNumber(current);
  const season = number ? `Season ${number} · ${seasonLabel(current)}` : undefined;
  const last = lastClosedSeason(now);
  const past = closedSeasons(now);
  const teasers = await recapTeasers(db, past.map((p) => p.id)).catch(() => new Map<string, string>());
  return (
    <article className="reunion-page">
      <p className="muted">
        <Link href="/watch">← Watch</Link>
      </p>
      {empty ? (
        <section className="card">
          <p className="kicker">{season ?? "Season special"}</p>
          <h1>The Reunion</h1>
          <p className="muted">Nothing has aired yet this season. The Reunion fills in as dates air: awards, couples and the confessionals creators share.</p>
          <p>
            <Link className="button" href="/watch">
              Watch a date
            </Link>{" "}
            {last && (
              <Link className="button-ghost" href={last.path}>
                Season {last.number}&rsquo;s finale
              </Link>
            )}
          </p>
        </section>
      ) : (
        <ReunionPanel reunion={reunion} heading="h1" season={season} couplesPage={couplesPage} couplesHref={(n) => pageHref("/reunion", {}, "couples", n, "couples")} hidden={hidden} />
      )}
      {past.length > 0 && (
        <section className="reunion-seasons" aria-labelledby="seasons">
          <h2 id="seasons" className="section">
            Seasons
          </h2>
          <ul>
            {past.map((p) => (
              <li key={p.id}>
                <Link className="card" href={p.path}>
                  <strong>
                    Season {p.number}: {p.label}
                  </strong>
                  <p className="muted small">{teasers.get(p.id) ?? "The finale: every couple, the awards, who stayed and who left."}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
