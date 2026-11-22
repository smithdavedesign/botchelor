import Link from "next/link";
import type { ReactNode } from "react";
import Avatar from "./Avatar";
import { showSetPath } from "@/lib/show-sets";
import type { OpenFace } from "@/lib/home-open";

/**
 * A stranger's whole first screen on home (lib/home-open.ts): the clip and one button.
 *
 * It began as the design system's first screen B, "the season promo" (2026-11-18): the cast on the stage, tonight's
 * story and a call to watch, with the pitch, the sentence box and the day's clip in a second hero right under it. The
 * growth plan (2026-11-19) and the product audit (2026-11-21) both read that as too many first steps for someone
 * arriving cold: seven doors, two heroes, a vote under a headline that says nobody steers, and a season's worth of
 * context (its number, its night, next month's format). So the two are one screen now: the stage, the promise, one
 * field with its button (`box`) and the day's clip playing beside it (`clip`), whose own button is the way to watch
 * first. Nothing else asks for a click.
 *
 * Phone first. The stage is 16:9 and a phone is not, so on a phone the art is a band at its own ratio and the cast
 * stands on its lower edge; then the promise, the field, and the clip's top inside the first screen. From 861px the
 * stage fills the screen behind two columns: the words and the field on the left, the clip in its phone on the right.
 * The one motion besides the clip is dust drifting in the two spotlight beams (the visual pop audit's pass 3), only
 * where motion is welcome. Under the stage its night runs on behind the next section before the page turns to paper.
 * Server-rendered; the field and the clip are the page's own client pieces, handed in.
 */
export default function HomeOpen({
  arc,
  line,
  lede,
  box,
  clip,
}: {
  /** The season strip under the header says where in the season tonight is; on this screen it steps aside (front.css). */
  arc: boolean;
  line: { face: OpenFace; lead: boolean }[];
  /** What to do and what happens, in a sentence or two. */
  lede: string;
  /** The one action: the sentence box (app/HomeExpressBox.tsx). Null while one-sentence create is off: a plain button. */
  box: ReactNode | null;
  /** The day's clip in its phone (app/HomeClip.tsx), or the show's own loop on a day without one. */
  clip: ReactNode | null;
}) {
  return (
    <>
      <section className={`home-open home-open--one${arc ? " home-open--arc" : ""}`} aria-labelledby="home-open-title">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset, the one picture on the screen */}
        <img className="home-open-art" src={showSetPath("stage")} alt="" width={1024} height={576} decoding="async" fetchPriority="high" />
        <div className="home-open-scrim" aria-hidden="true" />
        {/* Dust in the stage's two spotlight beams (front.css): set dressing. */}
        <div className="home-open-dust" aria-hidden="true">
          <span className="home-open-beam is-left">
            <i />
          </span>
          <span className="home-open-beam is-right">
            <i />
          </span>
        </div>
        <div className="home-open-body">
          <div className="home-open-pitch">
            {line.length > 0 && (
              <ul className="home-open-cast" aria-hidden="true">
                {line.map(({ face, lead }) => (
                  <li key={face.id} className={lead ? "home-open-lead" : "home-open-back"}>
                    <Avatar seed={face.id} name={face.name} hue={face.hue} portraitSrc={face.portrait} size={lead ? 96 : 56} fill decorative eager />
                  </li>
                ))}
              </ul>
            )}
            {/* Plain words where the season's number and night stood: a stranger has no season yet. */}
            <p className="kicker home-open-kicker">A new blind date every night</p>
            <h1 id="home-open-title" className="home-open-title">
              An AI blind-date show where nobody steers.
            </h1>
            <p className="home-open-lede">{lede}</p>
            {box ?? (
              <p className="home-open-calls">
                <Link className="button" href="/create" data-track="open-create">
                  Make your character
                </Link>
              </p>
            )}
            <p className="home-open-fine">Fictional characters only, no real people. Every date is written by AI.</p>
          </div>
          {clip && <div className="home-open-clip">{clip}</div>}
        </div>
      </section>
      {/* The stage's night, run on under the next section (front.css .home-open-tail). */}
      <div className="home-open-tail" aria-hidden="true" />
    </>
  );
}
