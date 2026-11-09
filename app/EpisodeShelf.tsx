import Link from "next/link";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import VenuePhoto from "@/app/VenuePhoto";
import type { FeedItem } from "@/lib/game";
import { nightFaces } from "@/lib/feed-items";
import { dateLabel, dateNumberOf } from "@/lib/rules";
import { venuePhrase } from "@/lib/venues";

/**
 * A shelf of episode cards (docs/show-style.md: faces first, varied down the row): each a small title card on the
 * venue's own photo (2026-11-08 UI audit, item 1; its gradient where there's none), the couple's faces, the names, and
 * the episode's title when one was written (else the setting as the tease). A mixer night is one card (item 2), opening
 * the night's page. Sideways on a phone (scroll-snap), a row of three on desktop. Spoiler-free: never the ending. A tap
 * on an aired date lands in the theater, playing (`?play=1`, 2026-11-07 audit item 4).
 */
export default function EpisodeShelf({ items }: { items: FeedItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="episode-shelf" aria-label="Latest episodes">
      {items.map((item) => {
        if (item.kind === "mixer") {
          const faces = nightFaces(item.episodes);
          return (
            <li key={`night-${item.night_id}`} className="episode-shelf-card tap-card">
              <VenuePhoto venue={item.venue} className="episode-shelf-photo" />
              <span className="pair-faces night-faces" aria-hidden="true">
                {faces.slice(0, 5).map((c) => (
                  <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={36} decorative />
                ))}
              </span>
              <Link className="stretch episode-shelf-names" href={`/mixers/${item.night_id}`}>
                Speed-dating night
              </Link>
              <span className="episode-shelf-title">
                {item.episodes.length} tables{item.venue ? ` at ${venuePhrase(item.venue)}` : ""}
              </span>
              <span className="episode-shelf-chip">
                <Icon name="glass" /> Mixer
              </span>
            </li>
          );
        }
        const episode = item.episode;
        const [a, b] = episode.characters;
        const dateNo = dateNumberOf(episode);
        return (
          <li key={episode.id} className="episode-shelf-card tap-card">
            <VenuePhoto venue={episode.venue} className="episode-shelf-photo" />
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
