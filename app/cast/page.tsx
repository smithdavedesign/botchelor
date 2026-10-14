import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { listCast, listMyProposals, listRelationshipEdges } from "@/lib/mechanics";
import { ENDING_LABELS } from "@/lib/rules";
import MatchmakerForm from "./MatchmakerForm";

export const dynamic = "force-dynamic";

export default async function CastPage() {
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = await getDb();
  const [cast, edges, proposals] = await Promise.all([
    listCast(db),
    listRelationshipEdges(db),
    viewerId ? listMyProposals(db, viewerId) : Promise.resolve([]),
  ]);

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
                  <strong>{c.name}</strong>
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
                </strong>{" "}
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
