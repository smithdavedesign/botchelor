import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { english, type T } from "@/lib/i18n/translate";
import { cookies } from "next/headers";
import Link from "next/link";
import VenuePhoto from "@/app/VenuePhoto";
import Avatar from "@/app/Avatar";
import { FeedEntry } from "@/app/EpisodeItem";
import Icon from "@/app/Icon";
import JsonLd from "@/app/JsonLd";
import { airWindowMinutes } from "@/lib/air";
import { isInsider, showCrowd } from "@/lib/crowd-threshold";
import { getDb } from "@/lib/db";
import { CallsLine } from "@/app/YourCalls";
import { callRecord } from "@/lib/streaks";
import { sharerOf } from "@/lib/share-record-name";
import DareVote from "@/app/DareVote";
import SituationVote from "@/app/SituationVote";
import OpenOnHash from "@/app/OpenOnHash";
import ShowSince from "@/app/ShowSince";
import SeasonLine from "./SeasonLine";
import { storyToday } from "@/lib/producer";
import DateExcerpt from "@/app/DateExcerpt";
import { pickFeaturedDate } from "@/lib/featured-date";
import RecouplingCard from "./RecouplingCard";
import BotchelorCard from "./BotchelorCard";
import { ceremonyBoard } from "@/lib/ceremony";
import { nextPremiere } from "@/lib/sunday-premiere";
import WeeklyReveal from "@/app/WeeklyReveal";
import { revealBoard } from "@/lib/weekly-reveal";
import { recouplingBoard } from "@/lib/recoupling";
import { ballotResult } from "@/lib/season-vote";
import { seasonIdOf } from "@/lib/season-window";
import { thisWeekOn } from "@/lib/season-format";
import { seasonPageLiveOn } from "@/lib/season-page";
import { seasonPath } from "@/lib/season-ref";
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
import { weekRecapOn } from "@/lib/week-recap";
import { dateBadge, dateNumberOf, endingLabel } from "@/lib/rules";
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
function startsIn(iso: string | null, now: number, t: T = english): string {
  if (!iso) return t("soon");
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  return mins >= 60 ? t("in {h}h {m}m", { h: Math.floor(mins / 60), m: mins % 60 }) : t("in {m} min", { m: mins });
}

/** "Airs in 6 min", or "Airs any minute" once its window has closed and it's waiting for its turn on air. */
function airsIn(iso: string, now: number, t: T = english): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins < 1) return t("Airs any minute");
  return mins >= 60 ? t("Airs in {h}h {m}m", { h: Math.floor(mins / 60), m: mins % 60 }) : t("Airs in {m} min", { m: mins });
}

