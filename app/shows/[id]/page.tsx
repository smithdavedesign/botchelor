import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import ShowTabs from "@/app/ShowTabs";
import { getDb } from "@/lib/db";
import { seasonCastCards } from "@/lib/season-cast";
import { seasonFormat, SEASON_FORMAT_SLUGS, type SeasonFormatSlug } from "@/lib/season-format";
import { seasonFormatSlug } from "@/lib/season-format-store";
import { seasonPath } from "@/lib/season-ref";
import { seasonLabel } from "@/lib/season-window";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { shared } from "@/lib/shared-cache";
import { ensureShowSeasons, getShow, SHOW_ID, showSeasons } from "@/lib/show-seasons";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const isSlug = (s: string | null): s is SeasonFormatSlug => s !== null && (SEASON_FORMAT_SLUGS as readonly string[]).includes(s);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const show = await getShow(await getDb(), id).catch(() => null);
  // No such show: the not-found page's title and robots (this said "Show not found", index, follow), as the page itself
  // turns it away, a failed read included (app/not-found.tsx).
  if (!show) notFound();
  return pageMetadata({
    title: `${show.title}: the show, its seasons and its cast`,
    description: `${show.title} is a blind-date show for original characters: every season it has run, the format of each, and who is on the cast now.`,
    path: `/shows/${show.id}`,
  });
}

/**
 * A show's own page (lib/show-seasons.ts; the connected-model plan, stage 8): what it is, the season on air, its cast,
 * and every season it has run with the format each was frozen in. All of it read from the registry by the show's id,
 * not from today's date, so a second show is a second row and this page is already its home. There is one show.
 */
export default async function ShowPage({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const show = await getShow(db, id).catch(() => null);
  if (!show) notFound();
  const now = Date.now();
  const [listed, cast] = await Promise.all([
    shared(`show:${show.id}:seasons`, () => showSeasons(db, show.id, { numbered: true })).catch(() => []),
    shared("show:cast-cards", () => seasonCastCards(db)).catch(() => []),
  ]);
  // The registry is written by the hourly job. In the hour before its first pass (a fresh database, the first deploy)
  // this show's own page fills it rather than showing a show with no seasons: idempotent, a handful of rows.
  let seasons = listed;
  if (!seasons.length && show.id === SHOW_ID) {
    await ensureShowSeasons(db).catch(() => null);
    seasons = await showSeasons(db, show.id, { numbered: true }).catch(() => []);
  }
  // A season that hasn't started has no frozen format: the store says what it will be (an admin's pick, else the ballot).
  const formats = new Map<string, SeasonFormatSlug | null>(
    await Promise.all(seasons.map(async (s) => [s.id, isSlug(s.format) ? s.format : await seasonFormatSlug(db, s.id).catch(() => null)] as const)),
  );
  const when = (s: { starts_at: string; ends_at: string }) => (Date.parse(s.starts_at) > now ? "next" : Date.parse(s.ends_at) > now ? "now" : "past");
  const current = seasons.find((s) => when(s) === "now") ?? null;
  const currentFormat = current ? formats.get(current.id) : null;
  return (
    <article className="shows-page show-page page-wide">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Shows", path: "/shows" },
            { name: show.title, path: `/shows/${show.id}` },
          ]),
        ]}
      />
      <ShowTabs active="/shows" />
      <p className="kicker">
        <Link href="/shows">Shows</Link> · {show.status === "on_air" ? "On air" : "Ended"}
      </p>
      <h1>{show.title}</h1>
      <p className="lede muted">
        Original characters go on blind dates that nobody steers: the rules decide how each one ends, an AI writes the lines, and the audience calls it before it airs.
      </p>

      {current && (
        <section className="card show-on-air" aria-labelledby="show-now">
          <p className="kicker">
            On now · Season {current.number}, {seasonLabel(current.id)}
          </p>
          <h2 id="show-now">
            {currentFormat ? (
              <>
                <span aria-hidden="true">{seasonFormat(currentFormat).emoji}</span> {seasonFormat(currentFormat).title}
              </>
            ) : (
              show.title
            )}
          </h2>
          {currentFormat && <p>{seasonFormat(currentFormat).pitch}</p>}
          <p className="cta-row">
            <Link className="button" href="/watch" data-track="show-watch">
              Watch tonight&apos;s dates
            </Link>
            <Link className="button-ghost" href="/house" data-track="show-house">
              The house
            </Link>
            <Link className="button-ghost" href="/reunion" data-track="show-season">
              The season so far
            </Link>
          </p>
        </section>
      )}

      {cast.length > 0 && (
        <section aria-labelledby="show-cast">
          <h2 id="show-cast" className="section">
            On the cast now
          </h2>
          <ul className="season-faces show-cast-faces" aria-label="This season's cast">
            {cast.slice(0, 12).map((c) => (
              <li key={c.id}>
                <Link href={`/characters/${c.id}`} title={c.name} data-track="show-cast">
                  <Avatar seed={c.id} name={c.name} hue={c.hue} house={!c.fan} portraitSrc={c.portrait} size={48} decorative />
                  <span className="sr-only">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="small">
            <Link href="/characters">Everyone on the show →</Link>
          </p>
        </section>
      )}

      {seasons.length > 0 && (
        <section aria-labelledby="show-seasons">
          <h2 id="show-seasons" className="section">
            Seasons
          </h2>
          <ul className="show-seasons-list">
            {seasons.map((s) => {
              const f = formats.get(s.id);
              const state = when(s);
              // The running season's page is the Season tab; a closed one has its finale; the next one its own page.
              const href = state === "now" ? "/reunion" : seasonPath(s.id);
              return (
                <li key={s.id}>
                  <Link className="card" href={href} data-track="show-season-row">
                    <strong>
                      Season {s.number} · {seasonLabel(s.id)}
                    </strong>
                    {state === "now" && <span className="chip">On now</span>}
                    {state === "next" && <span className="chip">Coming up</span>}
                    <p className="muted small">{f ? `${seasonFormat(f).title}: ${seasonFormat(f).pitch}` : "The format is the viewers' pick: the vote is on the Season page."}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
