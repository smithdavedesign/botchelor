import Link from "next/link";
import { invitePath } from "@/lib/leagues";
import { badgeLabel } from "@/lib/rules";
import { seasonLabel, type Badge, type PodiumEntry } from "@/lib/seasons";

/** A closed season's top 3 in one league (M4). Badges are free and carry no prizes. */
export function Podium({ entries }: { entries: PodiumEntry[] }) {
  return (
    <ol className="podium">
      {entries.map((entry, i) => (
        <li key={i} className={entry.me ? "me" : undefined}>
          <span className={`medal medal-${entry.place}`}>{badgeLabel(entry.place)}</span> <strong>{entry.name}</strong>
          {entry.me && " (you)"} <span className="muted">· {entry.points} points</span>
        </li>
      ))}
    </ol>
  );
}

/** The viewer's own badges, across their leagues, newest season first. */
export function BadgeList({ badges }: { badges: Badge[] }) {
  return (
    <ul className="list">
      {badges.map((badge) => (
        <li key={`${badge.season_id}-${badge.league_id}`} className="card">
          <span className={`medal medal-${badge.place}`}>{badgeLabel(badge.place)}</span> in{" "}
          <Link href={invitePath(badge.league_id)}>
            <strong>{badge.league_name}</strong>
          </Link>{" "}
          <span className="muted">
            · {seasonLabel(badge.season_id)} · {badge.points} points
          </span>
        </li>
      ))}
    </ul>
  );
}
