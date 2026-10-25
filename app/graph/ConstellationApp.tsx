"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/graph";
import { KINDS, type KindId } from "@/lib/kinds";
import { communityColor, kindHue, type ColorBy } from "./colors";
import type { Selection } from "./ConstellationCanvas";
import SidePanel from "./SidePanel";
import CharacterName from "@/app/CharacterName";

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
 * The interactive shell around the canvas: a toolbar above the sky (search-to-focus, origin, colouring, kind and depth
 * filters), the sky itself, and the detail panel. Filtering happens here so the canvas just draws what it's given;
 * edges are always cut down to pairs whose both ends survived the node filter (the canvas relies on that alignment).
 */
export default function ConstellationApp({ data, initialFocus = null }: { data: GraphData; initialFocus?: string | null }) {
  // /graph?focus=<id> (from a character, couple or episode page): open on that character, its panel open.
  const start = initialFocus && data.nodes.some((n) => n.id === initialFocus && !n.private) ? initialFocus : null;
  const [selection, setSelection] = useState<Selection>(start ? { kind: "node", id: start } : null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // The canvas settles its layout first; focusing a moment later centres on where the node actually ends up.
  useEffect(() => {
    if (!start) return;
    const t = setTimeout(() => setFocusId(start), 600);
    return () => clearTimeout(t);
  }, [start]);
  // Full screen: the stage over the whole screen (and the browser's own full screen where it has one); Esc leaves.
  const stage = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const el = stage.current;
    if (el?.requestFullscreen && !document.fullscreenElement) void el.requestFullscreen().catch(() => {});
    document.documentElement.classList.add("constellation-locked");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    const onFs = () => !document.fullscreenElement && setFull(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.documentElement.classList.remove("constellation-locked");
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [full]);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [minDates, setMinDates] = useState(0);
  const [showSingles, setShowSingles] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("character");
  const [kind, setKind] = useState<KindFilter>("all");
  // "Show what happened": endings, turn-downs, who left first and the chevrons. Off, like the episode page's recap.
  const [showOutcomes, setShowOutcomes] = useState(false);
  // The kinds anyone on the sky has said, in the vocabulary's order, for the filter and the legend.
  const kindsPresent = useMemo(() => KINDS.filter((k) => data.nodes.some((n) => n.kind === k.id)), [data.nodes]);
  // The clusters on the sky, biggest first (the server numbers them by size): the first CLUSTER_COLORS.length get a
  // colour, the rest share the grey and the key just counts them.
  const clusters = useMemo(() => [...new Set(data.nodes.map((n) => n.community).filter((c): c is number => c !== null))].sort((x, y) => x - y), [data.nodes]);

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

  const coloured = clusters.filter((c) => communityColor(c) !== null);
  const smaller = clusters.length - coloured.length;

  return (
    <div ref={stage} className={`constellation-stage${full ? " is-full" : ""}`}>
      <div className="constellation-hud" role="toolbar" aria-label="Find and filter the constellation">
        {/* The whole screen for the sky (2026-10-25): the browser's full screen where it has one, a fixed overlay either way. */}
        <button
          type="button"
          className="constellation-full-btn"
          aria-pressed={full}
          aria-label={full ? "Exit full screen" : "Full screen"}
          onClick={() => setFull((v) => !v)}
          title={full ? "Leave full screen (Esc)" : "Full screen"}
        >
          {full ? "✕" : "⛶"}
        </button>
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
                    {n.private ? `🔒 ${n.name}` : <CharacterName character={n} link={false} />}
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
          <div className="constellation-colour" role="group" aria-label="Colour by">
            <span className="constellation-colour-label" aria-hidden>
              Colour
            </span>
            <div className="segmented constellation-segmented">
              {COLOR_BY.map((c) => (
                <button key={c.id} type="button" className="segmented-tab" aria-pressed={colorBy === c.id} onClick={() => setColorBy(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <label className="constellation-filter constellation-kind">
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
          <label className="constellation-filter" title="Only pairs with two or more public dates">
            <input type="checkbox" checked={minDates >= 2} onChange={(e) => setMinDates(e.target.checked ? 2 : 0)} /> 2+ dates
          </label>
          <label className="constellation-filter" title="Characters still waiting for a first date, on the outer ring">
            <input type="checkbox" checked={showSingles} onChange={(e) => setShowSingles(e.target.checked)} /> The orbit
          </label>
        </div>
      </div>
      <div className="constellation-sky">
        <ConstellationCanvas
          nodes={nodes}
          edges={edges}
          selection={selection}
          onSelect={setSelection}
          focusId={focusId}
          colorBy={colorBy}
          showOutcomes={showOutcomes}
        />
        <SidePanel
          selection={selection}
          nodes={data.nodes}
          edges={data.edges}
          onClose={() => setSelection(null)}
          onFocus={focus}
          colorBy={colorBy}
          showOutcomes={showOutcomes}
          onShowOutcomes={setShowOutcomes}
        />
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
            {coloured.map((c) => (
              <li key={c}>
                <span className="constellation-swatch" style={{ background: communityColor(c)! }} aria-hidden /> Cluster {c + 1}
              </li>
            ))}
            {smaller > 0 && (
              <li>
                <span className="constellation-swatch is-grey" aria-hidden /> +{smaller} smaller
              </li>
            )}
            {clusters.length === 0 && <li>No clusters yet: every pair dates alone.</li>}
            <li className="muted">Each colour is a circle that dates mostly among itself.</li>
          </ul>
        )}
      </div>
      <p className="constellation-legend small">
        Bigger stars have dated more · brighter lines run deeper · dashed pairs keep it private
        {showOutcomes ? " · a chevron points at who got turned down" : ""} · the outer ring is still waiting for a first date
      </p>
    </div>
  );
}
