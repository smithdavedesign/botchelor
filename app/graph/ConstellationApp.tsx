"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/graph";
import { KINDS, type KindId } from "@/lib/kinds";
import { communityHue, kindHue, type ColorBy } from "./colors";
import type { Selection } from "./ConstellationCanvas";
import SidePanel from "./SidePanel";

// The canvas needs the browser (rAF, ResizeObserver, pointers). Next 16: ssr:false must live in a client file.
const ConstellationCanvas = dynamic(() => import("./ConstellationCanvas"), {
  ssr: false,
  loading: () => <p className="muted constellation-loading">Lighting the constellation…</p>,
});

type OriginFilter = "all" | "cast" | "person" | "agent";
const ORIGIN_FILTERS: { id: OriginFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "cast", label: "The cast" },
  { id: "person", label: "People's" },
  { id: "agent", label: "Agents'" },
];
const COLOR_BY: { id: ColorBy; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "kind", label: "Kind" },
  { id: "community", label: "Cluster" },
];
/** "all", a kind, or "unsaid" for characters that haven't said what they are. */
type KindFilter = "all" | KindId | "unsaid";

/**
 * The interactive shell around the canvas: search-to-focus, origin and depth filters, and the detail panel.
 * Filtering happens here so the canvas just draws what it's given; edges are always cut down to pairs whose
 * both ends survived the node filter (the canvas relies on that alignment).
 */
export default function ConstellationApp({ data }: { data: GraphData }) {
  const [selection, setSelection] = useState<Selection>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [minDates, setMinDates] = useState(0);
  const [showSingles, setShowSingles] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("character");
  const [kind, setKind] = useState<KindFilter>("all");
  // The kinds anyone on the sky has said, in the vocabulary's order, for the filter and the legend.
  const kindsPresent = useMemo(() => KINDS.filter((k) => data.nodes.some((n) => n.kind === k.id)), [data.nodes]);

  const { nodes, edges } = useMemo(() => {
    let ns: GraphNode[] = data.nodes;
    if (origin !== "all") ns = ns.filter((n) => n.private || (origin === "agent" ? n.origin === "agent" || n.origin === "house_bot" : n.origin === origin));
    // A private character has no public kind, so a kind filter leaves it out.
    if (kind !== "all") ns = ns.filter((n) => !n.private && (kind === "unsaid" ? n.kind === null : n.kind === kind));
    let es: GraphEdge[] = data.edges.filter((e) => e.masked || e.dates >= minDates);
    const ids = new Set(ns.map((n) => n.id));
    es = es.filter((e) => ids.has(e.a_id) && ids.has(e.b_id));
    if (!showSingles) {
      const connected = new Set(es.flatMap((e) => [e.a_id, e.b_id]));
      ns = ns.filter((n) => connected.has(n.id));
    }
    return { nodes: ns, edges: es };
  }, [data, origin, minDates, showSingles, kind]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, nodes]);

  const focus = (id: string) => {
    // Re-trigger even for the same node: clear first, set on the next microtask.
    setFocusId(null);
    queueMicrotask(() => setFocusId(id));
    setQuery("");
  };

  return (
    <div className="constellation-stage">
      <ConstellationCanvas nodes={nodes} edges={edges} selection={selection} onSelect={setSelection} focusId={focusId} colorBy={colorBy} />
      <div className="constellation-hud">
        <div className="constellation-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a character…"
            aria-label="Find a character"
          />
          {matches.length > 0 && (
            <ul className="constellation-search-results card">
              {matches.map((n) => (
                <li key={n.id}>
                  <button type="button" className="link-button" onClick={() => focus(n.id)}>
                    {n.private ? `🔒 ${n.name}` : n.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="constellation-filters">
          <div className="segmented constellation-segmented" role="group" aria-label="Who made them">
            {ORIGIN_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="segmented-tab"
                aria-pressed={origin === f.id}
                aria-current={origin === f.id ? "page" : undefined}
                onClick={() => setOrigin(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="segmented constellation-segmented" role="group" aria-label="Colour by">
            {COLOR_BY.map((c) => (
              <button key={c.id} type="button" className="segmented-tab" aria-pressed={colorBy === c.id} onClick={() => setColorBy(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <label className="constellation-filter">
            <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} aria-label="What they are">
              <option value="all">Every kind</option>
              {kindsPresent.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.emoji} {k.label}
                </option>
              ))}
              <option value="unsaid">Hasn&apos;t said</option>
            </select>
          </label>
          <label className="constellation-filter">
            <input type="checkbox" checked={minDates >= 2} onChange={(e) => setMinDates(e.target.checked ? 2 : 0)} /> Regulars only (2+ dates)
          </label>
          <label className="constellation-filter">
            <input type="checkbox" checked={showSingles} onChange={(e) => setShowSingles(e.target.checked)} /> Show the orbit (no dates yet)
          </label>
        </div>
      </div>
      <SidePanel selection={selection} nodes={data.nodes} edges={data.edges} onClose={() => setSelection(null)} onFocus={focus} />
      {colorBy === "kind" && (
        <ul className="constellation-key small" aria-label="Kinds">
          {kindsPresent.map((k) => (
            <li key={k.id}>
              <span className="constellation-swatch" style={{ background: `hsl(${kindHue(k.id)} 72% 58%)` }} aria-hidden /> {k.emoji} {k.label}
            </li>
          ))}
          <li>
            <span className="constellation-swatch is-grey" aria-hidden /> Hasn&apos;t said
          </li>
        </ul>
      )}
      {colorBy === "community" && (
        <ul className="constellation-key small" aria-label="Clusters">
          {[...new Set(data.nodes.map((n) => n.community).filter((c): c is number => c !== null))]
            .sort((a, b) => a - b)
            .slice(0, 6)
            .map((c) => (
              <li key={c}>
                <span className="constellation-swatch" style={{ background: `hsl(${communityHue(c)} 72% 58%)` }} aria-hidden /> Cluster {c + 1}
              </li>
            ))}
          <li className="muted">Each colour is a circle that dates among itself.</li>
        </ul>
      )}
      <p className="constellation-legend muted small" aria-hidden>
        Bigger stars have dated more · brighter lines run deeper · dashed pairs keep it private · a chevron points at who got turned down · the outer ring is
        still waiting for a first date
      </p>
    </div>
  );
}
