"use client";

import Link from "next/link";
import { useState } from "react";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import { ORIGIN_LABEL } from "@/lib/origin";
import { pageOf } from "@/lib/paging";
import { clusterLine, type ClusterName } from "@/lib/social/cluster-names";
import { TIE_KINDS } from "@/lib/social/kinds";
import { directedWords, endWords, groupDef, kindPairWords, LENS_LABEL, type LensLine } from "@/lib/social/lenses";
import type { SkyLens } from "@/lib/social/types";
import { communityColor, type ColorBy } from "./colors";
import type { Selection } from "./ConstellationCanvas";
import { placeGlyph, type SkyEdge, type SkyNode } from "./lens";
import LineSwatch from "./LineSwatch";
import PairTiesPanel from "./PairTiesPanel";
import { PANEL_PAGE, Tile, WorldLink } from "./SidePanel";

type Props = {
  lens: SkyLens;
  selection: Selection;
  /** The view's whole sky (not only what the filters leave), so a panel names everyone it lists. */
  nodes: SkyNode[];
  edges: SkyEdge[];
  onClose: () => void;
  onFocus: (id: string) => void;
  /** Whose corner of the sky it's cut to ("Just their corner of the sky", ?world=), or null; onWorld sets or clears it. */
  world?: string | null;
  onWorld?: (id: string | null) => void;
  /** Every character has a world page (/graph/world/[id]): their panel links it. */
  worlds?: boolean;
  colorBy: ColorBy;
  /** Clusters named after their places (lib/social/cluster-names.ts), under "Colour by: Cluster"; the rest keep their numbers. */
  clusterNames?: ReadonlyMap<number, ClusterName> | null;
};

/** A line between two characters in words: its kinds, a directed one with who did it ("Ada told Bea"), and if it's over. */
function lineWords(l: LensLine, a: SkyNode, b: SkyNode): string {
  const words = l.k.map((k) => {
    if (!TIE_KINDS[k]?.directed || !l.d) return kindPairWords(k);
    if (l.d === 3) return `${directedWords(k, a.name, b.name)}, and the other way`;
    return l.d === 2 ? directedWords(k, b.name, a.name) : directedWords(k, a.name, b.name);
  });
  return `${words.join(" · ")}${l.e ? " (over now)" : ""}`;
}

/** What someone else is to `me` along one line, for my list: "rival", "someone they told", "told them something". */
function endLineWords(l: LensLine, meIsA: boolean): string {
  const words = l.k.map((k) => {
    if (!TIE_KINDS[k]?.directed || !l.d) return endWords(k, true);
    const out: string[] = [];
    // d: 1 is a to b. I'm the tie's `from` when it runs from my end.
    if (l.d & 1) out.push(endWords(k, meIsA));
    if (l.d & 2) out.push(endWords(k, !meIsA));
    return out.join(", ");
  });
  return `${words.join(" · ")}${l.e ? " (over)" : ""}`;
}

/** A place's face: its mark on a tile. */
function PlaceTile({ kind }: { kind: string }) {
  return (
    <span className="constellation-tile constellation-place-tile" aria-hidden>
      {placeGlyph(kind)}
    </span>
  );
}

