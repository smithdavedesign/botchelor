"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GraphData } from "@/lib/graph";
import { KINDS } from "@/lib/kinds";
import { shortName } from "@/lib/names";
import { clusterLabel, membersByCommunity, nameClusters, namesThatFit, type ClusterName } from "@/lib/social/cluster-names";
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
import LensPanel from "./LensPanel";
import { filterLens, lensCounts, lensGraph, type SkyEdge, type SkyNode } from "./lens";
import {
  groupOn,
  LENS_EMPTY,
  LENS_GROUPS,
  LENS_LABEL,
  LENS_LEGEND,
  LENSES,
  lensHref,
  lensParam,
  LINE_STYLES,
  toggleGroup,
  type GroupChoice,
  type Lens,
  type LensSky,
} from "@/lib/social/lenses";
import type { SkyLens } from "@/lib/social/types";
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
/** The group the sky is narrowed to, said on the bar (its filter lives in the Filters sheet): "Yours", "The cast"… */
const SCOPE_LABEL: Record<Exclude<OriginFilter, "all">, string> = { yours: "Yours", cast: "The cast", person: "People's characters", agent: "Agents' characters" };
/** A stable "none" (a fresh [] each render would re-filter the sky each render). */
const NO_IDS: string[] = [];
/** An empty sky, the same one every render: a fresh [] would make every memo and effect built on the sky run again. */
const NO_NODES: SkyNode[] = [];
const NO_EDGES: SkyEdge[] = [];
const COLOR_BY: { id: ColorBy; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "kind", label: "Kind" },
  { id: "community", label: "Cluster" },
];
const STILL_HINT = "More than one date, the last in the last 30 days, and not over";
const ORBIT_HINT = "Characters still waiting for a first date, on the outer ring";
const PARTNERS_HINT = "Everyone they've dated, from any group, not only dates among themselves";

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
 * The interactive shell around the canvas: one bar above the sky (search-to-focus, the views, the stage chips that are
 * also its legend, Filters, full screen), the sky itself, and the detail panel, whose "Just their corner of the sky"
 * cuts the sky to one character's corner. Who's on the sky (origin, kind, the orbit), how it's coloured and when they
 * last dated sit behind the one Filters button, everywhere: a centred card on a desktop, a bottom sheet on a phone
 * (2026-11-21: the desktop's three rows of controls pushed the sky down; the phone's one button already worked).
 *
 * The views (SOCIAL_LENSES, docs/PRDs/social-network.md section 9): Love is the Constellation, who dated whom; Friends
 * and family, Rivals, Gossip and Everything draw the social network's public ties on the same canvas (./lens.ts), each
 * fetched the first time it's picked (/api/graph/lens), so none adds to the first load. A view has its own chips, its
 * own numbers line and its own link (?lens=). The filters for who's on the sky carry across views; the ones about
 * dating (the stages, when, still seeing each other, the orbit) are Love's.
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
  initialWorld = null,
  now,
  mine = NO_IDS,
  lensesOn = false,
  initialLens = "love",
  initialLensSky = null,
  loveNumbers = null,
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
  /** /graph?world=<id>: the sky opens on just that character's corner of it (./filter.ts worldOf). */
  initialWorld?: string | null;
  /** The server's clock (ms) when it rendered the page: "this season" and "the last 30 days" count from it on both sides. */
  now: number;
  /** The viewer's own character ids: the "Yours" filter (none: no such filter). */
  mine?: string[];
  /** The social views (SOCIAL_LENSES): off, the sky is the Constellation alone, exactly as before. */
  lensesOn?: boolean;
  /** /graph?lens=: the view it opens on, and that view's sky when the server built it (a shared link draws at once). */
  initialLens?: Lens;
  initialLensSky?: LensSky | null;
  /** Love's numbers line (the page renders it): under the sky in Love; another view shows its own there. */
  loveNumbers?: ReactNode;
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
  // "Just their corner of the sky" (./filter.ts worldOf): a character's id, from their panel or ?world=.
  const [world, setWorld] = useState<string | null>(initialWorld);
  // "Show what happened": endings, turn-downs, who left first and the chevrons. Off, like the episode page's recap.
  const [showOutcomes, setShowOutcomes] = useState(false);
  // On a phone the filters sit behind one button, in a bottom sheet (2026-10-31 UX audit, D7: the first screen was all
  // filters); a desktop's toolbar has room for them in its two rows, so there the button isn't shown.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The view (Love unless ?lens= said otherwise), and each social view's sky once it's in: the server's for the view a
  // shared link opened on, the rest fetched when first picked.
  const [lens, setLens] = useState<Lens>(lensesOn ? initialLens : "love");
  const social: SkyLens | null = lens === "love" ? null : lens;
  const [lensSkies, setLensSkies] = useState<Partial<Record<SkyLens, LensSky>>>(() => (initialLensSky ? { [initialLensSky.lens]: initialLensSky } : {}));
  const [lensFailed, setLensFailed] = useState<SkyLens | null>(null);
  const [lensTry, setLensTry] = useState(0);
  const lensData = social ? (lensSkies[social] ?? null) : null;
  useEffect(() => {
    if (!social || lensSkies[social]) return;
    let live = true;
    fetch(`/api/graph/lens?lens=${social}`)
      .then((r) => (r.ok ? (r.json() as Promise<LensSky>) : null))
      .catch(() => null)
      .then((sky) => {
        if (!live) return;
        if (sky) setLensSkies((had) => ({ ...had, [social]: sky }));
        else setLensFailed(social);
      });
    return () => {
      live = false;
    };
  }, [social, lensSkies, lensTry]);
  const lensLoading = social !== null && !lensData && lensFailed !== social;
  // A view's chips (lib/social/lenses.ts LENS_GROUPS): every group until one is turned off; a new view starts with all.
  const [groups, setGroups] = useState<GroupChoice>(null);
  const lensWhole = useMemo(() => (lensData ? lensGraph(lensData) : null), [lensData]);
  // Whichever sky is up: Love's characters, or the view's characters and places.
  const skyAll: SkyNode[] = lensWhole ? lensWhole.nodes : social ? NO_NODES : data.nodes;

  // The kinds anyone on the sky has said, in the vocabulary's order, for the filter and the legend.
  const kindsPresent = useMemo(() => KINDS.filter((k) => skyAll.some((n) => n.kind === k.id)), [skyAll]);
  // The clusters on the sky, biggest first (the server numbers them by size): the first CLUSTER_COLORS.length get a
  // colour, the rest share the grey and the key just counts them.
  const clusters = useMemo(() => [...new Set(skyAll.map((n) => n.community).filter((c): c is number => c !== null))].sort((x, y) => x - y), [skyAll]);
  // Clusters named after the place most of each shares ("Regulars at the dive bar", lib/social/cluster-names.ts), in
  // the key and a star's panel. A view names its own from its places; Love's come from /api/graph/clusters, fetched the
  // first time Love is coloured by cluster (never on the first load), and are kept only while they fit this sky.
  const [loveNames, setLoveNames] = useState<ClusterName[] | null>(null);
  const wantLoveNames = lensesOn && !social && colorBy === "community" && loveNames === null;
  useEffect(() => {
    if (!wantLoveNames) return;
    let live = true;
    fetch("/api/graph/clusters")
      .then((r) => (r.ok ? (r.json() as Promise<{ names: ClusterName[] }>) : null))
      .catch(() => null)
      .then((body) => {
        if (live && body && Array.isArray(body.names)) setLoveNames(body.names);
      });
    return () => {
      live = false;
    };
  }, [wantLoveNames]);
  const clusterNames = useMemo(() => {
    if (!lensesOn) return null;
    if (social) {
      if (!lensData) return null;
      const places = lensData.places.map((p) => ({ key: p.id, role: p.role, name: p.name, members: p.members }));
      return nameClusters(membersByCommunity(lensData.nodes), places);
    }
    return loveNames ? namesThatFit(loveNames, data.nodes) : null;
  }, [lensesOn, social, lensData, loveNames, data.nodes]);

  const mineSet = useMemo(() => new Set(mine), [mine]);
  // Their world needs them on the sky, and public (as ?focus= does). Until the whole sky is in, someone outside the
  // first sky isn't found yet; once it is, a world nobody's in is dropped. In another view, someone with no ties in it
  // keeps their world (the sky says so), for when Love is picked again.
  const worldNode = useMemo(() => (world ? (skyAll.find((n) => n.id === world && !n.private && !n.place) ?? null) : null), [skyAll, world]);
  const worldId = worldNode?.id ?? null;
  useEffect(() => {
    if (!social && world && whole && !worldNode) setWorld(null);
  }, [social, world, whole, worldNode]);
  const worldName = world ? (worldNode?.name ?? data.nodes.find((n) => n.id === world)?.name ?? null) : null;
  // In a view: the same filters on who's on the sky, its chips on its lines, and their corner within it.
  const lensBase = useMemo(() => ({ origin, kind, world: worldId }), [origin, kind, worldId]);
  const lensEvery = useMemo(() => (lensWhole ? filterLens(lensWhole, { ...lensBase, groups: null }, mineSet) : null), [lensWhole, lensBase, mineSet]);
  const lensShown = useMemo(() => (lensWhole && groups ? filterLens(lensWhole, { ...lensBase, groups }, mineSet) : lensEvery), [lensWhole, lensBase, groups, mineSet, lensEvery]);
  const lensChips = useMemo(() => (social && lensEvery ? lensCounts(LENS_GROUPS[social], lensEvery) : null), [social, lensEvery]);
  const pickLens = (next: Lens) => {
    if (next === lens) return;
    setLens(next);
    setGroups(null);
    setLensFailed(null);
    // A star's panel follows them into the next view (it says if they've no ties there); a pair's closes.
    setSelection((s) => (s?.kind === "node" ? s : null));
  };
  const originFilters = mine.length ? ORIGIN_FILTERS : ORIGIN_FILTERS.filter((f) => f.id !== "yours");
  // Every kind of pair under the other filters (the chips count what each would show), then the sky as the chips leave it.
  const others: Omit<SkyFilter, "stages"> = useMemo(
    () => ({ origin, partners, kind, showSingles, when, still, world: worldId }),
    [origin, partners, kind, showSingles, when, still, worldId],
  );
  const everyKind = useMemo(() => filterSky(data, { ...others, stages: null }, mineSet, now), [data, others, mineSet, now]);
  const { nodes, edges } = useMemo(
    () => (stagesNarrowed(stages) ? filterSky(data, { ...others, stages }, mineSet, now) : everyKind),
    [data, others, stages, mineSet, now, everyKind],
  );
  const counts = useMemo(() => stageCounts(everyKind.edges), [everyKind.edges]);
  const filter: SkyFilter = { ...others, stages };
  // In a view, only who made them and what they are: the rest of the sheet is about dating.
  const active = social ? [origin !== "all", kind !== "all"].filter(Boolean).length : activeFilters(filter);
  const narrowed = linesNarrowed(filter);
  // A kind of pair, a time or someone's world is looked for across the whole sky, not only its strongest pairs (which
  // are mostly couples): a chip turned off, a time picked, a world or a shared link brings the rest in once.
  const wantsWhole = !social && (narrowed || world !== null);
  useEffect(() => {
    if (wantsWhole) void loadWholeSky();
    // Only when that changes: loadWholeSky is a fresh function each render, and it does nothing twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsWhole]);
  // A view's link keeps the filters on who's on the sky and leaves Love's own (they're kept for when Love's picked again).
  useSkyAddress({
    ...(lensesOn ? { lens: lensParam(lens) } : {}),
    origin: origin === "all" ? null : origin,
    stage: social ? null : stagesParam(stages),
    when: social ? null : whenParam(when),
    still: social || !still ? null : "1",
    world,
  });
  // Into a world (or out of one, or the whole sky arriving under one): once the stars have moved, frame all of them
  // (`fit`). The centre's panel opens beside the sky on a wider screen; on a phone it would cover the world, so it closes.
  const [fit, setFit] = useState(0);
  const hadWorld = useRef(false);
  useEffect(() => {
    if (!worldId && !hadWorld.current) return;
    hadWorld.current = worldId !== null;
    if (worldId) setSelection(window.matchMedia("(max-width: 640px)").matches ? null : { kind: "node", id: worldId });
    const t = setTimeout(() => setFit((n) => n + 1), 600);
    return () => clearTimeout(t);
  }, [worldId, whole]);
  // Another view drawn, or Love again: once the stars have moved, frame them (a view's sky is laid out afresh).
  const arrived = useRef(lens === "love");
  useEffect(() => {
    if (arrived.current) {
      arrived.current = false;
      return;
    }
    if (social && !lensData) return;
    const t = setTimeout(() => setFit((n) => n + 1), 700);
    return () => clearTimeout(t);
  }, [lens, social, lensData]);
  // What the canvas draws: Love's pairs, or the view's lines and places as its filters leave them.
  const skyNodes: SkyNode[] = social ? (lensShown?.nodes ?? NO_NODES) : nodes;
  const skyEdges: SkyEdge[] = social ? (lensShown?.edges ?? NO_EDGES) : edges;
  // Their world with the centre filtered off the sky (a kind or a group they aren't): nothing of it can be drawn.
  const worldGone = worldNode !== null && !skyNodes.some((n) => n.id === worldNode.id);
  const noLines = social ? false : (narrowed && edges.length === 0) || worldGone;
  // In a view: nothing in it yet, their world with nothing in this view, or filters that leave nothing.
  const lensEmpty = Boolean(lensData && lensData.pairs.length === 0 && lensData.places.length === 0);
  const worldAbsent = social !== null && lensWhole !== null && world !== null && worldNode === null;
  const lensNothing = social !== null && lensShown !== null && !lensEmpty && !worldAbsent && lensShown.edges.length === 0;
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
  // A view's ties on the sky: its pairs' lines and its places.
  const tiesShown = social && lensShown ? lensShown.edges.reduce((sum, e) => sum + (e.spoke ? 0 : Math.max(1, e.lines?.length ?? 0)), 0) + lensShown.nodes.filter((n) => n.place).length : 0;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return skyNodes.filter((n) => !n.place && n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, skyNodes]);

  const focus = (id: string) => {
    // Re-trigger even for the same node: clear first, set on the next microtask.
    setFocusId(null);
    queueMicrotask(() => setFocusId(id));
    setQuery("");
  };

  const coloured = clusters.filter((c) => communityColor(c) !== null);
  const smaller = clusters.length - coloured.length;

  // The filters, in the Filters sheet: a checkbox with its hint under the label, and one-of-a-few as pills that wrap.
  const check = (checked: boolean, set: (v: boolean) => void, label: string, hint: string): ReactNode => (
    <label className="check constellation-sheet-check">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      <span>
        {label}
        <span className="muted small">{hint}</span>
      </span>
    </label>
  );
  const choice = <T extends string>(label: string, options: { id: T; label: string }[], value: T, set: (v: T) => void): ReactNode => (
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
  const originControl = choice("Who made them", originFilters, origin, setOrigin);
  const colourControl = choice("Colour by", COLOR_BY, colorBy, setColorBy);
  const partnersControl = !social && origin !== "all" && check(partners, setPartners, "Who they dated", PARTNERS_HINT);
  const orbitControl = !social && check(showSingles, setShowSingles, "The orbit", ORBIT_HINT);
  const stillControl = check(still, setStill, "Still seeing each other", STILL_HINT);

  return (
    <div ref={stage} className={`constellation-stage${full ? " is-full" : ""}`}>
      {/* One bar on a desktop (the two rows below laid out as one, app/globals.css .constellation-bar), two on a phone. */}
      <div className="constellation-bar">
      {/* Find someone, the filters, full screen. */}
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
        {/* Who the sky is narrowed to, in sight (a Map link from a Characters tab opens on its group): one tap for everyone. */}
        {origin !== "all" && (
          <button type="button" className="constellation-scope" onClick={() => setOrigin("all")} title="Show everyone" data-track="graph-scope-clear">
            {SCOPE_LABEL[origin]}
            {!social && partners && " & who they dated"}
            <span aria-hidden="true"> ✕</span>
            <span className="sr-only">, show everyone</span>
          </button>
        )}
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
      </div>
      {/* Which lines. The views first (Love · Friends and family · Rivals · Gossip · Everything): they pick which lines
          exist, and the chips after them filter within. The chips: one per kind of line, drawn as its line is, so the row
          is the sky's legend and its filter. */}
      <div className="constellation-lines" role="group" aria-label="Which pairs to draw">
        {lensesOn && (
          <nav className="segmented constellation-lenses scroll-row" aria-label="Views of the sky">
            {LENSES.map((l) => (
              <a
                key={l}
                className="segmented-tab"
                href={lensHref(l)}
                aria-current={l === lens ? "page" : undefined}
                data-track={`graph-lens-${l}`}
                onClick={(e) => {
                  // A new tab or window gets the link; a plain click switches the view in place.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  pickLens(l);
                }}
              >
                {LENS_LABEL[l]}
              </a>
            ))}
          </nav>
        )}
        {social ? (
          <ul className="constellation-stage-chips scroll-row">
            {LENS_GROUPS[social].map((g) => {
              const n = lensChips?.[g.id] ?? null;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    className="constellation-stage-chip"
                    aria-pressed={groupOn(groups, g.id)}
                    title={g.hint}
                    onClick={() => setGroups((c) => toggleGroup(social, c, g.id))}
                    style={{ "--chip-line": `var(${LINE_STYLES[g.style].token})` } as CSSProperties}
                  >
                    <LineSwatch social={g.style} />
                    {g.label}
                    {n !== null && (
                      <span className="constellation-stage-count">
                        {n}
                        <span className="sr-only"> {n === 1 ? "line" : "lines"}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
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
        )}
      </div>
      </div>
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="constellation-sheet">
          {!social && (
            <fieldset>
              <legend>When they last dated</legend>
              {choice("When they last dated", whenOptions, when, setWhen)}
              {stillControl}
            </fieldset>
          )}
          <fieldset>
            <legend>Who made them</legend>
            {originControl}
            {partnersControl}
          </fieldset>
          <fieldset>
            <legend>What they are</legend>
            {kindSelect}
          </fieldset>
          {!social && (
            <fieldset>
              <legend>Who&apos;s on the sky</legend>
              {orbitControl}
            </fieldset>
          )}
          <fieldset>
            <legend>Colour the stars by</legend>
            {colourControl}
          </fieldset>
          <div className="sheet-actions sheet-actions-pinned">
            <button type="button" className="button-ghost" onClick={resetFilters} disabled={active === 0 && colorBy === "character"}>
              Reset
            </button>
            <button type="button" className="primary" onClick={() => setFiltersOpen(false)}>
              {social ? `Show ${tiesShown} ${tiesShown === 1 ? "tie" : "ties"}` : `Show ${pairsShown} ${pairsShown === 1 ? "pair" : "pairs"}`}
            </button>
          </div>
        </div>
      </Sheet>
      {social && lensData && lensData.shown < lensData.ties && (
        <p className="constellation-more small">
          Showing {lensData.shown} of {lensData.ties} ties in {LENS_LABEL[lens]}: the strongest of every kind.
        </p>
      )}
      {!social && !whole && total && (
        <p className="constellation-more small">
          Showing the {first.edges.filter((e) => !e.masked).length} strongest pairs.{" "}
          <button type="button" className="button-ghost small" onClick={() => void loadWholeSky()} disabled={loadingSky} data-track="graph-whole-sky">
            {loadingSky ? "Lighting the rest…" : `Show the whole sky: ${total.characters} characters, ${total.pairs} pairs`}
          </button>
        </p>
      )}
      {worldNode && (
        <p className="constellation-more constellation-world small" role="status">
          {social ? (
            <span>
              Just <strong>{worldNode.name}</strong>&apos;s corner of {LENS_LABEL[lens]}: their ties here, and those people&apos;s (
              {skyNodes.filter((n) => !n.place).length} {skyNodes.filter((n) => !n.place).length === 1 ? "character" : "characters"}).
            </span>
          ) : (
            <span>
              Just <strong>{worldNode.name}</strong>&apos;s corner of the sky: who they dated, and who those dated ({nodes.length}{" "}
              {nodes.length === 1 ? "character" : "characters"}).
            </span>
          )}{" "}
          <button type="button" className="button-ghost small" onClick={() => setWorld(null)} data-track="graph-world-off">
            Show everyone
          </button>
          {/* Their whole world, every kind of tie, is a page of its own (/graph/world/[id]). */}
          {lensesOn && (
            <Link className="tap-link constellation-world-link" href={`/graph/world/${encodeURIComponent(worldNode.id)}`} data-track="graph-world-page">
              See {shortName(worldNode.name)}&apos;s world →
            </Link>
          )}
        </p>
      )}
      <div className="constellation-sky">
        <ConstellationCanvas
          nodes={skyNodes}
          edges={skyEdges}
          selection={selection}
          onSelect={setSelection}
          focusId={focusId}
          fit={fit}
          colorBy={colorBy}
          showOutcomes={showOutcomes}
          label={social ? `The Botchelor constellation: ${LENS_LABEL[lens]}` : undefined}
        />
        {social && (lensLoading || lensFailed === social || lensEmpty || worldAbsent || lensNothing) && (
          <div className="constellation-empty" role="status">
            <p>
              {lensLoading
                ? `Drawing ${LENS_LABEL[lens]}…`
                : lensFailed === social
                  ? `${LENS_LABEL[lens]} didn't load.`
                  : lensEmpty
                    ? LENS_EMPTY[social]
                    : worldAbsent
                      ? `${worldName ?? "They"} ${worldName ? "has" : "have"} no ties in ${LENS_LABEL[lens]} yet.`
                      : `No ties like that in ${LENS_LABEL[lens]}.`}
            </p>
            {!lensLoading && (
              <button
                type="button"
                className="button-ghost small"
                onClick={() => {
                  if (lensFailed === social) {
                    setLensFailed(null);
                    setLensTry((n) => n + 1);
                  } else if (lensEmpty) pickLens("love");
                  else if (worldAbsent) setWorld(null);
                  else {
                    setGroups(null);
                    setOrigin("all");
                    setKind("all");
                  }
                }}
              >
                {lensFailed === social ? "Try again" : lensEmpty ? "Back to Love" : worldAbsent ? "Show everyone" : "Show every tie"}
              </button>
            )}
          </div>
        )}
        {noLines && (
          <div className="constellation-empty" role="status">
            <p>
              {loadingSky
                ? "Looking across the whole sky…"
                : worldGone
                  ? `${worldNode.name} isn't on the sky with these filters.`
                  : worldNode
                    ? `No pairs like that in ${worldNode.name}'s world.`
                    : "No pairs like that on the sky."}
            </p>
            {!loadingSky && (
              <button
                type="button"
                className="button-ghost small"
                onClick={() => {
                  if (worldGone) resetFilters();
                  setStages(null);
                  setWhen("all");
                  setStill(false);
                }}
              >
                {worldGone ? "Clear the filters" : "Show every pair"}
              </button>
            )}
          </div>
        )}
        {social ? (
          lensWhole && (
            <LensPanel
              lens={social}
              selection={selection}
              nodes={lensWhole.nodes}
              edges={lensWhole.edges}
              onClose={() => setSelection(null)}
              onFocus={focus}
              world={worldId}
              onWorld={setWorld}
              worlds={lensesOn}
              colorBy={colorBy}
              clusterNames={clusterNames}
            />
          )
        ) : (
          <SidePanel
            selection={selection}
            nodes={data.nodes}
            edges={data.edges}
            onClose={() => setSelection(null)}
            onFocus={focus}
            world={worldId}
            onWorld={setWorld}
            worlds={lensesOn}
            colorBy={colorBy}
            clusterNames={clusterNames}
            showOutcomes={showOutcomes}
            onShowOutcomes={setShowOutcomes}
          />
        )}
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
                <span className="constellation-swatch" style={{ background: communityColor(c)! }} aria-hidden /> {clusterLabel(c, clusterNames)}
              </li>
            ))}
            {smaller > 0 && (
              <li>
                <span className="constellation-swatch is-grey" aria-hidden /> +{smaller} smaller
              </li>
            )}
            {clusters.length === 0 && <li>{social ? "No clusters yet." : "No clusters yet: every pair dates alone."}</li>}
            <li className="muted">{social ? "Each colour is a circle with most of its ties among itself." : "Each colour is a circle that dates mostly among itself."}</li>
          </ul>
        )}
      </div>
      {social ? (
        <p className="constellation-legend small">{LENS_LEGEND[social]}</p>
      ) : (
        <p className="constellation-legend small">
          Bigger stars have dated more · brighter, thicker lines run deeper · grey dashes keep a pair private
          {showOutcomes ? " · a chevron points at who got turned down" : ""} · the outer ring is still waiting for a first date
        </p>
      )}
      {/* The view's numbers: Love's from the page, another view's from its own build. */}
      {social
        ? lensData &&
          lensData.numbers.length > 0 && (
            <ul className="constellation-stats" aria-label={`${LENS_LABEL[lens]} right now`}>
              {lensData.numbers.map((x) => (
                <li key={x.words}>
                  {x.who ? (
                    <>
                      {x.words}: <strong>{x.who.name}</strong> ({x.n})
                    </>
                  ) : (
                    <>
                      <strong>{x.n}</strong> {x.words}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )
        : loveNumbers}
    </div>
  );
}
