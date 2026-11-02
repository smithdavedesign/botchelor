import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import EpisodeItem from "@/app/EpisodeItem";
import JsonLd from "@/app/JsonLd";
import { airWindowMinutes } from "@/lib/air";
import { getDb } from "@/lib/db";
import { CallersBoardPanel, CallsLine } from "@/app/YourCalls";
import { callersBoard, callRecord } from "@/lib/streaks";
import SituationVote from "@/app/SituationVote";
import ShowSince from "@/app/ShowSince";
import ChemistryShiftsPanel from "@/app/ChemistryShifts";
import { chemistryShifts } from "@/lib/chemistry-shifts";
import { showSince } from "@/lib/show-since";
import { situationBoard } from "@/lib/situations";
import { listAiredPage, listAiringSoon, parsePage, type AiringSoon } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { listMyLeagues } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { getReunion, type Reunion } from "@/lib/reunion";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";
import { countRecentPrivateDates, listLobby, type LobbyEntry } from "@/lib/watch";
import { dateLabel, dateNumberOf, endingLabel } from "@/lib/rules";
import { CreateLeagueForm } from "./WatchActions";
import StripPager from "./StripPager";
import Pager from "@/app/Pager";

export const dynamic = "force-dynamic";

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

const TITLE = "Watch AI blind dates: live rooms, episodes and leagues · Botchelor";
const DESCRIPTION =
  "Watch AI blind dates between original characters, human-made and agent-made: live rooms with chat and reactions, the latest episodes, replays, and friend leagues where you call the ending before the finale airs.";

/** Page 1 is plain /watch (the canonical URL); later pages are /watch?page=N, each its own crawlable page. */
const pagePath = (page: number) => (page <= 1 ? "/watch" : `/watch?page=${page}`);

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  return pageMetadata({
    title: page > 1 ? `${TITLE.replace(" · Botchelor", "")} (page ${page}) · Botchelor` : TITLE,
    description: DESCRIPTION,
    path: pagePath(page),
  });
}

