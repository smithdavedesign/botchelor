import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import { getDb } from "@/lib/db";
import { withPortraits } from "@/lib/portrait-sql";
import { seasonCastCards, type CastCard } from "@/lib/season-cast";
import { getSeasonRecap, type RecapChar, type SeasonRecap } from "@/lib/season-recap";
import { seasonRef, closedSeasons } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";
import { breadcrumbJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo";
import { daysLeftLabel } from "./season-visuals";

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: "Seasons · Botchelor",
  description: "Every season of Botchelor, the blind-date show for AI characters: each month's cast, its couples, and how the finale went.",
  path: "/seasons",
});

/** How many of the running cast's faces the hero shows. */
const FACES_SHOWN = 10;

/**
 * Every season on one page (the 2026-11-11 growth plan: the finales were indexable but nothing linked or listed them;
 * the 11-07 audit found /seasons a 404). The one running leads, with its cast's faces and the way to tonight and the
 * Reunion, where it lives until it closes; each closed season is a card with its golden couple and three numbers, from
 * the frozen finale (lib/season-recap.ts). Cached an hour; without a database (a build) the cards are the labels alone.
 */
export default async function SeasonsPage() {
  const now = new Date();
  const running = seasonRef(seasonIdOf(now));
  const closed = closedSeasons(now);

  let cast: CastCard[] = [];
  const recaps = new Map<string, SeasonRecap>();
  const portraits = new Map<string, string | null>();
  const face = (c: RecapChar) => c.portrait ?? portraits.get(c.id) ?? null;
  try {
    const db = await getDb();
    const [faces, finales] = await Promise.all([
      running.number > 0 ? seasonCastCards(db).catch(() => [] as CastCard[]) : Promise.resolve([] as CastCard[]),
      Promise.all(closed.map((s) => getSeasonRecap(db, s.id).catch(() => null))),
    ]);
    cast = faces;
    finales.forEach((r, i) => {
      if (r?.status === "closed") recaps.set(closed[i].id, r.recap);
    });
    // A golden couple frozen before their portrait was drawn: their face as it is now (lib/portrait-sql.ts).
    const faceless: RecapChar[] = [...recaps.values()].flatMap((r) => (r.data.golden ? [r.data.golden.a, r.data.golden.b] : [])).filter((c) => !c.portrait);
    if (faceless.length) for (const c of await withPortraits(db, faceless)) portraits.set(c.id, c.portrait);
  } catch {
    // No database here (a build, an outage): the page still lists every season by name.
  }

  return (
    <article className="page-wide seasons-page">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Seasons", path: "/seasons" },
          ]),
          itemListJsonLd(
            "Botchelor seasons",
            closed.map((s) => ({ name: s.label, path: s.path })),
          ),
        ]}
      />
      <p className="kicker">The show</p>
      <h1>Seasons</h1>
      <p className="lede muted">A month is a season: a new cast, a board, a finale. Each finale stays up as the season&apos;s page.</p>
      {running.number > 0 && (
        <section className="card season-now" aria-labelledby="season-now">
          <p className="kicker">Season {running.number} · on now</p>
          <h2 id="season-now">{running.label}</h2>
          <p className="season-now-clock">{daysLeftLabel(now)}</p>
          {cast.length > 0 && (
            <ul className="season-faces season-now-faces" aria-label="This season's cast">
              {cast.slice(0, FACES_SHOWN).map((c) => (
                <li key={c.id}>
                  <Link href={`/characters/${c.id}`} title={c.name}>
                    <Avatar seed={c.id} name={c.name} hue={c.hue} house={!c.fan} portraitSrc={c.portrait} size={44} decorative />
                    <span className="sr-only">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="season-now-note">
            Tonight&apos;s board, the couples and the vote are at the Reunion; the finale lands here when the month ends.
          </p>
          <p className="cta-row">
            <Link className="button" href="/reunion">
              The Reunion
            </Link>
            <Link className="button-ghost" href="/watch">
              Tonight&apos;s dates
            </Link>
          </p>
        </section>
      )}
      <section aria-labelledby="season-list">
        <h2 id="season-list" className="section">
          Finales
        </h2>
        {closed.length === 0 ? (
          <p className="muted">The first season is still running.</p>
        ) : (
          <ol className="season-index" reversed>
            {closed.map((s) => {
              const recap = recaps.get(s.id);
              const golden = recap?.data.golden ?? null;
              const n = recap?.data.numbers;
              return (
                <li key={s.id} className="card tap-card season-index-card">
                  <p className="kicker">Season {s.number}</p>
                  <h3>
                    <Link className="stretch" href={s.path}>
                      {s.label}
                    </Link>
                  </h3>
                  {golden ? (
                    <div className="season-index-golden">
                      <span className="pair-faces" aria-hidden="true">
                        <Avatar seed={golden.a.id} name={golden.a.name} hue={golden.a.hue} house={golden.a.house} portraitSrc={face(golden.a)} size={44} decorative />
                        <Avatar seed={golden.b.id} name={golden.b.name} hue={golden.b.hue} house={golden.b.house} portraitSrc={face(golden.b)} size={44} decorative />
                      </span>
                      <div className="season-index-golden-copy">
                        <p className="season-index-eyebrow">🏆 Golden couple</p>
                        <p className="season-index-names">
                          {golden.a.name} × {golden.b.name}
                        </p>
                        <p className="muted small season-index-line">{golden.line}</p>
                      </div>
                    </div>
                  ) : recap ? (
                    <p className="muted small season-index-line">No couple made it to a second yes. The finale tells the rest.</p>
                  ) : null}
                  {n && (
                    <dl className="season-mini-numbers">
                      <div>
                        <dt>dates aired</dt>
                        <dd>{n.aired}</dd>
                      </div>
                      <div>
                        <dt>pairings</dt>
                        <dd>{n.couples}</dd>
                      </div>
                      <div>
                        <dt>second dates</dt>
                        <dd>{n.second_dates}</dd>
                      </div>
                    </dl>
                  )}
                  <p className="season-index-cta small">The finale →</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}
