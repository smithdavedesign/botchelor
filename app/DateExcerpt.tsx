import type { CSSProperties } from "react";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import FirstRunCall from "@/app/FirstRunCall";
import Icon from "@/app/Icon";
import type { FeaturedDate } from "@/lib/featured-date";
import { venueBackdrop } from "@/lib/portraits";
import { venueBackdropCss, venuePhrase } from "@/lib/venues";

/** The opening lines that are simply there when the card appears; the rest type in after them. */
export const EXCERPT_LINES_AT_ONCE = 2;

/**
 * A few opening lines of a real aired date (lib/featured-date.ts) over the venue's own photo, with the way to watch the
 * rest. The first two are there at once and the others type in after them, like the theater plays them (2026-11-08 UI
 * audit, item 3: with every line typing in, the card sat half empty for its first seconds, the very seconds a visitor
 * looks). CSS only (no script): every line is in the page from the start, so a screen reader and a crawler read it all,
 * and the layout never moves. With reduced motion it simply shows. `still` draws it without the typing (the 18+ gate's
 * blurred backdrop). `wide` lays it out in two columns on a wide screen, the pair and the button beside the lines
 * (Watch's lead, on its wide page).
 */
export default function DateExcerpt({
  date,
  still = false,
  cta = true,
  wide = false,
  call = false,
  className = "",
}: {
  date: FeaturedDate;
  still?: boolean;
  cta?: boolean;
  wide?: boolean;
  /** The first-run track (app/FirstRunCall.tsx): call the ending on the card, then "Now send yours". A visitor's hero. */
  call?: boolean;
  className?: string;
}) {
  const [a, b] = date.characters;
  const face = (side: "a" | "b") => (side === "a" ? a : b);
  const where = date.venue ? `at ${venuePhrase(date.venue)}` : null;
  const photo = date.venue ? venueBackdrop(date.venue) : null;
  const backdrop = [
    "linear-gradient(180deg, rgba(20, 8, 30, 0.6), rgba(20, 8, 30, 0.9))",
    photo ? `url(${photo})` : null,
    date.venue ? venueBackdropCss(date.venue) : "linear-gradient(135deg, var(--photo-bg), var(--photo-bg))",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <figure
      className={`date-excerpt${still ? " is-still" : ""}${wide ? " is-wide" : ""}${className ? ` ${className}` : ""}`}
      style={{ backgroundImage: backdrop }}
    >
      <div className="date-excerpt-head">
        <span className="pair-faces" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={36} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={36} decorative />
        </span>
        <span className="date-excerpt-who">
          <strong>
            <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
          </strong>
          <span className="date-excerpt-meta">{[date.code, date.title ? `“${date.title}”` : where].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      <ol className="date-excerpt-lines" aria-label="The date's first lines">
        {date.lines.map((line, i) => {
          const who = face(line.side);
          const atOnce = i < EXCERPT_LINES_AT_ONCE;
          return (
            <li
              key={i}
              className={`date-excerpt-line is-${line.side}${atOnce ? " is-now" : ""}`}
              style={atOnce ? undefined : ({ "--i": i - EXCERPT_LINES_AT_ONCE } as CSSProperties)}
            >
              <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} portraitSrc={who.portrait} size={28} decorative />
              <span className="date-excerpt-bubble">
                <span className="sr-only">{who.name}: </span>
                {line.text}
              </span>
              {!still && !atOnce && (
                <span className="date-excerpt-typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {cta && call && date.ending ? (
        <figcaption className="date-excerpt-cta is-call">
          <FirstRunCall ending={date.ending} dateNumber={date.date_number} watchHref={`${date.share_path}?play=1`} />
          <span className="date-excerpt-note">A real date from the show: nobody wrote it in advance.</span>
        </figcaption>
      ) : (
        cta && (
          <figcaption className="date-excerpt-cta">
            <Link className="button" href={`${date.share_path}?play=1`} data-track="excerpt-watch">
              <Icon name="play" /> Watch how it ends
            </Link>
            <span className="date-excerpt-note">A real date from the show: nobody wrote it in advance.</span>
          </figcaption>
        )
      )}
    </figure>
  );
}
