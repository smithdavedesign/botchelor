import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import Avatar from "@/app/Avatar";
import ShareButton from "@/app/ShareButton";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import {
  episodeFromReportCard,
  gradeTone,
  reportBlueskyShareUrl,
  reportCardDescription,
  reportCardImagePath,
  reportCardOf,
  reportCardPath,
  reportCardStoryPath,
  reportCardTitle,
  reportRedditShareUrl,
  seeAgainWords,
  sharedReportCardPath,
} from "@/lib/report-card";
import { siteUrl } from "@/lib/site";

type Props = { params: Promise<{ id: string }> };

// Once per request: the metadata and the page both read it (2026-11-22 audit: a private date's card took 6.3 s).
const load = cache(async (id: string) => {
  const db = await getDb();
  // What a logged-out spectator may see, whoever opens it: the card never says more than the aired page does.
  const episode = await getEpisodeView(db, id, null);
  return { episode, card: reportCardOf(episode) };
});

/**
 * A private date this viewer may watch (its host or an owner of one of the two): its names, so its people read why it
 * has no card rather than "doesn't exist, or hidden after reports" (2026-11-22 audit). Null for anyone else.
 */
async function ownPrivateDate(id: string): Promise<{ names: [string, string] } | null> {
  const viewerId = userIdFromCookieStore(await cookies());
  if (!viewerId) return null;
  const mine = await getEpisodeView(await getDb(), id, viewerId).catch(() => null);
  if (!mine || mine.hidden || mine.visibility !== "private" || !(mine.is_creator || mine.is_host)) return null;
  return { names: [mine.characters[0].name, mine.characters[1].name] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { card } = await load(id);
  if (!card) return { title: "Report card · Botchelor", robots: { index: false, follow: false } };
  const title = reportCardTitle(card);
  const description = reportCardDescription(card);
  const image = { url: reportCardImagePath(id), width: 1200, height: 630, alt: `${title}. ${description}` };
  return {
    title: `${card.names[0]} × ${card.names[1]}: date report card · Botchelor`,
    description,
    // A share, not a page to find: the episode is the one search should have.
    alternates: { canonical: reportCardPath(id) },
    robots: { index: false, follow: true },
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: reportCardPath(id), images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/**
 * A date's report card (lib/report-card.ts): the aired date graded like a school report, each character's own verdict
 * and the quote of the night, with the share right on it. A date that hasn't aired (or that a spectator can't see) has
 * none: an unaired one goes to its episode, where it can still be called; anything else is a 404.
 */
export default async function ReportCardPage({ params }: Props) {
  const { id } = await params;
  const { episode, card } = await load(id);
  if (!episode || episode.hidden || episode.visibility === "private") {
    const own = await ownPrivateDate(id);
    if (!own) notFound();
    return (
      <article className="card report-card report-card-private" data-report-card="private">
        <p className="kicker">Botchelor · date report card</p>
        <h1>Private dates have no report card</h1>
        <p>
          {`${own.names[0]} × ${own.names[1]} is private: only you can watch it, so it isn't graded against the dates on the air.`} Put it on
          the air from the date&apos;s page and it gets one once it has aired.
        </p>
        <p>
          <Link className="button" href={`/episodes/${encodeURIComponent(id)}`}>
            Back to the date
          </Link>
        </p>
      </article>
    );
  }
  if (!card) redirect(`/episodes/${encodeURIComponent(id)}`);
  const [a, b] = episode.characters;
  const shareUrl = `${siteUrl()}${sharedReportCardPath(id)}`;
  return (
    <>
      <article className={`card report-card report-${gradeTone(card.overall)}`} data-report-card={card.overall}>
        <header className="report-head">
          <p className="kicker">Botchelor · date report card</p>
          <div className="report-pair" aria-hidden="true">
            <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={56} round />
            <span className="report-x">×</span>
            <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={56} round />
          </div>
          <h1>{`${card.names[0]} × ${card.names[1]}`}</h1>
          <div className="report-overall">
            <span className={`report-grade report-grade-big grade-${gradeTone(card.overall)}`} aria-label={`Overall grade ${card.overall}`}>
              {card.overall}
            </span>
            <span className="report-ending">
              <span className="muted small">How it ended</span>
              <strong>{card.ending}</strong>
            </span>
          </div>
        </header>

        <table className="report-subjects">
          {/* Said over the grades (2026-11-22 audit: "Rose a little · D" beside "Rose a little · A" read as a contradiction):
              the words are this night, the letter is where it stands among every aired date. */}
          <caption className="report-subjects-note muted small">Each grade compares this date with every date on the air; the words say how it went on the night.</caption>
          <tbody>
            {card.subjects.map((s) => (
              <tr key={s.variable} data-subject={s.variable}>
                <th scope="row">
                  {s.label}
                  {s.variable === "awkwardness" && <span className="muted small"> (less is better)</span>}
                </th>
                <td className="report-comment muted">{s.comment}</td>
                <td>
                  <span className={`report-grade grade-${gradeTone(s.grade)}`}>{s.grade}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {card.verdicts.length > 0 && (
          <section className="report-verdicts">
            <h2>Their own verdicts</h2>
            <ul>
              {card.verdicts.map((v) => (
                <li key={v.characterId} data-verdict={v.kind === "see_again" ? v.seeAgain : "diary"}>
                  <strong>{shortName(v.name)}</strong>
                  {v.kind === "see_again" && v.seeAgain && <span className={`report-again again-${v.seeAgain}`}>{seeAgainWords(v.seeAgain)}</span>}
                  {v.line && <q>{v.line}</q>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {card.quote && (
          <blockquote className="report-quote">
            <span className="muted small">Quote of the night</span>
            <q>{card.quote}</q>
          </blockquote>
        )}

        {/* Watch first, then the ways to share (the 2026-11-22 audit: "Watch the date" came after three share buttons). */}
        <p className="report-share">
          <Link className="button" href={episodeFromReportCard(id)} data-track="report-card-watch">
            Watch the date
          </Link>
          <ShareButton
            path={sharedReportCardPath(id)}
            title={reportCardTitle(card)}
            targets={[
              { label: "Reddit", href: reportRedditShareUrl(shareUrl, card) },
              { label: "Bluesky", href: reportBlueskyShareUrl(shareUrl, card) },
            ]}
            track="share-report-card"
            label="📝 Share the report card"
          />
          <a className="button-ghost" href={reportCardImagePath(id)} download={`botchelor-report-card-${id}.png`} data-track="report-card-image">
            Save the picture
          </a>
          <a className="button-ghost" href={reportCardStoryPath(id)} download={`botchelor-report-card-${id}-story.png`} data-track="report-card-story">
            Save for stories
          </a>
        </p>
        <p className="muted small">Graded on a curve against every date that has aired on the show. Nobody wrote these lines: two AI characters did, and nobody steered them.</p>
      </article>

      <section className="card report-next">
        <Link className="button-ghost" href="/create" data-track="report-card-create">
          Send your own character on one
        </Link>
      </section>
    </>
  );
}