/** "in 2h 10m", "in 4 min", for a premiere's start. */
function startsIn(iso: string | null, now: number): string {
  if (!iso) return "soon";
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins} min`;
}

/** "Airs in 6 min", or "Airs any minute" once its window has closed and it's waiting for its turn on air. */
function airsIn(iso: string, now: number): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins < 1) return "Airs any minute";
  return mins >= 60 ? `Airs in ${Math.floor(mins / 60)}h ${mins % 60}m` : `Airs in ${mins} min`;
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
          <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
        </strong>
        <span className="muted">
          {room.kind === "template" ? "Open room" : "Premiere"} · {room.phase_label}
          {room.date_number && <span className="badge watch-lobby-second">{dateLabel(room.date_number)}</span>}
        </span>
      </div>
      {/* A room to start or replay: its action looks like the button it is (the whole card is the link). */}
      <span className={`watch-lobby-live${room.status === "live" ? " on" : ""}${room.status === "ready" || room.status === "replay" ? " is-action" : ""}`}>{action}</span>
    </Link>
  );
}

/** How many replays the strip carries: the newest, sideways, so they never add to the page's length. */
const REPLAYS_SHOWN = 12;

/**
 * The Reunion, as one card (David, 2026-10-21: Watch was "a long scroll"; the whole special sat here, about 4,800px on a
 * phone). The season's numbers and its first award, then the way to the full special on /reunion.
 */
function ReunionTeaser({ reunion }: { reunion: Reunion }) {
  if (!reunion.couples.length && !reunion.confessionals.length && !reunion.awards.length) return null;
  const award = reunion.awards[0];
  return (
    <section className="watch-section">
      <Link href="/reunion" className="card watch-reunion-card">
        <span className="kicker">Season special</span>
        <strong className="watch-reunion-title">The Reunion</strong>
        <span className="muted small">
          {reunion.stats.aired} dates aired · {reunion.stats.couples} {reunion.stats.couples === 1 ? "pairing" : "pairings"} ·{" "}
          {reunion.stats.second_dates} second dates
        </span>
        {award && (
          <span className="watch-reunion-award">
            <span className="watch-lobby-avatars">
              {award.chars.map((c) => (
                <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={32} />
              ))}
            </span>
            <span>
              <strong>{award.title}:</strong> {award.name}
            </span>
          </span>
        )}
        <span className="watch-reunion-cta">See the Reunion →</span>
      </Link>
    </section>
  );
}

/** One unaired date in the "Airing soon" strip: the pair, when it airs, and the call to predict it. */
function AiringCard({ episode, now }: { episode: AiringSoon; now: number }) {
  const [a, b] = episode.characters;
  return (
    <li>
      <Link href={episode.share_path} className="card watch-airing-card">
        <span className="watch-airing-avatars">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={36} />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={36} />
        </span>
        <strong className="watch-airing-names">
          {a.name} × {b.name}
        </strong>
        <span className="chip watch-airing-when">{airsIn(episode.airs_at, now)}</span>
        <span className="watch-airing-call">
          {episode.my_pick ? `You picked ${endingLabel(episode.my_pick, dateNumberOf(episode))}` : "Call it →"}
        </span>
      </Link>
    </li>
  );
}

/**
 * Everything to watch, on one page (David, 2026-10-18: Watch and "Episodes & leagues" merged; /feed redirects here),
 * laid out so a phone sees something to watch on its first screen (2026-10-21): a one-line intro; dates airing soon
 * that you can still call; the live rooms (live now, open rooms nobody has started, premieres with a set start); the
 * latest aired episodes, 12 a page (?page=N); a one-line note about private dates; then replays, friend leagues, the
 * reunion and, folded away, how it all works. A viewer's own dates, badges and blocks are on their account page.
 */
export default async function WatchLobbyPage({ searchParams }: { searchParams: Search }) {
  const page = parsePage((await searchParams).page);
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  const [rooms, privateDates, airing, latest, leagues, profileName, reunion, situation, record, callers, showNews, shifts] = await Promise.all([
    listLobby(db),
    countRecentPrivateDates(db),
    listAiringSoon(db, viewerId, airWindowMinutes()),
    listAiredPage(db, viewerId, page),
    viewerId ? listMyLeagues(db, viewerId) : Promise.resolve([]),
    getProfileName(db, viewerId),
    getReunion(db),
    situationBoard(db, viewerId).catch(() => null),
    callRecord(db, viewerId).catch(() => null),
    callersBoard(db, viewerId).catch(() => null),
    showSince(db, viewerId).catch(() => null),
    chemistryShifts(db).catch(() => null),
  ]);
  const feed = latest.episodes;
  const now = Date.now();
  const live = rooms.filter((r) => r.status === "live");
  const ready = rooms.filter((r) => r.status === "ready");
  const upcoming = rooms.filter((r) => r.status === "upcoming");
  const replays = rooms.filter((r) => r.status === "replay");

  return (
    <article className="watch-page">
      <JsonLd
        data={itemListJsonLd(
          page > 1 ? `Latest Botchelor episodes, page ${page}` : "Latest Botchelor episodes",
          feed.map((e) => ({ name: `${e.characters[0].name} × ${e.characters[1].name}`, path: e.share_path })),
        )}
      />
      <p className="kicker">The Botchelor · watch</p>
      <h1>Watch a date</h1>
      <p className="lede watch-intro">
        AI characters on blind dates nobody steers. Call the ending before it airs.{" "}
        <a href="#how-it-works">How it works</a>
      </p>

      {showNews && <ShowSince card={showNews} />}

      {airing.length === 0 && record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} />}

      {airing.length > 0 && (
        <section className="watch-section" aria-labelledby="airing-soon">
          <h2 id="airing-soon">Airing soon: call it before it airs</h2>
          {record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} />}
          <ul className="watch-airing">
            {airing.map((episode) => (
              <AiringCard key={episode.id} episode={episode} now={now} />
            ))}
          </ul>
        </section>
      )}

      <section className="watch-section">
        {live.length ? (
          <>
            <h2>
              <span className="watch-dot" aria-hidden /> Live now
            </h2>
            <div className="watch-lobby">
              {live.map((r) => (
                <RoomCard key={r.id} room={r} action={`● ${r.watching} watching`} />
              ))}
            </div>
          </>
        ) : (
          // Nothing live: one line, not a heading over an empty space.
          <p className="watch-live-empty">
            <span className="watch-dot off" aria-hidden /> <strong>Nothing live right now.</strong>{" "}
            <span className="muted">
              {ready.length
                ? "Start an open room: anyone who joins in the next few minutes watches it with you."
                : upcoming.length
                  ? `The next premiere starts ${startsIn(upcoming[0].starts_at, now)}.`
                  : "A new open room is added every hour."}
            </span>
          </p>
        )}
        {ready.length > 0 && (
          <>
            <h3 className="watch-subhead">Ready to start</h3>
            <StripPager label="Ready to start pages">
              {ready.map((r) => (
                <RoomCard key={r.id} room={r} action="Start it" />
              ))}
            </StripPager>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h3 className="watch-subhead">Premieres coming up</h3>
            <StripPager label="Premieres pages">
              {upcoming.map((r) => (
                <RoomCard key={r.id} room={r} action={`Starts ${startsIn(r.starts_at, now)}`} />
              ))}
            </StripPager>
          </>
        )}
      </section>

      {situation && <SituationVote board={situation} now={now} />}

      <section className="watch-section" id="latest">
        <h2>Latest episodes{page > 1 ? ` · page ${page}` : ""}</h2>
        {feed.length ? (
          <ul className="list watch-latest-list">
            {feed.map((episode) => (
              <EpisodeItem key={episode.id} episode={episode} />
            ))}
          </ul>
        ) : latest.total > 0 ? (
          <p className="muted">
            There&apos;s no page {page}: the latest episodes run to page {latest.pages}.{" "}
            <Link href={`${pagePath(latest.pages)}#latest`}>Go to page {latest.pages}</Link>.
          </p>
        ) : (
          <p className="muted">
            Nothing has aired yet. <Link href="/create">Send a character on a date</Link>.
          </p>
        )}
        <Pager page={page} pages={latest.pages} label="Latest episodes pages" href={(n) => `${pagePath(n)}#latest`} prev="Newer" next="Older" />
      </section>

      {privateDates > 0 && (
        <p className="private-teaser private-teaser-compact">
          <span className="private-teaser-lock" aria-hidden="true">🔒</span>
          <span>
            <strong>{privateDates}</strong> private {privateDates === 1 ? "date" : "dates"} this week, seen only by
            {privateDates === 1 ? " its creators" : " their creators"}. Yours are in{" "}
            <Link href="/account#your-dates">your dates</Link>.
          </span>
        </p>
      )}

      {/* Shorter (2026-10-31 UX audit, D6): replays fold behind one line, and aren't mentioned when there are none. */}
      {replays.length > 0 && (
        <details className="watch-section watch-replays ux-fold">
          <summary>
            <h2>Replays</h2> <span className="muted small">{replays.length > REPLAYS_SHOWN ? `the newest ${REPLAYS_SHOWN} of ${replays.length}` : replays.length}</span>
          </summary>
          <StripPager label="Replays pages">
            {replays.slice(0, REPLAYS_SHOWN).map((r) => (
              <RoomCard key={r.id} room={r} action="Replay" />
            ))}
          </StripPager>
        </details>
      )}

      {shifts && <ChemistryShiftsPanel shifts={shifts} />}

      {callers && <CallersBoardPanel board={callers} nameless={viewerId !== null && profileName === null} />}

      <section className="watch-section" id="leagues">
        {leagues.length > 0 && <h2>Your leagues</h2>}
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
        {/* Folded: the form is tall, and most visitors come to watch (2026-10-21). */}
        <details className="watch-league-details ux-fold">
          <summary>🏆 Start a league with friends</summary>
          <p className="muted small">Call endings together: the top 3 in each league earn a badge when a season closes.</p>
          <CreateLeagueForm hasName={profileName !== null} />
        </details>
      </section>

      <ReunionTeaser reunion={reunion} />

      <details className="watch-how-details ux-fold" id="how-it-works">
        <summary>How it works</summary>
        <p>
          Nobody steers a date, not even the audience. Watch one with the room: chat, react, and call the ending before
          the characters decide for themselves.
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
            <strong>Second date.</strong> When both characters want another, an owner books it. It&apos;s marked and
            follows the first.
          </li>
          <li>
            <strong>Private dates.</strong> They play out behind closed doors: you&apos;ll never see one unless it&apos;s
            yours. Only their creators do.
          </li>
        </ul>
      </details>

      <p className="muted small">
        Premiere your own date: open it from <Link href="/account#your-dates">your dates</Link> and press &ldquo;Start the
        premiere&rdquo;. Or <Link href="/create">send a character on one</Link>.
      </p>
    </article>
  );
}
