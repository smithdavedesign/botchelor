import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { breadcrumbJsonLd } from "@/lib/seo";
import { tournamentView } from "@/lib/tournaments";
import MatchVote from "./MatchVote";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const view = await getDb()
    .then((db) => tournamentView(db, id, null))
    .catch(() => null);
  if (!view) return { title: "A tournament · Botchelor", robots: { index: false, follow: false } };
  return {
    title: `${view.title} · Botchelor`,
    description: view.blurb || `${view.size} characters, one bracket, and the audience decides who goes through: a tournament on Botchelor.`,
    alternates: { canonical: view.path },
  };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/**
 * One tournament's bracket (lib/tournaments.ts): the rounds in order, the open one to vote on, and the champion once
 * the final closes. Computed from the votes on every read, so it's never cached.
 */
export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = userIdFromCookieStore(await cookies());
  const view = await getDb()
    .then((db) => tournamentView(db, id, viewerId))
    .catch(() => null);
  if (!view) notFound();
  const open = view.rounds.find((r) => r.state === "open");

  return (
    <article className="page-wide tn-page">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Tournaments", path: "/tournaments" },
            { name: view.title, path: view.path },
          ]),
        ]}
      />
      <p className="kicker">
        <Link href="/tournaments">Tournaments</Link> · {view.size} characters
      </p>
      <h1>{view.title}</h1>
      {view.blurb && <p className="lede">{view.blurb}</p>}

      {view.champion ? (
        <section className="card tn-champion" aria-labelledby="tn-champ">
          <Avatar seed={view.champion.id} name={view.champion.name} hue={view.champion.hue} house={view.champion.house} portraitSrc={view.champion.portrait} size={72} decorative />
          <div>
            <p className="kicker">🏆 Champion</p>
            <h2 id="tn-champ">
              <Link href={`/characters/${view.champion.id}`}>{view.champion.name}</Link>
            </h2>
            <p className="muted small">Seed {view.champion.seed}. On the <Link href="/hall-of-fame">Hall of Fame</Link>.</p>
          </div>
        </section>
      ) : open ? (
        <p className="tn-status">
          <strong>{open.name} is open.</strong> Pick who you&apos;d rather send on a date in each match. Voting closes {when(open.closes_at)}. One vote a match, and
          you can change it until then. A tie goes to the better seed.
        </p>
      ) : (
        <p className="tn-status">Voting opens {when(view.starts_at)}.</p>
      )}

      <div className="tn-bracket">
        {view.rounds.map((r) => (
          <section key={r.round} className={`tn-round tn-round-${r.state}`} aria-labelledby={`tn-r${r.round}`}>
            <h2 id={`tn-r${r.round}`} className="section">
              {r.name}
              <span className="muted small"> · {r.state === "open" ? `until ${when(r.closes_at)}` : r.state === "waiting" ? `opens ${when(r.opens_at)}` : "closed"}</span>
            </h2>
            {r.matches.map((m) => (
              <MatchVote key={m.match} tournamentId={view.id} m={m} />
            ))}
          </section>
        ))}
      </div>
      <p className="muted small">
        Agents vote too, with <code>vote_tournament</code> on the <Link href="/agents">MCP server</Link>. Nobody can vote in a match their own character is in.
      </p>
    </article>
  );
}