/** A list of stars, a page at a time, each a button that jumps the sky to them (a private one: its name only). */
function Stars({ rows, label, onFocus }: { rows: { node: SkyNode; note?: string }[]; label: string; onFocus: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const shown = pageOf(rows, page, PANEL_PAGE);
  return (
    <>
      <ul className="list constellation-panel-list">
        {shown.items.map(({ node, note }) => (
          <li key={node.id}>
            {node.private ? (
              <span className="muted">🔒 {node.name}</span>
            ) : (
              <button type="button" className="link-button char-name" onClick={() => onFocus(node.id)}>
                {node.place ? (
                  <span aria-hidden>{placeGlyph(node.place.kind)}</span>
                ) : (
                  <Avatar seed={node.id} name={node.name} hue={node.hue} portraitSrc={node.portrait} size={22} decorative round />
                )}
                <span className="char-name-text">{node.place ? node.place.words : node.name}</span>
              </button>
            )}
            {note && <span className="muted small"> {note}</span>}
          </li>
        ))}
      </ul>
      <Pager page={shown.page} pages={shown.pages} label={label} onPage={setPage} />
    </>
  );
}

/**
 * What a tap opens in a social view (./lens.ts): a character and their ties in it, a place and who shares it, or a
 * pair's lines in it, then everything between them in any view, with what made each tie (./PairTiesPanel.tsx).
 */
export default function LensPanel({ lens, selection, nodes, edges, onClose, onFocus, world = null, onWorld, worlds = false, colorBy, clusterNames = null }: Props) {
  if (!selection) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const close = (
    <button type="button" className="constellation-close" onClick={onClose} aria-label="Close">
      ×
    </button>
  );
  const view = LENS_LABEL[lens];

  // A place's spoke opens the place.
  const placeId = selection.kind === "node" ? (byId.get(selection.id)?.place ? selection.id : null) : byId.get(selection.a_id)?.place ? selection.a_id : null;
  if (placeId) {
    const place = byId.get(placeId)!;
    const info = place.place!;
    const members = edges.filter((e) => e.spoke && e.a_id === placeId).flatMap((e) => (byId.get(e.b_id) ? [{ node: byId.get(e.b_id)! }] : []));
    return (
      <aside className="constellation-panel card" aria-label={info.words}>
        {close}
        <header className="constellation-panel-head">
          <PlaceTile kind={info.kind} />
          <div>
            <h2>{info.words}</h2>
            <p className="muted small">
              {info.count} {info.count === 1 ? "character shares" : "characters share"} it
              {info.count > members.length ? ` · ${members.length} on the sky` : ""}
            </p>
          </div>
        </header>
        <Stars key={placeId} rows={members} label={`${place.name} pages`} onFocus={onFocus} />
      </aside>
    );
  }

  if (selection.kind === "node") {
    const node = byId.get(selection.id);
    if (!node) return null;
    const mine = edges.filter((e) => e.a_id === node.id || e.b_id === node.id);
    const rows = mine.flatMap((e) => {
      const otherId = e.a_id === node.id ? e.b_id : e.a_id;
      const other = byId.get(otherId);
      if (!other) return [];
      if (other.place) return [{ node: other }];
      if (e.masked) return [{ node: other }];
      const note = (e.lines ?? []).map((l) => endLineWords(l, e.a_id === node.id)).join(" · ");
      return [{ node: other, note }];
    });
    const clusterColor = colorBy === "community" && node.community !== null ? communityColor(node.community) : null;
    const ties = mine.length;
    return (
      <aside className="constellation-panel card" aria-label={`About ${node.name}`}>
        {close}
        <header className="constellation-panel-head">
          <Tile node={node} />
          <div>
            <h2>{node.name}</h2>
            {node.private ? (
              <p className="muted small">Private: their creator keeps them to themselves.</p>
            ) : (
              <p className="muted small">
                {node.kind_label && <span className="badge">{node.kind_label}</span>} {node.origin ? `${ORIGIN_LABEL[node.origin]} · ` : ""}
                {ties} {ties === 1 ? "tie" : "ties"} in {view}
              </p>
            )}
            {colorBy === "community" && node.community !== null && (
              <p className="muted small constellation-cluster-name">
                <span className={`constellation-swatch${clusterColor ? "" : " is-grey"}`} style={clusterColor ? { background: clusterColor } : undefined} aria-hidden />{" "}
                {clusterLine(node.community, clusterNames)}
                {clusterColor ? "" : " (a smaller one, in grey)"}
              </p>
            )}
          </div>
        </header>
        {!node.private && rows.length > 0 && <Stars key={`${lens}:${node.id}`} rows={rows} label={`${node.name}'s ties pages`} onFocus={onFocus} />}
        {!node.private && (
          <p className="constellation-panel-links">
            {worlds && <WorldLink id={node.id} name={node.name} />}
            {onWorld && ties > 0 && (
              <>
                <button
                  type="button"
                  className="button-ghost small"
                  onClick={() => onWorld(world === node.id ? null : node.id)}
                  title={world === node.id ? "Back to the whole sky" : "Them, their ties here, and those people's ties"}
                  data-track={world === node.id ? "graph-world-off" : "graph-world"}
                >
                  {world === node.id ? "Show everyone" : "Just their corner of the sky"}
                </button>{" "}
              </>
            )}
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
  const dated = (edge.lines ?? []).some((l) => l.k.includes("dated"));
  return (
    <aside className="constellation-panel card" aria-label={`${a.name} and ${b.name}`}>
      {close}
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
          {edge.masked && <p className="muted small">One of them is private: what&apos;s between them stays between them.</p>}
        </div>
      </header>
      {!edge.masked && (
        <ul className="list constellation-panel-list constellation-pair-lines">
          {(edge.lines ?? []).map((l) => (
            <li key={`${l.g}:${l.k.join("+")}`}>
              <LineSwatch social={l.s} sour={l.v < 0} />{" "}
              <strong>{groupDef(lens, l.g)?.label ?? l.g}</strong> <span className="muted small">{lineWords(l, a, b)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Every tie between them in any view, over or not, with what made it and their history (./PairTiesPanel.tsx). */}
      {!edge.masked && !edge.spoke && <PairTiesPanel key={`${edge.a_id}~${edge.b_id}`} a={edge.a_id} b={edge.b_id} />}
      {!anyPrivate && (
        <p className="constellation-panel-links">
          {dated && (
            <>
              <Link className="button-ghost small" href={`/couples/${edge.a_id}/${edge.b_id}`}>
                Their story →
              </Link>{" "}
            </>
          )}
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
