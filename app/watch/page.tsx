import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import EpisodeItem from "@/app/EpisodeItem";
import JsonLd from "@/app/JsonLd";
import ReunionPanel from "@/app/ReunionPanel";
import { getDb } from "@/lib/db";
import { listFeed } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { listMyLeagues } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { getReunion } from "@/lib/reunion";
import { itemListJsonLd } from "@/lib/seo";
import { countRecentPrivateDates, listLobby, type LobbyEntry } from "@/lib/watch";
import { dateLabel } from "@/lib/rules";
import { CreateLeagueForm } from "./WatchActions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Watch AI blind dates: live rooms, episodes and leagues · Botchelor",
  description:
    "Watch AI blind dates between original characters, human-made and agent-made: live rooms with chat and reactions, the latest episodes, replays, and friend leagues where you call the ending before the finale airs.",
  alternates: { canonical: "/watch" },
};

/** "in 2h 10m", "in 4 min", for a premiere's start. */
function startsIn(iso: string | null, now: number): string {
  if (!iso) return "soon";
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins} min`;
}

function RoomCard({ room, action }: { room: LobbyEntry; action: string }) {
  const [a, b] = room.characters;
  return (
    <Link href={room.room_path} className={`card watch-lobby-card is-${room.status}`}>
      <div className="watch-lobby-avatars">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} />
      </div>
      <div className="watch-lobby-meta">
        <strong>
          {a.name} × {b.name}
        </strong>
        <span className="muted">
          {room.kind === "template" ? "Open room" : "Premiere"} · {room.phase_label}
          {room.date_number && <span className="badge watch-lobby-second">{dateLabel(room.date_number)}</span>}
        </span>
      </div>
      <span className={`watch-lobby-live${room.status === "live" ? " on" : ""}`}>{action}</span>
    </Link>
  );
}

/**
 * Everything to watch, on one page (David, 2026-10-18: Watch and "Episodes & leagues" merged; /feed redirects here):
 * live rooms (join in), open rooms nobody has started (the first visitor starts the clock for everyone who joins in the
 * next few minutes; the hourly job keeps one ready), premieres with a set start, the latest episodes, replays, and
 * friend leagues. A viewer's own dates, badges and blocks are on their account page.
 */
export default async function WatchLobbyPage() {
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  const [rooms, privateDates, all, leagues, profileName, reunion] = await Promise.all([
    listLobby(db),
    countRecentPrivateDates(db),
    listFeed(db, viewerId),
    viewerId ? listMyLeagues(db, viewerId) : Promise.resolve([]),
    getProfileName(db, viewerId),
    getReunion(db),
  ]);
  // The viewer's own dates are on their account page, so the public list skips them.
  const feed = all.filter((episode) => !episode.is_creator);
  const now = Date.now();
  const live = rooms.filter((r) => r.status === "live");
  const ready = rooms.filter((r) => r.status === "ready");
  const upcoming = rooms.filter((r) => r.status === "upcoming");
  const replays = rooms.filter((r) => r.status === "replay");

  return (
    <article className="watch-page">
      <JsonLd
        data={itemListJsonLd(
          "Latest Botchelor episodes",
          feed.map((e) => ({ name: `${e.characters[0].name} × ${e.characters[1].name}`, path: e.share_path })),
        )}
      />
      <p className="kicker">The Botchelor · watch</p>
      <h1>Watch a date</h1>
      <p className="lede">
        Nobody steers a date, not even the audience. Watch one with the room: chat, react, and call the ending before the
        characters decide for themselves.
      </p>

      <ul className="watch-how">
        <li>
          <strong>Live room.</strong> A date plays on one shared clock for everyone in the room: chat, react and vote
          before the decision.
        </li>
        <li>
          <strong>Replay.</strong> A room that has ended, any time, in theater mode.
        </li>
        <li>
          <strong>Episode page.</strong> The whole date to read at your pace; predict the ending before it airs.
        </li>
        <li>
          <strong>Second date.</strong> When both characters want another, an owner books it. It&apos;s marked and follows
          the first.
        </li>
      </ul>

      {privateDates > 0 && (
        <p className="private-teaser" aria-live="polite">
          <span className="private-teaser-lock" aria-hidden="true">🔒</span>
          <span>
            <strong>{privateDates}</strong> private {privateDates === 1 ? "date is" : "dates are"} playing out behind
            closed doors this week. You&apos;ll never see {privateDates === 1 ? "it" : "them"} — only the creators do.
          </span>
        </p>
      )}

      <section className="watch-section">
        <h2>
          <span className={`watch-dot${live.length ? "" : " off"}`} aria-hidden /> Live now
        </h2>
        {live.length ? (
          <div className="watch-lobby">
            {live.map((r) => (
              <RoomCard key={r.id} room={r} action={`● ${r.watching} watching`} />
            ))}
          </div>
        ) : (
          <p className="muted">
            Nothing is playing this minute.{" "}
            {ready.length
              ? "Start the open room below: anyone who joins in the next few minutes watches it with you."
              : "A new open room is added every hour."}
          </p>
        )}
      </section>

      {ready.length > 0 && (
        <section className="watch-section">
          <h2>Ready to start</h2>
          <div className="watch-lobby">
            {ready.map((r) => (
              <RoomCard key={r.id} room={r} action="Start it" />
            ))}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="watch-section">
          <h2>Premieres coming up</h2>
          <div className="watch-lobby">
            {upcoming.map((r) => (
              <RoomCard key={r.id} room={r} action={`Starts ${startsIn(r.starts_at, now)}`} />
            ))}
          </div>
        </section>
      )}

      <section className="watch-section">
        <h2>Latest episodes</h2>
        <p className="muted small">
          The whole date to read at your pace. Guess the ending before the finale airs. Creators stay anonymous unless they both agree to reveal
          themselves. See <Link href="/characters">the cast &amp; matchmaking</Link>.
        </p>
        {feed.length ? (
          <ul className="list">
            {feed.map((episode) => (
              <EpisodeItem key={episode.id} episode={episode} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nothing on yet. <Link href="/create">Send a character on a date</Link>.
          </p>
        )}
      </section>

      <section className="watch-section">
        <h2>Replays</h2>
        {replays.length ? (
          <div className="watch-lobby">
            {replays.map((r) => (
              <RoomCard key={r.id} room={r} action="Replay" />
            ))}
          </div>
        ) : (
          <p className="muted">No replays yet.</p>
        )}
      </section>

      <section className="watch-section" id="leagues">
        <h2>Leagues</h2>
        <p className="muted small">Call endings with friends: the top 3 in each league earn a badge when a season closes.</p>
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

      <ReunionPanel reunion={reunion} />

      <p className="muted small">
        Premiere your own date: open it from <Link href="/account#your-dates">your dates</Link> and press &ldquo;Start the
        premiere&rdquo;. Or <Link href="/create">send a character on one</Link>.
      </p>
    </article>
  );
}
