import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { FeedEntry } from "@/app/EpisodeItem";
import Icon from "@/app/Icon";
import JsonLd from "@/app/JsonLd";
import { airWindowMinutes } from "@/lib/air";
import { getDb } from "@/lib/db";
import { CallersBoardPanel, CallsLine } from "@/app/YourCalls";
import { callersBoard, callRecord } from "@/lib/streaks";
import { sharerOf } from "@/lib/share-record-name";
import BackCast from "@/app/BackCast";
import CastChat from "@/app/CastChat";
import { latestCastChat } from "@/lib/cast-chat";
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
import SeasonPoolPanel from "@/app/SeasonPool";
import { poolStanding, recentPoolBoard } from "@/lib/season-pool";
import { recouplingBoard } from "@/lib/recoupling";
import { ballotResult } from "@/lib/season-vote";
import { seasonIdOf } from "@/lib/season-window";
import { thisWeekOn } from "@/lib/season-format";
import { seasonFormatNow } from "@/lib/season-format-store";
import SeasonBanner from "@/app/SeasonBanner";
import ChemistryShiftsPanel from "@/app/ChemistryShifts";
import { chemistryShifts } from "@/lib/chemistry-shifts";
import { showSince } from "@/lib/show-since";
import { backingBoard } from "@/lib/backing";
import { dareBoard } from "@/lib/dares";
import { situationBoard } from "@/lib/situations";
import { listAiredFeed, listAiringSoon, parsePage, type AiringSoon } from "@/lib/game";
import { feedEpisodes, withoutEpisode } from "@/lib/feed-items";
import { userIdFromCookieStore } from "@/lib/http";
import { listMyLeagues } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { getReunion, type Reunion } from "@/lib/reunion";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";
import { forViewer, shared } from "@/lib/shared-cache";
import { countRecentPrivateDates, listLobby, type LobbyEntry } from "@/lib/watch";
import { dateLabel, dateNumberOf, endingLabel } from "@/lib/rules";
import { CreateLeagueForm } from "./WatchActions";
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
  // Someone signed out sees what everyone does: from a few seconds' shared copy (lib/shared-cache.ts). What's the same
  // for everyone (the private-date count, the reunion, the week's shifts, the season's format) is shared by all.
  const mine = <T,>(key: string, load: () => Promise<T>) => forViewer(viewerId, key, load);
  const [rooms, privateDates, airing, latest, leagues, profileName, reunion, situation, dares, backing, record, callers, showNews, shifts, seasonDef, recoupling, castChat, ballot, reveal, pool, poolRevealed] = await Promise.all([
    mine("lobby", () => listLobby(db)),
    shared("watch:private-dates", () => countRecentPrivateDates(db)),
    mine("home:airing", () => listAiringSoon(db, viewerId, airWindowMinutes())),
    mine(`watch:feed:${page}`, () => listAiredFeed(db, viewerId, page)),
    viewerId ? listMyLeagues(db, viewerId) : Promise.resolve([]),
    getProfileName(db, viewerId),
    shared("watch:reunion", () => getReunion(db)),
    mine("home:situation", () => situationBoard(db, viewerId)).catch(() => null),
    mine("home:dares", () => dareBoard(db, viewerId)).catch(() => null),
    mine("watch:backing", () => backingBoard(db, viewerId)).catch(() => null),
    mine("home:calls", () => callRecord(db, viewerId)).catch(() => null),
    mine("watch:callers", () => callersBoard(db, viewerId)).catch(() => null),
    showSince(db, viewerId).catch(() => null),
    shared("watch:shifts", () => chemistryShifts(db)).catch(() => null),
    shared("watch:season-format", () => seasonFormatNow(db)).catch(() => null),
    mine("watch:recoupling", () => recouplingBoard(db, viewerId)).catch(() => null),
    // The cast group chat (lib/cast-chat.ts): the same for everyone.
    shared("watch:cast-chat", () => latestCastChat(db)).catch(() => null),
    // How this season's format was picked (lib/season-vote.ts): the This Week card says so on week 1.
    shared("watch:ballot-result", () => ballotResult(db, seasonIdOf(new Date()))).catch(() => null),
    // Sunday's reveal (lib/weekly-reveal.ts) and the season pool (lib/season-pool.ts): the week's vote and the season's score.
    mine("watch:reveal", () => revealBoard(db, viewerId)).catch(() => null),
    mine("watch:pool", () => poolStanding(db, viewerId)).catch(() => null),
    mine("watch:pool-revealed", () => recentPoolBoard(db, viewerId)).catch(() => null),
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

  return (
    <article className="watch-page page-wide">
      <JsonLd
        data={itemListJsonLd(
          page > 1 ? `Latest Botchelor episodes, page ${page}` : "Latest Botchelor episodes",
          feed.map((e) => ({ name: `${e.characters[0].name} × ${e.characters[1].name}`, path: e.share_path })),
        )}
      />
      <ShowTabs active="/watch" />
      {/* The season's arc (or, in a month's first week, last season's finale): the design system, 2026-11-11. */}
      <SeasonBanner now={new Date(now)} format={seasonDef?.title ?? null} />
      <p className="kicker">The Botchelor · watch</p>
      <h1>Watch a date</h1>
      <p className="lede watch-intro">
        AI characters on blind dates nobody steers. Call the ending before it airs.{" "}
        <a href="#how-it-works">How it works</a>
      </p>

      {live.length > 0 ? (
        <section className="watch-section watch-lead" aria-labelledby="live-now">
          <h2 id="live-now">
            <span className="watch-dot" aria-hidden /> Live now
          </h2>
          <div className="watch-lobby">
            {live.map((r) => (
              <RoomCard key={r.id} room={r} action={`● ${r.watching} watching`} />
            ))}
          </div>
        </section>
      ) : (
        featured && (
          <section className="watch-section watch-lead" aria-labelledby="watch-lead-head">
            <h2 id="watch-lead-head" className="watch-lead-kicker">
              Just aired
            </h2>
            <DateExcerpt date={featured} wide />
          </section>
        )
      )}

      {/* The season, as one line under the date (it was three cards above it). The Recoupling's own card only while its
          vote is open: then there's something to do. */}
      <SeasonLine
        def={seasonDef}
        card={seasonDef ? thisWeekOn(seasonDef, new Date(now)) : null}
        picked={seasonDef && ballot?.winner && ballot.winner === seasonDef.slug ? { title: seasonDef.title, votes: ballot.votes, total: ballot.total } : null}
        recoupling={recoupling}
        now={now}
      />
      {recoupling && recoupling.choices.length > 0 && <RecouplingCard board={recoupling} now={now} />}
      {/* Sunday's reveal leads while its vote is open or its result is minutes away; otherwise it sits by tonight's vote. */}
      {/* …and once the secret is out it stays, as the opened envelope, while it's fresh (lib/weekly-reveal.ts LAST_SHOWN_DAYS). */}
      {reveal && (reveal.state === "open" || reveal.state === "closed" || reveal.last) && <WeeklyReveal board={reveal} now={now} />}
      {/* What the audience does tonight, before the listings and the archive (the audit, 2026-11-11, 2.3: the situation
          vote sat fifth on the page): tonight's situation and, until its vote opens, Sunday's reveal beside it. */}
      {(situation || (reveal && reveal.state !== "open" && reveal.state !== "closed" && !reveal.last)) && (
        <div className={`watch-votes${situation && reveal && reveal.state !== "open" && reveal.state !== "closed" && !reveal.last ? " is-two" : ""}`}>
          {situation && <SituationVote board={situation} now={now} />}
          {reveal && reveal.state !== "open" && reveal.state !== "closed" && !reveal.last && <WeeklyReveal board={reveal} now={now} />}
        </div>
      )}
      {showNews && <ShowSince card={showNews} />}

      {airing.length === 0 && record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}

      {airing.length > 0 && (
        <section className="watch-section" aria-labelledby="airing-soon">
          <h2 id="airing-soon">Airing soon: call it before it airs</h2>
          {record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}
          <ul className="watch-airing">
            {airing.map((episode) => (
              <AiringCard key={episode.id} episode={episode} now={now} />
            ))}
          </ul>
        </section>
      )}

      <section className="watch-section">
        {/* The schedule block reads as tonight's listings (docs/show-style.md). */}
        <p className="watch-tonight-kicker">Tonight on Botchelor</p>
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

      {/* The season pool's board just came out (the first week of the next season): shown, not folded. */}
      {poolRevealed && <SeasonPoolPanel standing={pool} revealed={poolRevealed} now={now} />}

      <section className="watch-section" id="latest">
        <h2>Latest episodes{page > 1 ? ` · page ${page}` : ""}</h2>
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
      </section>

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

      {/* Shorter (2026-10-31 UX audit, D6): replays fold behind one line, and aren't mentioned when there are none. */}
      {replays.length > 0 && (
        <details className="watch-section watch-replays ux-fold">
          <summary>
            <h2>Replays</h2> <span className="muted small">{replays.length > REPLAYS_SHOWN ? `the newest ${REPLAYS_SHOWN} of ${replays.length}` : replays.length}</span>
          </summary>
          <StripPager label="Replays">
            {replays.slice(0, REPLAYS_SHOWN).map((r) => (
              <RoomCard key={r.id} room={r} action="Replay" />
            ))}
          </StripPager>
        </details>
      )}

      {/* Shorter (UX round C, 2026-11-07): the cast chat, the dare, backing, chemistry shifts and the callers board fold
          under one line, so the page is tonight's dates, the vote and the episodes. A link into one opens it (OpenOnHash). */}
      {(castChat || dares || backing || shifts || callers || (pool && !poolRevealed)) && (
        <details className="watch-section watch-more ux-fold">
          <summary>
            <h2>More from the show</h2>{" "}
            <span className="muted small">
              {[castChat && "the cast chat", dares && "today's dare", backing && "who you back", shifts && "chemistry shifts", callers && "the best callers", pool && !poolRevealed && "the season pool"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </summary>
          {/* Yesterday's cast group chat (lib/cast-chat.ts): only ever about what has aired. */}
          {castChat && <CastChat chat={castChat} />}
          {dares && <DareVote board={dares} />}
          {backing && <BackCast board={backing} />}
          {shifts && <ChemistryShiftsPanel shifts={shifts} />}
          {callers && <CallersBoardPanel board={callers} nameless={viewerId !== null && profileName === null} />}
          {pool && !poolRevealed && <SeasonPoolPanel standing={pool} revealed={null} now={now} />}
        </details>
      )}
      <OpenOnHash />

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
          <summary>
            <Icon name="trophy" /> Start a league with friends
          </summary>
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
