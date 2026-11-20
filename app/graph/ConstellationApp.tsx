"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GraphData } from "@/lib/graph";
import { KINDS } from "@/lib/kinds";
import { communityColor, kindHue, type ColorBy } from "./colors";
import type { Selection } from "./ConstellationCanvas";
import {
  activeFilters,
  filterSky,
  linesNarrowed,
  stageCounts,
  stagesNarrowed,
  WHEN_LABEL,
  whenParam,
  WHENS,
  type KindFilter,
  type OriginFilter,
  type SkyFilter,
  type When,
} from "./filter";
import LineSwatch from "./LineSwatch";
import { GROUP_LABEL, groupHint, LINE_STYLE, STAGE_GROUPS, stageOn, stagesParam, toggleStage, type StageChoice } from "./stages";
import SidePanel from "./SidePanel";
import CharacterName from "@/app/CharacterName";
import Sheet from "@/app/Sheet";

// The canvas needs the browser (rAF, ResizeObserver, pointers). Next 16: ssr:false must live in a client file.
const ConstellationCanvas = dynamic(() => import("./ConstellationCanvas"), {
  ssr: false,
  loading: () => <p className="muted constellation-loading">Lighting the constellation…</p>,
});

/** "Yours" (the viewer's own characters) shows only for someone who has some: it follows Everyone, as on /characters. */
const ORIGIN_FILTERS: { id: OriginFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "yours", label: "Yours" },
  { id: "cast", label: "The cast" },
  { id: "person", label: "People's" },
  { id: "agent", label: "Agents'" },
];
/** A stable "none" (a fresh [] each render would re-filter the sky each render). */
const NO_IDS: string[] = [];
const COLOR_BY: { id: ColorBy; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "kind", label: "Kind" },
  { id: "community", label: "Cluster" },
];
const STILL_HINT = "More than one date, the last in the last 30 days, and not over";
const ORBIT_HINT = "Characters still waiting for a first date, on the outer ring";
const PARTNERS_HINT = "Everyone they've dated, from any group, not only dates among themselves";

/** Where a control is drawn: the desktop's toolbar on the sky, or the phone's Filters sheet on the page's card. */
type Place = "bar" | "sheet";

/**
 * Keeps the address in step with the sky's shareable filters, without a reload or a history entry (Next's router follows
 * window.history): only our own keys change, so ?focus= and ?ledger= stay as they were. It checks after every render,
 * so a ledger page's link (which knows nothing of the filters) can't leave the address behind the sky.
 */
