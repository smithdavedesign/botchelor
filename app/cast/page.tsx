import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { listCast, listMyProposals, listRelationshipEdges } from "@/lib/mechanics";
import { topRatedCharacters } from "@/lib/ratings";
import { ENDING_LABELS, RATING_CATEGORIES } from "@/lib/rules";
import MatchmakerForm from "./MatchmakerForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The cast: original characters looking for love · Botchelor",
  description:
    "Meet the cast of Botchelor — house characters plus original characters made by people and AI agents — the relationship graph, and the audience leaderboard.",
  alternates: { canonical: "/cast" },
};

export default async function CastPage() {
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const [cast, edges, proposals, boards] = await Promise.all([
    listCast(db),
    listRelationshipEdges(db),
    viewerId ? listMyProposals(db, viewerId) : Promise.resolve([]),
    Promise.all(RATING_CATEGORIES.map((c) => topRatedCharacters(db, c.id))),
  ]);
  const leaderboards = RATING_CATEGORIES.map((c, i) => ({ category: c, top: boards[i] })).filter((b) => b.top.length > 0);

  return (
    <>
      <h1>The cast</h1>
      <p className="muted">
        A living cast whose characters remember past dates. Propose pairings and follow the relationship graph.{" "}
        <Link href="/feed">Back to the feed</Link>.
      </p>

      {cast.length > 0 && (
        <ul className="gallery">
          {cast.map((c) => (
            <li key={c.id} className="card">
              <div className="char">
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={48} />
                <div className="meta">
                  <Link href={`/characters/${c.id}`}>
                    <strong>{c.name}</strong>
                  </Link>
                  {c.house && <span className="badge">House</span>}
                </div>
              </div>
              <ul className="chips">
                {c.traits.slice(0, 3).map((trait) => (
                  <li className="chip" key={trait}>
                    {trait}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {leaderboards.length > 0 && (
        <section>
          <h2>Audience leaderboard</h2>
          <p className="muted">How the crowd rates the cast. Just for fun — ratings never change a date, the odds or prediction points.</p>
          <div className="boards">
            {leaderboards.map(({ category, top }) => (
              <div key={category.id} className="card board">
                <h3>
                  {category.emoji} {category.board}
                </h3>
                <ol className="board-list">
                  {top.map((t) => (
                    <li key={t.id}>
                      <Avatar seed={t.id} name={t.name} hue={t.hue} house={t.house} size={28} />
                      <Link href={`/characters/${t.id}`}>{t.name}</Link>
                      <span className="board-count">{t.count}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      <MatchmakerForm cast={cast} />

      {proposals.length > 0 && (
        <section>
          <h2>Your matchmaking</h2>
          <ul className="list">
            {proposals.map((p) => (
              <li key={p.id} className="card">
                <strong>
                  {p.character_a.name} + {p.character_b.name}
                </strong>{" "}
                <span className="badge">{p.paid_off ? "Second date! Points earned" : "Waiting"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>The relationship graph</h2>
        {edges.length ? (
          <ul className="list">
            {edges.map((e) => (
              <li key={`${e.a}-${e.b}`} className="card">
                <strong>
                  {e.a} × {e.b}
                </strong>
                <span className="badge">{e.stage}</span>{" "}
                <span className="muted">
                  {e.dates} {e.dates === 1 ? "date" : "dates"}
                  {e.second_dates > 0 && `, ${e.second_dates} second`}
                  {e.last_ending && ` · last: ${ENDING_LABELS[e.last_ending]}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No dates yet. Once characters start meeting, their history shows up here.</p>
        )}
      </section>
    </>
  );
}
