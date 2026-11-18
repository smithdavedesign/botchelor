import Link from "next/link";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { showSetPath } from "@/lib/show-sets";
import type { OpenFace, OpenTonight } from "@/lib/home-open";

/**
 * A stranger's first screen on home (lib/home-open.ts; the design system's first screen B, "the season promo",
 * 2026-11-18): this season's cast on the stage under the neon heart, tonight's people stepped forward and lit, what is
 * between them, and one call. "Make your character" is the quiet second; the hero with the sentence box is right under.
 *
 * Phone first. The stage is 16:9 and a phone is not, so on a phone the art is a band at its own ratio (curtain, floor
 * and seats all there) and the cast stands on its lower edge; from 861px it fills the screen behind the words. No
 * motion at all, so there is nothing for reduced motion to stop. All server-rendered; no script.
 */
export default function HomeOpen({
  kicker,
  line,
  tonight,
  latest,
  watch,
  next,
}: {
  kicker: string | null;
  line: { face: OpenFace; lead: boolean }[];
  tonight: OpenTonight | null;
  /** On a night with no story: the date the call opens, named ("This week's best date: Sable × Juniper, …"). */
  latest: { label: string; names: string; title: string | null } | null;
  watch: { href: string; label: string };
  next: string | null;
}) {
  return (
    <section className={`home-open${kicker ? " home-open--arc" : ""}`} aria-labelledby="home-open-title">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset, the one picture on the screen */}
      <img className="home-open-art" src={showSetPath("stage")} alt="" width={1024} height={576} decoding="async" fetchPriority="high" />
      <div className="home-open-scrim" aria-hidden="true" />
      <div className="home-open-body">
        {line.length > 0 && (
          <ul className="home-open-cast" aria-hidden="true">
            {line.map(({ face, lead }) => (
              <li key={face.id} className={lead ? "home-open-lead" : "home-open-back"}>
                <Avatar seed={face.id} name={face.name} hue={face.hue} portraitSrc={face.portrait} size={lead ? 96 : 56} fill decorative eager />
              </li>
            ))}
          </ul>
        )}
        {kicker && <p className="kicker home-open-kicker">{kicker}</p>}
        <h1 id="home-open-title" className="home-open-title">
          A blind-date show where nobody steers.
        </h1>
        {tonight ? (
          <p className="home-open-tonight">
            <strong>Tonight:</strong> {tonight.names && <>{tonight.names}. </>}
            {tonight.label && <span className="chip home-open-chip">{tonight.label}</span>} <span className="home-open-quiet">{tonight.text}</span>
          </p>
        ) : (
          latest && (
            <p className="home-open-tonight">
              <strong>{latest.label}:</strong> {latest.names}
              {latest.title && <span className="home-open-quiet">, &ldquo;{latest.title}&rdquo;</span>}.
            </p>
          )
        )}
        <p className="home-open-calls">
          <Link className="button home-open-watch" href={watch.href} data-track="open-watch">
            <Icon name="play" /> {watch.label}
          </Link>
          <Link className="home-open-second" href="/create" data-track="open-create">
            Make your character
          </Link>
        </p>
        {next && <p className="home-open-next">{next}</p>}
        <p className="home-open-fine">Fictional characters only, no real people. Every date is written by AI.</p>
      </div>
    </section>
  );
}