function useSkyAddress(params: Record<string, string | null>) {
  const wanted = JSON.stringify(params);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(JSON.parse(wanted) as Record<string, string | null>)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    // A comma is fine in a query, and ?stage=together,sparks reads better in a shared link than together%2Csparks.
    const next = `${url.pathname}${url.search.replace(/%2C/gi, ",")}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  });
}

/**
 * The interactive shell around the canvas: two rows above the sky (who's on it: search-to-focus, origin, kind, the
 * orbit, colouring; which lines: the stage chips, when, still seeing each other), the sky itself, and the detail panel.
 * On a phone everything but search, the chips and full screen sits behind one Filters button, in a bottom sheet.
 * Filtering happens here so the canvas just draws what it's given; edges are always cut down to pairs whose both ends
 * survived the node filter (the canvas relies on that alignment).
 */
export default function ConstellationApp({
  data: first,
  total = null,
  initialFocus = null,
  initialOrigin = "all",
  initialStages = null,
  initialWhen = "all",
  initialStill = false,
  now,
  mine = NO_IDS,
}: {
  data: GraphData;
  /** The whole sky's size when `data` is only its strongest pairs (lib/graph.ts firstSky); null when it's all of it. */
  total?: { characters: number; pairs: number } | null;
  initialFocus?: string | null;
  /** /graph?origin= (the Characters page's preview of one tab's group): the filter it opens on. */
  initialOrigin?: OriginFilter;
  /** /graph?stage= (./stages.ts parseStages): the kinds of pair it opens on; null for all of them. */
  initialStages?: StageChoice;
  /** /graph?when= and ?still=1 (./filter.ts): when the pairs drawn last dated. */
  initialWhen?: When;
  initialStill?: boolean;
  /** The server's clock (ms) when it rendered the page: "this season" and "the last 30 days" count from it on both sides. */
  now: number;
  /** The viewer's own character ids: the "Yours" filter (none: no such filter). */
  mine?: string[];
}) {
  // The strongest pairs first; "Show the whole sky" swaps in all of it (/api/graph/sky). 2026-11-07 audit, item 17.
  const [data, setData] = useState<GraphData>(first);
  const [whole, setWhole] = useState(total === null);
  const [loadingSky, setLoadingSky] = useState(false);
  const loadWholeSky = async () => {
    if (whole || loadingSky) return;
    setLoadingSky(true);
    try {
      const res = await fetch("/api/graph/sky");
      if (res.ok) {
        setData((await res.json()) as GraphData);
        setWhole(true);
      }
    } catch {
      // The first sky stays, and so does the button, to try again.
    } finally {
      setLoadingSky(false);
    }
  };
  // /graph?focus=<id> (from a character, couple or episode page): open on that character, its panel open. Someone
  // outside the first sky brings the whole sky in first.
  const start = initialFocus && data.nodes.some((n) => n.id === initialFocus && !n.private) ? initialFocus : null;
  const [selection, setSelection] = useState<Selection>(start ? { kind: "node", id: start } : null);
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (initialFocus && !whole && !first.nodes.some((n) => n.id === initialFocus)) void loadWholeSky();
    // Only on arrival: the focus named in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The canvas settles its layout first; focusing a moment later centres on where the node actually ends up.
  useEffect(() => {
    if (!start) return;
    setSelection((s) => s ?? { kind: "node", id: start });
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
  const [origin, setOrigin] = useState<OriginFilter>(initialOrigin);
  // With a group picked, whoever they dated too (./filter.ts): the cast's love lives, not only their dates with each other.
  const [partners, setPartners] = useState(true);
  const [showSingles, setShowSingles] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("character");
  const [kind, setKind] = useState<KindFilter>("all");
  // Which kinds of pair are drawn (./stages.ts): the chips over the sky, which are its legend too.
  const [stages, setStages] = useState<StageChoice>(initialStages);
  // When they last dated, and "Still seeing each other" (which replaced "2+ dates": the First date chip covers those).
  const [when, setWhen] = useState<When>(initialWhen);
  const [still, setStill] = useState(initialStill);
  // "Show what happened": endings, turn-downs, who left first and the chevrons. Off, like the episode page's recap.
  const [showOutcomes, setShowOutcomes] = useState(false);
  // On a phone the filters sit behind one button, in a bottom sheet (2026-10-31 UX audit, D7: the first screen was all
  // filters); a desktop's toolbar has room for them in its two rows, so there the button isn't shown.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The kinds anyone on the sky has said, in the vocabulary's order, for the filter and the legend.
  const kindsPresent = useMemo(() => KINDS.filter((k) => data.nodes.some((n) => n.kind === k.id)), [data.nodes]);
  // The clusters on the sky, biggest first (the server numbers them by size): the first CLUSTER_COLORS.length get a
  // colour, the rest share the grey and the key just counts them.
  const clusters = useMemo(() => [...new Set(data.nodes.map((n) => n.community).filter((c): c is number => c !== null))].sort((x, y) => x - y), [data.nodes]);

  const mineSet = useMemo(() => new Set(mine), [mine]);
  const originFilters = mine.length ? ORIGIN_FILTERS : ORIGIN_FILTERS.filter((f) => f.id !== "yours");
  // Every kind of pair under the other filters (the chips count what each would show), then the sky as the chips leave it.
  const others: Omit<SkyFilter, "stages"> = useMemo(() => ({ origin, partners, kind, showSingles, when, still }), [origin, partners, kind, showSingles, when, still]);
  const everyKind = useMemo(() => filterSky(data, { ...others, stages: null }, mineSet, now), [data, others, mineSet, now]);
  const { nodes, edges } = useMemo(
    () => (stagesNarrowed(stages) ? filterSky(data, { ...others, stages }, mineSet, now) : everyKind),
    [data, others, stages, mineSet, now, everyKind],
  );
  const counts = useMemo(() => stageCounts(everyKind.edges), [everyKind.edges]);
  const filter: SkyFilter = { ...others, stages };
  const active = activeFilters(filter);
  const narrowed = linesNarrowed(filter);
  // A kind of pair or a time is looked for across the whole sky, not only its strongest pairs (which are mostly couples):
  // a chip turned off, a time picked or a shared link brings the rest in once.
  useEffect(() => {
    if (narrowed) void loadWholeSky();
    // Only when that changes: loadWholeSky is a fresh function each render, and it does nothing twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowed]);
  useSkyAddress({ origin: origin === "all" ? null : origin, stage: stagesParam(stages), when: whenParam(when), still: still ? "1" : null });
  const noLines = narrowed && edges.length === 0;
  const resetFilters = () => {
    setOrigin("all");
    setPartners(true);
    setKind("all");
    setShowSingles(true);
    setWhen("all");
    setStill(false);
    setColorBy("character");
  };
  const pairsShown = edges.length;

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

  // The filters, drawn on the desktop's toolbar and again in the phone's sheet: the same state, each place's own look.
  const check = (place: Place, checked: boolean, set: (v: boolean) => void, label: string, hint: string): ReactNode =>
    place === "bar" ? (
      <label className="constellation-filter" title={hint}>
        <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} /> {label}
      </label>
    ) : (
      <label className="check constellation-sheet-check">
        <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
        <span>
          {label}
          <span className="muted small">{hint}</span>
        </span>
      </label>
    );
  // One of a few: a segmented row on the toolbar; in the sheet, pills that wrap (a phone can't fit five in a row).
  // `current`: the origin's tabs also say aria-current, as the Characters page's tabs they mirror do.
  const choice = <T extends string>(place: Place, label: string, options: { id: T; label: string }[], value: T, set: (v: T) => void, current = false): ReactNode =>
    place === "bar" ? (
      <div className="segmented constellation-segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="segmented-tab"
            aria-pressed={value === o.id}
            aria-current={current && value === o.id ? "page" : undefined}
            onClick={() => set(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    ) : (
      <div className="constellation-options" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => set(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  const whenOptions = WHENS.map((w) => ({ id: w, label: WHEN_LABEL[w] }));
  const kindSelect = (
    <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} aria-label="What they are">
      <option value="all">Every kind</option>
      {kindsPresent.map((k) => (
        <option key={k.id} value={k.id}>
          {k.emoji} {k.label}
        </option>
      ))}
      <option value="unsaid">Hasn&apos;t said</option>
    </select>
  );
  const originControl = (place: Place) => choice(place, "Who made them", originFilters, origin, setOrigin, true);
  const colourControl = (place: Place) => choice(place, "Colour by", COLOR_BY, colorBy, setColorBy);
  const partnersControl = (place: Place) => origin !== "all" && check(place, partners, setPartners, "Who they dated", PARTNERS_HINT);
  const orbitControl = (place: Place) => check(place, showSingles, setShowSingles, "The orbit", ORBIT_HINT);
  const stillControl = (place: Place) => check(place, still, setStill, "Still seeing each other", STILL_HINT);

  return (
    <div ref={stage} className={`constellation-stage${full ? " is-full" : ""}`}>
      {/* Who's on the sky. */}
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
        <button type="button" className="constellation-filters-btn" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
          Filters
          {active > 0 && (
            <span className="constellation-filters-count">
              {" "}
              · {active}
              <span className="sr-only"> on</span>
            </span>
          )}
        </button>
        <div id="constellation-filters" className="constellation-filters">
          {originControl("bar")}
          {partnersControl("bar")}
          <label className="constellation-filter constellation-kind">{kindSelect}</label>
          {orbitControl("bar")}
          <div className="constellation-colour" role="group" aria-label="Colour by">
            <span className="constellation-colour-label" aria-hidden>
              Colour
            </span>
            {colourControl("bar")}
          </div>
        </div>
      </div>
      {/* Which lines. The chips: one per kind of pair, drawn as its line is, so the row is the sky's legend and its filter;
          then when they last dated. A lens switch (Love · Friends and family · Rivals · Gossip · Everything) goes first in
          this row when the social network's other views arrive: it picks which lines exist, and these filter within it. */}
      <div className="constellation-lines" role="group" aria-label="Which pairs to draw">
        <ul className="constellation-stage-chips scroll-row">
          {STAGE_GROUPS.map((g) => (
            <li key={g}>
              <button
                type="button"
                className="constellation-stage-chip"
                aria-pressed={stageOn(stages, g)}
                title={groupHint(g)}
                onClick={() => setStages((s) => toggleStage(s, g))}
                style={{ "--chip-line": `var(${LINE_STYLE[g].token})` } as CSSProperties}
              >
                <LineSwatch group={g} />
                {GROUP_LABEL[g]}
                <span className="constellation-stage-count">
                  {counts[g]}
                  <span className="sr-only"> {counts[g] === 1 ? "pair" : "pairs"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="constellation-when">
          <label className="constellation-filter">
            <span className="constellation-colour-label">When</span>
            <select value={when} onChange={(e) => setWhen(e.target.value as When)} aria-label="When they last dated">
              {whenOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {stillControl("bar")}
        </div>
      </div>
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="constellation-sheet">
          <fieldset>
            <legend>When they last dated</legend>
            {choice("sheet", "When they last dated", whenOptions, when, setWhen)}
            {stillControl("sheet")}
          </fieldset>
          <fieldset>
            <legend>Who made them</legend>
            {originControl("sheet")}
            {partnersControl("sheet")}
          </fieldset>
          <fieldset>
            <legend>What they are</legend>
            {kindSelect}
          </fieldset>
          <fieldset>
            <legend>Who&apos;s on the sky</legend>
            {orbitControl("sheet")}
          </fieldset>
          <fieldset>
            <legend>Colour the stars by</legend>
            {colourControl("sheet")}
          </fieldset>
          <div className="sheet-actions sheet-actions-pinned">
            <button type="button" className="button-ghost" onClick={resetFilters} disabled={active === 0 && colorBy === "character"}>
              Reset
            </button>
            <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>
              Show {pairsShown} {pairsShown === 1 ? "pair" : "pairs"}
            </button>
          </div>
        </div>
      </Sheet>
      {!whole && total && (
        <p className="constellation-more small">
          Showing the {first.edges.filter((e) => !e.masked).length} strongest pairs.{" "}
          <button type="button" className="button-ghost small" onClick={() => void loadWholeSky()} disabled={loadingSky} data-track="graph-whole-sky">
            {loadingSky ? "Lighting the rest…" : `Show the whole sky: ${total.characters} characters, ${total.pairs} pairs`}
          </button>
        </p>
      )}
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
        {noLines && (
          <div className="constellation-empty" role="status">
            <p>{loadingSky ? "Looking across the whole sky…" : "No pairs like that on the sky."}</p>
            {!loadingSky && (
              <button
                type="button"
                className="button-ghost small"
                onClick={() => {
                  setStages(null);
                  setWhen("all");
                  setStill(false);
                }}
              >
                Show every pair
              </button>
            )}
          </div>
        )}
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
        Bigger stars have dated more · brighter, thicker lines run deeper · grey dashes keep a pair private
        {showOutcomes ? " · a chevron points at who got turned down" : ""} · the outer ring is still waiting for a first date
      </p>
    </div>
  );
}
