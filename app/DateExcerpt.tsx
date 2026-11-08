import type { CSSProperties } from "react";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { FeaturedDate } from "@/lib/featured-date";
import { venueBackdropCss, venuePhrase } from "@/lib/venues";

/**
 * A few opening lines of a real aired date (lib/featured-date.ts), typing in one after another like the theater plays
 * them, over the venue's own colours, with the way to watch the rest. CSS only (no script): every line is in the page
 * from the start, so a screen reader and a crawler read it all, and the layout never moves. With reduced motion it
 * simply shows. `still` draws it without the typing (the 18+ gate's blurred backdrop).
 */
export default function DateExcerpt({ date, still = false, cta = true, className = "" }: { date: FeaturedDate; still?: boolean; cta?: boolean; className?: string }) {
  const [a, b] = date.characters;
  const face = (side: "a" | "b") => (side === "a" ? a : b);
  const where = date.venue ? `at ${venuePhrase(date.venue)}` : null;
  return (
    <figure
      className={`date-excerpt${still ? " is-still" : ""}${className ? ` ${className}` : ""}`}
      style={{ backgroundImage: `linear-gradient(180deg, rgba(20, 8, 30, 0.55), rgba(20, 8, 30, 0.88)), ${date.venue ? venueBackdropCss(date.venue) : "linear-gradient(135deg, #3a1630, #1d1030)"}` }}
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
          return (
            <li key={i} className={`date-excerpt-line is-${line.side}`} style={{ "--i": i } as CSSProperties}>
              <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} portraitSrc={who.portrait} size={28} decorative />
              <span className="date-excerpt-bubble">
                <span className="sr-only">{who.name}: </span>
                {line.text}
              </span>
              {!still && (
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
      {cta && (
        <figcaption className="date-excerpt-cta">
          <Link className="button" href={`${date.share_path}?play=1`} data-track="excerpt-watch">
            ▶ Watch how it ends
          </Link>
          <span className="date-excerpt-note">A real date from the show: nobody wrote it in advance.</span>
        </figcaption>
      )}
    </figure>
  );
}
