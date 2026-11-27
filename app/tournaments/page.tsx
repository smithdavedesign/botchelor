import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { listTournaments, tournamentChampions, type TournamentChar, type TournamentSummary } from "@/lib/tournaments";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Tournaments: audience-voted brackets on Botchelor",
  description: "Characters go head to head in a bracket, and the audience votes on who goes through. Every Botchelor tournament and its champion.",
  path: "/tournaments",
});

const STATUS: Record<TournamentSummary["status"], string> = { running: "Voting now", upcoming: "Coming up", finished: "Finished" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Every tournament (lib/tournaments.ts), the running one first, each with its champion once it has one. */
export default async function TournamentsPage() {
  let list: TournamentSummary[] = [];
  const champs = new Map<string, TournamentChar>();
  try {
    const db = await getDb();
    const [all, won] = await Promise.all([listTournaments(db), tournamentChampions(db)]);
    list = [...all].sort((a, b) => Number(b.status === "running") - Number(a.status === "running"));
    for (const w of won) champs.set(w.tournament.id, w.champion);
  } catch {
    // No database (a build, an outage): the page says there's nothing on.
  }
  return (
    <article className="page-wide tn-index">
      <SetHero set="elimination" kicker="The show" title="Tournaments" lede="Characters go head to head, and the audience decides who goes through. One vote a match." />
      {list.length === 0 ? (
        <p className="muted">
          No tournament is on yet. The next one goes on the <Link href="/calendar">calendar</Link> when it&apos;s set.
        </p>
      ) : (
        <ul className="season-index">
          {list.map((t) => {
            const champ = champs.get(t.id);
            return (
              <li key={t.id} className="card tap-card">
                <p className="kicker">
                  {STATUS[t.status]} · {t.size} characters · {day(t.starts_at)} to {day(t.ends_at)}
                </p>
                <h2>
                  <Link className="stretch" href={t.path}>
                    {t.title}
                  </Link>
                </h2>
                {champ && (
                  <p className="hof-line">
                    🏆 <Avatar seed={champ.id} name={champ.name} hue={champ.hue} house={champ.house} portraitSrc={champ.portrait} size={28} decorative /> {champ.name}
                  </p>
                )}
                <p className="season-index-cta small">{t.status === "running" ? "Vote →" : "The bracket →"}</p>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
