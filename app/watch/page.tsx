import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { FeedEntry } from "@/app/EpisodeItem";
import Icon from "@/app/Icon";
import JsonLd from "@/app/JsonLd";
import { airWindowMinutes } from "@/lib/air";
import { getDb } from "@/lib/db";
import { CallsLine } from "@/app/YourCalls";
import { callRecord } from "@/lib/streaks";
import { sharerOf } from "@/lib/share-record-name";
import DareVote from "@/app/DareVote";
import SituationVote from "@/app/SituationVote";
import OpenOnHash from "@/app/OpenOnHash";
import ShowSince from "@/app/ShowSince";
import SeasonLine from "./SeasonLine";
import DateExcerpt from "@/app/DateExcerpt";
import { pickFeaturedDate } from "@/lib/featured-date";
import RecouplingCard from "./RecouplingCard";
import WeeklyReveal from "@/app/WeeklyReveal";
import { revealBoard } from "@/lib/weekly-reveal";
import { recouplingBoard } from "@/lib/recoupling";
import { ballotResult } from "@/lib/season-vote";
import { seasonIdOf } from "@/lib/season-window";
import { thisWeekOn } from "@/lib/season-format";
import { seasonFormatNow } from "@/lib/season-format-store";
import { showSince } from "@/lib/show-since";
import { dareBoard } from "@/lib/dares";
import { situationBoard } from "@/lib/situations";
import { listAiredFeed, listAiringSoon, parsePage, type AiringSoon } from "@/lib/game";
import { feedEpisodes, withoutEpisode } from "@/lib/feed-items";
import { userIdFromCookieStore } from "@/lib/http";
import { getProfileName } from "@/lib/people";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";
import { forViewer, shared } from "@/lib/shared-cache";
import { countRecentPrivateDates, listLobby, type LobbyEntry } from "@/lib/watch";
import { dateLabel, dateNumberOf, endingLabel } from "@/lib/rules";
import StripPager from "./StripPager";
import Pager from "@/app/Pager";
import ShowTabs from "@/app/ShowTabs";

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
    // "Start it" starts it (lib/watch.ts syncRoom `start`); any other way into a waiting room asks first.
    <Link href={room.status === "ready" ? `${room.room_path}?start=1` : room.room_path} className={`card watch-lobby-card is-${room.status}`}>
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
 * Everything to watch, on one page (David, 2026-10-18: Watch and "Episodes & leagues" merged; /feed redirects here), in
 * three blocks since the 2026-11-14 design audit: on now (live rooms, else the newest aired date playing its opening
 * lines, then tonight's rooms), vote before it airs (the Recoupling, Sunday's reveal, tonight's situation and dare, the
 * dates still open to calls), and recent episodes, 12 a page (?page=N). The season's games live on the Reunion
 * (backing, the pool, the cast chat, chemistry shifts) and /calls (best callers, leagues); one line links them.
 */
