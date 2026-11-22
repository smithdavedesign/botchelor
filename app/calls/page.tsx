import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import VenuePhoto from "@/app/VenuePhoto";
import { airWindowMinutes } from "@/lib/air";
import { showCrowd, isInsider } from "@/lib/crowd-threshold";
import { getDb } from "@/lib/db";
import { listAiringSoon, type AiringSoon } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { dateNumberOf, endingLabel } from "@/lib/rules";
import { nightCode, parseRecordShare, recordGrid, recordWords, sharedByOf, type RecordShare } from "@/lib/share-record";
import { verifiedSharerName } from "@/lib/share-record-name";
import { forViewer } from "@/lib/shared-cache";
import { callersBoard, callRecord, recordLine, type CallRecord } from "@/lib/streaks";
import { CallersBoardPanel } from "@/app/YourCalls";
import { CreateLeagueForm } from "@/app/watch/WatchActions";
import Icon from "@/app/Icon";
import { listMyLeagues } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { countdown } from "@/lib/countdown";
import { venueName } from "@/lib/venues";
import { listLobby, type LobbyEntry } from "@/lib/watch";
import { revealBoard } from "@/lib/weekly-reveal";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** How many of tonight's open calls the page shows: a glance, with the lobby's list behind the button. */
const OPEN_CALLS_SHOWN = 4;

/** The card's address: the same numbers, drawn (app/api/og/record/route.tsx). */
const cardPath = (q: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const k of ["g", "w", "c", "s", "b", "n", "t"]) if (typeof q[k] === "string") p.set(k, q[k] as string);
  return `/api/og/record?${p.toString()}`;
};

/** The sharer's display name, when the link's signature checks out for the one person who goes by it (else null). */
async function sharerName(share: RecordShare | null, q: Record<string, string | string[] | undefined>): Promise<string | null> {
  const claim = share ? sharedByOf(q) : null;
  if (!share || !claim) return null;
  try {
    return await verifiedSharerName(await getDb(), share, claim);
  } catch {
    return null;
  }
}

