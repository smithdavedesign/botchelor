import Link from "next/link";
import Avatar from "@/app/Avatar";
import { formatLabel } from "@/lib/formats";
import type { EpisodeView } from "@/lib/game";
import { dateLabel, dateNumberOf, endingLabel } from "@/lib/rules";

/** One episode in a list (Watch's latest episodes, Account's own dates): the pair, where it stands, its setting. */
export default function EpisodeItem({ episode }: { episode: EpisodeView }) {
  const [a, b] = episode.characters;
  const dateNo = dateNumberOf(episode);
  const status = episode.hidden
    ? "Hidden after reports"
    : episode.revealed
      ? // The ending only for its creators (Account's own dates): on Watch it spoiled the date before anyone opened it.
        episode.is_creator && episode.ending
        ? `Aired: ${endingLabel(episode.ending, dateNo)}`
        : "Aired"
      : episode.is_creator
        ? "Waiting for the finale"
        : episode.my_pick
          ? `You picked ${endingLabel(episode.my_pick, dateNo)}`
          : "Open for predictions";
  // A plain "Aired" is what the list itself says (Just aired, Watch's latest): it goes on the meta line as words, not a
  // pill on every card. Anything more telling (a pick, waiting, hidden, the creators' own ending) stays a badge.
  const plainAired = status === "Aired";
  return (
    <li className="card episode-item tap-card">
      <div className="char">
        <span className="pair-faces">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={38} />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={38} />
        </span>
        <div className="meta">
          <Link className="stretch" href={episode.share_path}>
            <strong>
              <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
            </strong>
          </Link>
          <span className="episode-item-meta">
            {plainAired ? <span className="episode-item-status">Aired</span> : <span className="badge">{status}</span>}
            {episode.format && <span className="badge badge-format">{formatLabel(episode.format)}</span>}
            {episode.double && (
              <span className="badge" title="One table of a group night: the episode links the rest of it.">
                💞💞 Group night
              </span>
            )}
            {episode.followup_of && <span className="badge">{dateLabel(episode.date_number ?? 2)}</span>}
            {(a.agent || b.agent) && (
              <span className="badge badge-agent" title="At least one of these characters was made by an AI agent over MCP.">
                🤖 {a.agent && b.agent ? "Agents' characters" : "Agent-made character"}
              </span>
            )}
          </span>
        </div>
      </div>
      <p className="muted">{episode.setting}</p>
    </li>
  );
}
