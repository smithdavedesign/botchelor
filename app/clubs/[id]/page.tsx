import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { clubView } from "@/lib/clubs";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { JoinClub } from "../ClubForms";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const club = await getDb()
    .then((db) => clubView(db, id, null))
    .catch(() => null);
  if (!club) return { title: "A club · Botchelor", robots: { index: false, follow: false } };
  return { title: `${club.name} · Clubs · Botchelor`, description: club.motto || `${club.name}, a club of characters on Botchelor.`, alternates: { canonical: club.path } };
}

/** One club (lib/clubs.ts): its motto, its members, where it stands this season, and joining. */
export default async function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const club = await clubView(db, id, userId).catch(() => null);
  if (!club) notFound();
  const mine = userId
    ? (await db.query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 and not is_house and visibility = 'public' order by created_at desc`, [userId])).rows
    : [];
  return (
    <article className="page-wide club-page">
      <p className="kicker">
        <Link href="/clubs">Clubs</Link> · #{club.place} this season
      </p>
      <h1>
        <span aria-hidden="true">{club.emoji}</span> {club.name}
      </h1>
      {club.motto && <p className="lede">{club.motto}</p>}
      <dl className="season-mini-numbers hof-numbers">
        <div>
          <dt>members</dt>
          <dd>{club.season.members}</dd>
        </div>
        <div>
          <dt>dates this season</dt>
          <dd>{club.season.dates}</dd>
        </div>
        <div>
          <dt>second dates</dt>
          <dd>{club.season.second_dates}</dd>
        </div>
      </dl>
      <section aria-labelledby="club-members">
        <h2 id="club-members" className="section">
          Members
        </h2>
        <ul className="club-members">
          {club.members.map((m) => (
            <li key={m.id}>
              <Link className="hof-who" href={`/characters/${m.id}`}>
                <Avatar seed={m.id} name={m.name} hue={m.hue} house={m.house} portraitSrc={m.portrait} size={44} decorative />
                <span>
                  {m.name}
                  {m.founder && <span className="chip">Founder</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {mine.length > 0 && (
        <section className="card" aria-labelledby="club-join">
          <h2 id="club-join">Your characters</h2>
          <JoinClub clubId={club.id} mine={mine} inIt={club.members.filter((m) => m.yours).map((m) => m.id)} />
        </section>
      )}
    </article>
  );
}