/** Who's looking, or no one: a shared link is opened from anywhere, so no request scope is ever assumed. */
async function viewerIdOrNull(): Promise<string | null> {
  try {
    return userIdFromCookieStore(await cookies());
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = await searchParams;
  const share = parseRecordShare(q);
  const name = await sharerName(share, q);
  const tally = share ? (share.week ? `${share.week.right} of ${share.week.called} this week` : `${share.right} of ${share.called}`) : "";
  const title = share ? `${name ? `${name} called` : "Called"} ${tally} on Botchelor` : "Call the ending · Botchelor";
  const description = "AI characters go on blind dates nobody steers. Call how each one ends before it airs. No spoilers here.";
  return {
    title,
    description,
    // One page per set of numbers: never for search.
    robots: { index: false, follow: true },
    openGraph: { title, description, ...(share ? { images: [{ url: cardPath(q), width: 1200, height: 630 }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(share ? { images: [cardPath(q)] } : {}) },
  };
}

/** "Airs in 6 min", or "Airs any minute" once its window has closed and it's waiting for its turn on air (the lobby's words). */
function airsIn(iso: string, now: number): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins < 1) return "Airs any minute";
  return mins >= 60 ? `Airs in ${Math.floor(mins / 60)}h ${mins % 60}m` : `Airs in ${mins} min`;
}

/** One date still open to calls: the place's photo with the two faces on it, who, where, when, and the call. */
function OpenCall({ episode, now }: { episode: AiringSoon; now: number }) {
  const [a, b] = episode.characters;
  return (
    <li className="card tap-card open-call">
      <VenuePhoto venue={episode.venue} className="open-call-photo">
        <span className="pair-faces" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} decorative />
        </span>
        <span className="photo-chip">{airsIn(episode.airs_at, now)}</span>
      </VenuePhoto>
      <div className="open-call-body">
        {/* Where the lobby's own card goes: the episode, which takes the call before it airs. */}
        <Link className="stretch open-call-names" href={episode.share_path} data-track="share-record-open-call">
          <strong>
            <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
          </strong>
        </Link>
        <span className="muted small open-call-venue">{venueName(episode.venue)}</span>
        <span className="open-call-call">{episode.my_pick ? `You picked ${endingLabel(episode.my_pick, dateNumberOf(episode))}` : "Call it →"}</span>
      </div>
    </li>
  );
}

/**
 * Nothing open to calls (the empty-room rule, lib/crowd-threshold.ts; docs/show-style.md): never an empty list. The
 * lobby's live room, else the next premiere and when it starts, else one card to the lobby. The live room's count obeys
 * the rule: "N watching" for a crowd or an insider, "Live now" otherwise.
 */
function NothingOpen({ rooms, now, insider }: { rooms: LobbyEntry[]; now: number; insider: boolean }) {
  const live = rooms.find((r) => r.status === "live") ?? null;
  const next = rooms.filter((r) => r.status === "upcoming" && r.starts_at).sort((x, y) => String(x.starts_at).localeCompare(String(y.starts_at)))[0] ?? null;
  const room = live ?? next;
  if (!room) {
    return (
      <Link className="card tap-card open-calls-next open-calls-empty" href="/watch" data-track="share-record-lobby">
        <strong>Nothing is on the air right now.</strong>
        <span className="muted small">The next date opens for calls the moment it&apos;s booked. The lobby has tonight&apos;s schedule →</span>
      </Link>
    );
  }
  const [a, b] = room.characters;
  const mins = room.starts_at ? Math.max(1, Math.round((new Date(room.starts_at).getTime() - now) / 60_000)) : null;
  const when = live
    ? showCrowd(live.watching, { insider })
      ? `● Live now · ${live.watching} watching`
      : "● Live now"
    : mins === null
      ? "Next premiere"
      : `Next premiere · starts ${mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins} min`}`;
  return (
    <Link className={`card tap-card open-calls-next${live ? " is-live" : ""}`} href={room.room_path} data-track={live ? "share-record-live" : "share-record-premiere"}>
      <span className="pair-faces" aria-hidden="true">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={40} decorative />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={40} decorative />
      </span>
      <span className="open-call-body">
        <strong>
          <span className="nowrap">{a.name} ×</span> <span className="nowrap">{b.name}</span>
        </strong>
        <span className="muted small">{when}. Nothing is waiting for a call yet; the next date opens the moment it&apos;s booked.</span>
      </span>
    </Link>
  );
}

/**
 * A shared record (lib/share-record.ts): someone's squares — right calls and misses, nothing about which dates — and
 * the invitation to call tonight's endings yourself, with tonight's open calls right here (the dates airing soon that
 * the lobby lists under #airing-soon, lib/game.ts listAiringSoon). A link with numbers that don't parse just shows the
 * invitation.
 */
export default async function CallsPage({ searchParams }: Props) {
  const q = await searchParams;
  const share = parseRecordShare(q);
  const code = share ? nightCode(share) : null;
  // "Sam's calls" when the link is signed for the one person who goes by Sam; anyone else's link stays "Someone's".
  const name = await sharerName(share, q);
  const viewerId = await viewerIdOrNull();
  // Tonight's vote to land on (2026-11-07 audit, item 10): Sunday's reveal while its vote is open; the dates still open
  // to calls (the lobby's own list, shared with it from the same cache when nobody in particular is looking); and the
  // viewer's own record, one query, when they've called anything.
  const [reveal, airing, record, rooms, insider] = await Promise.all([
    getDb()
      .then((db) => revealBoard(db, null))
      .catch(() => null),
    getDb()
      .then((db) => forViewer(viewerId, "home:airing", () => listAiringSoon(db, viewerId, airWindowMinutes())))
      .catch(() => [] as AiringSoon[]),
    viewerId
      ? getDb()
          .then((db) => callRecord(db, viewerId))
          .catch(() => null as CallRecord | null)
      : Promise.resolve(null as CallRecord | null),
    // The lobby (lib/watch.ts), for when nothing is open to calls: its live room or the next premiere stands in.
    getDb()
      .then((db) => forViewer(viewerId, "lobby", () => listLobby(db)))
      .catch(() => [] as LobbyEntry[]),
    getDb()
      .then((db) => isInsider(db, viewerId))
      .catch(() => false),
  ]);
  // Best callers and friend leagues, here since they left /watch (the 2026-11-14 design audit): the page about calling endings.
  const [callers, leagues, profileName] = await Promise.all([
    getDb()
      .then((db) => forViewer(viewerId, "watch:callers", () => callersBoard(db, viewerId)))
      .catch(() => null),
    viewerId
      ? getDb()
          .then((db) => listMyLeagues(db, viewerId))
          .catch(() => [])
      : Promise.resolve([]),
    getDb()
      .then((db) => getProfileName(db, viewerId))
      .catch(() => null),
  ]);
  const open = airing.slice(0, OPEN_CALLS_SHOWN);
  const now = Date.now();
  return (
    <article className="calls-share-page">
      <p className="kicker">{code ? `Botchelor · ${code}` : "Botchelor"}</p>
      {share ? (
        <>
          <h1>
            {name ? `${name}'s calls` : "Someone's calls"}
            {share.week ? " this week" : ""}
          </h1>
          <p className="calls-share-grid" aria-label={recordWords(share)}>
            {recordGrid(share.recent)}
          </p>
          <p className="lede">{recordWords(share)}.</p>
          <p className="muted small">Each square is one date&apos;s ending, called before it aired: green called it, dark missed it. Which dates? That would be telling.</p>
        </>
      ) : (
        <h1>Call the ending</h1>
      )}
      <p>AI characters go on blind dates. The audience picks the situation; nobody steers how it ends. Call each one before it airs.</p>
      <p className="cta-row">
        {/* With nothing open to calls, the button doesn't ask for one (2026-11-22 audit): it goes to tonight's schedule. */}
        {open.length ? (
          <Link className="button" href="/watch#airing-soon" data-track="share-record-cta">
            Call tonight&apos;s endings
          </Link>
        ) : (
          <Link className="button" href="/watch" data-track="share-record-cta">
            See tonight&apos;s schedule
          </Link>
        )}{" "}
        {reveal?.state === "open" && (
          <Link className="button-ghost" href="/watch#sunday-reveal" data-track="share-record-reveal">
            🔓 Vote on Sunday&apos;s reveal: closes {countdown(reveal.closes_at, now)}
          </Link>
        )}
        {record && record.called > 0 && (
          <span className="chip open-calls-record" title="Your own record across every public date you called">
            Your calls: {recordLine(record)}
          </span>
        )}
      </p>

      <section className="open-calls" aria-labelledby="open-calls">
        <h2 id="open-calls">Tonight&apos;s open calls</h2>
        {open.length ? (
          <ul className="open-calls-list">
            {open.map((episode) => (
              <OpenCall key={episode.id} episode={episode} now={now} />
            ))}
          </ul>
        ) : (
          <NothingOpen rooms={rooms} now={now} insider={insider} />
        )}
      </section>

      {callers && <CallersBoardPanel board={callers} nameless={viewerId !== null && profileName === null} insider={insider} />}

      <section className="calls-leagues" id="leagues" aria-labelledby="leagues-head">
        <h2 id="leagues-head">Leagues</h2>
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
        <details className="watch-league-details ux-fold">
          <summary>
            <Icon name="trophy" /> Start a league with friends
          </summary>
          <p className="muted small">Call endings together: the top 3 in each league earn a badge when a season closes.</p>
          <CreateLeagueForm hasName={profileName !== null} />
        </details>
      </section>

      <p className="muted small">
        Every right call counts toward the season pool: one score for the month, and the board is revealed when the season closes.
      </p>
    </article>
  );
}
