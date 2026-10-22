"use client";

import Link from "next/link";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { ORIGIN_LABEL } from "@/lib/origin";
import type { Selection } from "./ConstellationCanvas";

type Props = {
  selection: Selection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  /** Jump the canvas to a node (the panel's partner links double as navigation). */
  onFocus: (id: string) => void;
};

const timeAgo = (iso: string | null): string | null => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
};

function Tile({ node }: { node: GraphNode }) {
  const p = avatarPalette(node.id, node.hue);
  return node.portrait && !node.private ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="constellation-tile" src={node.portrait} alt="" width={56} height={56} />
  ) : (
    <span className="constellation-tile" style={{ background: avatarGradientCss(p) }} aria-hidden>
      {node.private ? "🔒" : initials(node.name)}
    </span>
  );
}

/** What a tap opens: a character's public story, or a pair's. Everything here shipped with the page — no fetches. */
export default function SidePanel({ selection, nodes, edges, onClose, onFocus }: Props) {
  if (!selection) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (selection.kind === "node") {
    const node = byId.get(selection.id);
    if (!node) return null;
    const mine = edges.filter((e) => e.a_id === node.id || e.b_id === node.id);
    return (
      <aside className="constellation-panel card" aria-label={`About ${node.name}`}>
        <button type="button" className="constellation-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <header className="constellation-panel-head">
          <Tile node={node} />
          <div>
            <h2>{node.name}</h2>
            {node.private ? (
              <p className="muted small">Private: their creator keeps them to themselves.</p>
            ) : (
              <p className="muted small">
                {node.origin ? ORIGIN_LABEL[node.origin] : ""} · {node.degree === 0 ? "waiting for a first date" : `${node.degree} public connection${node.degree === 1 ? "" : "s"}`}
              </p>
            )}
          </div>
        </header>
        {!node.private && mine.length > 0 && (
          <ul className="list constellation-panel-list">
            {mine.map((e) => {
              const otherId = e.a_id === node.id ? e.b_id : e.a_id;
              const other = byId.get(otherId);
              if (!other) return null;
              return (
                <li key={`${e.a_id}~${e.b_id}`}>
                  {other.private ? (
                    <span className="muted">🔒 {other.name}</span>
                  ) : (
                    <button type="button" className="link-button" onClick={() => onFocus(otherId)}>
                      {other.name}
                    </button>
                  )}{" "}
                  {!e.masked && (
                    <span className="muted small">
                      {e.stage ? `${e.stage} · ` : ""}
                      {e.dates} {e.dates === 1 ? "date" : "dates"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!node.private && (
          <p className="constellation-panel-links">
            <Link className="button-ghost small" href={`/characters/${node.id}`}>
              Their card →
            </Link>
          </p>
        )}
      </aside>
    );
  }

  const a = byId.get(selection.a_id);
  const b = byId.get(selection.b_id);
  const edge = edges.find((e) => e.a_id === selection.a_id && e.b_id === selection.b_id);
  if (!a || !b || !edge) return null;
  const anyPrivate = a.private || b.private;
  return (
    <aside className="constellation-panel card" aria-label={`${a.name} and ${b.name}`}>
      <button type="button" className="constellation-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <header className="constellation-panel-head">
        <span className="constellation-pair">
          <Tile node={a} />
          <Tile node={b} />
        </span>
        <div>
          <h2>
            {a.private ? "🔒 " : ""}
            {a.name} × {b.private ? "🔒 " : ""}
            {b.name}
          </h2>
          {edge.masked ? (
            <p className="muted small">One of them is private: their dates stay between them.</p>
          ) : (
            <p className="muted small">
              {edge.stage && <span className="badge">{edge.stage}</span>}{" "}
              {edge.dates} {edge.dates === 1 ? "date" : "dates"}
              {edge.second_dates > 0 && `, ${edge.second_dates} second`}
              {edge.last_at && ` · last ${timeAgo(edge.last_at)}`}
            </p>
          )}
        </div>
      </header>
      {!edge.masked && (
        <div className="constellation-tie" title={`Tie strength ${Math.round(edge.weight * 100)}%`}>
          <span className="muted small">Tie strength</span>
          <span className="constellation-tie-track" aria-hidden>
            <span className="constellation-tie-fill" style={{ width: `${Math.max(4, Math.round(edge.weight * 100))}%` }} />
          </span>
        </div>
      )}
      {!anyPrivate && (
        <p className="constellation-panel-links">
          <Link className="button-ghost small" href={`/couples/${edge.a_id}/${edge.b_id}`}>
            Their story →
          </Link>{" "}
          <Link className="button-ghost small" href={`/characters/${a.id}`}>
            {a.name} →
          </Link>{" "}
          <Link className="button-ghost small" href={`/characters/${b.id}`}>
            {b.name} →
          </Link>
        </p>
      )}
    </aside>
  );
}
