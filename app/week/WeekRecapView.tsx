import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { EpisodeView } from "@/lib/game";
import { gradeTone, reportCardPath } from "@/lib/report-card";
import { weekLabel, weekOfId, type WeekDate, type WeekRecap } from "@/lib/week-recap";

/** "0:58" from seconds. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/** A week's own words: "Nov 16 to 22", from its id (its Monday). */
export const weekWords = (id: string): string => {
  const week = weekOfId(id);
  return week ? weekLabel(week) : id;
};

/**
 * The week in review (lib/week-recap.ts): the week's video, then the dates in it, each with how it ended and the one
 * thing to do about it (watch the date). Server-rendered; the video is the browser's own player, so it plays inline on
 * a phone and nothing loads until it is pressed (preload: only its length and first frame).
 */
export default function WeekRecapView({ recap, dates, previous, next }: { recap: WeekRecap; dates: { date: WeekDate; view: EpisodeView }[]; previous: string | null; next: string | null }) {
  const label = weekWords(recap.id);
  return (
    <article className="week-recap" data-week-recap={recap.id}>
      <header className="week-recap-head">
        <p className="kicker">Botchelor · {label}</p>
        <h1>The week in review</h1>
        <p className="lede">
          {dates.length === 1 ? "One date" : `${dates.length} dates`} from the week of {label}, in {clock(recap.seconds)}: the line of the night from each, and how it ended.
        </p>
      </header>
      <div className="week-recap-body">
        <div className="week-recap-stage">
          <video
            className="week-recap-video"
            src={recap.src}
            poster={recap.poster_src}
            width={recap.width}
            height={recap.height}
            controls
            playsInline
            preload="metadata"
            aria-label={`The week in review, ${label}: ${clock(recap.seconds)} of the week's dates`}
            data-week-recap-video
          />
          <p className="muted small">Every character is AI, and every date is AI-generated fiction.</p>
        </div>
        <section className="week-recap-list" aria-labelledby="week-recap-dates">
          <h2 id="week-recap-dates">The dates in it</h2>
          <ol className="week-recap-dates">
            {dates.map(({ date, view }) => {
              const [a, b] = view.characters;
              return (
                <li key={date.id} className="card week-date" data-week-date={date.id}>
                  <div className="week-date-pair" aria-hidden="true">
                    <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={56} round decorative />
                    <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={56} round decorative />
                  </div>
                  <div className="week-date-words">
                    <h3>{`${date.names[0]} × ${date.names[1]}`}</h3>
                    {date.title && <p className="week-date-title">{date.title}</p>}
                    {date.ending && (
                      <p className="week-date-ending">
                        <span className="muted small">How it ended</span> <strong>{date.ending}</strong>
                        {date.grade && (
                          <span className={`report-grade grade-${gradeTone(date.grade)}`} aria-label={`Report card grade ${date.grade}`}>
                            {date.grade}
                          </span>
                        )}
                      </p>
                    )}
                    <p className="week-date-links">
                      <Link className="button" href={`/episodes/${encodeURIComponent(date.id)}?play=1`}>
                        Watch the date
                      </Link>
                      {date.grade && <Link href={reportCardPath(date.id)}>Its report card</Link>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      {(previous || next) && (
        <nav className="week-recap-nav" aria-label="Other weeks">
          {previous ? <Link href={`/week/${previous}`}>← The week before ({weekWords(previous)})</Link> : <span />}
          {next ? <Link href={`/week/${next}`}>The week after ({weekWords(next)}) →</Link> : <span />}
        </nav>
      )}
    </article>
  );
}
