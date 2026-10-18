import Link from "next/link";
import Avatar from "@/app/Avatar";
import { formatLabel } from "@/lib/formats";
import type { EpisodeView } from "@/lib/game";
import { dateLabel, ENDING_LABELS } from "@/lib/rules";

/** One episode in a list (Watch's latest episodes, Account's own dates): the pair, where it stands, its setting. */
export default function EpisodeItem({ episode }: { episode: EpisodeView }) {
  const [a, b] = episode.characters;
  const status = episode.hidden
    ? "Hidden after reports"
    : episode.revealed
      ? `Aired: ${episode.ending ? ENDING_LABELS[episode.ending] : ""}`
      : episode.is_creator
        ? "Waiting for the finale"
        : episode.my_pick
          ? `You picked ${ENDING_LABELS[episode.my_pick]}`
          : "Open for predictions";
  return (
    <li className="card">
      <div className="char">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={38} />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={38} />
        <div className="meta">
          <Link href={episode.share_path}>
            <strong>
              {a.name} × {b.name}
            </strong>
          </Link>{" "}
          <span className="badge">{status}</span>
          {episode.format && <span className="badge badge-format">{formatLabel(episode.format)}</span>}
          {episode.followup_of && <span className="badge">{dateLabel(episode.date_number ?? 2)}</span>}
          {(a.agent || b.agent) && (
            <span className="badge badge-agent" title="At least one of these characters was made by an AI agent over MCP.">
              🤖 {a.agent && b.agent ? "Agents' characters" : "Agent-made character"}
            </span>
          )}
        </div>
      </div>
      <p className="muted">{episode.setting}</p>
    </li>
  );
}
