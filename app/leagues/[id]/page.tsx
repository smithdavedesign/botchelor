import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Podium } from "@/app/Badges";
import { frameClass } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { getLeague } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { PODIUM_SIZE, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "@/lib/rules";
import { seasonLabel, tryCloseDueSeasons } from "@/lib/seasons";
import { InviteFriends, JoinLeague } from "./LeagueActions";

export const dynamic = "force-dynamic";

// A friends' league is invite-only and personal: never indexed.
export const metadata: Metadata = { title: "Friends' league · Botchelor", robots: { index: false, follow: false } };

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (date: Date) => date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  await tryCloseDueSeasons(db);
  const league = await getLeague(db, id, viewerId);
  if (!league) notFound();
  const profileName = await getProfileName(db, viewerId);

  const start = new Date(league.week.start);
  const lastDay = new Date(new Date(league.week.end).getTime() - DAY_MS);
  const closes = new Date(league.season.closes_at);
  const [lastSeason, ...earlierSeasons] = league.past_seasons;

  return (
    <article>
      <p className="kicker">Friends&apos; league</p>
      {/* 2026-10-31 UX audit: Join was under the board and the rules, ~1,000px down a phone; the season's dates were said
          twice. Join (or a member's Invite) sits by the title, the dates are one line, and the rules fold away. */}
      <div className="section-head league-head">
        <h1>{league.name}</h1>
        {league.is_member && <InviteFriends invitePath={league.invite_path} />}
      </div>
      <p className="season">
        <strong>This season: {seasonLabel(league.season.id)}</strong>, {day(start)} to {day(lastDay)}. When it closes ({day(closes)},
        00:00 UTC), the top {PODIUM_SIZE} with points earn a badge.
      </p>
      {!league.is_member && <JoinLeague leagueId={league.id} hasName={profileName !== null} />}

      {lastSeason && (
        <section className="card">
          <h2>Latest podium</h2>
          <p className="muted">{seasonLabel(lastSeason.id)}</p>
          <Podium entries={lastSeason.podium} />
        </section>
      )}

      <h2>This season</h2>
      <table className="board league-board">
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {league.leaderboard.map((entry, i) => (
            <tr key={i} className={entry.me ? "me" : undefined}>
              {/* Nobody has a point yet: everyone "1st" read as broken, so no rank until there's something to rank. */}
              <td className="num">{entry.points > 0 ? entry.rank : <span aria-label="Not ranked yet">–</span>}</td>
              <td>
                <span className={entry.frame ? frameClass(entry.frame) : undefined}>{entry.name}</span>
                {entry.me && " (you)"}
              </td>
              <td className="num">{entry.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="ux-fold league-points">
        <summary>How points work</summary>
        <p className="muted">
          Points come from episodes whose finale airs this season: {POINTS_PER_CORRECT_PICK} for the right ending,{" "}
          {POINTS_PER_DRAMA_PICK} for the bonus question. Points and badges are free and carry no prizes.
        </p>
      </details>
      {league.is_member && (
        <p>
          <Link className="button secondary" href="/watch">
            Find episodes to predict →
          </Link>
        </p>
      )}

      {!lastSeason && <p className="muted">No badges yet. The first podium appears when this season closes.</p>}
      {earlierSeasons.length > 0 && (
        <section>
          <h2>Earlier seasons</h2>
          {earlierSeasons.map((season) => (
            <div key={season.id} className="card">
              <strong>{seasonLabel(season.id)}</strong>
              <Podium entries={season.podium} />
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
