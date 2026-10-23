"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import Pager from "@/app/Pager";
import { avatarGradientCss, avatarPalette, initials } from "@/lib/avatar";
import { pageOf } from "@/lib/paging";
import type { GraphEdge, GraphNode, PairTimeline } from "@/lib/graph";
import { ORIGIN_LABEL } from "@/lib/origin";
import { endingLabel } from "@/lib/rules";
import { communityColor, type ColorBy } from "./colors";
import type { Selection } from "./ConstellationCanvas";
import CharacterName from "@/app/CharacterName";

type Props = {
  selection: Selection;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  /** Jump the canvas to a node (the panel's partner links double as navigation). */
  onFocus: (id: string) => void;
  /** What the stars' colours mean right now: under "Cluster", a star's panel names its cluster. */
  colorBy: ColorBy;
  /** "Show what happened": endings, who turned whom down, who left first. Off by default (the episode page's rule). */
  showOutcomes: boolean;
  onShowOutcomes: (on: boolean) => void;
};

/** The panel's lists, this many a page: a star's partners, a pair's public dates. */
export const PANEL_PAGE = 8;

export const SHOW_OUTCOMES_LABEL = "Show what happened (it gives away the endings)";

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** What aired about a pair, in words: who turned whom down, who left first (lib/graph.ts; the only public directions). */
function aired(edge: GraphEdge, a: string, b: string): string[] {
  const out: string[] = [];
  const td = edge.turned_down;
  if (td?.a) out.push(`${a} turned ${b} down ${times(td.a)}`);
  if (td?.b) out.push(`${b} turned ${a} down ${times(td.b)}`);
  const lf = edge.left_first;
  if (lf?.a) out.push(`${a} left first ${times(lf.a)}`);
  if (lf?.b) out.push(`${b} left first ${times(lf.b)}`);
  if (lf?.together) out.push(`they left together ${times(lf.together)}`);
  return out;
}

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

/** Their first public date, and how it came about ("the show set it up"): never about a date before it. */
function firstPublic(edge: GraphEdge): string | null {
  if (!edge.first_at) return null;
  const how = edge.met_via === "set_up" ? ": the show set it up" : edge.met_via === "asked" ? ": one of them asked" : "";
  return `First public date ${shortDate(edge.first_at)}${how}.`;
}

/**
 * A pair's public dates with each ending and the stage after it, fetched when "Show what happened" is opened on them
 * (/api/graph/[a]/[b]): it isn't in the page's payload, which stays small and spoiler-light.
 */
function Timeline({ a, b }: { a: string; b: string }) {
  const key = `${a}~${b}`;
  const [got, setGot] = useState<{ key: string; data: PairTimeline | null } | null>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    let live = true;
    fetch(`/api/graph/${encodeURIComponent(a)}/${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PairTimeline>) : null))
      .catch(() => null)
      .then((data) => {
        if (live) setGot({ key, data });
      });
    return () => {
      live = false;
    };
  }, [a, b, key]);
  if (got?.key !== key) return <p className="muted small">Loading their dates…</p>;
  if (!got.data) return <p className="muted small">Their dates didn&apos;t load. Their story page has them all.</p>;
  const { timeline, total, truncated } = got.data;
  const shown = pageOf(timeline, page, PANEL_PAGE);
  // The first date on this page, counted over every public date (the timeline may be only the latest ones).
  const firstNumber = total - timeline.length + 1 + (shown.page - 1) * PANEL_PAGE;
  return (
    <>
      {truncated && (
        <p className="muted small constellation-timeline-note">
          Their latest {timeline.length} of {total} public dates.
        </p>
      )}
      <ol className="constellation-timeline small" aria-label="Their public dates" start={firstNumber}>
        {shown.items.map((step, i) => (
          <li key={`${step.at}-${i}`}>
            {/* Step i is their (total - shown + 1 + i)th public date: a happy ending on their third reads "A fourth date". */}
            <span className="muted">{shortDate(step.at)}</span> {endingLabel(step.ending, total - timeline.length + 1 + i)}
            {step.stage && <span className="muted"> → {step.stage}</span>}
          </li>
        ))}
      </ol>
      <Pager page={shown.page} pages={shown.pages} label="Their public dates pages" onPage={setPage} />
    </>
  );
}

/** A star's partners, a page at a time: each a button that jumps the sky to them (a private one: its name only). */
function Partners({ node, mine, byId, onFocus }: { node: GraphNode; mine: GraphEdge[]; byId: Map<string, GraphNode>; onFocus: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const rows = mine.flatMap((e) => {
    const other = byId.get(e.a_id === node.id ? e.b_id : e.a_id);
    return other ? [{ e, other }] : [];
  });
  const shown = pageOf(rows, page, PANEL_PAGE);
  return (
    <>
      <ul className="list constellation-panel-list">
        {shown.items.map(({ e, other }) => (
          <li key={`${e.a_id}~${e.b_id}`}>
            {other.private ? (
              <span className="muted">🔒 {other.name}</span>
            ) : (
              <button type="button" className="link-button char-name" onClick={() => onFocus(other.id)}>
                <Avatar seed={other.id} name={other.name} hue={other.hue} portraitSrc={other.portrait} size={22} decorative round />
                <span className="char-name-text">{other.name}</span>
              </button>
            )}{" "}
            {!e.masked && (
              <span className="muted small">
                {e.stage ? `${e.stage} · ` : ""}
                {e.dates} {e.dates === 1 ? "date" : "dates"}
              </span>
            )}
          </li>
        ))}
      </ul>
      <Pager page={shown.page} pages={shown.pages} label={`${node.name}'s connections pages`} onPage={setPage} />
    </>
  );
}

