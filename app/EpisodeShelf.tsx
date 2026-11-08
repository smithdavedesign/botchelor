import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { EpisodeView } from "@/lib/game";
import { dateLabel, dateNumberOf } from "@/lib/rules";
import { venueBackdropCss } from "@/lib/venues";

/**
 * A shelf of episode cards (docs/show-style.md: faces first, varied down the row): each card is a small title card —
 * the venue's own gradient under a dark grade, the couple's faces, the names, and the episode's title when one was
 * written (else the setting as the tease). Sideways on a phone (scroll-snap), a row of three on desktop. Spoiler-free:
 * never the ending. A tap on an aired date lands in the theater, playing (`?play=1`, 2026-11-07 audit item 4).
 */
export default function EpisodeShelf({ episodes }: { episodes: EpisodeView[] }) {
  if (!episodes.length) return null;
  return (
    <ul className="episode-shelf" aria-label="Latest episodes">
      {episodes.map((episode) => {
        const [a, b] = episode.characters;
        const dateNo = dateNumberOf(episode);
        return (
          <li
            key={episode.id}
            className="episode-shelf-card tap-card"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(20, 8, 30, 0.45) 0%, rgba(20, 8, 30, 0.62) 55%, rgba(20, 8, 30, 0.9) 100%), ${
                episode.venue ? venueBackdropCss(episode.venue) : "linear-gradient(135deg, #3a1630, #1d1030)"
              }`,
            }}
          >
            <span className="pair-faces" aria-hidden="true">
              <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} decorative />
              <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} decorative />
            </span>
            <Link className="stretch episode-shelf-names" href={episode.revealed ? `${episode.share_path}?play=1` : episode.share_path}>
              <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
            </Link>
            {episode.title ? <span className="episode-shelf-title">“{episode.title}”</span> : <span className="episode-shelf-setting">{episode.setting}</span>}
            {dateNo && dateNo > 1 && <span className="episode-shelf-chip">{dateLabel(dateNo)}</span>}
          </li>
        );
      })}
    </ul>
  );
}