export default async function WatchLobbyPage({ searchParams }: { searchParams: Search }) {
  const page = parsePage((await searchParams).page);
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  // Someone signed out sees what everyone does: from a few seconds' shared copy (lib/shared-cache.ts). What's the same
  // for everyone (the private-date count, the reunion, the week's shifts, the season's format) is shared by all.
  const mine = <T,>(key: string, load: () => Promise<T>) => forViewer(viewerId, key, load);
  const [rooms, privateDates, airing, latest, profileName, situation, dares, record, showNews, seasonDef, recoupling, ballot, reveal] = await Promise.all([
    mine("lobby", () => listLobby(db)),
    shared("watch:private-dates", () => countRecentPrivateDates(db)),
    mine("home:airing", () => listAiringSoon(db, viewerId, airWindowMinutes())),
    mine(`watch:feed:${page}`, () => listAiredFeed(db, viewerId, page)),
    getProfileName(db, viewerId),
    mine("home:situation", () => situationBoard(db, viewerId)).catch(() => null),
    mine("home:dares", () => dareBoard(db, viewerId)).catch(() => null),
    mine("home:calls", () => callRecord(db, viewerId)).catch(() => null),
    showSince(db, viewerId).catch(() => null),
    shared("watch:season-format", () => seasonFormatNow(db)).catch(() => null),
    mine("watch:recoupling", () => recouplingBoard(db, viewerId)).catch(() => null),
    // How this season's format was picked (lib/season-vote.ts): the This Week card says so on week 1.
    shared("watch:ballot-result", () => ballotResult(db, seasonIdOf(new Date()))).catch(() => null),
    // Sunday's reveal (lib/weekly-reveal.ts): the week's vote.
    mine("watch:reveal", () => revealBoard(db, viewerId)).catch(() => null),
  ]);
  // Their shared calls link carries their display name when it's theirs alone (lib/share-record-name.ts).
  const sharer = profileName && record?.called ? await sharerOf(db, viewerId).catch(() => null) : null;
  // A mixer night is one entry of the list (2026-11-08 UI audit, item 2); its tables are still each a date.
  const feed = feedEpisodes(latest.items);
  const now = Date.now();
  const live = rooms.filter((r) => r.status === "live");
  const ready = rooms.filter((r) => r.status === "ready");
  const upcoming = rooms.filter((r) => r.status === "upcoming");
  const replays = rooms.filter((r) => r.status === "replay");
  // The date first (2026-11-07 audit, item 3): what's live, else the newest aired date playing its opening lines. It
  // isn't listed again under Latest episodes.
  const featured = page === 1 && live.length === 0 ? pickFeaturedDate(feed) : null;
  const listed = featured ? withoutEpisode(latest.items, featured.episode_id) : latest.items;

  // The three blocks (the 2026-11-14 design audit, item 3: /watch was 14 sections and 7,400px on a phone, with no answer
  // to "what do I do right now"): what's on, what to vote on before it airs, and what aired. The season's games moved
  // to their own pages: backing, the season pool, the cast chat and chemistry shifts to the Reunion; best callers and
  // leagues to /calls. The line at the foot links each, and keeps the old #anchors landing somewhere.
  const lead = reveal && (reveal.state === "open" || reveal.state === "closed" || reveal.last);
  const voting = Boolean((recoupling && recoupling.choices.length > 0) || reveal || situation || dares || airing.length > 0 || (record && record.called > 0));
  return (
    <article className="watch-page page-wide">
      <JsonLd
        data={itemListJsonLd(
          page > 1 ? `Latest Botchelor episodes, page ${page}` : "Latest Botchelor episodes",
          feed.map((e) => ({ name: `${e.characters[0].name} × ${e.characters[1].name}`, path: e.share_path })),
        )}
      />
      <ShowTabs active="/watch" />
      <h1 className="watch-title">Watch a date</h1>
      <p className="lede watch-intro">
        AI characters on blind dates nobody steers. Call the ending before it airs.{" "}
        <a href="#how-it-works">How it works</a>
      </p>

      {/* 1. On now: what's live, else the newest aired date playing its opening lines; then tonight's rooms. */}
      <section className="watch-block" aria-labelledby="on-now">
        <h2 id="on-now" className="watch-block-head">
          {live.length > 0 ? (
            <>
              <span className="watch-dot" aria-hidden /> Live now
            </>
          ) : (
            "On now"
          )}
        </h2>
        {live.length > 0 ? (
          <div className="watch-lead" id="live-now">
            <div className="watch-lobby">
              {live.map((r) => (
                <RoomCard key={r.id} room={r} action={`● ${r.watching} watching`} />
              ))}
            </div>
          </div>
        ) : (
          featured && (
            <div className="watch-lead">
              <p className="watch-lead-kicker" id="watch-lead-head">
                Just aired
              </p>
              <DateExcerpt date={featured} wide />
            </div>
          )
        )}
        {/* The season, as one line under the date. */}
        <SeasonLine
          def={seasonDef}
          card={seasonDef ? thisWeekOn(seasonDef, new Date(now)) : null}
          picked={seasonDef && ballot?.winner && ballot.winner === seasonDef.slug ? { title: seasonDef.title, votes: ballot.votes, total: ballot.total } : null}
          recoupling={recoupling}
          now={now}
        />
        {showNews && <ShowSince card={showNews} />}
        {/* Tonight's listings (docs/show-style.md). */}
        {live.length ? null : (
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
            <StripPager label="Rooms ready to start">
              {ready.map((r) => (
                <RoomCard key={r.id} room={r} action="Start it" />
              ))}
            </StripPager>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h3 className="watch-subhead">Premieres coming up</h3>
            <StripPager label="Premieres coming up">
              {upcoming.map((r) => (
                <RoomCard key={r.id} room={r} action={`Starts ${startsIn(r.starts_at, now)}`} />
              ))}
            </StripPager>
          </>
        )}
      </section>

      {/* 2. Vote before it airs: one column, each vote full width (side by side squeezed three options into ~100px
          columns). Sunday's reveal leads while its vote is open, its result is minutes away, or the opened envelope is fresh. */}
      {voting && (
        <section className="watch-block" aria-labelledby="vote-now">
          <h2 id="vote-now" className="watch-block-head">
            Vote before it airs
          </h2>
          {recoupling && recoupling.choices.length > 0 && <RecouplingCard board={recoupling} now={now} />}
          {lead && <WeeklyReveal board={reveal} now={now} />}
          <div className="watch-votes">
            {situation && <SituationVote board={situation} now={now} />}
            {dares && <DareVote board={dares} />}
            {reveal && !lead && <WeeklyReveal board={reveal} now={now} />}
          </div>
          {airing.length === 0 && record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}
          {airing.length > 0 && (
            <div className="watch-airing-block">
              <h3 id="airing-soon" className="watch-subhead">
                Airing soon: call it before it airs
              </h3>
              {record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}
              <ul className="watch-airing">
                {airing.map((episode) => (
                  <AiringCard key={episode.id} episode={episode} now={now} />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 3. Recent: the archive, 12 a page. */}
      <section className="watch-block" id="latest" aria-labelledby="latest-head">
        <h2 id="latest-head" className="watch-block-head">
          Recent episodes{page > 1 ? ` · page ${page}` : ""}
        </h2>
        {listed.length ? (
          <ul className="list watch-latest-list">
            {listed.map((item) => (
              <FeedEntry key={item.kind === "mixer" ? `night-${item.night_id}` : item.episode.id} item={item} />
            ))}
          </ul>
        ) : featured ? (
          <p className="muted">The only one so far is the date at the top.</p>
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

        {privateDates > 0 && (
          <p className="private-teaser private-teaser-compact">
            <span className="private-teaser-lock">
              <Icon name="lock" />
            </span>
            <span>
              <strong>{privateDates}</strong> private {privateDates === 1 ? "date" : "dates"} this week, seen only by
              {privateDates === 1 ? " its creators" : " their creators"}. Yours are in{" "}
              <Link href="/account#your-dates">your dates</Link>.
            </span>
          </p>
        )}

        {/* Replays fold behind one line (2026-10-31 UX audit, D6), and aren't mentioned when there are none. */}
        {replays.length > 0 && (
          <details className="watch-replays ux-fold">
            <summary>
              <h3>Replays</h3> <span className="muted small">{replays.length > REPLAYS_SHOWN ? `the newest ${REPLAYS_SHOWN} of ${replays.length}` : replays.length}</span>
            </summary>
            <StripPager label="Replays">
              {replays.slice(0, REPLAYS_SHOWN).map((r) => (
                <RoomCard key={r.id} room={r} action="Replay" />
              ))}
            </StripPager>
          </details>
        )}
      </section>

      {/* The season's games, each on its own page now. The ids keep old links (emails, Discord posts) landing here. */}
      <nav className="watch-elsewhere" aria-label="More from the show">
        <span className="watch-elsewhere-head">More from the show</span>
        <Link href="/reunion">The Reunion</Link>
        <Link id="season-pool" href="/reunion#season-pool">
          Season pool and backing
        </Link>
        <Link id="cast-chat" href="/reunion#cast-chat">
          The cast chat
        </Link>
        <Link id="best-callers" href="/calls#best-callers">
          Best callers
        </Link>
        <Link id="leagues" href="/calls#leagues">
          Leagues
        </Link>
      </nav>
      <OpenOnHash />

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