/** What a tap opens: a character's public story, or a pair's. Spoilers wait behind "Show what happened". */
export default function SidePanel({ selection, nodes, edges, onClose, onFocus, colorBy, showOutcomes, onShowOutcomes }: Props) {
  if (!selection) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (selection.kind === "node") {
    const node = byId.get(selection.id);
    if (!node) return null;
    const mine = edges.filter((e) => e.a_id === node.id || e.b_id === node.id);
    const clusterColor = colorBy === "community" && node.community !== null ? communityColor(node.community) : null;
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
                {node.kind_label && <span className="badge">{node.kind_label}</span>} {node.origin ? ORIGIN_LABEL[node.origin] : ""} ·{" "}
                {node.degree === 0 ? "waiting for a first date" : `${node.degree} public connection${node.degree === 1 ? "" : "s"}`}
              </p>
            )}
            {colorBy === "community" && node.community !== null && (
              <p className="muted small constellation-cluster-name">
                <span className={`constellation-swatch${clusterColor ? "" : " is-grey"}`} style={clusterColor ? { background: clusterColor } : undefined} aria-hidden />{" "}
                Cluster {node.community + 1}
                {clusterColor ? "" : " (a smaller one, in grey)"}
              </p>
            )}
          </div>
        </header>
        {!node.private && mine.length > 0 && <Partners key={node.id} node={node} mine={mine} byId={byId} onFocus={onFocus} />}
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
  const first = firstPublic(edge);
  const happened = aired(edge, a.name, b.name);
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
      {!edge.masked && first && <p className="small constellation-aired">{first}</p>}
      {!edge.masked && (
        <div className="constellation-tie" title={`Tie strength ${Math.round(edge.weight * 100)}%`}>
          <span className="muted small">Tie strength</span>
          <span className="constellation-tie-track" aria-hidden>
            <span className="constellation-tie-fill" style={{ width: `${Math.max(4, Math.round(edge.weight * 100))}%` }} />
          </span>
        </div>
      )}
      {!edge.masked && (
        <div className="constellation-outcomes">
          {/* The same fold as the episode page's recap toggle: closed by default, and it opens the chevrons on the sky too. */}
          <button type="button" className="constellation-reveal" aria-expanded={showOutcomes} onClick={() => onShowOutcomes(!showOutcomes)}>
            {showOutcomes ? "Hide what happened" : SHOW_OUTCOMES_LABEL}
          </button>
          {showOutcomes && (
            <div className="constellation-outcomes-body">
              {happened.length > 0 && <p className="small constellation-aired">{happened.join(" · ")}</p>}
              <Timeline key={`${edge.a_id}~${edge.b_id}`} a={edge.a_id} b={edge.b_id} />
            </div>
          )}
        </div>
      )}
      {!anyPrivate && (
        <p className="constellation-panel-links">
          <Link className="button-ghost small" href={`/couples/${edge.a_id}/${edge.b_id}`}>
            Their story →
          </Link>{" "}
          <Link className="button-ghost small" href={`/characters/${a.id}`}>
            <CharacterName character={a} link={false} size={18} /> →
          </Link>{" "}
          <Link className="button-ghost small" href={`/characters/${b.id}`}>
            <CharacterName character={b} link={false} size={18} /> →
          </Link>
        </p>
      )}
    </aside>
  );
}
