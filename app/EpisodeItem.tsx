import Link from "next/link";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import VenuePhoto from "@/app/VenuePhoto";
import { formatLabel } from "@/lib/formats";
import type { EpisodeView, FeedItem } from "@/lib/game";
import { nightFaces, nightPairs } from "@/lib/feed-items";
import { dateLabel, dateNumberOf, endingLabel, endingWithDetail } from "@/lib/rules";
import { templateEpisodeTitle } from "@/lib/episode-title";
import { venuePhrase } from "@/lib/venues";

/**
 * One episode in Watch's latest list, picture first (2026-11-08 UI audit, item 1): the venue's photo with the couple's
 * faces on it, then the names, the title, where it stands and the setting. On a phone it's a row (the picture a square
 * on the left), so twelve still fit a few screens; wider, a card in a grid.
 */
export default function EpisodeItem({ episode }: { episode: EpisodeView }) {
  const [a, b] = episode.characters;
  const dateNo = dateNumberOf(episode);
  // A written title is the row's billing; the template one would only repeat the setting shown underneath.
  const title = episode.title && episode.title !== templateEpisodeTitle({ venue: episode.venue ?? null, dateNumber: dateNo ?? null }) ? episode.title : null;
  const status = episode.hidden
    ? "Hidden after reports"
    : episode.revealed
      ? // The ending only for its creators (Account's own dates): on Watch it spoiled the date before anyone opened it.
        episode.is_creator && episode.ending
        ? `Aired: ${endingWithDetail(episode.ending, dateNo, episode.ending_detail)}`
        : "Aired"
      : episode.is_creator
        ? "Waiting for the finale"
        : episode.my_pick
          ? `You picked ${endingLabel(episode.my_pick, dateNo)}`
          : "Open for predictions";
  // A plain "Aired" is what the list itself says (Just aired, Watch's latest): it goes on the meta line as words, not a
  // pill on every card. Anything more telling (a pick, waiting, hidden, the creators' own ending) stays a badge.
  const plainAired = status === "Aired";
  const mixer = episode.double && episode.group_kind === "mixer";
  // A mixer's tables are all speed dates: the format badge said what the group badge already does (UI audit, item 2).
  const format = episode.format && !(mixer && episode.format === "speed_date") ? episode.format : null;
  const later = (dateNo && dateNo > 1) || episode.followup_of ? dateLabel(dateNo ?? episode.date_number ?? 2) : null;
  return (
    <li className="card episode-item tap-card">
      <VenuePhoto venue={episode.venue} className="episode-item-photo">
        <span className="pair-faces">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} decorative />
        </span>
        {later && <span className="photo-chip">{later}</span>}
      </VenuePhoto>
      <div className="episode-item-body">
        <Link className="stretch episode-item-names" href={episode.share_path}>
          <strong>
            <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
          </strong>
        </Link>
        {/* The episode's own title (lib/episode-title.ts), once one was written at air time; lists stay quiet otherwise. */}
        {title && <span className="episode-item-title">“{title}”</span>}
        <span className="episode-item-meta">
          {plainAired ? <span className="episode-item-status">Aired</span> : <span className="badge">{status}</span>}
          {format && <span className="badge badge-format">{formatLabel(format)}</span>}
          {/* David, 2026-11-01: "Group night" read as a date of several people; it's one pairing of the night. */}
          {episode.double &&
            (episode.group_kind === "double" ? (
              <span className="badge" title="Two couples at one table: this is one couple's date, and the episode links the other's.">
                <Icon name="users" /> Double date
              </span>
            ) : (
              <span className="badge" title="One of the pairings at a mixer: just these two, and the episode links the rest of the night.">
                <Icon name="glass" /> Speed dating
              </span>
            ))}
          {(a.agent || b.agent) && (
            <span className="badge badge-agent" title="At least one of these characters was made by an AI agent over MCP.">
              <Icon name="bot" /> {a.agent && b.agent ? "Both made by AI agents" : "Made by an AI agent"}
            </span>
          )}
        </span>
        <p className="muted episode-item-setting">{episode.setting}</p>
      </div>
    </li>
  );
}

/** How many faces a night card shows before "+N". */
const NIGHT_FACES = 6;

/**
 * A whole mixer night as one card (2026-11-08 UI audit, item 2): the room's photo, everyone who sat down, how many
 * tables aired and a few of the pairs; it opens the night's own page (/mixers/[id]), every table in order.
 */
export function MixerNightItem({ item }: { item: Extract<FeedItem, { kind: "mixer" }> }) {
  const faces = nightFaces(item.episodes);
  const { line, more } = nightPairs(item.episodes);
  const tables = item.episodes.length;
  return (
    <li className="card episode-item night-item tap-card">
      <VenuePhoto venue={item.venue} className="episode-item-photo">
        <span className="night-faces">
          {faces.slice(0, NIGHT_FACES).map((c) => (
            <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={36} decorative />
          ))}
          {faces.length > NIGHT_FACES && <span className="night-faces-more">+{faces.length - NIGHT_FACES}</span>}
        </span>
        <span className="photo-chip">
          <Icon name="glass" /> {tables} tables
        </span>
      </VenuePhoto>
      <div className="episode-item-body">
        <Link className="stretch episode-item-names" href={`/mixers/${item.night_id}`}>
          <strong>Speed-dating night</strong>
        </Link>
        <span className="episode-item-title">{item.venue ? `At ${venuePhrase(item.venue)}` : "Everyone in one room"}</span>
        <span className="episode-item-meta">
          <span className="episode-item-status">
            {faces.length} singles · {tables} tables aired
          </span>
        </span>
        <p className="muted episode-item-setting">
          {line}
          {more > 0 && ` and ${more} more`}
        </p>
      </div>
    </li>
  );
}

/** A feed entry in Watch's latest list: a date, or a mixer night. */
export function FeedEntry({ item }: { item: FeedItem }) {
  return item.kind === "mixer" ? <MixerNightItem item={item} /> : <EpisodeItem episode={item.episode} />;
}
