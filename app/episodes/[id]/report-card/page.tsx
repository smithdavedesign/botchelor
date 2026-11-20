import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import ShareButton from "@/app/ShareButton";
import { getDb } from "@/lib/db";
import { getEpisodeView } from "@/lib/game";
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

async function load(id: string) {
  const db = await getDb();
  // What a logged-out spectator may see, whoever opens it: the card never says more than the aired page does.
  const episode = await getEpisodeView(db, id, null);
  return { episode, card: reportCardOf(episode) };
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
  if (!episode || episode.hidden || episode.visibility === "private") notFound();
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
          <caption className="sr-only">Grades by subject</caption>
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

        <p className="report-share">
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
        <Link className="button" href={episodeFromReportCard(id)} data-track="report-card-watch">
          Watch the date
        </Link>
        <Link className="button-ghost" href="/create" data-track="report-card-create">
          Send your own character on one
        </Link>
      </section>
    </>
  );
}
