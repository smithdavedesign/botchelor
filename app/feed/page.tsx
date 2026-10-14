import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { BadgeList } from "@/app/Badges";
import { getDb } from "@/lib/db";
import { listFeed, listMyEpisodes, type EpisodeView } from "@/lib/game";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { listMyLeagues } from "@/lib/leagues";
import { getProfileName, listBlocks } from "@/lib/people";
import { ENDING_LABELS } from "@/lib/rules";
import { formatLabel } from "@/lib/formats";
import { listMyBadges, tryCloseDueSeasons, type Badge } from "@/lib/seasons";
import { CreateLeagueForm, UnblockButton } from "./FeedActions";

export const dynamic = "force-dynamic";

function EpisodeItem({ episode }: { episode: EpisodeView }) {
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
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={38} />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={38} />
        <div className="meta">
          <Link href={episode.share_path}>
            <strong>
              {a.name} × {b.name}
            </strong>
          </Link>{" "}
          <span className="badge">{status}</span>
          {episode.format && <span className="badge badge-format">{formatLabel(episode.format)}</span>}
        </div>
      </div>
      <p className="muted">{episode.setting}</p>
    </li>
  );
}

export default async function FeedPage() {
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = await getDb();
  // The viewer's own dates get their own section below, so the public list skips them.
  const feed = (await listFeed(db, viewerId)).filter((episode) => !episode.is_creator);
  const mine = viewerId ? await listMyEpisodes(db, viewerId) : [];
  const leagues = viewerId ? await listMyLeagues(db, viewerId) : [];
  const blocks = viewerId ? await listBlocks(db, viewerId) : [];
  const profileName = await getProfileName(db, viewerId);
  // A season that ended since anyone last looked is closed here, so the viewer's new badges show (M4).
  let badges: Badge[] = [];
  if (viewerId && leagues.length) {
    await tryCloseDueSeasons(db);
    badges = await listMyBadges(db, viewerId);
  }

  return (
    <>
      <h1>Now showing</h1>
      <p className="muted">
        Blind dates between original characters, written by AI. Guess the ending before the finale airs. Creators stay
        anonymous unless they both agree to reveal themselves. See <Link href="/cast">the cast &amp; matchmaking</Link>.
      </p>

      {mine.length > 0 && (
        <section>
          <h2>Your characters&apos; dates</h2>
          <ul className="list">
            {mine.map((episode) => (
              <EpisodeItem key={episode.id} episode={episode} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Latest episodes</h2>
        {feed.length ? (
          <ul className="list">
            {feed.map((episode) => (
              <EpisodeItem key={episode.id} episode={episode} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nothing on yet. <Link href="/">Send a character on a date</Link>.
          </p>
        )}
      </section>

      <section>
        <h2>Your leagues</h2>
        {leagues.length > 0 && (
          <ul className="list">
            {leagues.map((league) => (
              <li key={league.id} className="card">
                <Link href={league.invite_path}>
                  <strong>{league.name}</strong>
                </Link>{" "}
                <span className="muted">
                  {league.members} {league.members === 1 ? "player" : "players"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <CreateLeagueForm hasName={profileName !== null} />
      </section>

      {badges.length > 0 && (
        <section>
          <h2>Your badges</h2>
          <p className="muted">The top 3 in each league earn one when a season closes. Badges are free and carry no prizes.</p>
          <BadgeList badges={badges} />
        </section>
      )}

      {blocks.length > 0 && (
        <section>
          <h2>Blocked creators</h2>
          <p className="muted">Listed by the episode you blocked them from; they stay anonymous.</p>
          <ul className="list">
            {blocks.map((block) => (
              <li key={block.episode_id} className="card">
                <Link href={block.share_path}>{block.title}</Link> <UnblockButton episodeId={block.episode_id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
