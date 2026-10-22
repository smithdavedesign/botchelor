import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import { getDb } from "@/lib/db";
import { constellation } from "@/lib/graph";
import { ENDING_LABELS } from "@/lib/rules";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo";
import ConstellationApp from "./ConstellationApp";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Every character on Botchelor and who they've dated, drawn as one living constellation: the couples, the sparks, the exes and the hopefuls still waiting for a first date.";

export const metadata: Metadata = {
  title: "The Constellation: Botchelor's social graph",
  description: DESCRIPTION,
  alternates: { canonical: "/graph" },
};

/** A private character's name (the directory's rule): never linked, no details. */
function PrivateName({ name }: { name: string }) {
  return (
    <span className="directory-private">
      <strong>{name}</strong> <span aria-label="private">🔒</span>
    </span>
  );
}

/**
 * The Constellation (/graph): the show's whole public social graph on one immersive canvas, with a
 * server-rendered ledger underneath so the same facts read without JavaScript (and index). Data comes from
 * lib/graph.ts, which only ever reads the relationship graph's public layer.
 */
export default async function GraphPage() {
  const db = await getDb();
  const { nodes, edges, stats } = await constellation(db);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const open = edges.filter((e) => !e.masked);
  const singles = nodes.filter((n) => n.degree === 0);

  return (
    <article className="constellation-page">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Characters", path: "/characters" },
            { name: "The Constellation", path: "/graph" },
          ]),
          itemListJsonLd(
            "The Botchelor constellation: couples with public dates",
            open.map((e) => ({ name: `${byId.get(e.a_id)?.name ?? "?"} × ${byId.get(e.b_id)?.name ?? "?"}`, path: `/couples/${e.a_id}/${e.b_id}` })),
          ),
        ]}
      />

      <header className="constellation-header">
        <p className="kicker">The social graph</p>
        <h1>The Constellation</h1>
        <p className="lede">{DESCRIPTION}</p>
        <ul className="constellation-stats" aria-label="The network right now">
          <li>
            <strong>{stats.characters}</strong> characters
          </li>
          <li>
            <strong>{stats.couples}</strong> {stats.couples === 1 ? "pair" : "pairs"} who've dated
          </li>
          <li>
            <strong>{stats.dates}</strong> public {stats.dates === 1 ? "date" : "dates"}
          </li>
          {stats.most_connected && (
            <li>
              most connected: <strong>{stats.most_connected.name}</strong> ({stats.most_connected.degree})
            </li>
          )}
          {stats.deepest && stats.deepest.dates > 1 && (
            <li>
              deepest: <strong>
                {stats.deepest.a} × {stats.deepest.b}
              </strong>{" "}
              ({stats.deepest.dates} dates)
            </li>
          )}
          <li>
            <strong>{stats.singles}</strong> waiting for a first date
          </li>
        </ul>
      </header>

      <ConstellationApp data={{ nodes, edges, stats }} />

      <section className="constellation-ledger">
        <h2>The ledger</h2>
        <p className="muted small">Every pair on the canvas, in plain text — the same public facts, no JavaScript needed.</p>
        {edges.length ? (
          <ul className="list">
            {edges.map((e) => {
              const a = byId.get(e.a_id);
              const b = byId.get(e.b_id);
              if (!a || !b) return null;
              return e.masked ? (
                <li key={`${e.a_id}~${e.b_id}`} className="card is-private">
                  {a.private ? <PrivateName name={a.name} /> : <strong>{a.name}</strong>} ×{" "}
                  {b.private ? <PrivateName name={b.name} /> : <strong>{b.name}</strong>}
                </li>
              ) : (
                <li key={`${e.a_id}~${e.b_id}`} className="card">
                  <strong>
                    <Link href={`/couples/${e.a_id}/${e.b_id}`}>
                      {a.name} × {b.name}
                    </Link>
                  </strong>{" "}
                  {e.stage && <span className="badge">{e.stage}</span>}{" "}
                  <span className="muted">
                    {e.dates} {e.dates === 1 ? "date" : "dates"}
                    {e.second_dates > 0 && `, ${e.second_dates} second`}
                    {e.last_ending && ` · last: ${ENDING_LABELS[e.last_ending]}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No public dates yet: the sky is all orbit. Send two characters on a date and the first line appears.</p>
        )}
        {singles.length > 0 && (
          <>
            <h3>In orbit (no public dates yet)</h3>
            <p className="constellation-singles">
              {singles.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && " · "}
                  {n.private ? <PrivateName name={n.name} /> : <Link href={`/characters/${n.id}`}>{n.name}</Link>}
                </span>
              ))}
            </p>
          </>
        )}
      </section>

      <section className="constellation-missing card">
        <h2>What the network doesn&apos;t know yet</h2>
        <p className="muted small">The constellation draws everything the show records publicly. These are the edges it can&apos;t draw — yet.</p>
        <ul>
          <li>
            <strong>Species and archetype aren&apos;t structured.</strong> Traits are free text, so a cross-species cluster (robot × vampire) is inferred
            from prose, never recorded as data.
          </li>
          <li>
            <strong>Mutual matches stay hidden until a date airs.</strong> A match is its owners&apos; secret, so the spark before the first date casts no
            light here. A public &quot;mutual spark&quot; opt-in would add pre-date edges.
          </li>
          <li>
            <strong>Every edge is a pair.</strong> There are no group scenes or double dates, so triangles you see are derived from pairwise history, never
            observed together.
          </li>
          <li>
            <strong>Texting between dates is private.</strong> Couples text after dates, but the volume is owner-only — a derived &quot;still texting&quot;
            badge could make living edges glow.
          </li>
          <li>
            <strong>No public first-met date.</strong> The public layer records when a pair last aired, not when they first met, so edge anniversaries are
            unknowable.
          </li>
          <li>
            <strong>Chemistry and trust never go public.</strong> The tie strength you see substitutes second dates for reciprocity — an honest
            approximation, not the engine&apos;s real number.
          </li>
        </ul>
        <p className="muted small">
          Want to light up a corner of the sky? <Link href="/create">Make a character</Link> or <Link href="/characters">browse the cast</Link> and send
          someone on a date.
        </p>
      </section>
    </article>
  );
}
