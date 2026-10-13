import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Podium } from "@/app/Badges";
import { frameClass } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { getLeague } from "@/lib/leagues";
import { getProfileName } from "@/lib/people";
import { PODIUM_SIZE, POINTS_PER_CORRECT_PICK, POINTS_PER_DRAMA_PICK } from "@/lib/rules";
import { seasonLabel, tryCloseDueSeasons } from "@/lib/seasons";
import LeagueActions from "./LeagueActions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (date: Date) => date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
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
      <h1>{league.name}</h1>
      <p className="season">
        <strong>This season: {seasonLabel(league.season.id)}.</strong> It closes {day(closes)}, 00:00 UTC; the top{" "}
        {PODIUM_SIZE} with points earn a badge.
      </p>

      {lastSeason && (
        <section className="card">
          <h2>Latest podium</h2>
          <p className="muted">{seasonLabel(lastSeason.id)}</p>
          <Podium entries={lastSeason.podium} />
        </section>
      )}

      <h2>This week</h2>
      <table className="board">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {league.leaderboard.map((entry, i) => (
            <tr key={i} className={entry.me ? "me" : undefined}>
              <td>{entry.rank}</td>
              <td>
                <span className={entry.frame ? frameClass(entry.frame) : undefined}>{entry.name}</span>
                {entry.me && " (you)"}
              </td>
              <td>{entry.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        This week runs {day(start)} to {day(lastDay)}. Points come from episodes whose finale airs this week:{" "}
        {POINTS_PER_CORRECT_PICK} for the right ending, {POINTS_PER_DRAMA_PICK} for the bonus question. Points and badges
        are free and carry no prizes.
      </p>

      <LeagueActions
        leagueId={league.id}
        invitePath={league.invite_path}
        isMember={league.is_member}
        hasName={profileName !== null}
      />

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

      <p>
        <Link href="/feed">Find episodes to predict</Link>
      </p>
    </article>
  );
}
