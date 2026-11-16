import Link from "next/link";
import Icon from "@/app/Icon";
import { clipCaption, type ShowClip } from "@/lib/home-clip";

/**
 * From the show (lib/home-clip.ts listShowClips): the show's own clips of dates that aired, in the Gallery beside what
 * creators made. Each is its poster and a way into the whole date: nothing loads a video here, and the tile says which
 * date and which season it is from. Absent when there are none.
 */
export default function ShowClips({ clips, of }: { clips: ShowClip[]; /** A character the Gallery is filtered to: the heading names them. */ of?: string | null }) {
  if (!clips.length) return null;
  return (
    <section className="show-clips" aria-labelledby="show-clips-title">
      <h2 id="show-clips-title" className="section">
        {of ? `From ${of}'s dates on the show` : "From the show"}
      </h2>
      <ul className="show-clips-row">
        {clips.map((c) => (
          <li key={c.id}>
            <Link href={c.watch_href} className="show-clip" data-track="gallery-show-clip" aria-label={`Watch the date: ${clipCaption(c)}`}>
              <span className="show-clip-frame" style={{ aspectRatio: `${c.width} / ${c.height}` }}>
                {/* The poster only: the clip itself plays on the home page; here the tile is the door to the date. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.poster_src} alt="" width={c.width} height={c.height} loading="lazy" decoding="async" />
                <span className="show-clip-play" aria-hidden="true">
                  <Icon name="play" />
                </span>
              </span>
              <span className="show-clip-names">
                {c.names[0]} × {c.names[1]}
              </span>
              <span className="muted small">{[c.ending ? `It ended: ${c.ending}` : "", c.season ?? ""].filter(Boolean).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
