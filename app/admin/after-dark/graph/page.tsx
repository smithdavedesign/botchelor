import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { afterDarkGraph, layout, pairContent, pairKey, splitPair, type PairContent } from "@/lib/adult/graph";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark graph · Botchelor", robots: { index: false, follow: false } };

const media = (id: string) => `/api/admin/after-dark/media/${id}`;
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every character's After Dark content on one page (David, 2026-10-22): a graph of who has had what with whom, and the
 * whole of one pair's content (scene, saved nights, videos, pictures, steps) when it's picked. Signed-in admins only;
 * a 404 to everyone else. Videos load only when played, so the page never downloads every shot.
 */
export default async function AfterDarkGraphPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  // A device that hasn't entered the admin's PIN (lib/adult/privacy.ts) gets nothing: the layout asks for it instead.
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const graph = await afterDarkGraph(db);
  const raw = (await searchParams).pair;
  const picked = typeof raw === "string" ? splitPair(raw) : null;
  const content = picked ? await pairContent(db, picked[0], picked[1]) : null;
  const at = layout(graph.nodes);
  const max = Math.max(1, ...graph.edges.map((e) => e.lines));
  const nameOf = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const pickedKey = picked ? pairKey(picked[0], picked[1]) : null;

  return (
    <article className="after-dark ad-graph">
      <p className="kicker">
        <Link href="/admin">← Admin</Link> · <Link href="/after-dark">After Dark</Link>
      </p>
      <h1>After Dark graph</h1>
      <p className="muted">
        {graph.nodes.length} characters, {graph.edges.length} pairs. A line is a pair with something between them; thicker is more
        scene lines. Pick a pair to see all of it.
      </p>
      {graph.edges.length ? (
        <svg className="ad-graph-svg" viewBox="0 0 100 100" role="img" aria-label="Characters and the pairs they've been in">
          {graph.edges.map((e) => {
            const p = at.get(e.a)!;
            const q = at.get(e.b)!;
            return (
              <a key={e.key} href={`?pair=${encodeURIComponent(e.key)}`}>
                <title>{`${nameOf.get(e.a)} × ${nameOf.get(e.b)}: ${e.lines} lines, ${e.nights} nights, ${e.videos} videos`}</title>
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  className={e.key === pickedKey ? "ad-edge picked" : "ad-edge"}
                  strokeWidth={0.4 + 2.2 * Math.sqrt(e.lines / max)}
                />
              </a>
            );
          })}
          {graph.nodes.map((n) => {
            const p = at.get(n.id)!;
            const clip = `clip-${n.id.replace(/[^a-z0-9]/gi, "")}`;
            return (
              <g key={n.id}>
                <title>{`${n.name}: ${n.pairs} pairs, ${n.lines} lines`}</title>
                <clipPath id={clip}>
                  <circle cx={p.x} cy={p.y} r={4.2} />
                </clipPath>
                <circle cx={p.x} cy={p.y} r={4.6} className="ad-node" />
                {n.portrait && <image href={media(n.portrait)} x={p.x - 4.2} y={p.y - 4.2} width={8.4} height={8.4} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />}
                <text x={p.x} y={p.y + 7.5} textAnchor="middle" className="ad-label">
                  {n.name.split(/\s+/)[0]}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="notice">Nothing has been made after dark yet.</p>
      )}

      <section>
        <h2>Pairs</h2>
        <table className="ad-pairs">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Lines</th>
              <th>Nights</th>
              <th>Videos</th>
              <th>Shots</th>
              <th>Pictures</th>
              <th>Steps</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e) => (
              <tr key={e.key} className={e.key === pickedKey ? "picked" : undefined}>
                <td>
                  <Link href={`?pair=${encodeURIComponent(e.key)}`}>
                    {nameOf.get(e.a)} × {nameOf.get(e.b)}
                  </Link>
                </td>
                <td>{e.lines}</td>
                <td>{e.nights}</td>
                <td>{e.videos}</td>
                <td>{e.shots}</td>
                <td>{e.pictures}</td>
                <td>{e.steps}</td>
                <td className="muted small">{day(e.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {picked && !content && <p className="notice">That pair isn&apos;t here.</p>}
      {content && <Pair content={content} />}
    </article>
  );
}

function Pair({ content: c }: { content: PairContent }) {
  const who = (w: "a" | "b") => (w === "a" ? c.a.name : c.b.name).split(/\s+/)[0];
  const lines = (ls: { who: "a" | "b"; text: string; stage?: number }[]) => (
    <ol className="ad-lines">
      {ls.map((l, i) => (
        <li key={i}>
          <strong>{who(l.who)}:</strong> {l.text}
        </li>
      ))}
    </ol>
  );
  return (
    <section id="pair" className="ad-pair">
      <h2>
        {c.a.name} × {c.b.name}
      </h2>
      <p>
        <Link href={`/after-dark/${c.a.id}/${c.b.id}`}>Open their After Dark page →</Link>
      </p>

      <h3>Videos ({c.reels.length})</h3>
      {c.reels.length ? (
        <ul className="ad-reels">
          {c.reels.map((r) => {
            const ready = r.shots.filter((s) => s.status === "ready" && s.media_id);
            return (
              <li key={r.id} className="card">
                <p className="muted small">
                  {day(r.created_at)} · {r.status} · {ready.length} of {r.shots.length} shots
                </p>
                {ready.length ? (
                  <div className="ad-shots">
                    {ready.map((s) => (
                      <figure key={s.media_id}>
                        <video controls preload="none" playsInline src={media(s.media_id!)} />
                        <figcaption className="small">
                          {who(s.who)}: {s.text}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="muted small">No shot came through{r.shots.find((s) => s.reason)?.reason ? ` (${r.shots.find((s) => s.reason)!.reason!.slice(0, 120)})` : ""}.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}

      <h3>Pictures ({c.pictures.length})</h3>
      {c.pictures.length ? (
        <div className="ad-pictures">
          {c.pictures.map((p) => (
            <figure key={p.id}>
              {p.mime.startsWith("video/") ? (
                <video controls preload="none" playsInline src={media(p.id)} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image
                <img src={media(p.id)} alt={p.prompt.slice(0, 120)} loading="lazy" />
              )}
              <figcaption className="muted small">
                {p.kind} · {day(p.created_at)}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="muted">None.</p>
      )}

      <h3>The scene ({c.scene?.lines.length ?? 0} lines)</h3>
      {c.scene ? (
        <details>
          <summary>Read it · last written {day(c.scene.updated_at)}</summary>
          {lines(c.scene.lines)}
        </details>
      ) : (
        <p className="muted">None running.</p>
      )}

      <h3>Saved nights ({c.nights.length})</h3>
      {c.nights.length ? (
        c.nights.map((n) => (
          <details key={n.id}>
            <summary>
              {day(n.created_at)} · {n.place ?? "no place"} · stage {n.stage} · {n.lines.length} lines
            </summary>
            {lines(n.lines)}
          </details>
        ))
      ) : (
        <p className="muted">None.</p>
      )}

      <h3>Steps</h3>
      {c.steps.length ? (
        <p className="muted">{c.steps.map((s) => `${s.n} ${s.status}`).join(" · ")}</p>
      ) : (
        <p className="muted">None logged.</p>
      )}
    </section>
  );
}
