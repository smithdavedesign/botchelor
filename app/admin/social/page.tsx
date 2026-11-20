import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { ALL_LAYERS } from "@/lib/social/analytics";
import { licensableTies, mostCentral, networkHistory, suggestionHits, type LicensableCount } from "@/lib/social/metrics-admin";
import { socialMetricsOn } from "@/lib/social/metrics-job";
import { signedInAdmin } from "../signed-in-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Social network · Admin · Botchelor", robots: { index: false, follow: false } };

/** The layers in the order the table shows them (docs/PRDs/social-network.md §5.1). */
const LAYERS = ["romance", "friendship", "kin", "work", "place", "conflict", "acquaintance", "communication"] as const;

const fixed = (x: number | null | undefined, digits = 3) => (x === null || x === undefined ? "–" : x.toFixed(digits));
const percent = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const share = (part: number, whole: number) => (whole ? percent(part / whole) : "–");

function LicensableTable({ rows, caption, item }: { rows: LicensableCount[]; caption: string; item: string }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="board">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{item}</th>
            <th scope="col">Public ties</th>
            <th scope="col">Licensable</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.key}</th>
              <td>{r.ties}</td>
              <td>{r.licensable}</td>
              <td>{share(r.licensable, r.ties)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Admin: the social network's numbers (docs/PRDs/social-network.md §10; lib/social/metrics-admin.ts). The daily job
 * writes them (lib/social/metrics-job.ts, SOCIAL_METRICS): the whole network day by day, the most central characters,
 * how much of the graph a dataset could license through the consent gate, and how often "Might know" lands.
 */
export default async function AdminSocialPage() {
  if (!(await signedInAdmin())) {
    return (
      <article className="admin-wide">
        <h1>Social network</h1>
        <p className="muted">Sign in to an admin account to see this.</p>
      </article>
    );
  }
  const db = await getDb();
  const [history, central, licensable, hits] = await Promise.all([
    networkHistory(db, 30).catch(() => []),
    mostCentral(db, 12).catch(() => ({ day: null, characters: [] })),
    licensableTies(db).catch(() => null),
    suggestionHits(db, 30).catch(() => null),
  ]);
  const on = socialMetricsOn();
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Social network
      </p>
      <h1>The social network</h1>
      <p className="muted">
        Every character&apos;s ties to others, measured once a day from the public record only: no private character, nothing After Dark.{" "}
        {on ? "The daily numbers are on." : "The daily numbers are off (SOCIAL_METRICS=0): what's below is from before."}
      </p>
      <details className="ux-fold admin-how">
        <summary>How this works</summary>
        <p className="muted small">
          Each day the job reads every public, active tie between two public characters and measures the network, each layer on its own and all of
          them at once (a pair counts once). PageRank and betweenness say who sits at the centre and who bridges groups; clustering, how often two of
          someone&apos;s people know each other; modularity, how cleanly the network splits into communities (found from ties that aren&apos;t
          negative); balanced triangles, the share of three-way ties whose signs agree. docs/PRDs/social-network.md sections 5.5 and 10 hold the
          details.
        </p>
      </details>

      <h2>The network, day by day</h2>
      {history.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="The network, day by day">
          <table className="board">
            <caption>The last {history.length} days, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Characters</th>
                <th scope="col">Ties</th>
                {LAYERS.map((l) => (
                  <th key={l} scope="col">
                    {l}
                  </th>
                ))}
                <th scope="col">Density</th>
                <th scope="col">Clustering</th>
                <th scope="col">Modularity</th>
                <th scope="col">Communities</th>
                <th scope="col">Largest group</th>
                <th scope="col">Balanced triangles</th>
                <th scope="col">One-way ties answered</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d) => (
                <tr key={d.day}>
                  <th scope="row">
                    {d.day}
                    {d.complete ? "" : " (partial)"}
                  </th>
                  <td>{d.nodes}</td>
                  <td>{d.ties[ALL_LAYERS] ?? 0}</td>
                  {LAYERS.map((l) => (
                    <td key={l}>{d.ties[l] ?? 0}</td>
                  ))}
                  <td>{fixed(d.density, 4)}</td>
                  <td>{fixed(d.clustering)}</td>
                  <td>{fixed(d.modularity)}</td>
                  <td>{d.communities ?? "–"}</td>
                  <td>{d.giant_component ?? "–"}</td>
                  <td>{d.balance ? `${d.balance.balanced} of ${d.balance.balanced + d.balance.unbalanced}` : "–"}</td>
                  <td>{percent(d.reciprocity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No day measured yet: the daily job writes the first one.</p>
      )}

      <h2>Most central{central.day ? ` on ${central.day}` : ""}</h2>
      {central.characters.length ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Most central characters">
          <table className="board">
            <caption>By PageRank across every layer; betweenness is the share of shortest paths through them</caption>
            <thead>
              <tr>
                <th scope="col">Character</th>
                <th scope="col">PageRank</th>
                <th scope="col">Betweenness</th>
                <th scope="col">Ties</th>
                <th scope="col">Core</th>
                <th scope="col">Community</th>
                <th scope="col">Constraint</th>
              </tr>
            </thead>
            <tbody>
              {central.characters.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href={`/characters/${c.id}`}>{c.name}</Link>
                  </th>
                  <td>{fixed(c.pagerank, 4)}</td>
                  <td>{fixed(c.betweenness)}</td>
                  <td>{c.degree}</td>
                  <td>{c.kcore}</td>
                  <td>{c.community ?? "–"}</td>
                  <td>{fixed(c.burt_constraint)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Nobody measured yet.</p>
      )}

      <h2>What a dataset could hold</h2>
      {licensable ? (
        <>
          <p className="muted">
            Public, active ties ({licensable.total.ties}), and the ones a dataset could license today ({licensable.total.licensable},{" "}
            {share(licensable.total.licensable, licensable.total.ties)}): every character on the tie is the show&apos;s, or its owner has opted in to
            training (the same consent gate as every dataset). A closed model&apos;s writing is also left out of a training set unless its terms
            allow it.
          </p>
          <LicensableTable rows={licensable.by_source} caption="By who made the tie" item="Source" />
          <LicensableTable rows={licensable.by_model} caption="By the model that wrote any part of it" item="Model" />
        </>
      ) : (
        <p className="muted">The ties couldn&apos;t be read.</p>
      )}

      <h2>Might know</h2>
      {hits && hits.shown ? (
        <>
          <p className="muted">
            The last {hits.days} days: {hits.shown} suggestions shown to owners, {hits.accepted} became a tie ({percent(hits.hit_rate)}),{" "}
            {hits.dismissed} dismissed, {hits.ignored} ignored, {hits.open} not answered yet.
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Suggestions by reason">
            <table className="board">
              <caption>By the reason given</caption>
              <thead>
                <tr>
                  <th scope="col">Reason</th>
                  <th scope="col">Shown</th>
                  <th scope="col">Accepted</th>
                  <th scope="col">Hit rate</th>
                </tr>
              </thead>
              <tbody>
                {hits.by_reason.map((r) => (
                  <tr key={r.reason}>
                    <th scope="row">{r.reason}</th>
                    <td>{r.shown}</td>
                    <td>{r.accepted}</td>
                    <td>{percent(r.hit_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">No suggestion shown in the last 30 days.</p>
      )}
    </article>
  );
}
