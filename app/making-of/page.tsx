import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import CountUp from "@/app/motion/CountUp";
import PromoVideo from "@/app/PromoVideo";
import { busiestDay, claudeShare, dayNumber, episodes, longDay, MAKING_OF, MAKING_OF_PATH, REPO_URL, shortDay } from "@/lib/making-of";
import { PROMO } from "@/lib/promo-videos";
import { pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import Episodes from "./Episodes";
import TimeMachine from "./TimeMachine";
import s from "./making-of.module.css";

const { totals, days, chapters, frames, first, dayOne } = MAKING_OF;
const n = (x: number) => x.toLocaleString("en-US");

export const metadata: Metadata = pageMetadata({
  title: `The making of Botchelor: ${totals.days} days, built in public · Botchelor`,
  description: `How one person and a crew of AI agents built Botchelor: ${n(totals.prs)} pull requests in ${totals.days} days, day by day, in ${n(totals.screenshots)} screenshots and a time-lapse.`,
  path: MAKING_OF_PATH,
  image: { url: "/making-of/share.png", width: 1200, height: 630, alt: "The making of Botchelor: the site on a laptop and a phone, day by day", type: "image/png" },
});

/** How many of day one's commits the page lists before "and N more". */
const DAY_ONE_SHOWN = 7;

/** How a change gets made, in the order it happens (app/about's "How it's made" says the same, shorter). */
const LINE: { title: string; body: string }[] = [
  { title: "A task", body: "From the founder, an audit, or a report filed by one of the AI visitors that try the show." },
  { title: "An agent writes it", body: "Claude Code, on its own copy of the code, tests included. Several work at once." },
  { title: "A pull request", body: `Every change, however small: ${n(totals.prs)} so far.` },
  { title: "Seven checks", body: "Types, four shards of tests, a build and browser tests. One red check and it waits." },
  { title: "It merges itself", body: "Once every check is green, and botchelor.com deploys from main." },
  { title: "Screenshots", body: "For new features, a real browser, usually on the live site, saved next to the code. You've been scrolling through them." },
];

/**
 * The making of Botchelor (2026-11-23): the site as it grew, from the screenshots its pull requests committed, for the
 * curious, for Hacker News and Product Hunt. Every number comes from git and GitHub through lib/making-of-data.json
 * (scripts/making-of/collect.mjs); nothing here reads the database. Open without the 18+ gate (proxy.ts UNGATED_PAGES):
 * every picture on it is from the PG show.
 */
export default function MakingOfPage() {
  const eps = episodes(MAKING_OF);
  const busiest = busiestDay(days);
  const shown = dayOne.slice(0, DAY_ONE_SHOWN);
  const moreThatDay = dayOne.filter((c) => c.pr).length - shown.filter((c) => c.pr).length;

  const base = siteUrl();
  return (
    <article className={`page-wide ${s.page}`}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "VideoObject",
          name: `The making of Botchelor: ${totals.days} days in under a minute`,
          description: `A time-lapse of botchelor.com being built, day by day, from the screenshots its pull requests committed.`,
          thumbnailUrl: `${base}${PROMO.makingOf.poster}`,
          contentUrl: `${base}${PROMO.makingOf.src}`,
          uploadDate: MAKING_OF.last,
          embedUrl: `${base}${MAKING_OF_PATH}`,
        }}
      />
      <header className={s.band}>
        <div className={s.bandInner}>
          <p className={s.kicker}>
            <span className={s.rec} aria-hidden="true" /> The making of Botchelor
          </p>
          <h1 className={s.title}>
            {totals.days} days, <em>on camera.</em>
          </h1>
          <p className={s.lede}>
            Botchelor is a blind-date show for original characters. One person and a crew of AI agents built it in the open:{" "}
            {n(totals.prs)} pull requests in {totals.days} days, and along the way {n(totals.screenshots)} screenshots from a real
            browser, each taken as proof that a change worked. Here are {frames.length} of them, day by day.
          </p>
          <TimeMachine frames={frames} days={days} chapters={chapters} first={first} />
          <details className={s.dataTable}>
            <summary>The chart as a table</summary>
            <table>
              <caption className="sr-only">Pull requests merged each day, Pacific time</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Date</th>
                  <th scope="col">Pull requests merged</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td>{dayNumber(d.day, first)}</td>
                    <td>{longDay(d.day)}</td>
                    <td>{d.prs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </header>

      <dl className={s.stats}>
        <div>
          <dt>days from the first line</dt>
          <dd>
            <CountUp value={totals.days} />
          </dd>
        </div>
        <div>
          <dt>pull requests merged</dt>
          <dd>
            <CountUp value={totals.prs} />
          </dd>
        </div>
        <div title={`${n(totals.byClaude)} of ${n(totals.prs)}`}>
          <dt>of them opened by Claude Code</dt>
          <dd>
            <CountUp value={claudeShare(totals)} suffix="%" />
          </dd>
        </div>
        <div>
          <dt>screenshots committed</dt>
          <dd>
            <CountUp value={totals.screenshots} />
          </dd>
        </div>
        <div>
          <dt>merged on the busiest day, {shortDay(busiest.day)}</dt>
          <dd>
            <CountUp value={busiest.prs} />
          </dd>
        </div>
      </dl>

      <section className={s.dayOne} aria-labelledby="day-one">
        <div className={s.dayOneWords}>
          <p className={s.sectionKicker}>Day one</p>
          <h2 id="day-one">An idea before breakfast, a show by the afternoon.</h2>
          <p>
            The first commit is one line describing the show. Six hours later the first working version merged, with its tests
            passing. Here&apos;s day one, as git remembers it.
          </p>
        </div>
        <ol className={s.script}>
          {shown.map((c) => (
            <li key={`${c.time}-${c.pr ?? "idea"}`}>
              <time className={s.scriptTime}>{c.time}</time>
              <span className={s.scriptLine}>
                {c.pr ? (
                  <a href={`${REPO_URL}/pull/${c.pr}`} rel="noopener" target="_blank">
                    #{c.pr}
                  </a>
                ) : (
                  <span className={s.scriptIdea}>first commit</span>
                )}{" "}
                {c.title}
              </span>
            </li>
          ))}
          {moreThatDay > 0 && <li className={s.scriptMore}>…and {moreThatDay} more pull requests before midnight.</li>}
        </ol>
      </section>

      <section className={s.season} aria-labelledby="season">
        <p className={s.sectionKicker}>The season so far</p>
        <h2 id="season">Six weeks, six episodes.</h2>
        <p className={s.sectionLede}>Each week as an episode, with the screenshots it brought. Open one to see it full size, with the pull request behind it.</p>
        <Episodes episodes={eps} first={first} />
      </section>

      <section className={s.line} aria-labelledby="how">
        <p className={s.sectionKicker}>How a change gets made</p>
        <h2 id="how">The production line.</h2>
        <ol className={s.lineSteps}>
          {LINE.map((step, k) => (
            <li key={step.title}>
              <span className={s.lineNo} aria-hidden="true">
                {k + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <p className={s.lineNote}>
          The code is public: <a href={REPO_URL}>github.com/smithdavedesign/botchelor</a>. The founder sets the direction and
          makes the calls a machine shouldn&apos;t; <Link href="/about">who builds it</Link> has the rest.
        </p>
      </section>

      <section className={s.film} aria-labelledby="film">
        <div className={s.filmWords}>
          <p className={s.sectionKicker}>The short version</p>
          <h2 id="film">{totals.days} days in under a minute.</h2>
          <p>The same screenshots as a time-lapse, to watch or to share.</p>
          <p>
            <a className={s.download} href={PROMO.makingOf.src} download data-track="making-of-video">
              Download the video (MP4)
            </a>{" "}
            <Link href="/press">or the whole press kit</Link>
          </p>
        </div>
        <PromoVideo video={PROMO.makingOf} className={s.filmPlayer} />
      </section>

      <section className={s.cta} aria-labelledby="cta">
        <h2 id="cta">That&apos;s how it&apos;s made. Here&apos;s what it makes.</h2>
        <p>Characters people write go on blind dates that the show writes. Free to watch, no account needed.</p>
        <p className={s.ctaButtons}>
          <Link className="button" href="/">
            See what&apos;s on tonight
          </Link>
          <Link className={s.ctaLink} href="/create">
            Make a character →
          </Link>
        </p>
      </section>

      <p className={s.footnote}>
        Days are Pacific time. Each screenshot is shown as it was committed, by the pull request linked under it; numbers come
        from git and GitHub, last counted {shortDay(MAKING_OF.last)}. This page is rebuilt from the repository by{" "}
        <a href={`${REPO_URL}/blob/main/scripts/making-of/collect.mjs`}>one script</a>.
      </p>
    </article>
  );
}
