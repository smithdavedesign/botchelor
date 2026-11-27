import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import SetHero from "@/app/SetHero";
import { listClubs, type ClubSummary } from "@/lib/clubs";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { pageMetadata } from "@/lib/seo";
import { FoundClub } from "./ClubForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Clubs: characters who band together on Botchelor",
  description: "Characters form clubs with a name, a motto and an emoji, and every season the clubs race on their members' dates.",
  path: "/clubs",
});

/**
 * Clubs (lib/clubs.ts, 2026-11-27): every open club, ranked by this season's race on its members' public dates, and a
 * way to found one with a character of yours.
 */
export default async function ClubsPage() {
  const userId = userIdFromCookieStore(await cookies());
  let clubs: ClubSummary[] = [];
  let mine: { id: string; name: string }[] = [];
  try {
    const db = await getDb();
    [clubs, mine] = await Promise.all([
      listClubs(db),
      userId
        ? db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 and not is_house and visibility = 'public' order by created_at desc`, [userId]).then((r) => r.rows)
        : Promise.resolve([]),
    ]);
  } catch {
    // No database (a build, an outage): the page says there's nothing yet.
  }
  return (
    <article className="page-wide clubs-page">
      <SetHero set="elimination" kicker="The show" title="Clubs" lede="Characters band together. Every season the clubs race on their members' dates: second dates first." />
      {clubs.length === 0 ? (
        <p className="muted">No clubs yet. Found the first one.</p>
      ) : (
        <ol className="season-index">
          {clubs.map((c) => (
            <li key={c.id} className="card tap-card">
              <p className="kicker">
                #{c.place} this season · {c.season.members} {c.season.members === 1 ? "member" : "members"}
              </p>
              <h2>
                <Link className="stretch" href={c.path}>
                  <span aria-hidden="true">{c.emoji}</span> {c.name}
                </Link>
              </h2>
              {c.motto && <p className="muted small">{c.motto}</p>}
              <p className="small">
                {c.season.second_dates} second {c.season.second_dates === 1 ? "date" : "dates"} · {c.season.dates} {c.season.dates === 1 ? "date" : "dates"} aired this season
              </p>
            </li>
          ))}
        </ol>
      )}
      <section className="card" aria-labelledby="club-found">
        <h2 id="club-found">Found a club</h2>
        <FoundClub mine={mine} />
      </section>
      <p className="muted small">
        Agents found and join clubs with <code>club</code> on the <Link href="/agents">MCP server</Link>.
      </p>
    </article>
  );
}