function RoomCard({ room, action, t = english }: { room: LobbyEntry; action: string; t?: T }) {
  const [a, b] = room.characters;
  return (
    // "Start it" starts it (lib/watch.ts syncRoom `start`); any other way into a waiting room asks first. Not prefetched:
    // every card on the lobby used to render its room in the background, whether anyone opened it or not.
    <Link href={room.status === "ready" ? `${room.room_path}?start=1` : room.room_path} prefetch={false} className={`card watch-lobby-card is-${room.status}`}>
      {/* A room still to start shows where the date is, across its top (pass 2 of the visual pop audit). */}
      {(room.status === "ready" || room.status === "upcoming") && room.venue && <VenuePhoto venue={room.venue} className="watch-lobby-top" />}
      <div className="watch-lobby-avatars">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} />
      </div>
      <div className="watch-lobby-meta">
        <strong>
          <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
        </strong>
        <span className="muted">
          {room.kind === "template" ? t("Open room") : t("Premiere")} · {room.phase_label}
          {/* "Date 7", as every badge numbers a date (lib/rules.ts dateBadge): "SEVENTH DATE" was cut off on a phone. */}
          {room.date_number && <span className="badge watch-lobby-second">{dateBadge(room.date_number)}</span>}
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
function AiringCard({ episode, now, t = english }: { episode: AiringSoon; now: number; t?: T }) {
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
        <span className="chip watch-airing-when">{airsIn(episode.airs_at, now, t)}</span>
        <span className="watch-airing-call">
          {episode.my_pick ? t("You picked {ending}", { ending: t(endingLabel(episode.my_pick, dateNumberOf(episode))) }) : `${t("Call it")} →`}
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
  // The page in the visitor's language (docs/i18n.md): its own words; the cards and votes it holds are next.
  const t = await getT();
  const viewerId = userIdFromCookieStore(await cookies());
  // Someone signed out sees what everyone does: from a few seconds' shared copy (lib/shared-cache.ts). What's the same
  // for everyone (the private-date count, the reunion, the week's shifts, the season's format) is shared by all.
  const mine = <T,>(key: string, load: () => Promise<T>) => forViewer(viewerId, key, load);
  const [rooms, privateDates, airing, latest, profileName, situation, dares, record, showNews, seasonDef, recoupling, ballot, reveal, insider, ceremony, story, premiere] = await Promise.all([
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
    // The empty-room rule (lib/crowd-threshold.ts): someone with a character sees every count; a stranger, only a crowd.
    isInsider(db, viewerId),
    // The Botchelor (lib/ceremony.ts): the lead, the suitors and Sunday's rose ceremony; null on any other format.
    mine("watch:ceremony", () => ceremonyBoard(db, viewerId)).catch(() => null),
    // Today's story from the producer (lib/producer.ts): "Tonight: …" on the season line. The same for everyone.
    shared("story:today", () => storyToday(db)).catch(() => null),
    // The Sunday premiere (lib/sunday-premiere.ts): the Botchelor card's line, and the pilot's on its day. The same for everyone.
    shared("premiere:next", () => nextPremiere(db)).catch(() => null),
  ]);
  // Their shared calls link carries their display name when it's theirs alone (lib/share-record-name.ts).
  const sharer = profileName && record?.called ? await sharerOf(db, viewerId).catch(() => null) : null;
  // A mixer night is one entry of the list (2026-11-08 UI audit, item 2); its tables are still each a date.
  const feed = feedEpisodes(latest.items);
  const now = Date.now();
  const live = rooms.filter((r) => r.status === "live");
  // One room a pair to start, whichever way round (the 2026-11-22 audit: Sable × Nell sat beside Nell × Sable).
  const pairKey = (r: LobbyEntry) => r.characters.map((c) => c.id).sort().join(" ");
  const ready = rooms.filter((r, i, all) => r.status === "ready" && all.findIndex((o) => o.status === "ready" && pairKey(o) === pairKey(r)) === i);
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
  const voting = Boolean((recoupling && recoupling.choices.length > 0) || ceremony || reveal || situation || dares || (airing.length === 0 && record && record.called > 0));
  return (
    <article className="watch-page page-wide">
      <JsonLd
        data={itemListJsonLd(
          page > 1 ? `Latest Botchelor episodes, page ${page}` : "Latest Botchelor episodes",
          feed.map((e) => ({ name: `${e.characters[0].name} × ${e.characters[1].name}`, path: e.share_path })),
        )}
      />
      <ShowTabs active="/watch" t={t} />
      <h1 className="watch-title">{t("Watch a date")}</h1>
      <p className="lede watch-intro">
        {t("AI characters on blind dates nobody steers. Call the ending before it airs.")}{" "}
        <a href="#how-it-works">{t("How it works")}</a>
      </p>

      {/* 0. Airing soon: call it (the 2026-11-20 mobile audit, A1). Calling the ending is the page's promise, so the dates
          still open to calls come first, right under the lede, not four screens down inside the votes. */}
      {airing.length > 0 && (
        <section className="watch-block watch-airing-block" aria-labelledby="airing-soon">
          <h2 id="airing-soon" className="watch-block-head">
            {t("Airing soon: call it")}
          </h2>
          {record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}
          <ul className="watch-airing scroll-row">
            {airing.map((episode) => (
              <AiringCard key={episode.id} episode={episode} now={now} t={t} />
            ))}
          </ul>
        </section>
      )}

      {/* 1. On now: what's live, else the newest aired date playing its opening lines; then tonight's rooms. The heading
          says which (the 2026-11-22 audit: the old On now heading sat over "Just aired" and "Off air · Nothing live
          right now"). */}
      <section className="watch-block" aria-labelledby="on-now">
        <h2 id="on-now" className="watch-block-head">
          {live.length > 0 ? (
            <>
              <span className="watch-dot" aria-hidden /> {t("Live now")}
            </>
          ) : featured ? (
            t("Just aired")
          ) : (
            t("Tonight")
          )}
        </h2>
        {live.length > 0 ? (
          <div className="watch-lead" id="live-now">
            <div className="watch-lobby">
              {live.map((r) => (
                <RoomCard key={r.id} room={r} t={t} action={showCrowd(r.watching, { insider }) ? `● ${t("{n} watching", { n: r.watching })}` : `● ${t("Live")}`} />
              ))}
            </div>
          </div>
        ) : (
          featured && (
            <div className="watch-lead">
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
          story={story}
          seasonPage={seasonDef?.lead && seasonPageLiveOn() ? seasonPath(seasonIdOf(new Date(now))) : null}
        />
        {showNews && <ShowSince card={showNews} />}
        {/* The pilot (lib/sunday-premiere.ts), on its day until its room opens: then the room is listed below. A lead
            season's weekly premiere is on the Botchelor card all week. */}
        {premiere?.kind === "pilot" && premiere.state === "scheduled" && premiere.sunday === new Date(now).toISOString().slice(0, 10) && (
          <p className="muted small" data-premiere="pilot">
            <span aria-hidden="true">📺</span> <strong>Tonight&apos;s pilot:</strong> meet {premiere.lead.name},{" "}
            {new Date(`${premiere.season_id}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}&apos;s lead, on a first date at{" "}
            {premiere.time_words}, {startsIn(premiere.at, now)}, live in one room for everyone. Its room opens here about 40 minutes before.
          </p>
        )}
        {/* Tonight's listings (docs/show-style.md). */}
        {live.length ? null : (
          // Nothing live: one line, not a heading over an empty space.
          <p className="watch-live-empty">
            {/* A studio's light, switched off (the seasons page's ON AIR light, dimmed). */}
            <span className="off-air" aria-hidden="true">
              <span className="off-air-dot" />
              {t("Off air")}
            </span>{" "}
            <strong>{t("Nothing live right now.")}</strong>{" "}
            <span className="muted">
              {ready.length
                ? t("Start an open room: anyone who joins in the next few minutes watches it with you.")
                : upcoming.length
                  ? t("The next premiere starts {when}.", { when: startsIn(upcoming[0].starts_at, now, t) })
                  : t("A new open room is added every hour.")}
            </span>
          </p>
        )}
        {ready.length > 0 && (
          <>
            <h3 className="watch-subhead">{t("Ready to start")}</h3>
            <StripPager label={t("Rooms ready to start")}>
              {ready.map((r) => (
                <RoomCard key={r.id} room={r} t={t} action={t("Start it")} />
              ))}
            </StripPager>
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <h3 className="watch-subhead">{t("Premieres coming up")}</h3>
            <StripPager label={t("Premieres coming up")}>
              {upcoming.map((r) => (
                <RoomCard key={r.id} room={r} t={t} action={t("Starts {when}", { when: startsIn(r.starts_at, now, t) })} />
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
            {t("Vote before it airs")}
          </h2>
          {recoupling && recoupling.choices.length > 0 && <RecouplingCard board={recoupling} now={now} insider={insider} />}
          {/* A Botchelor season (lib/ceremony.ts): the house and Sunday's rose ceremony, where the Recoupling would sit. */}
          {ceremony && <BotchelorCard board={ceremony} now={now} premiere={premiere} insider={insider} />}
          {lead && <WeeklyReveal board={reveal} now={now} insider={insider} />}
          {/* Side by side on a phone, one swipe apart (app/ux/show.css), so the recent episodes aren't four screens down. */}
          <div className="watch-votes">
            {situation && <SituationVote board={situation} now={now} insider={insider} />}
            {dares && <DareVote board={dares} insider={insider} />}
            {reveal && !lead && <WeeklyReveal board={reveal} now={now} insider={insider} />}
          </div>
          {airing.length === 0 && record && record.called > 0 && <CallsLine record={record} airing={0} nameless={viewerId !== null && profileName === null} sharer={sharer} where="watch" />}
        </section>
      )}

      {/* 3. Recent: the archive, 12 a page. */}
      <section className="watch-block" id="latest" aria-labelledby="latest-head">
        <h2 id="latest-head" className="watch-block-head">
          {t("Recent episodes")}{page > 1 ? ` · ${t("page {n}", { n: page })}` : ""}
        </h2>
        {listed.length ? (
          <ul className="list watch-latest-list">
            {listed.map((item) => (
              <FeedEntry key={item.kind === "mixer" ? `night-${item.night_id}` : item.episode.id} item={item} />
            ))}
          </ul>
        ) : featured ? (
          <p className="muted">{t("The only one so far is the date at the top.")}</p>
        ) : latest.total > 0 ? (
          <p className="muted">
            {t("There's no page {n}: the latest episodes run to page {last}.", { n: page, last: latest.pages })}{" "}
            <Link href={`${pagePath(latest.pages)}#latest`}>{t("Go to page {n}", { n: latest.pages })}</Link>.
          </p>
        ) : (
          <p className="muted">
            {t("Nothing has aired yet.")} <Link href="/create">{t("Send a character on a date")}</Link>.
          </p>
        )}
        <Pager page={page} pages={latest.pages} label={t("Latest episodes pages")} href={(n) => `${pagePath(n)}#latest`} prev={t("Newer")} next={t("Older")} />

        {privateDates > 0 && (
          <p className="private-teaser private-teaser-compact">
            <span className="private-teaser-lock">
              <Icon name="lock" />
            </span>
            <span>
              {privateDates === 1
                ? t("{n} private date this week, seen only by its creators.", { n: privateDates })
                : t("{n} private dates this week, seen only by their creators.", { n: privateDates })}{" "}
              {t("Yours are in")} <Link href="/account#your-dates">{t("your dates")}</Link>.
            </span>
          </p>
        )}

        {/* Replays fold behind one line (2026-10-31 UX audit, D6), and aren't mentioned when there are none. */}
        {replays.length > 0 && (
          <details className="watch-replays ux-fold">
            <summary>
              <h3>{t("Replays")}</h3> <span className="muted small">{replays.length > REPLAYS_SHOWN ? t("the newest {n} of {total}", { n: REPLAYS_SHOWN, total: replays.length }) : replays.length}</span>
            </summary>
            <StripPager label={t("Replays")}>
              {replays.slice(0, REPLAYS_SHOWN).map((r) => (
                <RoomCard key={r.id} room={r} t={t} action={t("Replay")} />
              ))}
            </StripPager>
          </details>
        )}
      </section>

      {/* The season's games, each on its own page now. The ids keep old links (emails, Discord posts) landing here. */}
      <nav className="watch-elsewhere" aria-label={t("More from the show")}>
        <span className="watch-elsewhere-head">{t("More from the show")}</span>
        {/* The words of docs/glossary.md: /reunion is "This season so far" (the Season tab), the points are a scoreboard. */}
        <Link href="/reunion">{t("This season so far")}</Link>
        <Link id="season-pool" href="/reunion#season-pool">
          {t("Season scoreboard and backing")}
        </Link>
        <Link id="cast-chat" href="/reunion#cast-chat">
          {t("The cast chat")}
        </Link>
        <Link href="/house">{t("The house")}</Link>
        {/* The week's best dates in about a minute (lib/week-recap.ts): gone with its switch. */}
        {weekRecapOn() && <Link href="/week">{t("The week in review")}</Link>}
        <Link id="best-callers" href="/calls#best-callers">
          {t("Best callers")}
        </Link>
        <Link id="leagues" href="/calls#leagues">
          {t("Leagues")}
        </Link>
      </nav>
      <OpenOnHash />

      <details className="watch-how-details ux-fold" id="how-it-works">
        <summary>{t("How it works")}</summary>
        <p>
          {t("The audience picks the situation. Nobody steers how it ends, not even us. Watch one with the room: chat, react, and call the ending before it airs.")}
        </p>
        <ul className="watch-how">
          <li>
            <strong>{t("Live room.")}</strong> {t("A date plays on one shared clock for everyone in the room: chat, react and vote before the decision.")}
          </li>
          <li>
            <strong>{t("Replay.")}</strong> {t("A room that has ended, any time, in theater mode.")}
          </li>
          <li>
            <strong>{t("Episode page.")}</strong> {t("The whole date to read at your pace; predict the ending before it airs.")}
          </li>
          <li>
            <strong>{t("Second date.")}</strong> {t("When both characters want another, an owner books it. It's marked and follows the first.")}
          </li>
          <li>
            <strong>{t("Private dates.")}</strong> {t("They play out behind closed doors: you'll never see one unless it's yours. Only their creators do.")}
          </li>
        </ul>
      </details>

      <p className="muted small">
        {t("Premiere your own date: open it from")} <Link href="/account#your-dates">{t("your dates")}</Link>{" "}
        {t("and press “Start the premiere”. Or")} <Link href="/create">{t("send a character on one")}</Link>.
      </p>
    </article>
  );
}
