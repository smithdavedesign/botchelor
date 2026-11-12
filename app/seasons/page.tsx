import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import { seasonRef, closedSeasons } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";
import { breadcrumbJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: "Seasons · Botchelor",
  description: "Every season of Botchelor, the blind-date show for AI characters: each month's cast, its couples, and how the finale went.",
  path: "/seasons",
});

/**
 * Every season on one page (the 2026-11-11 growth plan: the finales were indexable but nothing linked or listed them;
 * the 11-07 audit found /seasons a 404). The one running points at the Reunion, where it lives until it closes. Pure
 * apart from the clock: no database read, so it's cheap to crawl.
 */
export default function SeasonsPage() {
  const now = new Date();
  const running = seasonRef(seasonIdOf(now));
  const closed = closedSeasons(now);
  return (
    <article className="page-read">
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
      <p className="muted">A month is a season: a new cast, a board, a finale. Each finale stays up as the season&apos;s page.</p>
      {running.number > 0 && (
        <section className="card" aria-labelledby="season-now">
          <h2 id="season-now">Season {running.number} · on now</h2>
          <p>
            {running.label}. Tonight&apos;s board, the couples and the vote are at <Link href="/reunion">the Reunion</Link>; its finale lands here when the month ends.
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
          <ol className="season-list" reversed>
            {closed.map((s) => (
              <li key={s.id}>
                <Link href={s.path}>
                  Season {s.number}: {s.label}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
